import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';
import { LIBRARY_REBUILD_REQUIRED_SETTING_KEY } from '../src/constants/app-setting-keys.js';

type ApiModule = typeof import('../src/routes/api.js');
type EnvModule = typeof import('../src/config/env.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];
type PlaybackStrategy = ModelsModule['PlaybackStrategy'];

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  sendFile: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: express.RequestHandler }>;
  };
}

describe.sequential('original media route download behavior', () => {
  let tempRoot = '';
  let apiRouter: ApiModule['apiRouter'];
  let appConfig: EnvModule['appConfig'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-original-media-download-'));

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
    ({ apiRouter } = await import('../src/routes/api.js'));
    ({folderRepository, imageRepository, maintenanceRepository, appSettingsRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.dbDir, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    await maintenanceRepository.resetLibraryIndex();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('streams the original file inline when download is not requested', async () => {
    const folder = await folderRepository.upsert({ slug: 'album', name: 'Album', folderPath: 'album' });
    const image = await createIndexedMedia(folder, 'photo.jpg', 1_000, 'preview');
    const handler = getRouteHandler('/originals/:id', 'get');
    const response = createResponse();

    await handler(
      {
        params: { id: String(image.id) },
        query: {}
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.sendFile).toHaveBeenCalledWith(image.absolute_path);
    expect(response.download).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('downloads the original file as an attachment when download=1 is provided', async () => {
    const folder = await folderRepository.upsert({ slug: 'album-download', name: 'Album Download', folderPath: 'album-download' });
    const image = await createIndexedMedia(folder, 'snow day.jpg', 2_000, 'preview');
    const handler = getRouteHandler('/originals/:id', 'get');
    const response = createResponse();

    await handler(
      {
        params: { id: String(image.id) },
        query: { download: '1' }
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.download).toHaveBeenCalledWith(image.absolute_path, 'snow day.jpg');
    expect(response.sendFile).not.toHaveBeenCalled();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('resolves originals from the current gallery root when cached absolute paths are stale', async () => {
    const folder = await folderRepository.upsert({ slug: 'album-relocated', name: 'Album Relocated', folderPath: 'album-relocated' });
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    const image = await createIndexedMedia(folder, 'photo.jpg', 2_500, 'preview', null, {
      storedGalleryRoot: oldGalleryRoot
    });
    const handler = getRouteHandler('/originals/:id', 'get');
    const response = createResponse();

    await handler(
      {
        params: { id: String(image.id) },
        query: {}
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.sendFile).toHaveBeenCalledWith(path.join(appConfig.galleryRoot, image.relative_path));
    expect(response.sendFile).not.toHaveBeenCalledWith(image.absolute_path);
    expect(response.status).not.toHaveBeenCalled();
  });

  it('does not serve an indexed original path that would escape the current gallery root', async () => {
    const folder = await folderRepository.upsert({ slug: 'album-traversal', name: 'Album Traversal', folderPath: 'album-traversal' });
    const outsidePath = path.join(tempRoot, 'outside.jpg');
    await fs.writeFile(outsidePath, 'outside');
    const image = await imageRepository.upsert({
      folderId: folder.id,
      filename: 'outside.jpg',
      extension: '.jpg',
      relativePath: '../outside.jpg',
      absolutePath: outsidePath,
      fileSize: 7,
      width: 1280,
      height: 960,
      mediaType: 'image',
      mimeType: 'image/jpeg',
      durationMs: null,
      fingerprint: createFingerprint('../outside.jpg', 7, 3_000),
      mtimeMs: 3_000,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: 3_000,
      takenAt: 3_000,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: getThumbnailRelativePath('../outside.jpg'),
      previewPath: getPreviewRelativePath('../outside.jpg', 'image'),
      playbackStrategy: 'preview'
    });
    const handler = getRouteHandler('/originals/:id', 'get');
    const response = createResponse();

    await handler(
      {
        params: { id: String(image.id) },
        query: {}
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.sendFile).not.toHaveBeenCalled();
    expect(response.download).not.toHaveBeenCalled();
  });

  it('does not serve originals while a library rebuild is required after failed relocation', async () => {
    const folder = await folderRepository.upsert({ slug: 'album-blocked', name: 'Album Blocked', folderPath: 'album-blocked' });
    const image = await createIndexedMedia(folder, 'photo.jpg', 2_750, 'preview');
    const handler = getRouteHandler('/originals/:id', 'get');
    const response = createResponse();

    await appSettingsRepository.set(LIBRARY_REBUILD_REQUIRED_SETTING_KEY, '1');

    await handler(
      {
        params: { id: String(image.id) },
        query: {}
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.sendFile).not.toHaveBeenCalled();
    expect(response.download).not.toHaveBeenCalled();
  });

  it('returns 404 when the original file is no longer available on disk', async () => {
    const folder = await folderRepository.upsert({ slug: 'album-missing', name: 'Album Missing', folderPath: 'album-missing' });
    const image = await createIndexedMedia(folder, 'missing.jpg', 3_000, 'preview');
    const handler = getRouteHandler('/originals/:id', 'get');
    const response = createResponse();

    await fs.rm(image.absolute_path, { force: true });

    await handler(
      {
        params: { id: String(image.id) },
        query: {}
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.status).toHaveBeenCalledWith(404);
    expect(response.json).toHaveBeenCalledWith({ message: 'Original media not found' });
    expect(response.sendFile).not.toHaveBeenCalled();
    expect(response.download).not.toHaveBeenCalled();
  });

  function createResponse(): MockResponse {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      sendFile: vi.fn().mockReturnThis(),
      download: vi.fn().mockReturnThis()
    };
  }

  function getRouteHandler(routePath: string, method: 'get'): express.RequestHandler {
    const routerLayers = (apiRouter as unknown as { stack: RouteLayer[] }).stack;
    const layer = routerLayers.find((entry) => entry.route?.path === routePath && entry.route.methods[method]);

    if (!layer?.route) {
      throw new Error(`Route ${method.toUpperCase()} ${routePath} was not found`);
    }

    return layer.route.stack.at(-1)!.handle;
  }

  async function createIndexedMedia(
    folder: FolderRecord,
    filename: string,
    mtimeMs: number,
    playbackStrategy: PlaybackStrategy,
    durationMs: number | null = null,
    options: { storedGalleryRoot?: string } = {}
  ) {
    const relativePath = `${folder.folder_path}/${filename}`;
    const sourceAbsolutePath = path.join(appConfig.galleryRoot, relativePath);
    const absolutePath = options.storedGalleryRoot
      ? path.join(options.storedGalleryRoot, relativePath)
      : sourceAbsolutePath;
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
    const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
    const fileSize = 2_048 + mtimeMs;

    await fs.mkdir(path.dirname(sourceAbsolutePath), { recursive: true });
    await fs.writeFile(sourceAbsolutePath, `original:${filename}`);

    return await imageRepository.upsert({
      folderId: folder.id,
      filename,
      extension,
      relativePath,
      absolutePath,
      fileSize,
      width: 1280,
      height: 960,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs,
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
});
