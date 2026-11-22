import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestTestApp } from './http-test-utils.js';
import type { ScanRunRecord } from '../src/types/models.js';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

describe('persistent scan issue acknowledgements', () => {
  let root: string;
  let app: express.Application;
  let db: typeof import('../src/db/database.js')['databaseManager'];
  let runs: typeof import('../src/db/repositories.js')['scanRunRepository'];
  const headers = { 'x-foldergram-intent': '1' };
  const endpoint = '/api/admin/scan-issues/acknowledge';
  const identity = ({ id, started_at, finished_at }: ScanRunRecord) => ({ id, started_at, finished_at });
  const acknowledge = (results: ScanRunRecord[], extraHeaders = {}) =>
    requestTestApp(app, 'POST', endpoint, { ...headers, ...extraHeaders }, { results: results.map(identity) });
  const issues = async () => (await requestTestApp(app, 'GET', '/api/admin/scan-progress')).body.recentIssues as ScanRunRecord[];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-scan-ack-'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PUBLIC_DEMO_MODE', '0');
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) vi.stubEnv(key, path.join(root, directory));
    vi.resetModules();
    ({ databaseManager: db } = await import('../src/db/database.js'));
    ({ scanRunRepository: runs } = await import('../src/db/repositories.js'));
    app = (await import('../src/app.js')).createApp();
  });

  afterEach(async () => {
    db?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(root, { recursive: true, force: true });
  });

  function seed(status = 'failed'): ScanRunRecord {
    const id = runs.start();
    if (status !== 'running') runs.finish(id, {
      finished_at: new Date().toISOString(), status,
      scanned_files: 0, new_files: 0, updated_files: 0, removed_files: 0,
      error_text: status === 'completed' ? null : 'Scan interrupted by server restart. Run a scan to continue.',
      warning_count: 0, warning_text: null
    });
    return runs.latest()!;
  }

  it('shares acknowledgements across fresh requests and server restarts without changing scan history', async () => {
    const older = seed();
    const issue = seed();
    const completed = seed('completed');
    expect((await issues()).map(run => run.id)).toEqual([issue.id, older.id]);
    expect(await acknowledge([issue, older])).toMatchObject({ status: 200, body: { ok: true } });
    expect(await acknowledge([issue, older])).toMatchObject({ status: 200 });
    expect(await issues()).toEqual([]);

    db.close();
    vi.resetModules();
    ({ databaseManager: db } = await import('../src/db/database.js'));
    ({ scanRunRepository: runs } = await import('../src/db/repositories.js'));
    runs.recoverInterrupted();
    app = (await import('../src/app.js')).createApp();
    expect(await issues()).toEqual([]);
    const stats = await requestTestApp(app, 'GET', '/api/admin/stats');
    expect(stats.body.scan.recentIssues).toEqual([]);
    expect(stats.body.scan.lastCompletedScan).toEqual(completed);
    expect(db.connection.prepare('SELECT * FROM scan_runs ORDER BY id').all()).toEqual([older, issue, completed]);

    const newer = seed();
    expect((await issues()).map(run => run.id)).toEqual([newer.id]);
  });

  it('only acknowledges the exact displayed records and preserves newer, running, and successful scans', async () => {
    const issue = seed();
    const completed = seed('completed');
    const running = seed('running');
    const newer = seed();
    await acknowledge([issue, completed, { ...running, finished_at: issue.finished_at }]);
    expect((await issues()).map(run => run.id)).toEqual([newer.id]);
    expect(runs.latest()).toEqual(newer);

    await acknowledge([{ ...newer, started_at: '2000-01-01T00:00:00.000Z' }]);
    expect((await issues()).map(run => run.id)).toEqual([newer.id]);
  });

  it('merges separate acknowledgements without evicting older acknowledgements', async () => {
    const oldest = seed();
    await acknowledge([oldest]);
    for (let index = 0; index < 55; index += 1) {
      const issue = seed();
      runs.acknowledgeIssues([identity(issue)]);
    }
    db.connection.prepare('DELETE FROM scan_runs WHERE id <> ?').run(oldest.id);
    expect(await issues()).toEqual([]);
  });

  it('does not acknowledge a new run that reuses a removed run ID', async () => {
    const issue = seed();
    await acknowledge([issue]);
    db.connection.prepare('DELETE FROM scan_runs WHERE id = ?').run(issue.id);
    db.connection.prepare(`
      INSERT INTO scan_runs (id, source_id, started_at, finished_at, status, error_text)
      VALUES (?, ?, '2099-01-01T00:00:00.000Z', '2099-01-01T00:01:00.000Z', 'failed', 'New failure')
    `).run(issue.id, (issue as ScanRunRecord & { source_id: number }).source_id);
    expect((await issues()).map(run => run.error_text)).toEqual(['New failure']);
    await acknowledge([issue]);
    expect(await issues()).toHaveLength(1);
  });

  it('rolls back the entire acknowledgement when a database write fails', async () => {
    const older = seed();
    const issue = seed();
    db.connection.exec(`
      CREATE TRIGGER reject_scan_ack BEFORE INSERT ON app_settings
      WHEN NEW.key = 'scanner.acknowledged_scan.${issue.id}'
      BEGIN SELECT RAISE(ABORT, 'Fixture write failure'); END;
    `);
    expect(await acknowledge([older, issue])).toMatchObject({ status: 400 });
    expect((await issues()).map(run => run.id)).toEqual([issue.id, older.id]);
    db.connection.exec('DROP TRIGGER reject_scan_ack');
    await acknowledge([older, issue]);
    expect(await issues()).toEqual([]);
  });

  it('cleans up acknowledgements when their source scan history is reset', async () => {
    const issue = seed();
    await acknowledge([issue]);
    const { maintenanceRepository } = await import('../src/db/repositories.js');
    maintenanceRepository.resetLibraryIndex();
    expect(db.connection.prepare("SELECT key FROM app_settings WHERE key LIKE 'scanner.acknowledged_scan.%'").all()).toEqual([]);
  });

  it.each([{}, { results: [] }, { results: [{ id: 1 }] },
    { results: [{ id: -1, started_at: 'invalid', finished_at: null }] },
    { results: Array.from({ length: 11 }, () => ({ id: 1, started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:01:00Z' })) }
  ])('rejects invalid or oversized acknowledgement requests: %j', async body => {
    const issue = seed();
    expect(await requestTestApp(app, 'POST', endpoint, headers, body)).toMatchObject({ status: 400 });
    expect((await issues()).map(run => run.id)).toEqual([issue.id]);
  });

  it('requires mutation intent and a trusted origin', async () => {
    const issue = seed();
    expect(await requestTestApp(app, 'POST', endpoint, {}, { results: [identity(issue)] })).toMatchObject({ status: 403 });
    expect(await acknowledge([issue], { Origin: 'https://untrusted.example' })).toMatchObject({ status: 403 });
    expect(await issues()).toHaveLength(1);
  });

  it('rejects anonymous and viewer acknowledgements while allowing an admin', async () => {
    const issue = seed();
    const { authService } = await import('../src/services/auth-service.js');
    authService.setAdminPassword('admin-password');
    authService.setViewerAccess('password', 'viewer-password');
    expect(await acknowledge([issue])).toMatchObject({ status: 401 });

    const login = async (password: string) => {
      const response = await requestTestApp(app, 'POST', '/api/auth/login', headers, { password });
      expect(response.status).toBe(200);
      return response.headers.get('set-cookie')!.split(';')[0];
    };
    expect(await acknowledge([issue], { Cookie: await login('viewer-password') })).toMatchObject({ status: 403 });
    expect(await acknowledge([issue], { Cookie: await login('admin-password') })).toMatchObject({ status: 200 });
    expect(runs.recentIssues()).toEqual([]);
  });

  it('rejects acknowledgements in public demo mode', async () => {
    const issue = seed();
    const { appConfig } = await import('../src/config/env.js');
    appConfig.publicDemoMode = true;
    expect(await acknowledge([issue])).toMatchObject({ status: 403, body: { message: 'Disabled in public demo.' } });
    expect(await issues()).toHaveLength(1);
  });
});
