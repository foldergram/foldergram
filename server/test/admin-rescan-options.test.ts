import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestTestApp as requestApp } from './http-test-utils.js';

const { scanAllMock } = vi.hoisted(() => ({
  scanAllMock: vi.fn()
}));

describe.sequential('admin rescan options', () => {
  let tempRoot = '';
  let app: express.Application;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-admin-rescan-'));
  });

  beforeEach(async () => {
    scanAllMock.mockReset();
    scanAllMock.mockResolvedValue({ id: 1, status: 'completed' });

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    vi.doMock('../src/services/scanner-service.js', () => ({
      LIBRARY_REBUILD_REQUIRED_MESSAGE: 'Library rebuild required before scanning because the configured gallery root changed.',
      scannerService: {
        getProgress: () => ({ isScanning: false }),
        isLibraryRebuildRequired: () => false,
        scanAll: scanAllMock
      }
    }));
    vi.doMock('../src/services/watcher-service.js', () => ({
      watcherService: {
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockResolvedValue(undefined)
      }
    }));

    vi.stubEnv('NODE_ENV', 'test');
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data',
      GALLERY_ROOT: 'gallery',
      DB_DIR: 'db',
      THUMBNAILS_DIR: 'thumbnails',
      PREVIEWS_DIR: 'previews'
    })) {
      vi.stubEnv(key, path.join(tempRoot, directory));
    }

    const { createApp } = await import('../src/app.js');
    app = createApp();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.doUnmock('../src/services/scanner-service.js');
    vi.doUnmock('../src/services/watcher-service.js');
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('preserves repair-default behavior for absent, empty, and explicit true bodies', async () => {
    const cases: Array<{ body?: unknown; expected: boolean }> = [
      { body: undefined, expected: true },
      { body: {}, expected: true },
      { body: { repairDerivatives: true }, expected: true }
    ];

    for (const testCase of cases) {
      scanAllMock.mockClear();
      const response = await requestApp(app, 'POST', '/api/admin/rescan', { 'x-foldergram-intent': '1' }, testCase.body);

      expect(response.status).toBe(200);
      expect(scanAllMock).toHaveBeenCalledWith('manual', {
        repairUnchangedDerivatives: testCase.expected
      });
    }
  });

  it('passes an explicit quick-scan request through to the scanner', async () => {
    const response = await requestApp(app, 'POST', '/api/admin/rescan', { 'x-foldergram-intent': '1' }, {
      repairDerivatives: false
    });

    expect(response.status).toBe(200);
    expect(scanAllMock).toHaveBeenCalledWith('manual', {
      repairUnchangedDerivatives: false
    });
  });

  it.each([
    ['string boolean', { repairDerivatives: 'false' }],
    ['null', null],
    ['array', []],
    ['non-object', 'false']
  ])('rejects an invalid %s body with 400 without scanning', async (_label, body) => {
    const response = await requestApp(app, 'POST', '/api/admin/rescan', { 'x-foldergram-intent': '1' }, body);

    expect(response.status).toBe(400);
    expect(scanAllMock).not.toHaveBeenCalled();
  });
});
