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

type ImageRecord = ModelsModule['ImageRecord'];
type MediaType = ModelsModule['MediaType'];

describe.sequential('media search', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-media-search-'));

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
    ({folderRepository, imageRepository} = await import('../src/db/repositories.js'));
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

  it('matches filename substrings case-insensitively and paginates mixed media results', async () => {
    const redPandaPhoto = await createIndexedMedia('animals/red-pandas', 'redpanda.JPG', 1_777_000_000_000);
    const redPandaVideo = await createIndexedMedia('animals/red-pandas', 'RED_PANDA.mp4', 1_777_000_000_500);
    await createIndexedMedia('animals/alpacas', 'alpaca.jpg', 1_777_000_001_000);

    const firstPage = await galleryService.searchMedia('PANDA', 1, 1);
    const secondPage = await galleryService.searchMedia('PANDA', 2, 1);

    expect(firstPage.total).toBe(2);
    expect(firstPage.hasMore).toBe(true);
    expect(secondPage.hasMore).toBe(false);

    const resultIds = new Set([...firstPage.items, ...secondPage.items].map((item) => item.id));
    expect(resultIds).toEqual(new Set([redPandaPhoto.id, redPandaVideo.id]));
    expect(firstPage.items[0]?.mediaType).toBe('video');
  });

  it('matches partial multi-token queries across compact and underscore filenames', async () => {
    const compact = await createIndexedMedia('wildlife', 'redpanda.jpg', 1_777_100_000_000);
    const underscored = await createIndexedMedia('wildlife', 'red_panda.mp4', 1_777_100_000_500);

    const payload = await galleryService.searchMedia('red panda', 1, 20);

    expect(payload.total).toBe(2);
    expect(new Set(payload.items.map((item) => item.id))).toEqual(new Set([compact.id, underscored.id]));
  });

  it('returns saved custom captions in search results', async () => {
    const compact = await createIndexedMedia('wildlife', 'redpanda.jpg', 1_777_100_010_000);
    const updated = await galleryService.updateImageCaption(compact.id, 'Red panda at dusk');

    expect(updated?.caption).toBe('Red panda at dusk');

    const payload = await galleryService.searchMedia('red panda', 1, 20);
    expect(payload.items.find((item) => item.id === compact.id)?.caption).toBe('Red panda at dusk');
  });

  it('excludes deleted, trashed, and hidden cover media from search results', async () => {
    const visible = await createIndexedMedia('travel/sunrise', 'sunrise-visible.jpg', 1_777_200_000_000);
    const deleted = await createIndexedMedia('travel/sunrise', 'sunrise-deleted.jpg', 1_777_200_000_500);
    const trashed = await createIndexedMedia('travel/sunrise', 'sunrise-trashed.jpg', 1_777_200_001_000);
    await createIndexedMedia('travel/sunrise', 'cover.jpg', 1_777_200_001_500);

    await imageRepository.markDeleted(deleted.relative_path);
    expect(await imageRepository.moveToTrash(trashed.id)).toBe(true);

    const sunriseResults = await galleryService.searchMedia('sunrise', 1, 20);
    const coverResults = await galleryService.searchMedia('cover', 1, 20);

    expect(sunriseResults.total).toBe(1);
    expect(sunriseResults.items.map((item) => item.id)).toEqual([visible.id]);
    expect(coverResults.total).toBe(0);
    expect(coverResults.items).toEqual([]);
  });

  it('searches selected exif text fields without relying on raw json matching', async () => {
    const cameraMatch = await createIndexedMedia(
      'gear/fuji',
      'street-shot.jpg',
      1_777_300_000_000,
      JSON.stringify({
        cameraMake: 'Fujifilm',
        cameraModel: 'X100VI',
        lensModel: 'Summilux 28'
      })
    );
    await createIndexedMedia(
      'gear/other',
      'different-shot.jpg',
      1_777_300_000_500,
      JSON.stringify({
        cameraMake: 'Canon',
        cameraModel: 'R6',
        lensModel: 'RF 35mm'
      })
    );

    expect((await galleryService.searchMedia('fujifilm', 1, 20)).items.map((item) => item.id)).toEqual([cameraMatch.id]);
    expect((await galleryService.searchMedia('x100vi', 1, 20)).items.map((item) => item.id)).toEqual([cameraMatch.id]);
    expect((await galleryService.searchMedia('summilux', 1, 20)).items.map((item) => item.id)).toEqual([cameraMatch.id]);
  });

  async function createIndexedMedia(
    folderPath: string,
    filename: string,
    timestamp: number,
    exifJson = '{}'
  ): Promise<ImageRecord> {
    const folderName = path.posix.basename(folderPath);
    const folder = await folderRepository.upsert({
      slug: folderPath.replaceAll('/', '-'),
      name: folderName,
      folderPath
    });
    const relativePath = `${folderPath}/${filename}`;
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const thumbnailPath = getThumbnailRelativePath(relativePath);
    const previewPath = getPreviewRelativePath(relativePath, mediaType);

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
      exifJson,
      thumbnailPath,
      previewPath
    });
  }

  function getDurationForMediaType(mediaType: MediaType): number | null {
    return mediaType === 'video' ? 12_000 : null;
  }
});
