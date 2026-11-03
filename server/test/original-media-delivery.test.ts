import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestTestApp as requestApp } from './http-test-utils.js';
import { createFingerprint, getPreviewRelativePath, getThumbnailRelativePath } from '../src/utils/image-utils.js';

type AppModule = typeof import('../src/app.js');
type AuthServiceModule = typeof import('../src/services/auth-service.js');
type ConfigModule = typeof import('../src/config/env.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

const SOURCE_BYTES = Buffer.from(Array.from({ length: 4_096 }, (_, index) => index % 256));
const FILENAME = 'snow day.mp4';
const RELATIVE_PATH = `album/${FILENAME}`;

describe.sequential('original media delivery', () => {
  let tempRoot = '';
  let app: express.Application;
  let appConfig: ConfigModule['appConfig'];
  let authService: AuthServiceModule['authService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let image: ModelsModule['ImageRecord'];
  let originalsUrl = '';

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-original-delivery-'));
  });

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await Promise.all([
      fs.mkdir(path.join(tempRoot, 'db'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'gallery'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'thumbnails'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'previews'), { recursive: true })
    ]);

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();
    ({ appConfig } = await import('../src/config/env.js'));
    ({ authService } = await import('../src/services/auth-service.js'));
    ({ folderRepository, imageRepository, maintenanceRepository } = await import('../src/db/repositories.js'));
    const { createApp }: AppModule = await import('../src/app.js');

    maintenanceRepository.resetLibraryIndex();
    app = createApp();

    const folder = folderRepository.upsert({ slug: 'album', name: 'Album', folderPath: 'album' });
    const absolutePath = path.join(appConfig.galleryRoot, RELATIVE_PATH);
    const mtimeMs = Date.parse('2026-01-01T00:00:00.000Z');

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, SOURCE_BYTES);

    image = imageRepository.upsert({
      folderId: folder.id,
      filename: FILENAME,
      extension: '.mp4',
      relativePath: RELATIVE_PATH,
      absolutePath,
      fileSize: SOURCE_BYTES.length,
      width: 1280,
      height: 960,
      mediaType: 'video',
      mimeType: 'video/mp4',
      durationMs: 5_000,
      playbackStrategy: 'original',
      fingerprint: createFingerprint(RELATIVE_PATH, SOURCE_BYTES.length, mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: null,
      thumbnailPath: getThumbnailRelativePath(RELATIVE_PATH),
      previewPath: getPreviewRelativePath(RELATIVE_PATH, 'video')
    });
    originalsUrl = `/api/originals/${image.id}`;
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('serves originals with public revalidation headers and full metadata', async () => {
    const response = await requestApp(app, 'GET', originalsUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('vary')).toBeNull();
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('etag')).toBeTruthy();
    expect(response.headers.get('last-modified')).toBeTruthy();
    expect(Number(response.headers.get('content-length'))).toBe(SOURCE_BYTES.length);
    expect(response.rawBody.equals(SOURCE_BYTES)).toBe(true);
  });

  it('serves exact bytes for bounded, open-ended, and suffix ranges', async () => {
    const bounded = await requestApp(app, 'GET', originalsUrl, { Range: 'bytes=0-1023' });
    expect(bounded.status).toBe(206);
    expect(bounded.headers.get('content-range')).toBe(`bytes 0-1023/${SOURCE_BYTES.length}`);
    expect(bounded.headers.get('content-length')).toBe('1024');
    expect(bounded.headers.get('cache-control')).toBe('public, no-cache');
    expect(bounded.rawBody.equals(SOURCE_BYTES.subarray(0, 1_024))).toBe(true);

    const openEnded = await requestApp(app, 'GET', originalsUrl, {
      Range: `bytes=${SOURCE_BYTES.length - 5}-`
    });
    expect(openEnded.status).toBe(206);
    expect(openEnded.headers.get('content-range')).toBe(
      `bytes ${SOURCE_BYTES.length - 5}-${SOURCE_BYTES.length - 1}/${SOURCE_BYTES.length}`
    );
    expect(openEnded.rawBody.equals(SOURCE_BYTES.subarray(SOURCE_BYTES.length - 5))).toBe(true);

    const suffix = await requestApp(app, 'GET', originalsUrl, { Range: 'bytes=-8' });
    expect(suffix.status).toBe(206);
    expect(suffix.rawBody.equals(SOURCE_BYTES.subarray(SOURCE_BYTES.length - 8))).toBe(true);
  });

  it('rejects unsatisfiable ranges with a 416 content range', async () => {
    for (const range of [`bytes=${SOURCE_BYTES.length}-`, 'bytes=7-0']) {
      const response = await requestApp(app, 'GET', originalsUrl, { Range: range });
      expect(response.status).toBe(416);
      expect(response.headers.get('content-range')).toBe(`bytes */${SOURCE_BYTES.length}`);
    }

    const malformedBytes = await requestApp(app, 'GET', originalsUrl, { Range: 'bytes=invalid' });
    expect(malformedBytes.status).toBe(416);
    expect(malformedBytes.headers.get('content-range')).toBe(`bytes */${SOURCE_BYTES.length}`);

    const ignoredRange = await requestApp(app, 'GET', originalsUrl, { Range: 'invalid' });
    expect(ignoredRange.status).toBe(200);
    expect(ignoredRange.rawBody.equals(SOURCE_BYTES)).toBe(true);
  });

  it('supports HEAD without a response body', async () => {
    const response = await requestApp(app, 'HEAD', originalsUrl);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(Number(response.headers.get('content-length'))).toBe(SOURCE_BYTES.length);
    expect(response.rawBody.length).toBe(0);
  });

  it('honors conditional requests while keeping the original cache policy', async () => {
    const first = await requestApp(app, 'GET', originalsUrl);
    const etag = first.headers.get('etag');
    const lastModified = first.headers.get('last-modified');
    expect(etag).toBeTruthy();
    expect(lastModified).toBeTruthy();

    const byEtag = await requestApp(app, 'GET', originalsUrl, { 'If-None-Match': etag as string });
    expect(byEtag.status).toBe(304);
    expect(byEtag.headers.get('cache-control')).toBe('public, no-cache');
    expect(byEtag.rawBody.length).toBe(0);

    const byDate = await requestApp(app, 'GET', originalsUrl, { 'If-Modified-Since': lastModified as string });
    expect(byDate.status).toBe(304);
    expect(byDate.headers.get('cache-control')).toBe('public, no-cache');
    expect(byDate.rawBody.length).toBe(0);
  });

  it('downloads with an attachment disposition and keeps the original cache policy', async () => {
    const response = await requestApp(app, 'GET', `${originalsUrl}?download=1`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain(FILENAME);
    expect(response.rawBody.equals(SOURCE_BYTES)).toBe(true);
  });

  it('serves legacy original-backed preview URLs with the original cache policy', async () => {
    const response = await requestApp(app, 'GET', `/previews/${encodeURI(image.preview_path)}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.rawBody.equals(SOURCE_BYTES)).toBe(true);
  });

  it('protects originals and uses private revalidation when auth is enabled', async () => {
    authService.setAdminPassword('admin12345');

    const anonymous = await requestApp(app, 'GET', originalsUrl);
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('cache-control')).toBe('no-store');

    const adminCookie = createSessionCookie('admin');
    const authedHeaders = { Cookie: `foldergram_session=${adminCookie}` };
    const authed = await requestApp(app, 'GET', originalsUrl, authedHeaders);
    expect(authed.status).toBe(200);
    expect(authed.headers.get('cache-control')).toBe('private, no-cache');
    expect(authed.headers.get('vary')).toContain('Cookie');
    expect(authed.rawBody.equals(SOURCE_BYTES)).toBe(true);

    const ranged = await requestApp(app, 'GET', originalsUrl, {
      ...authedHeaders,
      Range: 'bytes=0-3'
    });
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('cache-control')).toBe('private, no-cache');
    expect(ranged.headers.get('vary')).toContain('Cookie');

    const head = await requestApp(app, 'HEAD', originalsUrl, authedHeaders);
    expect(head.status).toBe(200);
    expect(head.headers.get('cache-control')).toBe('private, no-cache');
    expect(head.headers.get('vary')).toContain('Cookie');
  });

  it('allows public viewer reads with private revalidation headers', async () => {
    authService.setAdminPassword('admin12345');
    authService.setViewerAccess('public');

    const response = await requestApp(app, 'GET', originalsUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-cache');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(response.rawBody.equals(SOURCE_BYTES)).toBe(true);
  });

  function createSessionCookie(role: 'admin' | 'viewer'): string {
    const mockResponse = { cookie: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    authService.setAuthenticatedSession(
      mockResponse as unknown as express.Response,
      { secure: false, get: () => undefined } as unknown as express.Request,
      role
    );
    return mockResponse.cookie.mock.calls.at(-1)?.[1] as string;
  }
});
