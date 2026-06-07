import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRole = ModelsModule['FolderRole'];
type ImageRecord = ModelsModule['ImageRecord'];
type MediaType = ModelsModule['MediaType'];

describe.sequential('bookmark collections', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let collectionRepository: RepositoriesModule['collectionRepository'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-bookmark-collections-'));

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
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({collectionRepository, folderRepository, imageRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('creates exactly one Saved default collection', async () => {
    const first = await collectionRepository.ensureDefaultCollection();
    const second = await collectionRepository.ensureDefaultCollection();
    const summaries = await collectionRepository.listSummaries();

    expect(first.id).toBe(second.id);
    expect(first.slug).toBe('saved');
    expect(first.name).toBe('Saved');
    expect(summaries.filter((collection) => collection.is_default === 1)).toHaveLength(1);
  });

  it('adds custom collection membership through Saved', async () => {
    const image = await createIndexedMedia('trips', 'photo-a.jpg', 1_800_000_000_000);

    const custom = await galleryService.createCollection('Trip Picks');
    expect(custom).toMatchObject({ slug: 'trip-picks', name: 'Trip Picks', isDefault: false });

    expect(await galleryService.addImageToCollection('trip-picks', image.id)).toMatchObject({
      imageId: image.id,
      isSaved: true
    });

    const memberships = await galleryService.getImageCollections(image.id);
    expect(memberships?.isSaved).toBe(true);
    expect(memberships?.items.find((collection) => collection.slug === 'saved')?.containsImage).toBe(true);
    expect(memberships?.items.find((collection) => collection.slug === 'trip-picks')?.containsImage).toBe(true);
    expect((await galleryService.getCollectionImages('saved', 1, 20))?.items.map((item) => item.id)).toEqual([image.id]);
    expect((await galleryService.getCollectionImages('trip-picks', 1, 20))?.items.map((item) => item.id)).toEqual([image.id]);
  });

  it('removes custom memberships when a post is unsaved', async () => {
    const image = await createIndexedMedia('trips-unsave', 'photo-a.jpg', 1_800_000_005_000);
    await galleryService.createCollection('Trip Picks');

    expect(await galleryService.addImageToCollection('trip-picks', image.id)).toMatchObject({
      imageId: image.id,
      isSaved: true
    });
    expect(await galleryService.unsaveImage(image.id)).toMatchObject({
      imageId: image.id,
      isSaved: false
    });

    const memberships = await galleryService.getImageCollections(image.id);
    expect(memberships?.isSaved).toBe(false);
    expect(memberships?.items.find((collection) => collection.slug === 'saved')?.containsImage).toBe(false);
    expect(memberships?.items.find((collection) => collection.slug === 'trip-picks')?.containsImage).toBe(false);
    expect((await galleryService.getCollectionImages('saved', 1, 20))?.items).toHaveLength(0);
    expect((await galleryService.getCollectionImages('trip-picks', 1, 20))?.items).toHaveLength(0);
  });

  it('removing a post from a custom collection keeps it saved', async () => {
    const image = await createIndexedMedia('trips-remove-custom', 'photo-a.jpg', 1_800_000_007_500);
    await galleryService.createCollection('Trip Picks');
    await galleryService.addImageToCollection('trip-picks', image.id);

    expect(await galleryService.removeImageFromCollection('trip-picks', image.id)).toMatchObject({
      imageId: image.id,
      isSaved: true
    });

    const memberships = await galleryService.getImageCollections(image.id);
    expect(memberships?.isSaved).toBe(true);
    expect(memberships?.items.find((collection) => collection.slug === 'saved')?.containsImage).toBe(true);
    expect(memberships?.items.find((collection) => collection.slug === 'trip-picks')?.containsImage).toBe(false);
  });

  it('removing the default collection membership clears every collection membership', async () => {
    const image = await createIndexedMedia('trips-remove-default', 'photo-a.jpg', 1_800_000_009_000);
    await galleryService.createCollection('Trip Picks');
    await galleryService.addImageToCollection('trip-picks', image.id);

    expect(await galleryService.removeImageFromCollection('saved', image.id)).toMatchObject({
      imageId: image.id,
      isSaved: false
    });

    const memberships = await galleryService.getImageCollections(image.id);
    expect(memberships?.isSaved).toBe(false);
    expect(memberships?.items.find((collection) => collection.slug === 'saved')?.containsImage).toBe(false);
    expect(memberships?.items.find((collection) => collection.slug === 'trip-picks')?.containsImage).toBe(false);
  });

  it('does not save to the default collection when the target custom collection is missing', async () => {
    const image = await createIndexedMedia('missing-target', 'photo-a.jpg', 1_800_000_010_000);

    expect(await galleryService.addImageToCollection('does-not-exist', image.id)).toBeNull();
    expect(await collectionRepository.isImageSaved(image.id)).toBe(false);
  });

  it('repairs legacy custom-only collection memberships into Saved', async () => {
    const image = await createIndexedMedia('repair-membership', 'photo-a.jpg', 1_800_000_012_500);
    await galleryService.createCollection('Repair Picks');
    await galleryService.addImageToCollection('repair-picks', image.id);

    await collectionRepository.removeImage('saved', image.id);
    expect(await collectionRepository.isImageSaved(image.id)).toBe(false);
    expect((await galleryService.getImageCollections(image.id))?.items.find((collection) => collection.slug === 'repair-picks')?.containsImage).toBe(true);

    expect(await collectionRepository.repairDefaultMemberships()).toBe(1);

    const memberships = await galleryService.getImageCollections(image.id);
    expect(memberships?.isSaved).toBe(true);
    expect(memberships?.items.find((collection) => collection.slug === 'saved')?.containsImage).toBe(true);
    expect(memberships?.items.find((collection) => collection.slug === 'repair-picks')?.containsImage).toBe(true);
  });

  it('renames and deletes custom collections while preserving saved membership', async () => {
    const image = await createIndexedMedia('collection-management', 'photo-a.jpg', 1_800_000_015_000);
    expect(await galleryService.createCollection('Rename Me')).toMatchObject({
      slug: 'rename-me',
      name: 'Rename Me',
      isDefault: false
    });

    expect(await galleryService.updateCollection('rename-me', 'Trip Archive')).toMatchObject({
      slug: 'rename-me',
      name: 'Trip Archive',
      isDefault: false
    });
    expect(await galleryService.addImageToCollection('rename-me', image.id)).toMatchObject({
      imageId: image.id,
      isSaved: true
    });

    expect(await galleryService.deleteCollection('rename-me')).toMatchObject({
      slug: 'rename-me',
      name: 'Trip Archive'
    });
    expect(await galleryService.getCollectionImages('rename-me', 1, 20)).toBeNull();

    const memberships = await galleryService.getImageCollections(image.id);
    expect(memberships?.isSaved).toBe(true);
    expect(memberships?.items.some((collection) => collection.slug === 'rename-me')).toBe(false);
    expect(memberships?.items.find((collection) => collection.slug === 'saved')?.containsImage).toBe(true);
    expect((await galleryService.getCollectionImages('saved', 1, 20))?.items.map((item) => item.id)).toEqual([image.id]);
  });

  it('filters hidden collection members while keeping membership metadata', async () => {
    const visible = await createIndexedMedia('visible', 'photo-a.jpg', 1_800_000_020_000);
    const cover = await createIndexedMedia('visible', 'cover.jpg', 1_800_000_021_000);
    const deleted = await createIndexedMedia('visible', 'deleted.jpg', 1_800_000_022_000);
    const trashed = await createIndexedMedia('visible', 'trashed.jpg', 1_800_000_023_000);
    const story = await createIndexedMedia('story-capsule', 'story.jpg', 1_800_000_024_000, 'story_capsule');

    for (const image of [visible, cover, deleted, trashed, story]) {
      expect(await galleryService.saveImage(image.id)).toMatchObject({ imageId: image.id, isSaved: true });
    }
    await imageRepository.markDeleted(deleted.relative_path);
    await imageRepository.moveToTrash(trashed.id);

    const saved = await galleryService.getCollectionImages('saved', 1, 20);
    expect(saved?.total).toBe(1);
    expect(saved?.items.map((item) => item.id)).toEqual([visible.id]);
    expect(await collectionRepository.isImageSaved(deleted.id)).toBe(true);
    expect(await collectionRepository.isImageSaved(story.id)).toBe(true);
  });

  it('restores collection listing when a soft-deleted image reappears', async () => {
    const image = await createIndexedMedia('reactivated', 'photo-a.jpg', 1_800_000_030_000);
    expect(await galleryService.saveImage(image.id)).toMatchObject({ imageId: image.id, isSaved: true });

    await imageRepository.markDeleted(image.relative_path);
    expect((await galleryService.getCollectionImages('saved', 1, 20))?.items).toHaveLength(0);

    const reappeared = await createIndexedMedia('reactivated', 'photo-a.jpg', 1_800_000_031_000);
    expect(reappeared.id).toBe(image.id);
    expect((await galleryService.getCollectionImages('saved', 1, 20))?.items.map((item) => item.id)).toEqual([image.id]);
  });

  it('cascades membership when an image row is hard-deleted', async () => {
    const image = await createIndexedMedia('hard-delete', 'photo-a.jpg', 1_800_000_040_000);
    await galleryService.createCollection('Keepers');
    expect(await galleryService.addImageToCollection('keepers', image.id)).toMatchObject({ imageId: image.id, isSaved: true });

    await imageRepository.deleteById(image.id);

    expect(await collectionRepository.isImageSaved(image.id)).toBe(false);
    expect((await galleryService.getCollectionImages('keepers', 1, 20))?.items).toHaveLength(0);
  });

  it('rejects synthetic __all collection queries', async () => {
    await createIndexedMedia('all/default', 'photo-a.jpg', 1_800_000_045_000);
    expect(await galleryService.getCollectionImages('__all', 1, 20)).toBeNull();
  });

  it('includes isSaved on feed and detail payloads', async () => {
    const image = await createIndexedMedia('payloads', 'photo-a.jpg', 1_800_000_050_000);
    expect(await galleryService.saveImage(image.id)).toMatchObject({ imageId: image.id, isSaved: true });

    expect((await galleryService.getFeed(1, 10, 'recent')).items.find((item) => item.id === image.id)?.isSaved).toBe(true);
    expect((await galleryService.getImageDetail(image.id))?.isSaved).toBe(true);
  });

  async function createIndexedMedia(
    folderPath: string,
    filename: string,
    timestamp: number,
    role: FolderRole = 'normal'
  ): Promise<ImageRecord> {
    const folder = await folderRepository.upsert({
      slug: folderPath.replaceAll('/', '-'),
      name: path.posix.basename(folderPath),
      folderPath,
      role
    });
    const relativePath = `${folderPath}/${filename}`;
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);

    return await imageRepository.upsert({
      folderId: folder.id,
      filename,
      extension,
      relativePath,
      absolutePath,
      fileSize: 2_048,
      width: mediaType === 'video' ? 1080 : 1600,
      height: mediaType === 'video' ? 1920 : 1200,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs: getDurationForMediaType(mediaType),
      isAnimated: false,
      fingerprint: createFingerprint(relativePath, 2_048, timestamp),
      mtimeMs: timestamp,
      firstSeenAt: new Date(timestamp).toISOString(),
      sortTimestamp: timestamp,
      takenAt: timestamp,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, mediaType),
      playbackStrategy: 'preview'
    });
  }

  function getDurationForMediaType(mediaType: MediaType): number | null {
    return mediaType === 'video' ? 18_000 : null;
  }
});
