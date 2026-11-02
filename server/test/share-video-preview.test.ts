import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestTestApp as requestApp } from './http-test-utils.js';
import { LIBRARY_REBUILD_REQUIRED_SETTING_KEY } from '../src/constants/app-setting-keys.js';
import { getPreviewPathForAssetKey, getThumbnailPathForAssetKey } from '../src/utils/derivative-paths.js';
import { createFingerprint } from '../src/utils/image-utils.js';

const {
  generateDerivativesMock,
  generateThumbnailDerivativeMock,
  generatePreviewDerivativeMock,
  readMediaMetadataMock
} = vi.hoisted(() => ({
  generateDerivativesMock: vi.fn(),
  generateThumbnailDerivativeMock: vi.fn(),
  generatePreviewDerivativeMock: vi.fn(),
  readMediaMetadataMock: vi.fn()
}));

type AppConfigModule = typeof import('../src/config/env.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

describe.sequential('shared and legacy preview delivery for eligible videos', () => {
  let tempRoot = '';
  let app: express.Application;
  let appConfig: AppConfigModule['appConfig'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let folderShareService: typeof import('../src/services/folder-share-service.js')['folderShareService'];
  let authService: typeof import('../src/services/auth-service.js')['authService'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-share-video-'));
  });

  beforeEach(async () => {
    generateDerivativesMock.mockReset();
    generateThumbnailDerivativeMock.mockReset();
    generatePreviewDerivativeMock.mockReset();
    readMediaMetadataMock.mockReset();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DERIVATIVE_MODE', 'eager');
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data',
      GALLERY_ROOT: 'gallery',
      DB_DIR: 'db',
      THUMBNAILS_DIR: 'thumbnails',
      PREVIEWS_DIR: 'previews'
    })) {
      vi.stubEnv(key, path.join(tempRoot, directory));
    }

    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      generatePreviewDerivative: generatePreviewDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ folderRepository, imageRepository, maintenanceRepository } = await import('../src/db/repositories.js'));
    ({ folderShareService } = await import('../src/services/folder-share-service.js'));
    ({ authService } = await import('../src/services/auth-service.js'));
    const { createApp } = await import('../src/app.js');

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
    maintenanceRepository.resetLibraryIndex();

    generatePreviewDerivativeMock.mockImplementation(async (
      _sourcePath: string,
      relativePath: string,
      _force: boolean,
      overrides: { previewPath?: string } = {}
    ) => {
      const previewPath = overrides.previewPath ?? getPreviewPathForAssetKey('placeholder', 'video');
      const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
      await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
      await fs.writeFile(previewAbsolutePath, `generated-shared-preview:${relativePath}`);
      return {
        previewPath,
        generatedPreview: true
      };
    });

    app = createApp();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.doUnmock('../src/services/derivative-service.js');
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function createEligibleVideo(options: { withOriginal: boolean } = { withOriginal: true }) {
    const folder = folderRepository.upsert({ slug: 'shared-videos', name: 'Shared Videos', folderPath: 'shared-videos' });
    const relativePath = 'shared-videos/clip.mp4';
    const sourcePath = path.join(appConfig.galleryRoot, relativePath);
    if (options.withOriginal) {
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, `original:${relativePath}`);
    }
    const sourceStats = options.withOriginal
      ? await fs.stat(sourcePath)
      : { size: 1024, mtimeMs: Date.parse('2026-01-01T00:00:00.000Z') };
    const assetKey = 'aabbccddeeff00112233445566778899';
    const thumbnailPath = getThumbnailPathForAssetKey(assetKey);
    const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
    await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
    await fs.writeFile(thumbnailAbsolutePath, 'poster');

    const image = imageRepository.upsert({
      folderId: folder.id,
      assetKey,
      filename: 'clip.mp4',
      extension: '.mp4',
      relativePath,
      absolutePath: sourcePath,
      fileSize: sourceStats.size,
      width: 1080,
      height: 1920,
      mediaType: 'video',
      mimeType: 'video/mp4',
      durationMs: 5000,
      playbackStrategy: 'original',
      fingerprint: createFingerprint(relativePath, sourceStats.size, sourceStats.mtimeMs),
      mtimeMs: sourceStats.mtimeMs,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: sourceStats.mtimeMs,
      takenAt: sourceStats.mtimeMs,
      takenAtSource: 'mtime',
      exifJson: null,
      thumbnailPath,
      previewPath: getPreviewPathForAssetKey(assetKey, 'video')
    });

    return { folder, image };
  }

  it('generates a scoped shared preview without granting ordinary original access', async () => {
    const { folder, image } = await createEligibleVideo();
    authService.setAdminPassword('admin12345');
    const link = folderShareService.createLink(folder.slug, { expiresAt: null })!;
    const grant = folderShareService.verifyLinkToken(folder.slug, link.rawToken)!;
    const shareCookie = createShareCookie(grant);

    const response = await requestApp(app, 'GET', `/api/share/images/${image.id}/preview`, {
      Cookie: `foldergram_share_session=${shareCookie}`
    });

    expect(response.status).toBe(200);
    expect(response.body).toBe('generated-shared-preview:shared-videos/clip.mp4');
    expect(generatePreviewDerivativeMock).toHaveBeenCalledOnce();
    expect(response.headers.get('cache-control')).toBe('private, no-store');

    const originalResponse = await requestApp(app, 'GET', `/api/originals/${image.id}`, {
      Cookie: `foldergram_share_session=${shareCookie}`
    });
    expect(originalResponse.status).toBe(401);
  });

  it('serves an existing eligible preview URL from the original in eager mode', async () => {
    const { image } = await createEligibleVideo();

    const response = await requestApp(app, 'GET', `/previews/${image.preview_path}`);

    expect(response.status).toBe(200);
    expect(response.body).toBe('original:shared-videos/clip.mp4');
    expect(response.headers.get('cache-control')).toBe('public, no-cache');
    expect(generatePreviewDerivativeMock).not.toHaveBeenCalled();
  });

  it('supports HEAD and byte ranges for original-resolved preview URLs', async () => {
    const { image } = await createEligibleVideo();

    const headResponse = await requestApp(app, 'HEAD', `/previews/${image.preview_path}`);
    expect(headResponse.status).toBe(200);
    expect(Number(headResponse.headers.get('content-length'))).toBeGreaterThan(0);

    const rangeResponse = await requestApp(app, 'GET', `/previews/${image.preview_path}`, {
      Range: 'bytes=0-7'
    });
    expect(rangeResponse.status).toBe(206);
    expect(rangeResponse.body).toBe('original');
  });

  describe.each(['eager', 'lazy'] as const)('%s original delivery guards', (mode) => {
    async function useMode() {
      appConfig.derivativeMode = mode;
      const { createApp } = await import('../src/app.js');
      app = createApp();
      authService.setAdminPassword('admin12345');
      authService.setViewerAccess('public');
    }

    it.each(['GET', 'HEAD'])('blocks %s through legacy preview URLs when a library rebuild is required', async (method) => {
      const { image } = await createEligibleVideo();
      await useMode();
      const { appSettingsRepository } = await import('../src/db/repositories.js');
      appSettingsRepository.set(LIBRARY_REBUILD_REQUIRED_SETTING_KEY, '1');

      for (const url of [`/api/originals/${image.id}`, `/previews/${image.preview_path}`]) {
        const response = await requestApp(app, method, url);
        expect(response.status).toBe(404);
        expect(JSON.stringify(response.body)).not.toContain('original:');
      }
      expect(generatePreviewDerivativeMock).not.toHaveBeenCalled();
    });

    it.each(['GET', 'HEAD'])('blocks %s through legacy preview URLs when library storage is unavailable', async (method) => {
      const { image } = await createEligibleVideo();
      await useMode();
      const { storageService } = await import('../src/services/storage-service.js');
      const state = storageService.getState();
      const stateSpy = vi.spyOn(storageService, 'getState').mockReturnValue({ ...state, libraryAvailable: false });
      try {
        for (const url of [`/api/originals/${image.id}`, `/previews/${image.preview_path}`]) {
          expect((await requestApp(app, method, url)).status).toBe(404);
        }
        expect(generatePreviewDerivativeMock).not.toHaveBeenCalled();
      } finally {
        stateSpy.mockRestore();
      }
    });

    it('handles ranges consistently through original and legacy preview URLs', async () => {
      const { image } = await createEligibleVideo();
      await useMode();
      const size = Buffer.byteLength('original:shared-videos/clip.mp4');
      for (const url of [`/api/originals/${image.id}`, `/previews/${image.preview_path}`]) {
        for (const range of [`bytes=${size}-`, 'bytes=99999-100000', 'bytes=7-0', 'bytes=invalid']) {
          const response = await requestApp(app, 'GET', url, { Range: range });
          expect(response.status).toBe(416);
          expect(response.headers.get('content-range')).toBe(`bytes */${size}`);
        }
        const malformed = await requestApp(app, 'GET', url, { Range: 'invalid' });
        expect(malformed.status).toBe(200);
        expect(malformed.body).toBe('original:shared-videos/clip.mp4');
        const suffix = await requestApp(app, 'GET', url, { Range: 'bytes=-8' });
        expect(suffix.status).toBe(206);
        expect(suffix.body).toBe('clip.mp4');
      }
    });
  });

  it('does not generate an intentionally skipped preview from its legacy URL when the original is missing', async () => {
    const { image } = await createEligibleVideo({ withOriginal: false });

    const response = await requestApp(app, 'GET', `/previews/${image.preview_path}`);

    expect(response.status).toBe(404);
    expect(generatePreviewDerivativeMock).not.toHaveBeenCalled();
  });

  it('can recreate a required shared preview after cleanup when sharing is enabled again', async () => {
    const { folder, image } = await createEligibleVideo();
    authService.setAdminPassword('admin12345');
    const previewAbsolutePath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
    await fs.writeFile(previewAbsolutePath, 'stale-preview');
    await fs.rm(previewAbsolutePath);

    const link = folderShareService.createLink(folder.slug, { expiresAt: null })!;
    const grant = folderShareService.verifyLinkToken(folder.slug, link.rawToken)!;
    const shareCookie = createShareCookie(grant);
    const firstResponse = await requestApp(app, 'GET', `/api/share/images/${image.id}/preview`, {
      Cookie: `foldergram_share_session=${shareCookie}`
    });
    expect(firstResponse.status).toBe(200);
    expect(generatePreviewDerivativeMock).toHaveBeenCalledOnce();

    folderShareService.revokeLink(folder.slug, link.link.id);
    const revokedResponse = await requestApp(app, 'GET', `/api/share/images/${image.id}/preview`, {
      Cookie: `foldergram_share_session=${shareCookie}`
    });
    expect(revokedResponse.status).toBe(401);
  });

  function createShareCookie(grant: NonNullable<ReturnType<typeof folderShareService.verifyLinkToken>>): string {
    const mockResponse = { cookie: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    folderShareService.setShareSession(
      mockResponse as unknown as express.Response,
      { secure: false, get: () => undefined } as unknown as express.Request,
      grant
    );
    return mockResponse.cookie.mock.calls.at(-1)?.[1] as string;
  }
});
