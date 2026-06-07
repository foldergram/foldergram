import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMediaTypeFromExtension, getPreviewRelativePath, getThumbnailRelativePath } from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('trash flow', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let likeRepository: RepositoriesModule['likeRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-trash-flow-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    generateThumbnailDerivativeMock.mockReset();
    generateDerivativesMock.mockReset();
    readMediaMetadataMock.mockReset();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({imageRepository, likeRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(sourcePath).toLowerCase());
      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 12_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });

    generateDerivativesMock.mockImplementation(async (sourcePath: string, relativePath: string) => {
      await fs.access(sourcePath);

      const mediaType = getMediaTypeFromExtension(path.extname(relativePath).toLowerCase());
      const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
      const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
      const thumbnailPath = path.join(appConfig.thumbnailsDir, thumbnailRelativePath);
      const previewPath = path.join(appConfig.previewsDir, previewRelativePath);

      await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
      await fs.mkdir(path.dirname(previewPath), { recursive: true });
      await fs.writeFile(thumbnailPath, `thumb:${relativePath}`);
      await fs.writeFile(previewPath, `preview:${relativePath}`);

      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 12_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false,
        thumbnailPath: thumbnailRelativePath,
        previewPath: previewRelativePath,
        generatedThumbnail: true,
        generatedPreview: true
      };
    });

    generateThumbnailDerivativeMock.mockImplementation(async (sourcePath: string, relativePath: string) => {
      await fs.access(sourcePath);
      const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
      const thumbnailPath = path.join(appConfig.thumbnailsDir, thumbnailRelativePath);
      await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
      await fs.writeFile(thumbnailPath, `thumb:${relativePath}`);

      return {
        thumbnailPath: thumbnailRelativePath,
        generatedThumbnail: true
      };
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('hides trashed posts from feed/folder/detail/likes and makes them visible again on restore', async () => {
    await createSourceFile('trip/photo-a.jpg');
    await createSourceFile('trip/photo-b.jpg');
    await scanAll('initial');

    const imageA = await mustGetImage('trip/photo-a.jpg');
    const imageB = await mustGetImage('trip/photo-b.jpg');
    expect(await galleryService.likeImage(imageA.id)).toMatchObject({ id: imageA.id, liked: true });

    const trashed = await galleryService.trashImage(imageA.id);
    expect(trashed).toEqual({
      id: imageA.id,
      folderSlug: 'trip'
    });

    const trashedRow = await imageRepository.getById(imageA.id);
    expect(trashedRow?.is_trashed).toBe(1);
    expect(trashedRow?.is_deleted).toBe(0);

    const feedIds = (await galleryService.getFeed(1, 20, 'recent')).items.map((item) => item.id);
    expect(feedIds).not.toContain(imageA.id);
    expect(feedIds).toContain(imageB.id);

    const folderImages = await galleryService.getFolderImages('trip', 1, 20);
    expect(folderImages?.items.map((item) => item.id)).toEqual([imageB.id]);

    expect(await galleryService.getImageDetail(imageA.id)).toBeNull();
    expect((await galleryService.getLikes()).items.map((item) => item.id)).not.toContain(imageA.id);
    expect(await galleryService.likeImage(imageA.id)).toBeNull();

    const restored = await galleryService.restoreImage(imageA.id);
    expect(restored).toEqual({
      id: imageA.id,
      folderSlug: 'trip'
    });

    const restoredRow = await imageRepository.getById(imageA.id);
    expect(restoredRow?.is_trashed).toBe(0);
    expect(restoredRow?.trashed_at).toBeNull();
    expect(await galleryService.getImageDetail(imageA.id)).not.toBeNull();
    expect((await galleryService.getFolderImages('trip', 1, 20))?.items.map((item) => item.id)).toContain(imageA.id);
    expect((await galleryService.getFeed(1, 20, 'recent')).items.map((item) => item.id)).toContain(imageA.id);
    expect((await galleryService.getLikes()).items.map((item) => item.id)).toContain(imageA.id);
  });

  it('keeps trashed posts hidden across rescans, including missing and reappeared files', async () => {
    await createSourceFile('archive/old.jpg');
    await scanAll('initial');

    const image = await mustGetImage('archive/old.jpg');
    expect(await galleryService.trashImage(image.id)).toMatchObject({ id: image.id });

    await scanAll('rescan-present');
    expect((await imageRepository.getById(image.id))?.is_trashed).toBe(1);
    expect((await imageRepository.getById(image.id))?.is_deleted).toBe(0);

    await fs.rm(path.join(appConfig.galleryRoot, 'archive/old.jpg'), { force: true });
    await scanAll('rescan-missing');
    expect((await imageRepository.getById(image.id))?.is_deleted).toBe(1);
    expect((await imageRepository.getById(image.id))?.is_trashed).toBe(1);

    await createSourceFile('archive/old.jpg', 'reappeared');
    await scanAll('rescan-reappeared');
    expect((await imageRepository.getById(image.id))?.is_deleted).toBe(0);
    expect((await imageRepository.getById(image.id))?.is_trashed).toBe(1);
    expect((await galleryService.getFeed(1, 20, 'recent')).items.map((item) => item.id)).not.toContain(image.id);
  });

  it('preserves custom captions in likes and trash payloads', async () => {
    await createSourceFile('captions/photo-a.jpg');
    await scanAll('initial');

    const image = await mustGetImage('captions/photo-a.jpg');
    expect(await galleryService.updateImageCaption(image.id, 'Misty morning by the lake')).toMatchObject({
      id: image.id,
      caption: 'Misty morning by the lake'
    });

    expect(await galleryService.likeImage(image.id)).toMatchObject({ id: image.id, liked: true });
    expect((await galleryService.getLikes()).items.find((item) => item.id === image.id)?.caption).toBe('Misty morning by the lake');

    expect(await galleryService.trashImage(image.id)).toMatchObject({ id: image.id });
    expect((await galleryService.getTrashImages(1, 20)).items.find((item) => item.id === image.id)?.caption).toBe('Misty morning by the lake');
  });

  it('permanently deletes rows and derivatives and still succeeds when original files are already missing', async () => {
    await createSourceFile('cleanup/photo-a.jpg');
    await scanAll('initial');

    const imageA = await mustGetImage('cleanup/photo-a.jpg');
    const imageAThumbnailPath = path.join(appConfig.thumbnailsDir, imageA.thumbnail_path);
    const imageAPreviewPath = path.join(appConfig.previewsDir, imageA.preview_path);
    await likeRepository.upsert(imageA.id);

    const deletedA = await galleryService.deleteImage(imageA.id);
    expect(deletedA).toEqual({
      id: imageA.id,
      folderSlug: 'cleanup'
    });
    expect(await imageRepository.getById(imageA.id)).toBeUndefined();
    expect(await likeRepository.getByImageId(imageA.id)).toBeUndefined();
    await expect(fs.stat(path.join(appConfig.galleryRoot, 'cleanup/photo-a.jpg'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(imageAThumbnailPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(imageAPreviewPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await createSourceFile('cleanup/photo-b.jpg');
    await scanAll('second');

    const imageB = await mustGetImage('cleanup/photo-b.jpg');
    await fs.rm(path.join(appConfig.galleryRoot, 'cleanup/photo-b.jpg'), { force: true });

    const deletedB = await galleryService.deleteImage(imageB.id);
    expect(deletedB).toEqual({
      id: imageB.id,
      folderSlug: 'cleanup'
    });
    expect(await imageRepository.getById(imageB.id)).toBeUndefined();
  });

  it('keeps scan-driven missing/reappeared is_deleted behavior intact for non-trashed files', async () => {
    await createSourceFile('reactivate/keep.jpg');
    await scanAll('initial');

    const image = await mustGetImage('reactivate/keep.jpg');
    expect(image.is_deleted).toBe(0);
    expect(image.is_trashed).toBe(0);

    await fs.rm(path.join(appConfig.galleryRoot, 'reactivate/keep.jpg'), { force: true });
    await scanAll('missing');
    expect((await imageRepository.getById(image.id))?.is_deleted).toBe(1);
    expect((await imageRepository.getById(image.id))?.is_trashed).toBe(0);

    await createSourceFile('reactivate/keep.jpg', 'back-again');
    await scanAll('reappeared');
    expect((await imageRepository.getById(image.id))?.is_deleted).toBe(0);
    expect((await imageRepository.getById(image.id))?.is_trashed).toBe(0);
    expect((await galleryService.getFeed(1, 20, 'recent')).items.map((item) => item.id)).toContain(image.id);
  });

  async function scanAll(reason: string): Promise<void> {
    const run = await scannerService.scanAll(reason, {
      repairUnchangedDerivatives: false
    });

    expect(run?.status).toBe('completed');
  }

  async function createSourceFile(relativePath: string, contents = 'source'): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${contents}:${relativePath}`);
  }

  async function mustGetImage(relativePath: string) {
    const row = await imageRepository.getByRelativePath(relativePath);
    expect(row).toBeDefined();
    return row!;
  }
});
