import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';

import { describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

function createRequest(method: string): express.Request {
  return {
    method
  } as express.Request;
}

function createResponse() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis()
  } as unknown as express.Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe.sequential('blockPublicDemoMutations', () => {
  it('blocks mutating requests when public demo mode is enabled', async () => {
    vi.resetModules();
    vi.stubEnv('PUBLIC_DEMO_MODE', '1');

    const middleware = await import('../src/middleware/public-demo-mode.js');
    const request = createRequest('DELETE');
    const response = createResponse();
    const next = vi.fn();

    middleware.blockPublicDemoMutations(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({ message: middleware.PUBLIC_DEMO_DISABLED_MESSAGE });
    vi.unstubAllEnvs();
  });

  it('allows safe requests in public demo mode', async () => {
    vi.resetModules();
    vi.stubEnv('PUBLIC_DEMO_MODE', '1');

    const middleware = await import('../src/middleware/public-demo-mode.js');
    const request = createRequest('GET');
    const response = createResponse();
    const next = vi.fn();

    middleware.blockPublicDemoMutations(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('reports demo mode with admin capabilities and blocks both appearance writes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-demo-appearance-'));
    vi.resetModules();
    vi.stubEnv('PUBLIC_DEMO_MODE', '1');
    vi.stubEnv('NODE_ENV', 'test');
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) vi.stubEnv(key, path.join(root, directory));

    try {
      const { createApp } = await import('../src/app.js');
      const app = createApp();
      expect(await requestTestApp(app, 'GET', '/api/auth/status')).toMatchObject({
        status: 200, body: { enabled: false, publicDemoMode: true, capabilities: { canAccessSettings: true } }
      });
      expect(await requestTestApp(app, 'GET', '/api/appearance')).toMatchObject({
        status: 200, body: { theme: 'system', accent: 'blue' }
      });
      for (const [method, payload] of [['PATCH', { theme: 'dark' }], ['PUT', { theme: 'dark', accent: 'rose' }]] as const) {
        expect(await requestTestApp(app, method, '/api/admin/settings/appearance', { 'x-foldergram-intent': '1' }, payload))
          .toMatchObject({ status: 403, body: { message: 'Disabled in public demo.' } });
      }
      expect(await requestTestApp(app, 'GET', '/api/appearance')).toMatchObject({
        status: 200, body: { theme: 'system', accent: 'blue' }
      });
    } finally {
      const { databaseManager } = await import('../src/db/database.js');
      databaseManager.close();
      vi.unstubAllEnvs();
      vi.resetModules();
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it('allows mutating requests when public demo mode is disabled', async () => {
    vi.resetModules();
    vi.stubEnv('PUBLIC_DEMO_MODE', '0');

    const middleware = await import('../src/middleware/public-demo-mode.js');
    const request = createRequest('POST');
    const response = createResponse();
    const next = vi.fn();

    middleware.blockPublicDemoMutations(request, response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
