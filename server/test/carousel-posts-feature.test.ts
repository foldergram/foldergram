import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type express from 'express';

import { LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY } from '../src/constants/app-setting-keys.js';
import {
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';
import { getRelativeGalleryPath } from '../src/utils/path-utils.js';
import { requestTestApp } from './http-test-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');

async function requestApp(app: express.Application, method: string, urlPath: string, body?: unknown) {
  return requestTestApp(app, method, urlPath, { 'x-foldergram-intent': '1' }, body);
}

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('carousel posts feature', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let postRepository: RepositoriesModule['postRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let placeRepository: RepositoriesModule['placeRepository'];
  let app: express.Application;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-carousels-feature-'));

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
    ({ folderRepository, postRepository, maintenanceRepository, appSettingsRepository, imageRepository, placeRepository } = await import(
      '../src/db/repositories.js'
    ));
    app = (await import('../src/app.js')).createApp();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (absolutePath: string) => {
      const extension = path.extname(absolutePath).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);
      const relativePath = getRelativeGalleryPath(appConfig.galleryRoot, absolutePath);

      return {
        width: mediaType === 'video' ? 1080 : 1440,
        height: mediaType === 'video' ? 1920 : 960,
        takenAt: null,
        durationMs: mediaType === 'video' ? 4_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false,
        thumbnailPath: getThumbnailRelativePath(relativePath),
        previewPath: getPreviewRelativePath(relativePath, mediaType),
        generatedThumbnail: true,
        generatedPreview: true
      };
    });

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string) => {
      const extension = path.extname(relativePath).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);

      return {
        thumbnailPath: getThumbnailRelativePath(relativePath),
        previewPath: getPreviewRelativePath(relativePath, mediaType)
      };
    });

    maintenanceRepository.resetLibraryIndex();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('scans reserved carousels folder and creates carousel post with ordered items', async () => {
    const albumPath = path.join(appConfig.galleryRoot, 'vacation');
    const carouselPath = path.join(albumPath, 'carousels', 'sunset');
    await fs.mkdir(carouselPath, { recursive: true });

    const dummyContent = 'dummy-media';
    await fs.writeFile(path.join(carouselPath, '01-beach.jpg'), dummyContent);
    await fs.writeFile(path.join(carouselPath, '02-wave.jpg'), dummyContent);
    await fs.writeFile(path.join(carouselPath, '10-dusk.jpg'), dummyContent);

    await scannerService.scanAll('manual');

    const posts = postRepository.listFeed(1, 20);
    expect(posts).toHaveLength(1);

    const post = posts[0];
    expect(post.postType).toBe('carousel');
    expect(post.itemCount).toBe(3);
    expect(post.mediaItems).toHaveLength(3);
    expect(post.mediaItems[0].filename).toBe('01-beach.jpg');
    expect(post.mediaItems[1].filename).toBe('02-wave.jpg');
    expect(post.mediaItems[2].filename).toBe('10-dusk.jpg');

    const feed = galleryService.getFeed(1, 20, 'recent');
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].postType).toBe('carousel');
    expect(feed.items[0].mediaItems).toHaveLength(3);
    expect(feed.items[0].itemCount).toBe(3);
  });

  it('keeps a carousel beginning with cover.jpg visible across post surfaces', async () => {
    const carouselPath = path.join(appConfig.galleryRoot, 'album', 'carousels', 'cover-first');
    await fs.mkdir(carouselPath, { recursive: true });
    await fs.writeFile(path.join(carouselPath, 'cover.jpg'), 'carousel-cover-item');
    await fs.writeFile(path.join(carouselPath, 'second.jpg'), 'carousel-second-item');

    await scannerService.scanAll('manual');

    const post = postRepository.listFeed(1, 10)[0]!;
    const ownerFolder = folderRepository.getByFolderPath('album')!;
    expect(post.mediaItems.map((item) => item.filename)).toEqual(['cover.jpg', 'second.jpg']);
    expect(postRepository.isExplicitFolderCover(post.id)).toBe(false);
    expect(postRepository.countFeed()).toBe(1);
    expect(postRepository.listVisibleByFolder(ownerFolder.id, 1, 10).map((item) => item.id)).toEqual([post.id]);
    expect(postRepository.countVisibleByFolder(ownerFolder.id)).toBe(1);
    expect(galleryService.getFeed(1, 10, 'recent').items.map((item) => item.id)).toEqual([post.id]);
    expect(galleryService.getFolderImages(ownerFolder.slug, 1, 10)?.items.map((item) => item.id)).toEqual([post.id]);
    expect(folderRepository.getSummaryBySlug(ownerFolder.slug)).toMatchObject({
      image_count: 1,
      post_count: 1,
      carousel_count: 1
    });
    expect(galleryService.getFolderBySlug(ownerFolder.slug)).toMatchObject({
      imageCount: 1,
      postCount: 1
    });
    expect(galleryService.listFolders()).toEqual([
      expect.objectContaining({ id: ownerFolder.id, imageCount: 1, postCount: 1 })
    ]);

    expect(galleryService.likeImage(post.id)).toEqual({ id: post.id, liked: true });
    expect(galleryService.saveImage(post.id)?.isSaved).toBe(true);
    expect(galleryService.getLikes().items.map((item) => item.id)).toEqual([post.id]);
    expect(galleryService.getCollectionImages('saved', 1, 10)?.items.map((item) => item.id)).toEqual([post.id]);

    const place = placeRepository.upsertCity({
      slug: 'cover-city',
      displayName: 'Cover City',
      geonamesId: 765432,
      latitude: 10,
      longitude: 20,
      cityName: 'Cover City'
    });
    const storedPost = postRepository.findById(post.id)!;
    const postItems = postRepository.listImageRecords(post.id);
    postRepository.upsertPostWithItems({
      existingPostId: storedPost.id,
      folderId: storedPost.folder_id,
      placeId: place.id,
      sourcePath: storedPost.source_path,
      postType: storedPost.post_type,
      caption: storedPost.caption,
      sortTimestamp: storedPost.sort_timestamp,
      takenAt: storedPost.taken_at,
      takenAtSource: storedPost.taken_at_source,
      isDeleted: storedPost.is_deleted,
      isTrashed: storedPost.is_trashed
    }, postItems.map((image, index) => ({ imageId: image.id, position: index + 1 })));

    expect(galleryService.listPlaces()).toEqual([expect.objectContaining({ slug: place.slug, postCount: 1 })]);
    expect(galleryService.getPlaceImages(place.slug, 1, 10)?.items.map((item) => item.id)).toEqual([post.id]);
  });

  it('truncates carousel posts exceeding 20 items and logs a scan warning', async () => {
    const carouselPath = path.join(appConfig.galleryRoot, 'events', 'carousels', 'big-party');
    await fs.mkdir(carouselPath, { recursive: true });

    const dummyContent = 'dummy-media';
    for (let i = 1; i <= 25; i++) {
      const numStr = String(i).padStart(2, '0');
      await fs.writeFile(path.join(carouselPath, `photo-${numStr}.jpg`), dummyContent);
    }

    await scannerService.scanAll('manual');

    const posts = postRepository.listFeed(1, 30);
    expect(posts).toHaveLength(1);

    const post = posts[0];
    expect(post.postType).toBe('carousel');
    expect(post.itemCount).toBe(20);
    expect(post.mediaItems).toHaveLength(20);

    const scanRun = scannerService.getProgress().lastCompletedScan;
    expect(scanRun?.status).toBe('completed');
    expect(scanRun?.warning_count).toBe(1);
    expect(scanRun?.warning_text).toContain('maximum limit of 20 items');
    expect(scanRun?.error_text).toBeNull();
  });

  it('keeps multiple carousel source folders isolated during the same scan', async () => {
    const carouselsRoot = path.join(appConfig.galleryRoot, 'album', 'carousels');
    await fs.mkdir(path.join(carouselsRoot, 'first'), { recursive: true });
    await fs.mkdir(path.join(carouselsRoot, 'second'), { recursive: true });
    await fs.writeFile(path.join(carouselsRoot, 'first', '01.jpg'), 'first-1');
    await fs.writeFile(path.join(carouselsRoot, 'first', '02.jpg'), 'first-2');
    await fs.writeFile(path.join(carouselsRoot, 'second', '01.jpg'), 'second-1');
    await fs.writeFile(path.join(carouselsRoot, 'second', '02.jpg'), 'second-2');

    await scannerService.scanAll('manual');

    const posts = postRepository.listFeed(1, 20);
    expect(posts).toHaveLength(2);
    expect(posts.map((post) => post.mediaItems.map((item) => item.filename))).toEqual([
      ['01.jpg', '02.jpg'],
      ['01.jpg', '02.jpg']
    ]);

    const carouselSources = folderRepository.getAll().filter((folder) => folder.role === 'carousel_source');
    expect(carouselSources).toHaveLength(2);
    expect(new Set(carouselSources.map((folder) => folder.folder_path))).toEqual(new Set([
      'album/carousels/first',
      'album/carousels/second'
    ]));
  });

  it('preserves post identity and caption while transitioning between one and two items', async () => {
    const carouselPath = path.join(appConfig.galleryRoot, 'album', 'carousels', 'changing');
    const secondPath = path.join(carouselPath, '02.jpg');
    await fs.mkdir(carouselPath, { recursive: true });
    await fs.writeFile(path.join(carouselPath, '01.jpg'), 'first');

    await scannerService.scanAll('manual');
    const initialPost = postRepository.listFeed(1, 20)[0];
    expect(initialPost.postType).toBe('single');
    galleryService.updateImageCaption(initialPost.id, 'Stable caption');

    await fs.writeFile(secondPath, 'second');
    await scannerService.scanAll('manual');
    const expandedPost = postRepository.listFeed(1, 20)[0];
    expect(expandedPost.id).toBe(initialPost.id);
    expect(expandedPost.postType).toBe('carousel');
    expect(expandedPost.caption).toBe('Stable caption');

    await fs.rm(secondPath);
    await scannerService.scanAll('manual');
    const collapsedPost = postRepository.listFeed(1, 20)[0];
    expect(collapsedPost.id).toBe(initialPost.id);
    expect(collapsedPost.postType).toBe('single');
    expect(collapsedPost.caption).toBe('Stable caption');
  });

  it('ignores root files and sub-subdirectories in carousels directory', async () => {
    const carouselsRoot = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const validPostPath = path.join(carouselsRoot, 'valid-post');
    const nestedSubPath = path.join(validPostPath, 'nested-sub');

    await fs.mkdir(nestedSubPath, { recursive: true });

    const dummyContent = 'dummy-media';
    await fs.writeFile(path.join(carouselsRoot, 'ignored-root.jpg'), dummyContent);
    await fs.writeFile(path.join(validPostPath, '01.jpg'), dummyContent);
    await fs.writeFile(path.join(validPostPath, '02.jpg'), dummyContent);
    await fs.writeFile(path.join(nestedSubPath, 'ignored-nested.jpg'), dummyContent);

    await scannerService.scanAll('manual');

    const posts = postRepository.listFeed(1, 20);
    expect(posts).toHaveLength(1);
    expect(posts[0].mediaItems).toHaveLength(2);
    expect(posts[0].mediaItems.map((item) => item.filename)).toEqual(['01.jpg', '02.jpg']);
  });

  it('updates caption for the whole carousel post', async () => {
    const carouselPath = path.join(appConfig.galleryRoot, 'album', 'carousels', 'post-1');
    await fs.mkdir(carouselPath, { recursive: true });

    const dummyContent = 'dummy-media';
    await fs.writeFile(path.join(carouselPath, '01.jpg'), dummyContent);
    await fs.writeFile(path.join(carouselPath, '02.jpg'), dummyContent);

    await scannerService.scanAll('manual');

    const feed = galleryService.getFeed(1, 10, 'recent');
    const postId = feed.items[0].id;

    const updated = galleryService.updateImageCaption(postId, 'Awesome carousel trip');
    expect(updated).not.toBeNull();
    expect(updated?.caption).toBe('Awesome carousel trip');

    const reFetched = galleryService.getImageDetail(postId);
    expect(reFetched?.caption).toBe('Awesome carousel trip');

    expect(galleryService.saveImage(postId)?.isSaved).toBe(true);
    expect(galleryService.likeImage(postId)).toEqual({ id: postId, liked: true });
    expect(galleryService.trashImage(postId)?.id).toBe(postId);
    expect(postRepository.findById(postId)?.is_trashed).toBe(1);
    expect(postRepository.listImageRecords(postId).every((item) => item.is_trashed === 1)).toBe(true);

    expect(galleryService.restoreImage(postId)?.id).toBe(postId);
    expect(postRepository.findById(postId)?.is_trashed).toBe(0);
    expect(postRepository.listImageRecords(postId).every((item) => item.is_trashed === 0)).toBe(true);
  });

  it('respects treatCarouselsAsFolders setting toggle', async () => {
    const carouselPath = path.join(appConfig.galleryRoot, 'album', 'carousels', 'post-1');
    await fs.mkdir(carouselPath, { recursive: true });

    const dummyContent = 'dummy-media';
    await fs.writeFile(path.join(carouselPath, '01.jpg'), dummyContent);

    await scannerService.scanAll('manual');

    expect(galleryService.getFeed(1, 10, 'recent').items).toHaveLength(1);

    galleryService.setTreatCarouselsAsFolders(true);
    await scannerService.scanAll('manual');

    const folders = folderRepository.getAll();
    const carouselsFolder = folders.find((f) => f.slug.includes('carousels'));
    expect(carouselsFolder).toBeDefined();
    expect(scannerService.getProgress().lastCompletedScan?.status).toBe('completed');
  });

  it('prevents numeric postId and imageId collision between consecutive carousels', async () => {
    const albumPath = path.join(appConfig.galleryRoot, 'album');
    const carouselsRoot = path.join(albumPath, 'carousels');
    await fs.mkdir(carouselsRoot, { recursive: true });

    // Single post -> image 1, post 1
    await fs.writeFile(path.join(albumPath, 'single.jpg'), 'single-media');

    // Carousel A -> images 2 & 3, post 2
    const carouselAPath = path.join(carouselsRoot, 'carousel-a');
    await fs.mkdir(carouselAPath, { recursive: true });
    await fs.writeFile(path.join(carouselAPath, 'a1.jpg'), 'a1-media');
    await fs.writeFile(path.join(carouselAPath, 'a2.jpg'), 'a2-media');

    // Carousel B -> images 4 & 5, post 3
    const carouselBPath = path.join(carouselsRoot, 'carousel-b');
    await fs.mkdir(carouselBPath, { recursive: true });
    await fs.writeFile(path.join(carouselBPath, 'b1.jpg'), 'b1-media');
    await fs.writeFile(path.join(carouselBPath, 'b2.jpg'), 'b2-media');

    await scannerService.scanAll('manual');

    const feed = galleryService.getFeed(1, 10, 'oldest');
    expect(feed.items).toHaveLength(3);

    const post1 = feed.items.find((p) => p.sourcePath?.includes('single.jpg'))!;
    const post2 = feed.items.find((p) => p.sourcePath?.includes('carousel-a'))!;
    const post3 = feed.items.find((p) => p.sourcePath?.includes('carousel-b'))!;

    // Canonical request for /posts/:id (post 3, Carousel B)
    const detailPost3 = galleryService.getImageDetail(post3.id);
    expect(detailPost3?.id).toBe(post3.id);
    expect(detailPost3?.mediaItems.map((m) => m.filename)).toEqual(['b1.jpg', 'b2.jpg']);

    // Caption update on canonical post 3
    const updatedCaption = galleryService.updateImageCaption(post3.id, 'Caption for Carousel B');
    expect(updatedCaption?.id).toBe(post3.id);
    expect(updatedCaption?.caption).toBe('Caption for Carousel B');
    expect(galleryService.getImageDetail(post2.id)?.caption).toBeNull();

    // Like on canonical post 3
    expect(galleryService.likeImage(post3.id)).toEqual({ id: post3.id, liked: true });
    expect(galleryService.getLikes().items.map((item) => item.id)).toEqual([post3.id]);

    // Save on canonical post 3
    expect(galleryService.saveImage(post3.id)?.id).toBe(post3.id);
    expect(galleryService.getImageCollections(post3.id)?.isSaved).toBe(true);

    // Trash & restore on canonical post 3
    expect(galleryService.trashImage(post3.id)?.id).toBe(post3.id);
    expect(postRepository.findById(post3.id)?.is_trashed).toBe(1);
    expect(postRepository.findById(post2.id)?.is_trashed).toBe(0);

    expect(galleryService.restoreImage(post3.id)?.id).toBe(post3.id);
    expect(postRepository.findById(post3.id)?.is_trashed).toBe(0);

    // Image 3 is second slide of Carousel A (post 2)
    const image3 = imageRepository.getByRelativePath('album/carousels/carousel-a/a2.jpg');
    expect(image3).toBeDefined();

    // Legacy image alias /images/:id (image 3 resolves to post 2, Carousel A)
    const legacyDetailImage3 = galleryService.getImageDetail(image3!.id, undefined, { isLegacyImageAlias: true });
    expect(legacyDetailImage3?.id).toBe(post2.id);
    expect(legacyDetailImage3?.mediaItems.map((m) => m.filename)).toEqual(['a1.jpg', 'a2.jpg']);

    // Deleting canonical post 3 deletes Carousel B, not Carousel A
    const deleted = await galleryService.deleteImage(post3.id);
    expect(deleted?.id).toBe(post3.id);
    expect(postRepository.findById(post3.id)).toBeUndefined();
    expect(postRepository.findById(post2.id)).toBeDefined();
  });

  it('keeps canonical post and legacy image HTTP namespaces separate across reads, mutations, shares, and deletion', async () => {
    const albumPath = path.join(appConfig.galleryRoot, 'album');
    const carouselsRoot = path.join(albumPath, 'carousels');
    await fs.mkdir(carouselsRoot, { recursive: true });
    await fs.writeFile(path.join(albumPath, 'single.jpg'), 'single-media');

    const createCarousel = async (name: string) => {
      const carouselPath = path.join(carouselsRoot, name);
      await fs.mkdir(carouselPath, { recursive: true });
      await fs.writeFile(path.join(carouselPath, '01.jpg'), `${name}-first`);
      await fs.writeFile(path.join(carouselPath, '02.jpg'), `${name}-second-slide`);
    };
    await createCarousel('carousel-a');
    await createCarousel('carousel-b');
    await scannerService.scanAll('manual');

    const initialFeed = galleryService.getFeed(1, 20, 'oldest').items;
    const carouselA = initialFeed.find((post) => post.sourcePath?.endsWith('/carousel-a'))!;
    const carouselB = initialFeed.find((post) => post.sourcePath?.endsWith('/carousel-b'))!;
    const carouselAItems = postRepository.listImageRecords(carouselA.id);
    const carouselBItems = postRepository.listImageRecords(carouselB.id);
    // Parallel image processing can assign either slide the colliding ID.
    const collidingImage = carouselAItems.find(image => image.id === carouselB.id);
    expect(collidingImage).toBeDefined();

    const canonicalDetail = await requestApp(app, 'GET', `/api/posts/${carouselB.id}`);
    expect(canonicalDetail.status).toBe(200);
    expect(canonicalDetail.body.id).toBe(carouselB.id);
    expect(canonicalDetail.body.mediaItems.map((item: { filename: string }) => item.filename)).toEqual(['01.jpg', '02.jpg']);
    expect(canonicalDetail.body.sourcePath).toContain('carousel-b');

    const legacyDetail = await requestApp(app, 'GET', `/api/images/${collidingImage!.id}`);
    expect(legacyDetail.status).toBe(200);
    expect(legacyDetail.body.id).toBe(carouselA.id);
    expect(legacyDetail.body.sourcePath).toContain('carousel-a');

    expect((await requestApp(app, 'PATCH', `/api/posts/${carouselB.id}/caption`, { caption: 'Canonical B' })).status).toBe(200);
    expect((await requestApp(app, 'PATCH', `/api/images/${collidingImage!.id}/caption`, { caption: 'Legacy A' })).status).toBe(200);
    expect(postRepository.findById(carouselB.id)?.caption).toBe('Canonical B');
    expect(postRepository.findById(carouselA.id)?.caption).toBe('Legacy A');

    expect((await requestApp(app, 'POST', `/api/posts/${carouselB.id}/like`)).body).toMatchObject({ id: carouselB.id, liked: true });
    expect((await requestApp(app, 'DELETE', `/api/posts/${carouselB.id}/like`)).body).toMatchObject({ id: carouselB.id, liked: false });
    expect((await requestApp(app, 'POST', `/api/images/${collidingImage!.id}/like`)).body).toMatchObject({ id: carouselA.id, liked: true });
    expect((await requestApp(app, 'DELETE', `/api/images/${collidingImage!.id}/like`)).body).toMatchObject({ id: carouselA.id, liked: false });

    expect((await requestApp(app, 'POST', `/api/posts/${carouselB.id}/save`)).body).toMatchObject({ id: carouselB.id, isSaved: true });
    expect((await requestApp(app, 'DELETE', `/api/posts/${carouselB.id}/save`)).body).toMatchObject({ id: carouselB.id, isSaved: false });
    expect((await requestApp(app, 'POST', `/api/images/${collidingImage!.id}/save`)).body).toMatchObject({ id: carouselA.id, isSaved: true });
    expect((await requestApp(app, 'DELETE', `/api/images/${collidingImage!.id}/save`)).body).toMatchObject({ id: carouselA.id, isSaved: false });

    const collectionResponse = await requestApp(app, 'POST', '/api/collections', { name: 'Collision checks' });
    const collectionSlug = collectionResponse.body.collection.slug as string;
    expect((await requestApp(app, 'POST', `/api/collections/${collectionSlug}/posts/${carouselB.id}`)).body.id).toBe(carouselB.id);
    expect((await requestApp(app, 'DELETE', `/api/collections/${collectionSlug}/posts/${carouselB.id}`)).body.id).toBe(carouselB.id);
    expect((await requestApp(app, 'POST', `/api/collections/${collectionSlug}/images/${collidingImage!.id}`)).body.id).toBe(carouselA.id);
    expect((await requestApp(app, 'DELETE', `/api/collections/${collectionSlug}/images/${collidingImage!.id}`)).body.id).toBe(carouselA.id);

    expect((await requestApp(app, 'POST', `/api/posts/${carouselB.id}/trash`)).body.id).toBe(carouselB.id);
    expect(postRepository.findById(carouselA.id)?.is_trashed).toBe(0);
    expect((await requestApp(app, 'POST', `/api/posts/${carouselB.id}/restore`)).body.id).toBe(carouselB.id);
    expect((await requestApp(app, 'POST', `/api/images/${collidingImage!.id}/trash`)).body.id).toBe(carouselA.id);
    expect(postRepository.findById(carouselB.id)?.is_trashed).toBe(0);
    expect((await requestApp(app, 'POST', `/api/images/${collidingImage!.id}/restore`)).body.id).toBe(carouselA.id);

    expect((await requestApp(app, 'GET', `/api/share/posts/${carouselB.id}`)).body.id).toBe(carouselB.id);
    expect((await requestApp(app, 'GET', `/api/share/images/${collidingImage!.id}`)).body.id).toBe(carouselA.id);

    expect((await requestApp(app, 'GET', '/api/places')).body).toEqual({ items: [] });
    const place = placeRepository.upsertCity({
      slug: 'collision-city',
      displayName: 'Collision City',
      geonamesId: 123456,
      latitude: 10,
      longitude: 20,
      cityName: 'Collision City'
    });
    const storedCarouselB = postRepository.findById(carouselB.id)!;
    postRepository.upsertPostWithItems({
      existingPostId: storedCarouselB.id,
      folderId: storedCarouselB.folder_id,
      placeId: place.id,
      sourcePath: storedCarouselB.source_path,
      postType: storedCarouselB.post_type,
      caption: storedCarouselB.caption,
      sortTimestamp: storedCarouselB.sort_timestamp,
      takenAt: storedCarouselB.taken_at,
      takenAtSource: storedCarouselB.taken_at_source,
      isDeleted: storedCarouselB.is_deleted,
      isTrashed: storedCarouselB.is_trashed
    }, carouselBItems.map((image, index) => ({ imageId: image.id, position: index + 1 })));
    const placesResponse = await requestApp(app, 'GET', '/api/places');
    expect(placesResponse.status).toBe(200);
    expect(placesResponse.body.items).toEqual([expect.objectContaining({ slug: 'collision-city', postCount: 1 })]);
    const placeImagesResponse = await requestApp(app, 'GET', '/api/places/collision-city/images');
    expect(placeImagesResponse.status).toBe(200);
    expect(placeImagesResponse.body.items.map((post: { id: number }) => post.id)).toEqual([carouselB.id]);

    await fs.writeFile(path.join(albumPath, 'cover.jpg'), 'unrelated-cover');
    await createCarousel('carousel-c');
    await createCarousel('carousel-d');
    await createCarousel('carousel-e');
    await scannerService.scanAll('manual');
    const coverImage = imageRepository.getByRelativePath('album/cover.jpg')!;
    const collidingCoverPost = postRepository.findById(coverImage.id)!;
    expect(collidingCoverPost).toBeDefined();
    expect(postRepository.findByImageId(coverImage.id)).toBeUndefined();

    const postsBeforeMissingLegacyGet = postRepository.countAll();
    expect((await requestApp(app, 'GET', `/api/images/${coverImage.id}`)).status).toBe(404);
    expect(postRepository.countAll()).toBe(postsBeforeMissingLegacyGet);
    expect(postRepository.findByImageId(coverImage.id)).toBeUndefined();
    expect((await requestApp(app, 'GET', `/api/posts/${collidingCoverPost.id}`)).body.id).toBe(collidingCoverPost.id);
    expect((await requestApp(app, 'POST', `/api/posts/${collidingCoverPost.id}/like`)).body.id).toBe(collidingCoverPost.id);
    expect((await requestApp(app, 'POST', `/api/posts/${collidingCoverPost.id}/save`)).body.id).toBe(collidingCoverPost.id);

    for (const image of [...carouselAItems, ...carouselBItems]) {
      for (const [root, relativePath] of [
        [appConfig.thumbnailsDir, image.thumbnail_path],
        [appConfig.previewsDir, image.preview_path]
      ] as const) {
        const target = path.join(root, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, `derivative:${image.relative_path}`);
      }
    }

    expect((await requestApp(app, 'DELETE', `/api/posts/${carouselB.id}`)).body.id).toBe(carouselB.id);
    for (const image of carouselBItems) {
      await expect(fs.stat(path.join(appConfig.galleryRoot, image.relative_path))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(path.join(appConfig.thumbnailsDir, image.thumbnail_path))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(path.join(appConfig.previewsDir, image.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    for (const image of carouselAItems) {
      await expect(fs.stat(path.join(appConfig.galleryRoot, image.relative_path))).resolves.toBeDefined();
    }

    expect((await requestApp(app, 'DELETE', `/api/images/${collidingImage!.id}`)).body.id).toBe(carouselA.id);
    for (const image of carouselAItems) {
      await expect(fs.stat(path.join(appConfig.galleryRoot, image.relative_path))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(path.join(appConfig.thumbnailsDir, image.thumbnail_path))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(path.join(appConfig.previewsDir, image.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(fs.stat(path.join(albumPath, 'single.jpg'))).resolves.toBeDefined();
  });

  it('rolls back source-path and membership changes when carousel reconciliation conflicts', async () => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    for (const name of ['first', 'second']) {
      await fs.mkdir(path.join(root, name), { recursive: true });
      await fs.writeFile(path.join(root, name, '01.jpg'), `${name}-1`);
      await fs.writeFile(path.join(root, name, '02.jpg'), `${name}-2-long`);
    }
    await scannerService.scanAll('manual');
    const posts = postRepository.listFeed(1, 10);
    const first = posts.find((post) => post.sourcePath.endsWith('/first'))!;
    const second = posts.find((post) => post.sourcePath.endsWith('/second'))!;
    const firstItems = postRepository.listImageRecords(first.id);
    const secondItems = postRepository.listImageRecords(second.id);

    expect(postRepository.findByUnambiguousImageMembership([firstItems[0].id, secondItems[0].id])).toBeUndefined();

    expect(() =>
      postRepository.upsertPostWithItems({
        existingPostId: first.id,
        folderId: first.folderId,
        sourcePath: 'album/carousels/renamed-first',
        postType: 'carousel',
        caption: 'must roll back',
        sortTimestamp: first.sortTimestamp,
        isDeleted: 0,
        isTrashed: 0
      }, [
        { imageId: firstItems[0].id, position: 1 },
        { imageId: secondItems[0].id, position: 2 }
      ])
    ).toThrow();

    expect(postRepository.findById(first.id)?.source_path).toBe(first.sourcePath);
    expect(postRepository.findById(first.id)?.caption).not.toBe('must roll back');
    expect(postRepository.listImageRecords(first.id).map((image) => image.id)).toEqual(firstItems.map((image) => image.id));
    expect(postRepository.listImageRecords(second.id).map((image) => image.id)).toEqual(secondItems.map((image) => image.id));
  });

  it('reconciles carousel post when child directory is renamed', async () => {
    appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, appConfig.galleryRoot);
    const carouselsRoot = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const oldPath = path.join(carouselsRoot, 'day-1');
    const newPath = path.join(carouselsRoot, 'day-1-renamed');

    await fs.mkdir(oldPath, { recursive: true });
    await fs.writeFile(path.join(oldPath, 'photo1.jpg'), 'photo-1');
    await fs.writeFile(path.join(oldPath, 'photo2.jpg'), 'photo-2');

    await scannerService.scanAll('manual');

    const feedBefore = galleryService.getFeed(1, 10, 'recent');
    const originalPostId = feedBefore.items[0].id;

    galleryService.updateImageCaption(originalPostId, 'Day 1 memories');
    galleryService.likeImage(originalPostId);

    // Rename carousel folder on disk
    await fs.rename(oldPath, newPath);

    // Rescan should reconcile by stable image IDs
    await scannerService.scanAll('manual');

    const feedAfter = galleryService.getFeed(1, 10, 'recent');
    expect(feedAfter.items).toHaveLength(1);
    expect(feedAfter.items[0].id).toBe(originalPostId);
    expect(feedAfter.items[0].caption).toBe('Day 1 memories');
    expect(galleryService.getLikes().items.map((i) => i.id)).toContain(originalPostId);
  });

  it.each(['added', 'removed', 'modified', 'single'])('preserves a renamed carousel with %s slides and succeeds on repeat scans', async (change) => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const oldPath = path.join(root, 'original');
    const newPath = path.join(root, 'renamed');
    await fs.mkdir(oldPath, { recursive: true });
    await fs.writeFile(path.join(oldPath, '01.jpg'), 'first-slide');
    await fs.writeFile(path.join(oldPath, '02.jpg'), 'second-slide-longer');
    await fs.writeFile(path.join(oldPath, '03.jpg'), 'third-slide-even-longer');
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');

    const original = postRepository.findBySourcePath('album/carousels/original')!;
    const originalItems = postRepository.listImageRecords(original.id);
    galleryService.updateImageCaption(original.id, 'Keep these memories');
    galleryService.likeImage(original.id);
    galleryService.saveImage(original.id);
    const collection = await requestApp(app, 'POST', '/api/collections', { name: 'Memories' });
    const collectionSlug = collection.body.collection.slug as string;
    expect((await requestApp(app, 'POST', `/api/collections/${collectionSlug}/posts/${original.id}`)).status).toBe(200);

    await fs.rename(oldPath, newPath);
    if (change === 'added') await fs.writeFile(path.join(newPath, '04.jpg'), 'added-slide');
    if (change === 'removed' || change === 'single') await fs.rm(path.join(newPath, '03.jpg'));
    if (change === 'single') await fs.rm(path.join(newPath, '02.jpg'));
    if (change === 'modified') await fs.writeFile(path.join(newPath, '03.jpg'), 'modified-slide-with-new-size');

    for (const reason of ['manual', 'manual', 'startup']) {
      const scan = await scannerService.scanAll(reason);
      expect(scan?.status).toBe('completed');
      expect(scan?.error_text).toBeNull();
      const renamed = postRepository.findBySourcePath('album/carousels/renamed')!;
      expect(renamed.id).toBe(original.id);
      expect(renamed.caption).toBe('Keep these memories');
      expect(renamed.sort_timestamp).toBe(original.sort_timestamp);
      expect(renamed.post_type).toBe(change === 'single' ? 'single' : 'carousel');
      expect(postRepository.countAll()).toBe(1);
      const items = postRepository.listImageRecords(original.id);
      const expectedNames = change === 'added' ? ['01.jpg', '02.jpg', '03.jpg', '04.jpg']
        : change === 'single' ? ['01.jpg'] : change === 'removed' ? ['01.jpg', '02.jpg'] : ['01.jpg', '02.jpg', '03.jpg'];
      expect(items.map(image => image.filename)).toEqual(expectedNames);
      expect(items[0].id).toBe(originalItems[0].id);
      expect(items.every(image => image.relative_path.startsWith('album/carousels/renamed/'))).toBe(true);
      expect(galleryService.getLikes().items.map(item => item.id)).toEqual([original.id]);
      expect(galleryService.getCollectionImages('saved', 1, 10)?.items.map(item => item.id)).toEqual([original.id]);
      expect(galleryService.getCollectionImages(collectionSlug, 1, 10)?.items.map(item => item.id)).toEqual([original.id]);
    }
  });

  it('preserves separate renamed carousels when one slide cannot be matched uniquely', async () => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const stableTime = new Date('2025-01-01T00:00:00Z');
    for (const name of ['first', 'second']) {
      await fs.mkdir(path.join(root, name), { recursive: true });
      await fs.writeFile(path.join(root, name, '01.jpg'), 'same-slide');
      await fs.utimes(path.join(root, name, '01.jpg'), stableTime, stableTime);
      await fs.writeFile(path.join(root, name, '02.jpg'), `${name}-unique-slide`);
    }
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const originals = ['first', 'second'].map(name => postRepository.findBySourcePath(`album/carousels/${name}`)!);
    for (const [index, name] of ['first', 'second'].entries()) {
      galleryService.updateImageCaption(originals[index].id, `${name} memories`);
      await fs.rename(path.join(root, name), path.join(root, `${name}-renamed`));
    }

    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    expect(postRepository.countAll()).toBe(2);
    for (const [index, name] of ['first', 'second'].entries()) {
      const renamed = postRepository.findBySourcePath(`album/carousels/${name}-renamed`)!;
      expect(renamed.id).toBe(originals[index].id);
      expect(renamed.caption).toBe(`${name} memories`);
      expect(postRepository.listImageRecords(renamed.id).map(image => image.relative_path)).toEqual([
        `album/carousels/${name}-renamed/01.jpg`, `album/carousels/${name}-renamed/02.jpg`
      ]);
    }
    expect((await scannerService.scanAll('startup'))?.status).toBe('completed');
  });

  it.each(['new-first', 'renamed-first', 'different-album'])('does not transfer a split carousel history based on discovery order (%s)', async (order) => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const originalPath = path.join(root, 'original');
    const renamedPath = path.join(root, order === 'renamed-first' ? 'a-renamed' : 'z-renamed');
    const newPath = order === 'different-album'
      ? path.join(appConfig.galleryRoot, 'a-album', 'carousels', 'new')
      : path.join(root, order === 'renamed-first' ? 'z-new' : 'a-new');
    await fs.mkdir(originalPath, { recursive: true });
    for (const [index, content] of ['first-slide', 'second-slide-longer', 'third-slide-even-longer'].entries()) {
      await fs.writeFile(path.join(originalPath, `0${index + 1}.jpg`), content);
    }
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const original = postRepository.findBySourcePath('album/carousels/original')!;
    const originalIds = postRepository.listImageRecords(original.id).map(image => image.id);
    galleryService.updateImageCaption(original.id, 'Original history');
    galleryService.likeImage(original.id);
    galleryService.saveImage(original.id);
    await fs.rename(originalPath, renamedPath);
    await fs.mkdir(newPath, { recursive: true });
    await fs.rename(path.join(renamedPath, '01.jpg'), path.join(newPath, '01.jpg'));
    await fs.writeFile(path.join(newPath, 'new.jpg'), 'entirely-new-slide');

    for (const reason of ['manual', 'startup']) {
      const scan = await scannerService.scanAll(reason);
      expect(scan?.status).toBe('failed');
      expect(scan?.error_text).toContain('multiple carousel destinations');
      expect(postRepository.findById(original.id)).toMatchObject({
        source_path: original.source_path, caption: 'Original history', sort_timestamp: original.sort_timestamp, is_deleted: 0
      });
      expect(postRepository.listImageRecords(original.id).map(image => image.id)).toEqual(originalIds);
      expect(postRepository.countAll()).toBe(1);
      expect(galleryService.getLikes().items.map(item => item.id)).toEqual([original.id]);
      expect(galleryService.getCollectionImages('saved', 1, 10)?.items.map(item => item.id)).toEqual([original.id]);
    }

    // Returning the surviving slides to one directory lets the scan preserve history.
    await fs.rename(path.join(newPath, '01.jpg'), path.join(renamedPath, '01.jpg'));
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    expect(postRepository.findById(original.id)?.source_path).toBe(getRelativeGalleryPath(appConfig.galleryRoot, renamedPath));
    expect(postRepository.findById(original.id)?.caption).toBe('Original history');
    const restoredItems = postRepository.listImageRecords(original.id);
    expect(restoredItems.map(image => image.filename)).toEqual(['01.jpg', '02.jpg', '03.jpg']);
    expect(restoredItems.slice(1).map(image => image.id)).toEqual(originalIds.slice(1));
  });

  it.each([['EACCES', 'directory'], ['EIO', 'directory'], ['EACCES', 'slide'], ['EIO', 'slide']])('preserves carousel memberships when checking the old source fails with %s (%s)', async (code, location) => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const originalPath = path.join(root, 'original');
    const newPath = path.join(root, 'a-new');
    await fs.mkdir(originalPath, { recursive: true });
    for (const [index, content] of ['first-slide', 'second-slide-longer', 'third-slide-even-longer'].entries()) {
      await fs.writeFile(path.join(originalPath, `0${index + 1}.jpg`), content);
    }
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const original = postRepository.findBySourcePath('album/carousels/original')!;
    const originalIds = postRepository.listImageRecords(original.id).map(image => image.id);
    galleryService.updateImageCaption(original.id, 'Keep original history');
    await fs.mkdir(newPath, { recursive: true });
    await fs.rename(path.join(originalPath, '01.jpg'), path.join(newPath, '01.jpg'));
    await fs.writeFile(path.join(newPath, 'new.jpg'), 'entirely-new-slide');
    const deniedPath = location === 'directory' ? originalPath : path.join(originalPath, '01.jpg');
    const originalAccess = fs.access;
    const accessSpy = vi.spyOn(fs, 'access').mockImplementation(async (target, mode) => {
      if (String(target) === deniedPath) throw Object.assign(new Error(`${code}: cannot inspect original source`), { code });
      return originalAccess(target, mode);
    });
    try {
      const scan = await scannerService.scanAll('manual');
      expect(scan?.status).toBe('failed');
      expect(scan?.error_text).toContain(code);
      expect(postRepository.findById(original.id)).toMatchObject({ source_path: original.source_path, caption: 'Keep original history', is_deleted: 0 });
      expect(postRepository.listImageRecords(original.id).map(image => image.id)).toEqual(originalIds);
      expect(postRepository.countAll()).toBe(1);
    } finally {
      accessSpy.mockRestore();
    }
    await expect(fs.stat(originalPath)).resolves.toBeDefined();
  });

  it.each(['EACCES', 'EIO'])('does not retire a carousel when reading its directory fails with %s', async (code) => {
    const sourcePath = path.join(appConfig.galleryRoot, 'album', 'carousels', 'original');
    await fs.mkdir(sourcePath, { recursive: true });
    await fs.writeFile(path.join(sourcePath, '01.jpg'), 'first-slide');
    await fs.writeFile(path.join(sourcePath, '02.jpg'), 'second-slide-longer');
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const original = postRepository.findBySourcePath('album/carousels/original')!;
    const originalIds = postRepository.listImageRecords(original.id).map(image => image.id);
    galleryService.updateImageCaption(original.id, 'Keep history');
    const originalReaddir = fs.readdir;
    const readdirSpy = vi.spyOn(fs, 'readdir').mockImplementation(((target: Parameters<typeof fs.readdir>[0], options: unknown) => {
      if (String(target) === sourcePath) return Promise.reject(Object.assign(new Error(`${code}: cannot read carousel directory`), { code }));
      return originalReaddir(target, options as Parameters<typeof fs.readdir>[1]);
    }) as typeof fs.readdir);
    try {
      const scan = await scannerService.scanAll('manual');
      expect(scan?.status).toBe('failed');
      expect(scan?.error_text).toContain(code);
      expect(postRepository.findById(original.id)).toMatchObject({ source_path: original.source_path, caption: 'Keep history', is_deleted: 0 });
      expect(postRepository.listImageRecords(original.id).map(image => image.id)).toEqual(originalIds);
      expect(postRepository.listImageRecords(original.id).every(image => image.is_deleted === 0)).toBe(true);
    } finally {
      readdirSpy.mockRestore();
    }
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
  });

  it.each([['unchanged', 'distinct'], ['added', 'distinct'], ['unchanged', 'overlap'], ['added', 'overlap'], ['added', 'mixed']])('rejects a previously indexed rename destination without merging histories (%s slides, %s filenames)', async (change, filenames) => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const originalPath = path.join(root, 'original');
    const destinationPath = path.join(root, 'destination');
    for (const name of ['original', 'destination']) {
      await fs.mkdir(path.join(root, name), { recursive: true });
      for (const position of ['01', '02']) {
        const filename = filenames === 'distinct' ? `${name}-${position}.jpg` : `${position}.jpg`;
        const sameFirstSlide = filenames === 'mixed' && position === '01';
        const filePath = path.join(root, name, filename);
        await fs.writeFile(filePath, sameFirstSlide ? 'same-first-slide' : `${name}-${position}-slide`);
        const timestamp = new Date(name === 'original' || sameFirstSlide ? '2025-01-01T00:00:00Z' : '2025-01-02T00:00:00Z');
        await fs.utimes(filePath, timestamp, timestamp);
      }
    }
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const original = postRepository.findBySourcePath('album/carousels/original')!;
    const destination = postRepository.findBySourcePath('album/carousels/destination')!;
    const originalIds = postRepository.listImageRecords(original.id).map(image => image.id);
    const destinationImages = postRepository.listImageRecords(destination.id);
    const destinationIds = destinationImages.map(image => image.id);
    galleryService.likeImage(original.id);
    galleryService.likeImage(destination.id);
    galleryService.saveImage(original.id);
    galleryService.saveImage(destination.id);
    galleryService.updateImageCaption(original.id, 'Original history');
    galleryService.updateImageCaption(destination.id, 'Destination history');
    await fs.rm(destinationPath, { recursive: true });
    await fs.rename(originalPath, destinationPath);
    if (change === 'added') await fs.writeFile(path.join(destinationPath, 'new.jpg'), 'newly-added-slide');

    for (const reason of ['manual', 'startup']) {
      const scan = await scannerService.scanAll(reason);
      expect(scan?.status).toBe('failed');
      expect(scan?.error_text).toContain('different indexed post');
      expect(scan?.error_text).not.toContain('UNIQUE constraint');
      expect(postRepository.findById(original.id)).toMatchObject({ source_path: original.source_path, caption: 'Original history' });
      expect(postRepository.findById(destination.id)).toMatchObject({ source_path: destination.source_path, caption: 'Destination history' });
      expect(postRepository.listImageRecords(original.id).map(image => image.id)).toEqual(originalIds);
      expect(postRepository.listImageRecords(destination.id).map(image => image.id)).toEqual(destinationIds);
      expect(postRepository.countAll()).toBe(2);
      expect(postRepository.listImageRecords(destination.id)).toEqual(destinationImages);
      expect(postRepository.findById(original.id)?.is_deleted).toBe(0);
      expect(galleryService.getLikes().items.map(item => item.id).sort()).toEqual([original.id, destination.id].sort());
      expect(galleryService.getCollectionImages('saved', 1, 10)?.items.map(item => item.id).sort()).toEqual([original.id, destination.id].sort());
    }

    const freshPath = path.join(root, 'fresh-name');
    await fs.rename(destinationPath, freshPath);
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    expect(postRepository.findById(original.id)).toMatchObject({ source_path: 'album/carousels/fresh-name', caption: 'Original history' });
    expect(postRepository.findById(destination.id)?.caption).toBe('Destination history');
    expect(postRepository.findById(destination.id)?.is_deleted).toBe(1);
  });

  it('rejects an overlapping destination with identical file fingerprints when a slide is added', async () => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const timestamp = new Date('2025-01-01T00:00:00Z');
    for (const name of ['original', 'destination']) {
      await fs.mkdir(path.join(root, name), { recursive: true });
      for (const filename of ['01.jpg', '02.jpg']) {
        const filePath = path.join(root, name, filename);
        await fs.writeFile(filePath, `same-${filename}-content`);
        await fs.utimes(filePath, timestamp, timestamp);
      }
    }
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const original = postRepository.findBySourcePath('album/carousels/original')!;
    const destination = postRepository.findBySourcePath('album/carousels/destination')!;
    const destinationImages = postRepository.listImageRecords(destination.id);
    galleryService.updateImageCaption(original.id, 'Original history');
    galleryService.updateImageCaption(destination.id, 'Destination history');
    galleryService.likeImage(original.id);
    await fs.rm(path.join(root, 'destination'), { recursive: true });
    await fs.rename(path.join(root, 'original'), path.join(root, 'destination'));
    await fs.writeFile(path.join(root, 'destination', '03.jpg'), 'new-slide');
    for (const reason of ['manual', 'startup']) {
      const scan = await scannerService.scanAll(reason);
      expect(scan?.status).toBe('failed');
      expect(scan?.error_text).toContain('different indexed post');
      expect(postRepository.findById(original.id)).toMatchObject({ source_path: original.source_path, caption: 'Original history', is_deleted: 0 });
      expect(postRepository.findById(destination.id)).toMatchObject({ source_path: destination.source_path, caption: 'Destination history', is_deleted: 0 });
      expect(postRepository.listImageRecords(destination.id)).toEqual(destinationImages);
      expect(galleryService.getLikes().items.map(item => item.id)).toEqual([original.id]);
    }
  });

  it('allows an unchanged destination to remain indexed when a duplicate carousel is removed', async () => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const timestamp = new Date('2025-01-01T00:00:00Z');
    for (const name of ['duplicate', 'destination']) {
      await fs.mkdir(path.join(root, name), { recursive: true });
      for (const filename of ['01.jpg', '02.jpg']) {
        const filePath = path.join(root, name, filename);
        await fs.writeFile(filePath, `same-${filename}-content`);
        await fs.utimes(filePath, timestamp, timestamp);
      }
    }
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const destination = postRepository.findBySourcePath('album/carousels/destination')!;
    const duplicate = postRepository.findBySourcePath('album/carousels/duplicate')!;
    const destinationIds = postRepository.listImageRecords(destination.id).map(image => image.id);
    await fs.rm(path.join(root, 'duplicate'), { recursive: true });
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    expect(postRepository.findById(destination.id)?.is_deleted).toBe(0);
    expect(postRepository.listImageRecords(destination.id).map(image => image.id)).toEqual(destinationIds);
    expect(postRepository.findById(duplicate.id)?.is_deleted).toBe(1);
  });

  it('recovers a previously failed rename scan without rebuilding the library', async () => {
    const root = path.join(appConfig.galleryRoot, 'album', 'carousels');
    const oldPath = path.join(root, 'original');
    const newPath = path.join(root, 'renamed');
    await fs.mkdir(oldPath, { recursive: true });
    await fs.writeFile(path.join(oldPath, '01.jpg'), 'first-slide');
    await fs.writeFile(path.join(oldPath, '02.jpg'), 'second-slide-longer');
    expect((await scannerService.scanAll('manual'))?.status).toBe('completed');
    const original = postRepository.findBySourcePath('album/carousels/original')!;
    galleryService.updateImageCaption(original.id, 'Survives recovery');
    galleryService.likeImage(original.id);
    await fs.rename(oldPath, newPath);
    await fs.writeFile(path.join(newPath, '03.jpg'), 'added-slide');

    // Emulate the old scanner creating a competing post after committing asset moves.
    const originalUpsert = postRepository.upsertPostWithItems;
    const upsertSpy = vi.spyOn(postRepository, 'upsertPostWithItems').mockImplementation((input, items) => (
      originalUpsert.call(postRepository, { ...input, existingPostId: undefined }, items)
    ));
    try {
      const failed = await scannerService.scanAll('manual');
      expect(failed?.status).toBe('failed');
      expect(failed?.error_text).toContain('UNIQUE constraint failed: post_items.image_id');
    } finally {
      upsertSpy.mockRestore();
    }
    expect(postRepository.findById(original.id)?.source_path).toBe('album/carousels/original');
    expect(imageRepository.getByRelativePath('album/carousels/renamed/01.jpg')).toBeDefined();

    for (const reason of ['manual', 'startup']) {
      expect((await scannerService.scanAll(reason))?.status).toBe('completed');
      const renamed = postRepository.findBySourcePath('album/carousels/renamed')!;
      expect(renamed.id).toBe(original.id);
      expect(renamed.caption).toBe('Survives recovery');
      expect(postRepository.listImageRecords(original.id)).toHaveLength(3);
      expect(galleryService.getLikes().items.map(item => item.id)).toEqual([original.id]);
      expect(postRepository.countAll()).toBe(1);
    }
  });

  it('repairs and preserves representative Place assignments for posts', async () => {
    const albumPath = path.join(appConfig.galleryRoot, 'places-album');
    await fs.mkdir(albumPath, { recursive: true });
    await fs.writeFile(path.join(albumPath, 'single.jpg'), 'single-place-media');
    await scannerService.scanAll('manual');

    const image = imageRepository.getByRelativePath('places-album/single.jpg')!;
    const post = postRepository.findByImageId(image.id)!;
    const place = placeRepository.upsertCity({
      slug: 'representative-city',
      displayName: 'Representative City',
      geonamesId: 246810,
      latitude: 12,
      longitude: 34,
      cityName: 'Representative City'
    });

    imageRepository.assignPlace(image.id, place.id);
    expect(postRepository.findById(post.id)?.place_id).toBe(place.id);

    postRepository.upsertPostWithItems({
      existingPostId: post.id,
      folderId: post.folder_id,
      placeId: null,
      sourcePath: post.source_path,
      postType: post.post_type,
      caption: post.caption,
      sortTimestamp: post.sort_timestamp,
      takenAt: post.taken_at,
      takenAtSource: post.taken_at_source,
      isDeleted: 0,
      isTrashed: 0
    }, [{ imageId: image.id, position: 1 }]);
    expect(postRepository.findById(post.id)?.place_id).toBeNull();

    await scannerService.scanAll('manual');
    expect(postRepository.findById(post.id)?.place_id).toBe(place.id);
    expect(galleryService.listPlaces()).toEqual([
      expect.objectContaining({ slug: place.slug, postCount: 1 })
    ]);
  });

  it('soft-deletes and reactivates the last carousel when its child becomes empty', async () => {
    const albumPath = path.join(appConfig.galleryRoot, 'mixed-album');
    const carouselPath = path.join(albumPath, 'carousels', 'only-carousel');
    await fs.mkdir(carouselPath, { recursive: true });
    await fs.writeFile(path.join(albumPath, 'direct.jpg'), 'direct-media');
    await fs.writeFile(path.join(carouselPath, '01.jpg'), 'carousel-one');
    await fs.writeFile(path.join(carouselPath, '02.jpg'), 'carousel-two');

    await scannerService.scanAll('manual');

    const carousel = postRepository.listFeed(1, 10).find((post) => post.postType === 'carousel')!;
    const originalItemIds = postRepository.listImageRecords(carousel.id).map((image) => image.id);

    await fs.rm(path.join(carouselPath, '01.jpg'));
    await fs.rm(path.join(carouselPath, '02.jpg'));
    await scannerService.scanAll('manual');

    expect(postRepository.findById(carousel.id)?.is_deleted).toBe(1);
    expect(postRepository.listFeed(1, 10).map((post) => post.id)).not.toContain(carousel.id);
    for (const imageId of originalItemIds) {
      expect(imageRepository.getById(imageId)?.is_deleted).toBe(1);
    }

    await fs.writeFile(path.join(carouselPath, '01.jpg'), 'carousel-one');
    await fs.writeFile(path.join(carouselPath, '02.jpg'), 'carousel-two');
    await scannerService.scanAll('manual');

    expect(postRepository.findById(carousel.id)?.is_deleted).toBe(0);
    expect(postRepository.listFeed(1, 10).map((post) => post.id)).toContain(carousel.id);
    expect(postRepository.listImageRecords(carousel.id).map((image) => image.id)).toEqual(originalItemIds);
  });
});
