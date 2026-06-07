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

describe.sequential('reels feed', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let likeRepository: RepositoriesModule['likeRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-reels-feed-'));

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
    ({folderRepository, imageRepository, likeRepository} = await import('../src/db/repositories.js'));
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

  it('returns visible videos only and excludes deleted or trashed entries', async () => {
    const visibleVideo = await createIndexedMedia('travel/clips', 'visible.mp4', 1_778_000_000_000);
    const deletedVideo = await createIndexedMedia('travel/clips', 'deleted.mp4', 1_778_000_000_500);
    const trashedVideo = await createIndexedMedia('travel/clips', 'trashed.mp4', 1_778_000_001_000);
    await createIndexedMedia('travel/clips', 'photo.jpg', 1_778_000_001_500);

    await imageRepository.markDeleted(deletedVideo.relative_path);
    expect(await imageRepository.moveToTrash(trashedVideo.id)).toBe(true);

    const payload = await galleryService.getReels(1, 12, 'recommended', 17);

    expect(payload.mode).toBe('recommended');
    expect(payload.total).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.id).toBe(visibleVideo.id);
    expect(payload.items[0]?.mediaType).toBe('video');
  });

  it('keeps random ordering stable for one seed and changes it for a different seed', async () => {
    await createIndexedMedia('seed/alpha', 'alpha-a.mp4', 1_778_100_000_000);
    await createIndexedMedia('seed/beta', 'beta-a.mp4', 1_778_100_000_000);
    await createIndexedMedia('seed/gamma', 'gamma-a.mp4', 1_778_100_000_000);

    const first = await galleryService.getReels(1, 3, 'random', 11);
    const second = await galleryService.getReels(1, 3, 'random', 11);
    const differentSeed = await galleryService.getReels(1, 3, 'random', 29);

    expect(first.mode).toBe('random');
    expect(first.items.map((item) => item.id)).toEqual(second.items.map((item) => item.id));
    expect(first.items.map((item) => item.id)).not.toEqual(differentSeed.items.map((item) => item.id));
  });

  it('returns newest visible videos first in recent mode even when affinity and likes would favor older reels', async () => {
    const newest = await createIndexedMedia('recent/alpha', 'alpha-1.mp4', 1_778_150_003_000);
    const middle = await createIndexedMedia('recent/beta', 'beta-1.mp4', 1_778_150_002_000);
    const oldest = await createIndexedMedia('recent/gamma', 'gamma-1.mp4', 1_778_150_001_000);

    await likeRepository.upsert(oldest.id);

    const payload = await galleryService.getReels(1, 3, 'recent', 91, {
      lastOpenedFolderSlug: 'recent-gamma',
      recentOpenedFolderSlugs: ['recent-gamma', 'recent-beta']
    });

    expect(payload.mode).toBe('recent');
    expect(payload.items.map((item) => item.id)).toEqual([newest.id, middle.id, oldest.id]);
  });

  it('uses likes for the first reel while keeping nearby queue slots folder-diverse', async () => {
    const alphaLead = await createIndexedMedia('reels/alpha', 'alpha-1.mp4', 1_778_200_003_000);
    await createIndexedMedia('reels/alpha', 'alpha-2.mp4', 1_778_200_002_000);
    await createIndexedMedia('reels/beta', 'beta-1.mp4', 1_778_200_001_000, {
      width: 1280,
      height: 720
    });
    await createIndexedMedia('reels/gamma', 'gamma-1.mp4', 1_778_200_000_000, {
      width: 1280,
      height: 720
    });

    await likeRepository.upsert(alphaLead.id);

    const payload = await galleryService.getReels(1, 4, 'recommended', 91);

    expect(payload.mode).toBe('recommended');
    expect(payload.items[0]?.folderSlug).toBe('reels-alpha');
    expect(payload.items[0]?.id).toBe(alphaLead.id);
    expect(payload.items[1]?.folderSlug).not.toBe('reels-alpha');
  });

  it('returns an empty payload when the indexed library has no visible videos', async () => {
    const payload = await galleryService.getReels(1, 8, 'random', 13);

    expect(payload).toEqual({
      mode: 'random',
      items: [],
      page: 1,
      limit: 8,
      total: 0,
      hasMore: false
    });
  });

  async function createIndexedMedia(
    folderPath: string,
    filename: string,
    timestamp: number,
    overrides: {
      width?: number;
      height?: number;
      durationMs?: number | null;
    } = {}
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
      width: overrides.width ?? (mediaType === 'video' ? 1080 : 1600),
      height: overrides.height ?? (mediaType === 'video' ? 1920 : 1200),
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs: overrides.durationMs ?? getDurationForMediaType(mediaType),
      isAnimated: false,
      fingerprint: createFingerprint(relativePath, 2_048, timestamp),
      mtimeMs: timestamp,
      firstSeenAt: new Date(timestamp).toISOString(),
      sortTimestamp: timestamp,
      takenAt: timestamp,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath,
      previewPath
    });
  }

  function getDurationForMediaType(mediaType: MediaType): number | null {
    return mediaType === 'video' ? 18_000 : null;
  }
});
