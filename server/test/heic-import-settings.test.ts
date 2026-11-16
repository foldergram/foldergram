import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HEIC_IMPORT_ENABLED_SETTING_KEY } from '../src/constants/app-setting-keys.js';
import { requestTestApp } from './http-test-utils.js';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

const settingPath = '/api/admin/settings/heic-import';
const mutationHeaders = { 'x-foldergram-intent': '1' };

describe('HEIC import settings', () => {
  let root: string;
  let db: typeof import('../src/db/database.js')['databaseManager'] | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-heic-settings-'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(root, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(root, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(root, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(root, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(root, 'previews'));
    vi.stubEnv('PUBLIC_DEMO_MODE', '0');
    vi.stubEnv('HEIC_ENABLED', undefined);
    vi.resetModules();
  });

  afterEach(async () => {
    db?.close();
    db = undefined;
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function startApp() {
    ({ databaseManager: db } = await import('../src/db/database.js'));
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    authService.refresh();
    const app = createApp();
    return (method: string, body?: unknown, headers: Record<string, string> = mutationHeaders, url = settingPath) =>
      requestTestApp(app, method, url, headers, body);
  }

  it('defaults off, persists both choices, and schedules no scan', async () => {
    const request = await startApp();
    const { appSettingsRepository, scanRunRepository } = await import('../src/db/repositories.js');
    expect(await request('GET')).toMatchObject({
      status: 200, body: { enabled: false, managedByEnvironment: false, libraryWorkPending: false }
    });
    expect(appSettingsRepository.get(HEIC_IMPORT_ENABLED_SETTING_KEY)).toBeNull();

    for (const enabled of [true, false]) {
      expect(await request('PUT', { enabled })).toMatchObject({ status: 200, body: { enabled, managedByEnvironment: false } });
      expect(appSettingsRepository.get(HEIC_IMPORT_ENABLED_SETTING_KEY)).toBe(enabled ? '1' : '0');
      db?.close();
      expect(await request('GET')).toMatchObject({ status: 200, body: { enabled, libraryWorkPending: false } });
    }
    expect(scanRunRepository.latest()).toBeUndefined();
  });

  it.each(['true', 'false'] as const)('uses explicit HEIC_ENABLED=%s and rejects edits', async (override) => {
    vi.stubEnv('HEIC_ENABLED', override);
    const request = await startApp();
    const { appSettingsRepository } = await import('../src/db/repositories.js');
    const enabled = override === 'true';
    const storedValue = enabled ? '0' : '1';
    appSettingsRepository.set(HEIC_IMPORT_ENABLED_SETTING_KEY, storedValue);
    expect(await request('GET')).toMatchObject({ status: 200, body: { enabled, managedByEnvironment: true } });
    for (const attemptedValue of [enabled, !enabled]) {
      expect(await request('PUT', { enabled: attemptedValue })).toMatchObject({
        status: 409, body: { message: 'HEIC imports are managed by environment configuration.' }
      });
    }
    expect(appSettingsRepository.get(HEIC_IMPORT_ENABLED_SETTING_KEY)).toBe(storedValue);
  });

  it('requires admin access and the existing mutation intent header', async () => {
    const request = await startApp();
    const { authService } = await import('../src/services/auth-service.js');
    const adminPassword = 'fixture-admin-password';
    const viewerPassword = 'fixture-viewer-password';
    authService.setAdminPassword(adminPassword);
    authService.setViewerAccess('password', viewerPassword);

    expect((await request('GET')).status).toBe(401);
    expect((await request('PUT', { enabled: true })).status).toBe(401);

    async function login(password: string) {
      const result = await request('POST', { password }, mutationHeaders, '/api/auth/login');
      expect(result.status).toBe(200);
      return { Cookie: result.headers.get('set-cookie')!.split(';', 1)[0] };
    }

    const viewer = await login(viewerPassword);
    expect((await request('GET', undefined, viewer)).status).toBe(403);
    expect((await request('PUT', { enabled: true }, { ...viewer, ...mutationHeaders })).status).toBe(403);

    const admin = await login(adminPassword);
    expect((await request('GET', undefined, admin)).status).toBe(200);
    expect((await request('PUT', { enabled: true }, admin)).status).toBe(403);
    expect((await request('PUT', { enabled: true }, { ...admin, ...mutationHeaders })).status).toBe(200);
  });

  it('rejects missing, non-boolean, and unexpected fields', async () => {
    const request = await startApp();
    for (const body of [undefined, {}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }, { enabled: true, extra: true }]) {
      expect((await request('PUT', body)).status).toBe(400);
    }
    expect(await request('GET')).toMatchObject({ status: 200, body: { enabled: false } });
  });

  it('rejects updates while a scan is queued before discovery begins', async () => {
    const request = await startApp();
    const { scannerService } = await import('../src/services/scanner-service.js');
    const { maintenanceOperationLock } = await import('../src/services/maintenance-operation-lock.js');
    const { promise: releasePromise, resolve: release } = Promise.withResolvers<void>();
    const lock = maintenanceOperationLock.runExclusive(() => releasePromise);
    const scan = scannerService.scanAll('fixture');

    try {
      expect(scannerService.getProgress().isScanning).toBe(false);
      expect(await request('GET')).toMatchObject({ status: 200, body: { libraryWorkPending: true } });
      expect(await request('PUT', { enabled: true })).toMatchObject({
        status: 409, body: { message: 'Wait for the current scan or rebuild to finish.' }
      });
    } finally {
      release();
      await lock;
      await scan;
    }
    expect(await request('GET')).toMatchObject({ status: 200, body: { enabled: false, libraryWorkPending: false } });
    expect((await request('PUT', { enabled: true })).status).toBe(200);
  });

  it('applies the preference when inspecting local sources', async () => {
    const request = await startApp();
    const secondary = path.join(root, 'secondary');
    await Promise.all([
      fs.mkdir(secondary, { recursive: true }),
      fs.mkdir(path.join(root, 'gallery'), { recursive: true })
    ]);
    for (const directory of [secondary, path.join(root, 'gallery')]) {
      await fs.writeFile(path.join(directory, 'ignored.heif'), '');
      await fs.writeFile(path.join(directory, 'ignored.jpg'), '');
    }

    for (const enabled of [false, true, false]) {
      expect((await request('PUT', { enabled })).status).toBe(200);
      const count = enabled ? 2 : 1;
      expect(await request('POST', { rootPath: secondary }, mutationHeaders, '/api/admin/sources/local/test'))
        .toMatchObject({ status: 200, body: { ignoredRootMediaCount: count } });
      expect(await request('GET', undefined, {}, '/api/status'))
        .toMatchObject({ status: 200, body: { libraryIndex: { ignoredRootMediaCount: count } } });
    }
  });
});
