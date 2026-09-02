import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestTestApp } from './http-test-utils.js';

type DatabaseModule = typeof import('../src/db/database.js');
type DeletionJobModule = typeof import('../src/services/deletion-job-service.js');

async function requestApp(app: express.Application, method: string, urlPath: string, body?: unknown) {
  return requestTestApp(app, method, urlPath, { 'x-foldergram-intent': '1' }, body);
}

describe.sequential('permanent deletion batch routes', () => {
  let tempRoot = '';
  let app: express.Application;
  let deletionJobService: DeletionJobModule['deletionJobService'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-deletion-routes-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    try {
      const dbModule: DatabaseModule = await import('../src/db/database.js');
      dbModule.databaseManager.close();
    } catch {
      // Not loaded yet.
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
    await Promise.all([
      fs.mkdir(path.join(tempRoot, 'db'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'gallery'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'thumbnails'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'previews'), { recursive: true })
    ]);

    vi.resetModules();
    const { createApp } = await import('../src/app.js');
    ({ deletionJobService } = await import('../src/services/deletion-job-service.js'));
    app = createApp();
  });

  it('does not let /posts/deletions/batch fall through to the /posts/:id handler', async () => {
    // `deletions` is not a numeric id, so a wrong route order would surface as a
    // 400 from imageIdSchema instead of a job snapshot.
    const response = await requestApp(app, 'GET', '/api/posts/deletions/batch');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      job: { active: false, total: 0, processed: 0, remaining: 0 }
    });
  });

  it('queues a batch, reports it, and clears it on acknowledge', async () => {
    const enqueued = await requestApp(app, 'POST', '/api/posts/deletions/batch', { ids: [4242] });

    expect(enqueued.status).toBe(200);
    expect(enqueued.body.job.total).toBe(1);

    // The id does not exist, so the job records a failure and finishes quickly.
    await vi.waitFor(() => {
      expect(deletionJobService.getSnapshot().active).toBe(false);
    });

    const reported = await requestApp(app, 'GET', '/api/posts/deletions/batch');
    expect(reported.body.job).toMatchObject({ active: false, total: 1, processed: 1, failedCount: 1 });

    const acknowledged = await requestApp(app, 'DELETE', '/api/posts/deletions/batch');
    expect(acknowledged.body.job).toMatchObject({ active: false, total: 0, processed: 0 });
  });

  it('rejects an empty or oversized id list', async () => {
    const empty = await requestApp(app, 'POST', '/api/posts/deletions/batch', { ids: [] });
    expect(empty.status).toBe(400);

    const oversized = await requestApp(app, 'POST', '/api/posts/deletions/batch', {
      ids: Array.from({ length: 5001 }, (_value, index) => index + 1)
    });
    expect(oversized.status).toBe(400);
  });

  it('requires the delete capability when auth is enabled', async () => {
    const { authService } = await import('../src/services/auth-service.js');
    authService.setAdminPassword('admin12345');
    authService.setViewerAccess('public', null);

    // Anonymous callers are turned away before the job service is reached: 401 when
    // the session itself is missing, 403 when the session lacks canDeleteMedia.
    const anonymous = await requestApp(app, 'POST', '/api/posts/deletions/batch', { ids: [1] });
    expect([401, 403]).toContain(anonymous.status);

    const anonymousRead = await requestApp(app, 'GET', '/api/posts/deletions/batch');
    expect([401, 403]).toContain(anonymousRead.status);
    expect(deletionJobService.getSnapshot().total).toBe(0);
  });
});
