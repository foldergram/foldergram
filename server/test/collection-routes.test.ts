import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ApiModule = typeof import('../src/routes/api.js');
type EnvModule = typeof import('../src/config/env.js');

interface MockResponse {
  json: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  status: ReturnType<typeof vi.fn>;
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: express.RequestHandler }>;
  };
}

type RouteMethod = 'get' | 'post' | 'patch' | 'delete';

describe.sequential('collection routes', () => {
  let tempRoot = '';
  let apiRouter: ApiModule['apiRouter'];
  let appConfig: EnvModule['appConfig'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-collection-routes-'));

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
    await (await import('../src/db/repositories.js')).initRepositories();
    ({ apiRouter } = await import('../src/routes/api.js'));
    ({ appConfig } = await import('../src/config/env.js'));

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

  it('surfaces a useful duplicate-name error that the app error middleware returns as 400 JSON', async () => {
    const createHandlerError = await invokeRoute('/collections', 'post', {
      body: { name: 'Travel' },
      headers: {}
    });
    expect(createHandlerError).toBeUndefined();

    const duplicateResponse = createResponse();
    const duplicateError = await invokeRoute(
      '/collections',
      'post',
      {
        body: { name: ' travel ' },
        headers: {}
      },
      duplicateResponse
    );

    applyAppErrorResponse(duplicateError, duplicateResponse);

    expect(duplicateResponse.status).toHaveBeenCalledWith(400);
    expect(duplicateResponse.json).toHaveBeenCalledWith({ message: 'Collection name already exists.' });
  });

  it('returns 404 for the removed synthetic __all collection route', async () => {
    const response = createResponse();
    const error = await invokeRoute(
      '/collections/:slug/images',
      'get',
      {
        params: { slug: '__all' },
        query: {},
        headers: {}
      },
      response
    );

    expect(error).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ message: 'Collection not found' });
  });

  function createResponse(): MockResponse {
    const response: MockResponse = {
      setHeader: vi.fn(),
      status: vi.fn(),
      json: vi.fn()
    };

    response.status.mockReturnValue(response);
    return response;
  }

  function applyAppErrorResponse(error: unknown, response: MockResponse) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    response.status(400).json({ message });
  }

  function getRouteHandlers(pathname: string, method: RouteMethod) {
    const routerLayers = (apiRouter as unknown as { stack: RouteLayer[] }).stack;
    const route = routerLayers.find((layer) => layer.route?.path === pathname && layer.route.methods[method])?.route;
    if (!route) {
      throw new Error(`Route ${method.toUpperCase()} ${pathname} not found`);
    }

    return route.stack.map((layer) => layer.handle);
  }

  async function invokeRoute(
    pathname: string,
    method: RouteMethod,
    request: Partial<express.Request>,
    response = createResponse()
  ): Promise<unknown> {
    const handlers = getRouteHandlers(pathname, method);
    let thrownError: unknown;
    const pendingPromises: Promise<unknown>[] = [];

    function makeNext(index: number): express.NextFunction {
      return (error?: unknown): void => {
        if (error) {
          thrownError ??= error;
          return;
        }
        const nextIndex = index + 1;
        if (nextIndex < handlers.length) {
          const p = handlers[nextIndex]?.(
            request as express.Request,
            response as unknown as express.Response,
            makeNext(nextIndex)
          );
          if (p instanceof Promise) {
            pendingPromises.push(p.catch((e: unknown) => { thrownError ??= e; }));
          }
        }
      };
    }

    try {
      const p = handlers[0]?.(
        request as express.Request,
        response as unknown as express.Response,
        makeNext(0)
      );
      if (p instanceof Promise) {
        await p.catch((e: unknown) => { thrownError ??= e; });
      }
    } catch (error) {
      thrownError ??= error;
    }

    await Promise.all(pendingPromises);
    return thrownError;
  }
});
