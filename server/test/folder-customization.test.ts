import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFingerprint, getMediaTypeFromExtension, getMimeTypeFromExtension } from '../src/utils/image-utils.js';

vi.mock('../src/services/storage-service.js', () => ({
  storageService: {
    getDatabasePath: () => {
      const dbDir = process.env.DB_DIR || path.join(os.tmpdir(), 'db');
      return path.join(dbDir, 'gallery.db');
    },
    getState: () => ({
      libraryAvailable: true,
      lastScanCompletedAt: null,
      lastScanDurationMs: null,
      stats: null,
      libraryStatus: 'ready'
    }),
    startSession: vi.fn(),
    refreshState: vi.fn()
  }
}));

type ApiModule = typeof import('../src/routes/api.js');
type EnvModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

describe.sequential('folder customization', () => {
  let tempRoot = '';
  let appConfig: EnvModule['appConfig'];
  let apiModule: ApiModule;
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-folder-customization-'));

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
    apiModule = await import('../src/routes/api.js');
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({folderRepository, imageRepository, maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await maintenanceRepository.resetLibraryIndex();

    await fs.rm(appConfig.galleryRoot, { recursive: true, force: true });
    await fs.mkdir(appConfig.galleryRoot, { recursive: true });
  });

  describe('schema validation', () => {
    it('validates PATCH folder body correctly', async () => {
      const { patchFolderBodySchema } = apiModule;

      expect(patchFolderBodySchema.parse({ name: 'Valid Name', description: 'Some description' })).toEqual({
        name: 'Valid Name',
        description: 'Some description'
      });

      expect(patchFolderBodySchema.parse({ name: 'Just Name' })).toEqual({
        name: 'Just Name'
      });

      expect(() => patchFolderBodySchema.parse({ name: '' })).toThrowError();
      expect(() => patchFolderBodySchema.parse({ name: 'x'.repeat(256) })).toThrowError();
      expect(() => patchFolderBodySchema.parse({ name: 'Name', description: 'x'.repeat(301) })).toThrowError();
    });

    it('validates POST folder body correctly', async () => {
      const { folderCoverBodySchema } = apiModule;

      expect(folderCoverBodySchema.parse({ imageId: 10 })).toEqual({ imageId: 10 });
      expect(() => folderCoverBodySchema.parse({ imageId: -1 })).toThrowError();
      expect(() => folderCoverBodySchema.parse({ imageId: 'abc' })).toThrowError();
    });

    it('validates PATCH image caption body correctly', async () => {
      const { patchImageCaptionBodySchema } = apiModule;

      expect(patchImageCaptionBodySchema.parse({ caption: '  New caption  ' })).toEqual({
        caption: 'New caption'
      });
      expect(patchImageCaptionBodySchema.parse({ caption: '   ' })).toEqual({
        caption: null
      });
      expect(patchImageCaptionBodySchema.parse({})).toEqual({
        caption: null
      });

      expect(() => patchImageCaptionBodySchema.parse({ caption: 'x'.repeat(301) })).toThrowError();
    });
  });

  describe('gallery service operations', () => {
    it('updates folder metadata', async () => {
      const folder = await folderRepository.upsert({ slug: 'test-folder', name: 'Test Folder', folderPath: 'test-folder' });
      await imageRepository.upsert({
        folderId: folder.id,
        filename: 'img1.jpg',
        relativePath: 'test/img1.jpg',
        absolutePath: '/dummy/test/img1.jpg',
        fileSize: 100,
        mtimeMs: 1000,
        width: 100,
        height: 100,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        fingerprint: 'test-fingerprint-1',
        sortTimestamp: 1000,
        takenAt: 1000,
        takenAtSource: 'mtime',
        extension: '.jpg',
        firstSeenAt: new Date().toISOString(),
        thumbnailPath: 't/img1.jpg',
        previewPath: 'p/img1.webp',
        playbackStrategy: 'preview',
        durationMs: null,
        exifJson: null
      });
      
      
      const updated = await galleryService.updateFolderMetadata('test-folder', 'New Name', 'A new bio for testing');
      
      expect(updated!.name).toBe('New Name');
      expect(updated!.description).toBe('A new bio for testing');

      const DBFolder = await folderRepository.getBySlug('test-folder');
      expect(DBFolder?.name).toBe('New Name');
      expect(DBFolder?.description).toBe('A new bio for testing');
    });

    it('returns null updating non-existent metadata', async () => {
      expect(await galleryService.updateFolderMetadata('non-existent', 'Name', null)).toBeFalsy();
    });

    it('updates an image caption and clears it back to the filename fallback', async () => {
      const folder = await folderRepository.upsert({ slug: 'caption-folder', name: 'Caption Folder', folderPath: 'caption-folder' });
      const image = await imageRepository.upsert({
        folderId: folder.id,
        filename: 'photo-1.jpg',
        relativePath: 'caption-folder/photo-1.jpg',
        absolutePath: '/dummy/caption-folder/photo-1.jpg',
        fileSize: 100,
        mtimeMs: 1000,
        width: 100,
        height: 100,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        fingerprint: 'caption-fingerprint-1',
        sortTimestamp: 1000,
        takenAt: 1000,
        takenAtSource: 'mtime',
        extension: '.jpg',
        firstSeenAt: new Date().toISOString(),
        thumbnailPath: 't/photo-1.webp',
        previewPath: 'p/photo-1.webp',
        playbackStrategy: 'preview',
        durationMs: null,
        exifJson: null
      });

      const updated = await galleryService.updateImageCaption(image.id, 'Custom caption');
      expect(updated?.caption).toBe('Custom caption');
      expect((await imageRepository.getById(image.id))?.caption).toBe('Custom caption');

      const cleared = await galleryService.updateImageCaption(image.id, null);
      expect(cleared?.caption).toBeNull();
      expect((await imageRepository.getById(image.id))?.caption).toBeNull();
    });

    it('sets folder cover avatar', async () => {
      const folder = await folderRepository.upsert({ slug: 'test-folder-2', name: 'Test 2', folderPath: 'test2' });
      const image = await imageRepository.upsert({
        folderId: folder.id,
        filename: 'img1.jpg',
        relativePath: 'test2/img1.jpg',
        absolutePath: '/dummy/test2/img1.jpg',
        fileSize: 100,
        mtimeMs: 1000,
        width: 100,
        height: 100,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        fingerprint: 'test-fingerprint',
        sortTimestamp: 1000,
        takenAt: 1000,
        takenAtSource: 'mtime',
        extension: '.jpg',
        firstSeenAt: new Date().toISOString(),
        thumbnailPath: 't/img1.jpg',
        previewPath: 'p/img1.webp',
        playbackStrategy: 'preview',
        durationMs: null,
        exifJson: null
      });

      await galleryService.setFolderAvatar('test-folder-2', image.id);
      
      const DBFolder = await folderRepository.getBySlug('test-folder-2');
      expect(DBFolder?.avatar_image_id).toBe(image.id);
      expect(DBFolder?.avatar_source).toBe('manual');
    });

    it('allows a video thumbnail to be used as the folder cover avatar', async () => {
      const folder = await folderRepository.upsert({ slug: 'test-folder-video', name: 'Test Video', folderPath: 'test-video' });
      const video = await imageRepository.upsert({
        folderId: folder.id,
        filename: 'clip1.mp4',
        relativePath: 'test-video/clip1.mp4',
        absolutePath: '/dummy/test-video/clip1.mp4',
        fileSize: 8_192,
        mtimeMs: 2_000,
        width: 1920,
        height: 1080,
        mediaType: 'video',
        mimeType: 'video/mp4',
        fingerprint: 'test-fingerprint-video',
        sortTimestamp: 2_000,
        takenAt: 2_000,
        takenAtSource: 'mtime',
        extension: '.mp4',
        firstSeenAt: new Date().toISOString(),
        thumbnailPath: 't/clip1.webp',
        previewPath: 'p/clip1.mp4',
        playbackStrategy: 'original',
        durationMs: 5_000,
        exifJson: null
      });

      expect(await galleryService.setFolderAvatar('test-folder-video', video.id)).toBe(true);

      // Manual avatar selection is revalidated during sync/rescan paths.
      await folderRepository.syncAvatarSelection(folder.id);

      const dbFolder = await folderRepository.getBySlug('test-folder-video');
      expect(dbFolder?.avatar_image_id).toBe(video.id);
      expect(dbFolder?.avatar_source).toBe('manual');

      const folderSummary = await galleryService.getFolderBySlug('test-folder-video');
      expect(folderSummary?.avatarImageId).toBe(video.id);
      expect(folderSummary?.avatarUrl).toBe('/thumbnails/t/clip1.webp');
    });

    it('exposes customized parent folder display names for nested folders', async () => {
      const parentFolder = await folderRepository.upsert({ slug: 'italy', name: 'Italy', folderPath: 'Italy' });
      const childFolder = await folderRepository.upsert({ slug: 'italy-2022', name: '2022', folderPath: 'Italy/2022' });

      await imageRepository.upsert({
        folderId: parentFolder.id,
        filename: 'rome.jpg',
        relativePath: 'Italy/rome.jpg',
        absolutePath: '/dummy/Italy/rome.jpg',
        fileSize: 120,
        mtimeMs: 1_000,
        width: 100,
        height: 100,
        mediaType: getMediaTypeFromExtension('.jpg'),
        mimeType: getMimeTypeFromExtension('.jpg'),
        fingerprint: createFingerprint('Italy/rome.jpg', 120, 1_000),
        sortTimestamp: 1_000,
        takenAt: 1_000,
        takenAtSource: 'mtime',
        extension: '.jpg',
        firstSeenAt: new Date().toISOString(),
        thumbnailPath: 't/rome.webp',
        previewPath: 'p/rome.webp',
        playbackStrategy: 'preview',
        durationMs: null,
        exifJson: null
      });

      const childImage = await imageRepository.upsert({
        folderId: childFolder.id,
        filename: 'venice.jpg',
        relativePath: 'Italy/2022/venice.jpg',
        absolutePath: '/dummy/Italy/2022/venice.jpg',
        fileSize: 240,
        mtimeMs: 2_000,
        width: 100,
        height: 100,
        mediaType: getMediaTypeFromExtension('.jpg'),
        mimeType: getMimeTypeFromExtension('.jpg'),
        fingerprint: createFingerprint('Italy/2022/venice.jpg', 240, 2_000),
        sortTimestamp: 2_000,
        takenAt: 2_000,
        takenAtSource: 'mtime',
        extension: '.jpg',
        firstSeenAt: new Date().toISOString(),
        thumbnailPath: 't/venice.webp',
        previewPath: 'p/venice.webp',
        playbackStrategy: 'preview',
        durationMs: null,
        exifJson: null
      });

      expect((await galleryService.updateFolderMetadata('italy', 'Italia', null))?.name).toBe('Italia');

      const childSummary = await galleryService.getFolderBySlug('italy-2022');
      const childFeedItem = (await galleryService.getFeed(1, 10, 'recent')).items.find((item) => item.folderSlug === 'italy-2022');
      const childDetail = await galleryService.getImageDetail(childImage.id);

      expect(childSummary?.parentFolderName).toBe('Italia');
      expect(childFeedItem?.folderParentName).toBe('Italia');
      expect(childDetail?.folderParentName).toBe('Italia');
    });

    it('returns null when setting cover for non-existent items', async () => {
      expect(await galleryService.setFolderAvatar('non-existent', 123)).toBeNull();
      
      const folder = await folderRepository.upsert({ slug: 'test-folder-3', name: 'Test 3', folderPath: 'test3' });
      expect(await galleryService.setFolderAvatar('test-folder-3', 999)).toBeNull();
    });
  });
});
