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

describe.sequential('feed filtering of records without a thumbnail', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-feed-renderable-'));

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
    ({ folderRepository, imageRepository } = await import('../src/db/repositories.js'));

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

  it('keeps posts whose cover has no thumbnail out of every feed mode', async () => {
    const ready = await createIndexedImage('ready', 'IMG_20220710_071100.jpg', Date.UTC(2022, 6, 10, 7, 11, 0), 'ready/aa.webp');
    // A record mid-scan: indexed, but its derivative has not been produced yet.
    const pending = await createIndexedImage('pending', 'IMG_20220710_071048.jpg', Date.UTC(2022, 6, 10, 7, 10, 48), '');

    for (const mode of ['recent', 'random'] as const) {
      const payload = galleryService.getFeed(1, 10, mode);
      const ids = payload.items.map((item) => item.id);

      expect(ids).toContain(ready.id);
      expect(ids).not.toContain(pending.id);
      // The total has to agree with the rows, otherwise the client keeps asking for a
      // page that will never arrive.
      expect(payload.total).toBe(1);
      expect(payload.hasMore).toBe(false);
    }
  });

  it('counts only renderable posts for the feed while library statistics keep everything', async () => {
    await createIndexedImage('ready', 'IMG_20220710_071100.jpg', Date.UTC(2022, 6, 10, 7, 11, 0), 'ready/aa.webp');
    await createIndexedImage('pending', 'IMG_20220710_071048.jpg', Date.UTC(2022, 6, 10, 7, 10, 48), '');

    expect(imageRepository.countRenderableFeed()).toBe(1);
    expect(imageRepository.countFeed()).toBe(2);
  });

  async function createIndexedImage(
    folderPath: string,
    filename: string,
    timestamp: number,
    thumbnailPathOverride?: string
  ): Promise<ImageRecord> {
    const folder = folderRepository.upsert({
      slug: folderPath.replaceAll('/', '-'),
      name: path.posix.basename(folderPath),
      folderPath
    });
    const relativePath = `${folderPath}/${filename}`;
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const thumbnailPath = thumbnailPathOverride ?? getThumbnailRelativePath(relativePath);
    const previewPath = getPreviewRelativePath(relativePath, mediaType);

    return imageRepository.upsert({
      folderId: folder.id,
      filename,
      extension,
      relativePath,
      absolutePath,
      fileSize: 2_048,
      width: 1600,
      height: 1200,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs: null,
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
});
