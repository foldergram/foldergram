import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type express from 'express';

import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';
import { LIBRARY_REBUILD_REQUIRED_SETTING_KEY } from '../src/constants/app-setting-keys.js';

type AppConfigModule = typeof import('../src/config/env.js');
type AuthServiceModule = typeof import('../src/services/auth-service.js');
type LazyRoutesModule = typeof import('../src/routes/lazy-derivatives.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];
type PlaybackStrategy = ModelsModule['PlaybackStrategy'];

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const generatePreviewDerivativeMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('DERIVATIVE_MODE lazy behavior', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let authService: AuthServiceModule['authService'];
  let lazyThumbnailsRouter: LazyRoutesModule['lazyThumbnailsRouter'];
  let lazyPreviewsRouter: LazyRoutesModule['lazyPreviewsRouter'];
  let scannerService: ScannerServiceModule['scannerService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];

  async function reset(derivativeMode = 'lazy', scanDerivativeConcurrency = 4) {
    generateThumbnailDerivativeMock.mockReset();
    generateDerivativesMock.mockReset();
    generatePreviewDerivativeMock.mockReset();
    readMediaMetadataMock.mockReset();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generatePreviewDerivative: generatePreviewDerivativeMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    vi.stubEnv('DERIVATIVE_MODE', derivativeMode);
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
    vi.stubEnv('SCAN_DERIVATIVE_CONCURRENCY', String(scanDerivativeConcurrency));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ authService } = await import('../src/services/auth-service.js'));
    ({ lazyThumbnailsRouter, lazyPreviewsRouter } = await import('../src/routes/lazy-derivatives.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({folderRepository, imageRepository, maintenanceRepository, appSettingsRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(sourcePath));
      return {
        width: 1280,
        height: 960,
        takenAt: null,
        durationMs: mediaType === 'video' ? 5000 : null,
        mediaType,
        playbackStrategy: sourcePath.endsWith('.mp4') ? 'original' : 'preview',
        isAnimated: false
      };
    });

    generateDerivativesMock.mockImplementation(async (_src: string, relativePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
      return {
        width: 1280,
        height: 960,
        takenAt: null,
        durationMs: mediaType === 'video' ? 5000 : null,
        mediaType,
        playbackStrategy: relativePath.endsWith('.mp4') ? 'original' : 'preview',
        isAnimated: false,
        thumbnailPath: getThumbnailRelativePath(relativePath),
        previewPath: getPreviewRelativePath(relativePath, mediaType),
        generatedThumbnail: true,
        generatedPreview: true
      };
    });

    generateThumbnailDerivativeMock.mockImplementation(async (_src: string, relativePath: string) => {
      const thumbnailPath = getThumbnailRelativePath(relativePath);
      const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
      await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
      await fs.writeFile(thumbnailAbsolutePath, `thumbnail:${relativePath}`);
      return {
        thumbnailPath,
        generatedThumbnail: true
      };
    });

    generatePreviewDerivativeMock.mockImplementation(async (_src: string, relativePath: string, _force = false, overrides?: { previewPath?: string }) => {
      const previewPath = overrides?.previewPath ?? getPreviewRelativePath(relativePath, getMediaTypeFromExtension(path.extname(relativePath)));
      const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
      await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
      const suffix = path.extname(relativePath).toLowerCase() === '.mp4'
        ? 'video-preview'
        : path.extname(relativePath).toLowerCase() === '.avif'
          ? 'animated-avif-preview'
          : 'image-preview';
      await fs.writeFile(previewAbsolutePath, `${suffix}:${path.basename(previewAbsolutePath)}`);
      return {
        previewPath,
        generatedPreview: true
      };
    });
  }

  async function dispatchRoute(
    router: LazyRoutesModule['lazyThumbnailsRouter'] | LazyRoutesModule['lazyPreviewsRouter'],
    routePath: string,
    options: {
      sendFile?: (
        filePath: string,
        callback: ((error?: Error) => void) | undefined,
        helpers: {
          finish(): void;
          fail(error: unknown): void;
          response: express.Response;
        }
      ) => void;
    } = {}
  ) {
    return await new Promise<{
      body: unknown;
      headers: Map<string, string>;
      jsonCalls: number;
      statusCode: number;
    }>((resolve, reject) => {
      const headers = new Map<string, string>();
      const responseState = {
        body: null as unknown,
        jsonCalls: 0,
        statusCode: 200
      };
      let settled = false;

      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve({
          ...responseState,
          headers
        });
      };

      const fail = (error: unknown) => {
        if (settled) {
          return;
        }

        settled = true;
        reject(error);
      };

      const response = {
        headersSent: false,
        json(payload: unknown) {
          responseState.body = payload;
          responseState.jsonCalls += 1;
          this.headersSent = true;
          finish();
          return this;
        },
        sendFile(filePath: string, callback?: (error?: Error) => void) {
          if (options.sendFile) {
            options.sendFile(filePath, callback, {
              fail,
              finish,
              response: this as unknown as express.Response
            });
            return this;
          }

          void fs.readFile(filePath, 'utf8')
            .then((body) => {
              responseState.body = body;
              this.headersSent = true;
              callback?.();
              finish();
            })
            .catch((error) => {
              callback?.(error as Error);
              fail(error);
            });

          return this;
        },
        setHeader(name: string, value: string) {
          headers.set(name.toLowerCase(), value);
        },
        status(code: number) {
          responseState.statusCode = code;
          return this;
        }
      } satisfies Pick<express.Response, 'json' | 'sendFile' | 'setHeader' | 'status'>;

      const request = {
        get() {
          return undefined;
        },
        method: 'GET',
        originalUrl: routePath,
        url: routePath
      } as unknown as express.Request;

      router.handle(request, response as unknown as express.Response, (error?: unknown) => {
        if (error) {
          fail(error);
          return;
        }
      });
    });
  }

  function encodeRelativePath(relativePath: string): string {
    return relativePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  }

  async function createIndexedMedia(
    folder: FolderRecord,
    filename: string,
    mtimeMs: number,
    playbackStrategy: PlaybackStrategy,
    durationMs: number | null = null,
    options: { storedGalleryRoot?: string; isAnimated?: boolean | null } = {}
  ) {
    const relativePath = `${folder.folder_path}/${filename}`;
    const absolutePath = options.storedGalleryRoot
      ? path.join(options.storedGalleryRoot, relativePath)
      : path.join(appConfig.galleryRoot, relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
    const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
    const fileSize = 2_048 + mtimeMs;

    return await imageRepository.upsert({
      folderId: folder.id,
      filename,
      extension,
      relativePath,
      absolutePath,
      fileSize,
      width: mediaType === 'video' ? 1080 : 1600,
      height: mediaType === 'video' ? 1920 : 1200,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs,
      isAnimated: options.isAnimated ?? false,
      fingerprint: createFingerprint(relativePath, fileSize, mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: mediaType === 'image' ? '{}' : null,
      thumbnailPath: thumbnailRelativePath,
      previewPath: previewRelativePath,
      playbackStrategy
    });
  }

  async function createSourceFile(relativePath: string): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
  }

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-lazy-derivatives-'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('does not call generateDerivatives for new files when DERIVATIVE_MODE=lazy', async () => {
    await reset('lazy');

    await createSourceFile('album/photo.jpg');
    await scannerService.scanAll('test');

    expect(generateDerivativesMock).not.toHaveBeenCalled();
    expect(generateThumbnailDerivativeMock).not.toHaveBeenCalled();
    expect(await imageRepository.countFeed()).toBe(1);
  });

  it('still calls generateDerivatives for new files when DERIVATIVE_MODE=eager', async () => {
    await reset('eager');

    await createSourceFile('album2/photo.jpg');
    await scannerService.scanAll('test');

    expect(generateDerivativesMock).toHaveBeenCalledOnce();
  });

  it('rebuildThumbnails still generates thumbnails in lazy mode', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'rb', name: 'RB', folderPath: 'rb' });
    await createIndexedMedia(folder, 'photo.jpg', 1000, 'preview');

    await scannerService.rebuildThumbnails('test');

    expect(generateThumbnailDerivativeMock).toHaveBeenCalledOnce();
  });

  it('image index contains deterministic thumbnail and preview paths even in lazy mode', async () => {
    await reset('lazy');

    await createSourceFile('album3/photo.jpg');
    await scannerService.scanAll('test');

    const images = await imageRepository.listActive();
    expect(images).toHaveLength(1);
    expect(images[0]!.thumbnail_path).toMatch(/^[a-f0-9]{2}\/[a-f0-9]{32}\.webp$/);
    expect(images[0]!.preview_path).toMatch(/^[a-f0-9]{2}\/[a-f0-9]{32}\.webp$/);
  });

  it('generates a missing thumbnail on first request, reuses it on later requests, and preserves cache headers', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'thumbs', name: 'Thumbs', folderPath: 'thumbs' });
    const image = await createIndexedMedia(folder, 'photo.jpg', 2000, 'preview');
    const requestPath = `/${encodeRelativePath(image.thumbnail_path)}`;
    const firstResponse = await dispatchRoute(lazyThumbnailsRouter, requestPath);
    expect(firstResponse.statusCode).toBe(200);
    expect(firstResponse.headers.get('cache-control')).toBe('public, max-age=604800, immutable');
    expect(firstResponse.body).toBe(`thumbnail:${image.relative_path}`);
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledOnce();

    const secondResponse = await dispatchRoute(lazyThumbnailsRouter, requestPath);
    expect(secondResponse.statusCode).toBe(200);
    expect(secondResponse.body).toBe(`thumbnail:${image.relative_path}`);
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledOnce();
  });

  it('generates a missing thumbnail from the current gallery root when the cached absolute path is stale', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'relocated-thumbs', name: 'Relocated Thumbs', folderPath: 'relocated-thumbs' });
    await createSourceFile('relocated-thumbs/photo.jpg');
    const image = await createIndexedMedia(folder, 'photo.jpg', 2_200, 'preview', null, {
      storedGalleryRoot: path.join(tempRoot, 'old-gallery-root')
    });

    const response = await dispatchRoute(lazyThumbnailsRouter, `/${encodeRelativePath(image.thumbnail_path)}`);

    expect(response.statusCode).toBe(200);
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledWith(
      path.join(appConfig.galleryRoot, image.relative_path),
      image.relative_path,
      false,
      { thumbnailPath: image.thumbnail_path }
    );
  });

  it('uses private browser caching headers for protected derivative responses', async () => {
    await reset('lazy');

    await authService.setAdminPassword('password123');
    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'secured', name: 'Secured', folderPath: 'secured' });
    const image = await createIndexedMedia(folder, 'photo.jpg', 2500, 'preview');

    const response = await dispatchRoute(lazyThumbnailsRouter, `/${encodeRelativePath(image.thumbnail_path)}`);

    expect(response.statusCode).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, max-age=604800, immutable');
    expect(response.headers.get('vary')).toBe('Cookie');
  });

  it('generates a missing image preview on first request', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'previews', name: 'Previews', folderPath: 'previews' });
    const image = await createIndexedMedia(folder, 'photo.jpg', 3000, 'preview');
    const response = await dispatchRoute(lazyPreviewsRouter, `/${encodeRelativePath(image.preview_path)}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('image-preview:photo.webp');
    expect(generatePreviewDerivativeMock).toHaveBeenCalledOnce();
  });

  it('generates a missing image preview from the current gallery root when the cached absolute path is stale', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'relocated-previews', name: 'Relocated Previews', folderPath: 'relocated-previews' });
    await createSourceFile('relocated-previews/photo.jpg');
    const image = await createIndexedMedia(folder, 'photo.jpg', 3_200, 'preview', null, {
      storedGalleryRoot: path.join(tempRoot, 'old-gallery-root')
    });

    const response = await dispatchRoute(lazyPreviewsRouter, `/${encodeRelativePath(image.preview_path)}`);

    expect(response.statusCode).toBe(200);
    expect(generatePreviewDerivativeMock).toHaveBeenCalledWith(
      path.join(appConfig.galleryRoot, image.relative_path),
      image.relative_path,
      false,
      { previewPath: image.preview_path }
    );
  });

  it('generates a missing animated AVIF preview through the AVIF-aware preview generator', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'animated-avif', name: 'Animated AVIF', folderPath: 'animated-avif' });
    const image = await createIndexedMedia(folder, 'clip.avif', 3_400, 'preview', null, {
      isAnimated: true
    });

    const response = await dispatchRoute(lazyPreviewsRouter, `/${encodeRelativePath(image.preview_path)}`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('animated-avif-preview:clip.webp');
    expect(generatePreviewDerivativeMock).toHaveBeenCalledWith(
      path.join(appConfig.galleryRoot, image.relative_path),
      image.relative_path,
      false,
      { previewPath: image.preview_path }
    );
  });

  it('deduplicates concurrent requests for the same missing video preview', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'videos', name: 'Videos', folderPath: 'videos' });
    const video = await createIndexedMedia(folder, 'clip.mp4', 4000, 'original', 5000);
    let releaseGeneration: (() => void) | null = null;
    const generationStarted = new Promise<void>((resolve) => {
      generatePreviewDerivativeMock.mockImplementationOnce(async (_src: string, relativePath: string, _force = false, overrides?: { previewPath?: string }) => {
        const previewPath = overrides?.previewPath ?? getPreviewRelativePath(relativePath, 'video');
        const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
        resolve();
        await new Promise<void>((generationResolve) => {
          releaseGeneration = generationResolve;
        });
        await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
        await fs.writeFile(previewAbsolutePath, 'video-preview:clip.mp4');
      });
    });

    const previewPath = `/${encodeRelativePath(video.preview_path)}`;
    const firstRequest = dispatchRoute(lazyPreviewsRouter, previewPath);
    await generationStarted;
    const secondRequest = dispatchRoute(lazyPreviewsRouter, previewPath);
    releaseGeneration?.();

    const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstResponse.body).toBe('video-preview:clip.mp4');
    expect(secondResponse.body).toBe('video-preview:clip.mp4');
    expect(generatePreviewDerivativeMock).toHaveBeenCalledOnce();
  });

  it('limits concurrent generation for different missing derivatives', async () => {
    await reset('lazy', 1);

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'queue', name: 'Queue', folderPath: 'queue' });
    const firstImage = await createIndexedMedia(folder, 'photo-1.jpg', 5000, 'preview');
    const secondImage = await createIndexedMedia(folder, 'photo-2.jpg', 6000, 'preview');

    let activeGenerations = 0;
    let maxActiveGenerations = 0;
    let releaseFirstGeneration: (() => void) | null = null;
    let firstGenerationSeen = false;

    generateThumbnailDerivativeMock.mockImplementation(async (_src: string, relativePath: string) => {
      activeGenerations += 1;
      maxActiveGenerations = Math.max(maxActiveGenerations, activeGenerations);

      if (!firstGenerationSeen) {
        firstGenerationSeen = true;
        await new Promise<void>((resolve) => {
          releaseFirstGeneration = resolve;
        });
      }

      const thumbnailPath = getThumbnailRelativePath(relativePath);
      const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
      await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
      await fs.writeFile(thumbnailAbsolutePath, `thumbnail:${relativePath}`);
      activeGenerations -= 1;

      return {
        thumbnailPath,
        generatedThumbnail: true
      };
    });

    const firstRequest = dispatchRoute(lazyThumbnailsRouter, `/${encodeRelativePath(firstImage.thumbnail_path)}`);
    await vi.waitFor(() => {
      expect(maxActiveGenerations).toBe(1);
      expect(generateThumbnailDerivativeMock).toHaveBeenCalledTimes(1);
    });

    const secondRequest = dispatchRoute(lazyThumbnailsRouter, `/${encodeRelativePath(secondImage.thumbnail_path)}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledTimes(1);
    expect(maxActiveGenerations).toBe(1);

    releaseFirstGeneration?.();

    const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);
    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstResponse.body).toBe(`thumbnail:${firstImage.relative_path}`);
    expect(secondResponse.body).toBe(`thumbnail:${secondImage.relative_path}`);
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledTimes(2);
    expect(maxActiveGenerations).toBe(1);
  });

  it('returns 404 when no indexed row matches the requested derivative path', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const response = await dispatchRoute(lazyPreviewsRouter, '/missing/path.webp');
    expect(response.statusCode).toBe(404);
    expect(response.body).toEqual({ message: 'Derivative not found.' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('does not generate missing derivatives while a library rebuild is required', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'blocked', name: 'Blocked', folderPath: 'blocked' });
    const image = await createIndexedMedia(folder, 'photo.jpg', 4_700, 'preview');
    await appSettingsRepository.set(LIBRARY_REBUILD_REQUIRED_SETTING_KEY, '1');

    const response = await dispatchRoute(lazyThumbnailsRouter, `/${encodeRelativePath(image.thumbnail_path)}`);

    expect(response.statusCode).toBe(409);
    expect(response.body).toEqual({ message: 'Library rebuild required before generating derivatives.' });
    expect(generateThumbnailDerivativeMock).not.toHaveBeenCalled();
  });

  it('does not emit a JSON error after sendFile fails once headers are already sent', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const folder = await folderRepository.upsert({ slug: 'abort', name: 'Abort', folderPath: 'abort' });
    const video = await createIndexedMedia(folder, 'clip.mp4', 4500, 'original', 5000);
    const previewAbsolutePath = path.join(appConfig.previewsDir, video.preview_path);

    await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
    await fs.writeFile(previewAbsolutePath, 'video-preview:clip.mp4');

    const response = await dispatchRoute(lazyPreviewsRouter, `/${encodeRelativePath(video.preview_path)}`, {
      sendFile(_filePath, callback, { finish, response: routeResponse }) {
        Object.assign(routeResponse, { headersSent: true });
        callback?.(Object.assign(new Error('request aborted'), { code: 'ECONNABORTED' }));
        setImmediate(finish);
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toBeNull();
    expect(response.jsonCalls).toBe(0);
  });

  it('rejects traversal attempts with a 400 response', async () => {
    await reset('lazy');

    await maintenanceRepository.resetLibraryIndex();
    const response = await dispatchRoute(lazyThumbnailsRouter, '/%2E%2E/outside.webp');
    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ message: 'Invalid derivative path.' });
  });
});
