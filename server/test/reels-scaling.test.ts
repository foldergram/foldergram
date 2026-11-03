import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { databaseManager } from '../src/db/database.js';
import { buildReelQueue, REEL_RECOMMENDED_WINDOW_SIZE } from '../src/utils/reels-utils.js';

type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const SYNTHETIC_VIDEO_COUNT = 15_000;
const SYNTHETIC_FOLDER_COUNT = 30;

describe.sequential('reels scaling', () => {
  let tempRoot = '';
  let galleryService: GalleryServiceModule['galleryService'];
  let imageRepository: RepositoriesModule['imageRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-reels-scaling-'));

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

    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ imageRepository } = await import('../src/db/repositories.js'));

    const { appConfig } = await import('../src/config/env.js');
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

  it('keeps recent, random, and recommended Reels work bounded on a 15,000-video library', async () => {
    seedSyntheticLibrary(SYNTHETIC_VIDEO_COUNT, SYNTHETIC_FOLDER_COUNT);

    const countStartedAt = performance.now();
    const totalVideos = imageRepository.countVisibleVideos();
    const countDurationMs = performance.now() - countStartedAt;

    const recentStartedAt = performance.now();
    const recentItems = imageRepository.listRecentVideos(0, 6);
    const recentDurationMs = performance.now() - recentStartedAt;

    const randomStartedAt = performance.now();
    const randomItems = imageRepository.listRandomVideos(0, 6, 4242);
    const randomDurationMs = performance.now() - randomStartedAt;

    const candidateStartedAt = performance.now();
    const recommendedCandidates = imageRepository.listRecommendedVideoCandidates(4242, [
      'synthetic-0',
      'synthetic-1',
      'synthetic-2'
    ]);
    const candidateDurationMs = performance.now() - candidateStartedAt;

    const rankingStartedAt = performance.now();
    const rankedCandidates = buildReelQueue(recommendedCandidates, 4242, {
      lastOpenedFolderSlug: 'synthetic-0',
      recentOpenedFolderSlugs: ['synthetic-0', 'synthetic-1', 'synthetic-2']
    });
    const rankingDurationMs = performance.now() - rankingStartedAt;

    const eventLoopMonitor = monitorEventLoopDelay({ resolution: 1 });
    const heapBeforeMs = process.memoryUsage().heapUsed;
    eventLoopMonitor.enable();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const recommendedStartedAt = performance.now();
    const recommendedPayload = galleryService.getReels(1, 6, 'recommended', 4242, {
      lastOpenedFolderSlug: 'synthetic-0',
      recentOpenedFolderSlugs: ['synthetic-0', 'synthetic-1', 'synthetic-2']
    });
    const recommendedDurationMs = performance.now() - recommendedStartedAt;
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    eventLoopMonitor.disable();
    const heapDeltaBytes = process.memoryUsage().heapUsed - heapBeforeMs;
    const eventLoopDelayMeanMs = Number.isFinite(eventLoopMonitor.mean)
      ? Math.round(eventLoopMonitor.mean / 1e6)
      : null;
    const eventLoopDelayMaxMs = Number.isFinite(eventLoopMonitor.max)
      ? Math.round(eventLoopMonitor.max / 1e6)
      : null;

    expect(totalVideos).toBe(SYNTHETIC_VIDEO_COUNT);
    expect(countDurationMs).toBeGreaterThanOrEqual(0);
    expect(recentItems).toHaveLength(6);
    expect(randomItems).toHaveLength(6);
    expect(recommendedCandidates.length).toBeGreaterThan(0);
    expect(recommendedCandidates.length).toBeLessThanOrEqual(REEL_RECOMMENDED_WINDOW_SIZE);
    expect(rankedCandidates.length).toBe(recommendedPayload.total);
    expect(recommendedPayload.items).toHaveLength(6);
    expect(recommendedPayload.total).toBeLessThanOrEqual(REEL_RECOMMENDED_WINDOW_SIZE);
    expect(recommendedPayload.nextCursor).toEqual(expect.any(String));

    console.info('[reels-scaling]', {
      videos: totalVideos,
      recentRows: recentItems.length,
      randomRows: randomItems.length,
      recommendedCandidates: recommendedCandidates.length,
      countDurationMs: Math.round(countDurationMs),
      recentDurationMs: Math.round(recentDurationMs),
      randomDurationMs: Math.round(randomDurationMs),
      candidateDurationMs: Math.round(candidateDurationMs),
      rankingDurationMs: Math.round(rankingDurationMs),
      recommendedDurationMs: Math.round(recommendedDurationMs),
      eventLoopDelayMeanMs,
      eventLoopDelayMaxMs,
      heapDeltaBytes
    });
  }, 120_000);
});

function seedSyntheticLibrary(videoCount: number, folderCount: number): void {
  const database = databaseManager.connection;
  const insertFolder = database.prepare(
    `INSERT INTO folders (slug, name, folder_path, role) VALUES (?, ?, ?, 'normal')`
  );
  const insertImage = database.prepare(`
    INSERT INTO images (
      folder_id,
      filename,
      extension,
      relative_path,
      absolute_path,
      file_size,
      width,
      height,
      media_type,
      mime_type,
      duration_ms,
      is_animated,
      checksum_or_fingerprint,
      mtime_ms,
      first_seen_at,
      sort_timestamp,
      taken_at,
      taken_at_source,
      exif_json,
      thumbnail_path,
      preview_path,
      playback_strategy
    ) VALUES (?, ?, '.mp4', ?, ?, 2048, 1080, 1920, 'video', 'video/mp4', 18000, 0, ?, ?, ?, ?, ?, 'mtime', '{}', ?, ?, 'preview')
  `);
  const insertPost = database.prepare(`
    INSERT INTO posts (folder_id, source_path, post_type, sort_timestamp, taken_at, taken_at_source)
    VALUES (?, ?, 'single', ?, ?, 'mtime')
  `);
  const insertPostItem = database.prepare(
    `INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`
  );

  database.exec('BEGIN');
  try {
    const folderIds: number[] = [];
    for (let index = 0; index < folderCount; index += 1) {
      const folderPath = `synthetic-${index}`;
      const result = insertFolder.run(folderPath, `Synthetic ${index}`, folderPath);
      folderIds.push(Number(result.lastInsertRowid));
    }

    for (let index = 0; index < videoCount; index += 1) {
      const folderIndex = index % folderCount;
      const folderId = folderIds[folderIndex]!;
      const filename = `clip-${index}.mp4`;
      const relativePath = `synthetic-${folderIndex}/${filename}`;
      const timestamp = 1_700_000_000_000 + index * 1_000;
      const firstSeenAt = new Date(timestamp).toISOString();

      const imageResult = insertImage.run(
        folderId,
        filename,
        relativePath,
        `/tmp/foldergram/${relativePath}`,
        `fingerprint-${index}`,
        timestamp,
        firstSeenAt,
        timestamp,
        timestamp,
        `thumbnails/${relativePath}.webp`,
        `previews/${relativePath}.webp`
      );
      const postResult = insertPost.run(folderId, relativePath, timestamp, timestamp);
      insertPostItem.run(Number(postResult.lastInsertRowid), Number(imageResult.lastInsertRowid));
    }

    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
