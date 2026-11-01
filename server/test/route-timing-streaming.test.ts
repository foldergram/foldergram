import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { requestTestApp as requestApp } from './http-test-utils.js';

type RouteTimingModule = typeof import('../src/middleware/route-timing.js');

const MEDIA_BYTE_LENGTH = 128 * 1024;

describe.sequential('route timing middleware with streamed responses in development', () => {
  let tempRoot = '';
  let app: express.Express;
  let mediaFilePath = '';

  beforeAll(async () => {
    tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'insta-route-timing-stream-'));
    mediaFilePath = path.join(tempRoot, 'video.mp4');
    await fsPromises.writeFile(mediaFilePath, Buffer.alloc(MEDIA_BYTE_LENGTH, 7));

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    const { routeTimingMiddleware }: RouteTimingModule = await import('../src/middleware/route-timing.js');

    app = express();
    app.use('/api', routeTimingMiddleware, (_request, _response, next) => next());

    app.get('/api/status', (_request, response) => {
      response.json({ ok: true });
    });
    app.get('/api/originals/:id', (_request, response) => {
      response.sendFile(mediaFilePath);
    });
    app.get('/api/share/images/:id/thumbnail', (_request, response) => {
      response.setHeader('Content-Type', 'image/webp');
      response.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(mediaFilePath, { start: 0, end: 2_047 }).pipe(response);
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  });

  it('sets Server-Timing for buffered JSON responses', async () => {
    const response = await requestApp(app, 'GET', '/api/status');

    expect(response.status).toBe(200);
    expect(response.headers.get('server-timing')).toMatch(/^app;dur=\d+(\.\d+)?$/);
  });

  it('serves a streamed original file without header exceptions', { timeout: 5_000 }, async () => {
    const response = await requestApp(app, 'GET', '/api/originals/1');

    expect(response.status).toBe(200);
    expect(response.body.length).toBe(MEDIA_BYTE_LENGTH);
    expect(response.headers.get('server-timing')).toBeNull();
  });

  it('serves an original video range request without header exceptions', { timeout: 5_000 }, async () => {
    const response = await requestApp(app, 'GET', '/api/originals/1', { Range: 'bytes=0-1023' });

    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 0-1023/${MEDIA_BYTE_LENGTH}`);
    expect(response.body.length).toBe(1_024);
    expect(response.headers.get('server-timing')).toBeNull();
  });

  it('serves a streamed shared derivative without header exceptions', { timeout: 5_000 }, async () => {
    const response = await requestApp(app, 'GET', '/api/share/images/1/thumbnail');

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.body.length).toBe(2_048);
    expect(response.headers.get('server-timing')).toBeNull();
  });
});
