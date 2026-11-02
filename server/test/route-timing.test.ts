import os from 'node:os';
import path from 'node:path';
import fsPromises from 'node:fs/promises';

import type { NextFunction, Request, Response } from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type RouteTimingModule = typeof import('../src/middleware/route-timing.js');
type TimingModule = typeof import('../src/utils/perf-timing.js');
type EnvModule = typeof import('../src/config/env.js');

function createRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/admin/stats',
    route: { path: '/admin/stats' },
    ...overrides
  } as unknown as Request;
}

function createResponse() {
  const finishHandlers: Array<() => void> = [];
  const originalEnd = vi.fn();
  const response = {
    once: vi.fn((event: string, handler: () => void) => {
      if (event === 'finish') {
        finishHandlers.push(handler);
      }
    }),
    setHeader: vi.fn(),
    end: originalEnd,
    headersSent: false
  };

  return { response, finishHandlers, originalEnd };
}

describe.sequential('route timing middleware', () => {
  let tempRoot = '';
  let routeTimingMiddleware: RouteTimingModule['routeTimingMiddleware'];
  let isSlowOperationDuration: TimingModule['isSlowOperationDuration'];
  let logInfoSpy = vi.fn();

  beforeAll(async () => {
    tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'insta-route-timing-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ routeTimingMiddleware } = await import('../src/middleware/route-timing.js'));
    ({ isSlowOperationDuration } = await import('../src/utils/perf-timing.js'));
    await import('../src/config/env.js');
  });

  beforeEach(() => {
    logInfoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  });

  it('does not modify the response for non-development sessions', () => {
    const request = createRequest();
    const { response, finishHandlers } = createResponse();
    const next: NextFunction = vi.fn();
    const originalEnd = (response as { end: unknown }).end;

    routeTimingMiddleware(request, response as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((response as { setHeader: ReturnType<typeof vi.fn> }).setHeader).not.toHaveBeenCalled();
    expect((response as { end: unknown }).end).toBe(originalEnd);
    expect(finishHandlers).toHaveLength(1);
    expect(logInfoSpy).not.toHaveBeenCalled();
  });

  it('stays silent when a fast route finishes', () => {
    const request = createRequest({ route: undefined } as Partial<Request>);
    const { response, finishHandlers } = createResponse();
    const next: NextFunction = vi.fn();

    routeTimingMiddleware(request, response as unknown as Response, next);
    expect(finishHandlers).toHaveLength(1);

    finishHandlers[0]?.();

    expect(logInfoSpy).not.toHaveBeenCalled();
  });

  it('logs slow route finishes with a stable, query-free route context', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    let nowValue = 0;
    nowSpy.mockImplementation(() => nowValue);

    try {
      const request = createRequest({ path: '/api/admin/stats?seed=1' });
      const { response, finishHandlers } = createResponse();
      const next: NextFunction = vi.fn();

      routeTimingMiddleware(request, response as unknown as Response, next);
      nowValue = 1500;
      finishHandlers[0]?.();

      const loggedLines = logInfoSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(loggedLines).toContain('Slow API request: GET /admin/stats');
      expect(loggedLines).toContain('durationMs=1500');
      expect(loggedLines).not.toContain('/api/admin/stats?seed=1');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('uses the first safe template for array-valued route paths', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    let nowValue = 0;
    nowSpy.mockImplementation(() => nowValue);

    try {
      const request = createRequest({
        path: '/api/collections/private-family-trip/posts/42',
        route: {
          path: ['/collections/:slug/posts/:id', '/collections/:slug/images/:id']
        }
      } as Partial<Request>);
      const { response, finishHandlers } = createResponse();
      const next: NextFunction = vi.fn();

      routeTimingMiddleware(request, response as unknown as Response, next);
      nowValue = 1500;
      finishHandlers[0]?.();

      const loggedLines = logInfoSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(loggedLines).toContain('Slow API request: GET /collections/:slug/posts/:id');
      expect(loggedLines).not.toContain('private-family-trip');
      expect(loggedLines).not.toContain('/posts/42');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('uses a fixed label when no safe route template is available', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    let nowValue = 0;
    nowSpy.mockImplementation(() => nowValue);

    try {
      const request = createRequest({
        path: '/api/folders/private-family-trip/images',
        route: undefined
      } as Partial<Request>);
      const { response, finishHandlers } = createResponse();
      const next: NextFunction = vi.fn();

      routeTimingMiddleware(request, response as unknown as Response, next);
      nowValue = 1500;
      finishHandlers[0]?.();

      const loggedLines = logInfoSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(loggedLines).toContain('Slow API request: GET unmatched');
      expect(loggedLines).not.toContain('private-family-trip');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not log raw paths for requests rejected before routing', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    let nowValue = 0;
    nowSpy.mockImplementation(() => nowValue);

    try {
      const request = createRequest({
        method: 'POST',
        path: '/api/admin/rescan?token=secret',
        route: undefined
      } as Partial<Request>);
      const { response, finishHandlers } = createResponse();
      const next: NextFunction = vi.fn();

      routeTimingMiddleware(request, response as unknown as Response, next);
      nowValue = 2000;
      finishHandlers[0]?.();

      const loggedLines = logInfoSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(loggedLines).toContain('Slow API request: POST unmatched');
      expect(loggedLines).not.toContain('token=secret');
      expect(loggedLines).not.toContain('/api/admin/rescan');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('uses the fixed label for regex-valued route paths', () => {
    const nowSpy = vi.spyOn(performance, 'now');
    let nowValue = 0;
    nowSpy.mockImplementation(() => nowValue);

    try {
      const request = createRequest({
        path: '/api/private-family-trip',
        route: { path: /^\/api\/.*$/ }
      } as Partial<Request>);
      const { response, finishHandlers } = createResponse();
      const next: NextFunction = vi.fn();

      routeTimingMiddleware(request, response as unknown as Response, next);
      nowValue = 1500;
      finishHandlers[0]?.();

      const loggedLines = logInfoSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(loggedLines).toContain('Slow API request: GET unmatched');
      expect(loggedLines).not.toContain('private-family-trip');
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('treats durations at or above the default threshold as slow', () => {
    expect(isSlowOperationDuration(250)).toBe(false);
    expect(isSlowOperationDuration(1000)).toBe(true);
  });
});

describe.sequential('route timing middleware in development', () => {
  let tempRoot = '';
  let routeTimingMiddleware: RouteTimingModule['routeTimingMiddleware'];
  let appConfig: EnvModule['appConfig'];

  beforeAll(async () => {
    tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'insta-route-timing-dev-'));

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ routeTimingMiddleware } = await import('../src/middleware/route-timing.js'));
    ({ appConfig } = await import('../src/config/env.js'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  });

  it('exposes a Server-Timing header when development mode is enabled', () => {
    expect(appConfig.isDevelopment).toBe(true);

    const request = createRequest();
    const { response, originalEnd } = createResponse();
    const next: NextFunction = vi.fn();

    routeTimingMiddleware(request, response as unknown as Response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((response as { end: unknown }).end).not.toBe(originalEnd);
    expect((response as { setHeader: ReturnType<typeof vi.fn> }).setHeader).not.toHaveBeenCalled();

    (response as unknown as { end: () => void }).end();

    expect(response.setHeader).toHaveBeenCalledWith('Server-Timing', expect.stringMatching(/^app;dur=\d+(\.\d+)?$/));
    expect(originalEnd).toHaveBeenCalledOnce();
  });

  it('skips the Server-Timing header once a streamed response has committed headers', () => {
    const request = createRequest();
    const { response, originalEnd } = createResponse();
    const next: NextFunction = vi.fn();

    routeTimingMiddleware(request, response as unknown as Response, next);

    (response as { headersSent: boolean }).headersSent = true;

    expect(() => {
      (response as unknown as { end: () => void }).end();
    }).not.toThrow();
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(originalEnd).toHaveBeenCalledOnce();
  });
});
