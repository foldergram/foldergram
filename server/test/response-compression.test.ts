import zlib from 'node:zlib';

import express from 'express';
import { describe, expect, it } from 'vitest';

import { compressTextResponses } from '../src/middleware/response-compression.js';
import { requestTestApp } from './http-test-utils.js';

const largeText = 'foldergram compression probe '.repeat(200);

function createApp(): express.Application {
  const app = express();
  app.use(compressTextResponses);

  app.get('/json', (_request, response) => {
    response.json({ payload: largeText });
  });

  app.get('/small', (_request, response) => {
    response.json({ ok: true });
  });

  app.get('/binary', (_request, response) => {
    response.setHeader('Content-Type', 'video/mp4');
    response.send(Buffer.alloc(64 * 1024, 7));
  });

  app.get('/partial', (_request, response) => {
    response.status(206);
    response.setHeader('Content-Type', 'video/mp4');
    response.setHeader('Content-Range', 'bytes 0-1023/8192');
    response.send(Buffer.alloc(1024, 3));
  });

  app.get('/prezipped', (_request, response) => {
    response.setHeader('Content-Type', 'application/javascript');
    response.setHeader('Content-Encoding', 'gzip');
    response.send(zlib.gzipSync(Buffer.from(largeText)));
  });

  app.get('/no-content', (_request, response) => {
    response.status(204).end();
  });

  return app;
}

describe('compressTextResponses', () => {
  it('brotli-compresses a large JSON response and keeps the body intact', async () => {
    const response = await requestTestApp(createApp(), 'GET', '/json', { 'accept-encoding': 'br, gzip' });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-encoding')).toBe('br');
    expect(response.headers.get('vary')).toContain('Accept-Encoding');

    const declaredLength = Number(response.headers.get('content-length'));
    expect(declaredLength).toBeGreaterThan(0);
    // The whole point: the wire payload is a fraction of the identity body.
    expect(declaredLength).toBeLessThan(Buffer.byteLength(JSON.stringify({ payload: largeText })) / 2);
  });

  it('falls back to gzip when brotli is not accepted', async () => {
    const response = await requestTestApp(createApp(), 'GET', '/json', { 'accept-encoding': 'gzip, deflate' });

    expect(response.headers.get('content-encoding')).toBe('gzip');
  });

  it('leaves the response untouched when no encoding is accepted', async () => {
    const response = await requestTestApp(createApp(), 'GET', '/json', {});

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.body.payload).toBe(largeText);
  });

  it('skips bodies below the size floor', async () => {
    const response = await requestTestApp(createApp(), 'GET', '/small', { 'accept-encoding': 'br' });

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(response.body).toEqual({ ok: true });
  });

  it('never touches binary media responses', async () => {
    const response = await requestTestApp(createApp(), 'GET', '/binary', { 'accept-encoding': 'br, gzip' });

    expect(response.headers.get('content-encoding')).toBeNull();
    expect(Number(response.headers.get('content-length'))).toBe(64 * 1024);
  });

  it('never touches range responses', async () => {
    const withRangeHeader = await requestTestApp(createApp(), 'GET', '/binary', {
      'accept-encoding': 'br, gzip',
      range: 'bytes=0-1023'
    });
    expect(withRangeHeader.headers.get('content-encoding')).toBeNull();

    const partial = await requestTestApp(createApp(), 'GET', '/partial', { 'accept-encoding': 'br, gzip' });
    expect(partial.status).toBe(206);
    expect(partial.headers.get('content-encoding')).toBeNull();
    expect(partial.headers.get('content-range')).toBe('bytes 0-1023/8192');
  });

  it('does not double-encode a response that is already compressed', async () => {
    const response = await requestTestApp(createApp(), 'GET', '/prezipped', { 'accept-encoding': 'br, gzip' });

    expect(response.headers.get('content-encoding')).toBe('gzip');
    const rawLength = Number(response.headers.get('content-length'));
    expect(rawLength).toBe(zlib.gzipSync(Buffer.from(largeText)).length);
  });

  it('passes an empty 204 through without stalling', async () => {
    const response = await requestTestApp(createApp(), 'GET', '/no-content', { 'accept-encoding': 'br' });

    expect(response.status).toBe(204);
    expect(response.headers.get('content-encoding')).toBeNull();
  });
});
