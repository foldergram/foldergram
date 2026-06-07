import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ApiModule = typeof import('../src/routes/api.js');
type EnvModule = typeof import('../src/config/env.js');

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: express.RequestHandler }>;
  };
}

describe.sequential('admin route rate limiting', () => {
  let tempRoot = '';
  let apiRouter: ApiModule['apiRouter'];
  let appConfig: EnvModule['appConfig'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-admin-rate-limit-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    ({ appConfig } = await import('../src/config/env.js'));
    await (await import('../src/db/repositories.js')).initRepositories();
    ({ apiRouter } = await import('../src/routes/api.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.dbDir, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('does not attach the mutation rate limiter to admin stats', async () => {
    const handlers = getRouteHandlers('/admin/stats', 'get');

    expect(handlers.length).toBeGreaterThanOrEqual(2);

    const request = { ip: '127.0.0.1' } as express.Request;
    const terminalHandler = handlers.at(-1)!;

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = createResponse();

      await terminalHandler(request, response as unknown as express.Response, vi.fn());

      expect(response.status).not.toHaveBeenCalled();
      expect(response.json).toHaveBeenCalledOnce();
    }
  });

  it('keeps the mutation rate limiter on admin rescan', async () => {
    const handlers = getRouteHandlers('/admin/rescan', 'post');

    expect(handlers.length).toBeGreaterThanOrEqual(3);

    const request = { ip: '127.0.0.1' } as express.Request;
    const rateLimiter = handlers[1]!;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = createResponse();
      const next = vi.fn();

      rateLimiter(request, response as unknown as express.Response, next);

      expect(next).toHaveBeenCalledOnce();
      expect(response.status).not.toHaveBeenCalled();
    }

    const response = createResponse();
    const next = vi.fn();

    rateLimiter(request, response as unknown as express.Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(429);
    expect(response.json).toHaveBeenCalledWith({
      message: 'Too many administrative requests. Please try again in a minute.'
    });
  });

  function getRouteHandlers(routePath: string, method: 'get' | 'post'): express.RequestHandler[] {
    const routerLayers = (apiRouter as unknown as { stack: RouteLayer[] }).stack;
    const layer = routerLayers.find((entry) => entry.route?.path === routePath && entry.route.methods[method]);

    if (!layer?.route) {
      throw new Error(`Route ${method.toUpperCase()} ${routePath} was not found`);
    }

    return layer.route.stack.map((entry) => entry.handle);
  }
});

function createResponse(): MockResponse {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn()
  };
}
