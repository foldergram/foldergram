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
import { REEL_RECOMMENDED_WINDOW_SIZE } from '../src/utils/reels-utils.js';

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
    ({ folderRepository, imageRepository, likeRepository } = await import('../src/db/repositories.js'));

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

    imageRepository.markDeleted(deletedVideo.relative_path);
    expect(imageRepository.moveToTrash(trashedVideo.id)).toBe(true);

    const payload = galleryService.getReels(1, 12, 'recommended', 17);

    expect(payload.mode).toBe('recommended');
    expect(payload.total).toBe(1);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.id).toBe(visibleVideo.id);
    expect(payload.items[0]?.mediaType).toBe('video');
  });

  it('keeps random ordering stable for one seed and changes adjacency for a different seed', async () => {
    for (let index = 0; index < 7; index += 1) {
      await createIndexedMedia('seed/clips', `clip-${index}.mp4`, 1_778_100_000_000);
    }

    const first = galleryService.getReels(1, 7, 'random', 11);
    const second = galleryService.getReels(1, 7, 'random', 11);
    const differentSeed = galleryService.getReels(1, 7, 'random', 29);
    const firstIds = first.items.map((item) => item.id);
    const secondIds = second.items.map((item) => item.id);
    const differentSeedIds = differentSeed.items.map((item) => item.id);
    const adjacencyFor = (ids: number[]) =>
      ids.map((id, index) => `${id}:${ids[(index + 1) % ids.length]}`).sort();

    expect(first.mode).toBe('random');
    expect(firstIds).toEqual(secondIds);
    expect(firstIds).not.toEqual(differentSeedIds);
    expect(adjacencyFor(firstIds)).not.toEqual(adjacencyFor(differentSeedIds));
  });

  it('returns newest visible videos first in recent mode even when affinity and likes would favor older reels', async () => {
    const newest = await createIndexedMedia('recent/alpha', 'alpha-1.mp4', 1_778_150_003_000);
    const middle = await createIndexedMedia('recent/beta', 'beta-1.mp4', 1_778_150_002_000);
    const oldest = await createIndexedMedia('recent/gamma', 'gamma-1.mp4', 1_778_150_001_000);

    likeRepository.upsert(oldest.id);

    const payload = galleryService.getReels(1, 3, 'recent', 91, {
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

    likeRepository.upsert(alphaLead.id);

    const payload = galleryService.getReels(1, 4, 'recommended', 91);

    expect(payload.mode).toBe('recommended');
    expect(payload.items[0]?.folderSlug).toBe('reels-alpha');
    expect(payload.items[0]?.id).toBe(alphaLead.id);
    expect(payload.items[1]?.folderSlug).not.toBe('reels-alpha');
  });

  it('paginates recent reels with keyset cursors when sort timestamps tie', async () => {
    const timestamp = 1_778_250_000_000;
    const created = [];

    for (let index = 0; index < 5; index += 1) {
      created.push(await createIndexedMedia('tied/recent', `clip-${index}.mp4`, timestamp));
    }

    const first = galleryService.getReels(1, 2, 'recent');
    const second = galleryService.getReels(1, 2, 'recent', undefined, {}, first.nextCursor);
    const third = galleryService.getReels(1, 2, 'recent', undefined, {}, second.nextCursor);
    const collectedIds = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    const expectedIds = created
      .map((item) => item.id)
      .sort((left, right) => right - left);

    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.nextCursor).toEqual(expect.any(String));
    expect(third.nextCursor).toBeNull();
    expect(collectedIds).toHaveLength(5);
    expect(new Set(collectedIds).size).toBe(5);
    expect(collectedIds).toEqual(expectedIds);
  });

  it('paginates recent reels across pre-1970 timestamps', async () => {
    const created = [];

    for (let index = 0; index < 5; index += 1) {
      created.push(
        await createIndexedMedia('historical/recent', `clip-${index}.mp4`, -2_000_000_000_000 + index * 1_000)
      );
    }

    const first = galleryService.getReels(1, 2, 'recent');
    const second = galleryService.getReels(1, 2, 'recent', undefined, {}, first.nextCursor);
    const third = galleryService.getReels(1, 2, 'recent', undefined, {}, second.nextCursor);
    const collectedIds = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    const expectedIds = created
      .map((item) => item.id)
      .sort((left, right) => right - left);

    expect(first.nextCursor).toEqual(expect.any(String));
    expect(second.nextCursor).toEqual(expect.any(String));
    expect(third.nextCursor).toBeNull();
    expect(collectedIds).toHaveLength(5);
    expect(new Set(collectedIds).size).toBe(5);
    expect(collectedIds).toEqual(expectedIds);
  });

  it('paginates random reels deterministically without duplicates across cursors', async () => {
    for (let index = 0; index < 5; index += 1) {
      await createIndexedMedia('random/pages', `clip-${index}.mp4`, 1_778_260_000_000 + index);
    }

    const first = galleryService.getReels(1, 2, 'random', 37);
    const second = galleryService.getReels(1, 2, 'random', 37, {}, first.nextCursor);
    const third = galleryService.getReels(1, 2, 'random', 37, {}, second.nextCursor);
    const collectedIds = [...first.items, ...second.items, ...third.items].map((item) => item.id);
    const pageNumberIds = [1, 2, 3].flatMap((page) =>
      galleryService.getReels(page, 2, 'random', 37).items.map((item) => item.id)
    );

    expect(collectedIds).toHaveLength(5);
    expect(new Set(collectedIds).size).toBe(5);
    expect(collectedIds).toEqual(pageNumberIds);
  });

  it('continues implicit-seed cursors across UTC midnight for random and recommended modes', async () => {
    for (let index = 0; index < 5; index += 1) {
      await createIndexedMedia('midnight/cursors', `clip-${index}.mp4`, 1_778_265_000_000 + index);
    }

    vi.useFakeTimers();

    try {
      for (const mode of ['random', 'recommended'] as const) {
        vi.setSystemTime(new Date('2026-03-10T23:59:59.000Z'));
        const first = galleryService.getReels(1, 2, mode);
        expect(first.nextCursor).toEqual(expect.any(String));

        vi.setSystemTime(new Date('2026-03-11T00:00:01.000Z'));
        const second = galleryService.getReels(1, 2, mode, undefined, {}, first.nextCursor);

        expect(second.page).toBe(2);
        expect(second.items).toHaveLength(2);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes affinity-folder videos outside the recent candidate slice and keeps the window bounded', async () => {
    const oldAffinityVideo = await createIndexedMedia('window/affinity', 'old.mp4', 1_778_000_000_000);

    for (let index = 0; index < 200; index += 1) {
      await createIndexedMedia(
        `window/recent-${index % 4}`,
        `recent-${index}.mp4`,
        1_778_100_000_000 + index
      );
    }

    const candidates = imageRepository.listRecommendedVideoCandidates(17, ['window-affinity']);

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(REEL_RECOMMENDED_WINDOW_SIZE);
    expect(candidates.some((candidate) => candidate.id === oldAffinityVideo.id)).toBe(true);
  });

  it('excludes cover files and media from non-normal folders', async () => {
    const visibleVideo = await createIndexedMedia('exclude/visible', 'visible.mp4', 1_778_270_000_000);
    await createIndexedMedia('exclude/visible', 'cover.jpg', 1_778_270_001_000);
    const storyVideo = await createIndexedMedia('exclude/story', 'story.mp4', 1_778_270_002_000);

    folderRepository.upsert({
      slug: 'exclude-story',
      name: 'story',
      folderPath: 'exclude/story',
      role: 'story_root'
    });

    const payload = galleryService.getReels(1, 12, 'recent');

    expect(payload.items.map((item) => item.id)).toEqual([visibleVideo.id]);
    expect(payload.items.map((item) => item.id)).not.toContain(storyVideo.id);
    expect(payload.items.every((item) => item.mediaType === 'video')).toBe(true);
    expect(payload.total).toBe(1);
  });

  it('rejects malformed cursors and cursors from a different session', async () => {
    for (let index = 0; index < 3; index += 1) {
      await createIndexedMedia('cursor/validation', `clip-${index}.mp4`, 1_778_280_000_000 + index);
    }

    expect(() => galleryService.getReels(1, 1, 'random', 5, {}, 'not-a-cursor')).toThrow(
      'Invalid Reels cursor.'
    );

    const randomCursor = galleryService.getReels(1, 1, 'random', 5).nextCursor;
    expect(randomCursor).toEqual(expect.any(String));
    expect(() => galleryService.getReels(1, 1, 'recent', undefined, {}, randomCursor)).toThrow(
      'Reels cursor does not match the current session.'
    );
    expect(() => galleryService.getReels(1, 1, 'random', 6, {}, randomCursor)).toThrow(
      'Reels cursor does not match the current session.'
    );
  });

  it('returns an empty payload when the indexed library has no visible videos', () => {
    const payload = galleryService.getReels(1, 8, 'random', 13);

    expect(payload).toEqual({
      mode: 'random',
      items: [],
      page: 1,
      limit: 8,
      total: 0,
      hasMore: false,
      nextCursor: null
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
    const folder = folderRepository.upsert({
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

    return imageRepository.upsert({
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
