import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

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

type FolderRecord = ModelsModule['FolderRecord'];

describe.sequential('highlight rail selection', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-highlight-rail-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
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
    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  it('keeps highlight covers and recent batch items out of the top recent feed window when enough alternatives exist', async () => {
    await createIndexedFolder('alpha', 1_777_000_000_000, 12);
    await createIndexedFolder('bravo', 1_776_000_000_000, 12);
    await createIndexedFolder('charlie', 1_775_000_000_000, 12);

    const recentFeedIds = new Set((await galleryService.getFeed(1, 18, 'recent')).items.map((item) => item.id));
    const rail = await galleryService.listMoments();

    expect(rail.railKind).toBe('highlights');
    expect(rail.items.length).toBeGreaterThan(0);

    for (const capsule of rail.items) {
      expect(recentFeedIds.has(capsule.coverImage.id)).toBe(false);
    }

    const recentBatches = rail.items.find((capsule) => capsule.id === 'highlight-recent-batches');
    expect(recentBatches).toBeDefined();

    const recentBatchFeed = await galleryService.getMomentFeed('highlight-recent-batches', 1, 30);
    expect(recentBatchFeed).not.toBeNull();
    expect(recentBatchFeed?.items.length).toBeGreaterThanOrEqual(2);

    for (const item of recentBatchFeed?.items ?? []) {
      expect(recentFeedIds.has(item.id)).toBe(false);
    }
  });

  async function createIndexedFolder(relativeFolderPath: string, startTimestamp: number, imageCount: number): Promise<{
    folder: FolderRecord;
  }> {
    const slug = relativeFolderPath.replaceAll('/', '-');
    const folderName = path.posix.basename(relativeFolderPath);
    const folder = await folderRepository.upsert({
      slug,
      name: folderName,
      folderPath: relativeFolderPath
    });

    for (let index = 0; index < imageCount; index += 1) {
      const filename = `photo-${String(index + 1).padStart(2, '0')}.jpg`;
      const relativePath = `${relativeFolderPath}/${filename}`;
      const absolutePath = path.join(appConfig.galleryRoot, relativePath);
      const extension = path.extname(filename).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);
      const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
      const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
      const capturedAt = startTimestamp - index * 60_000;
      const fileSize = 1_000 + index;

      const image = await imageRepository.upsert({
        folderId: folder.id,
        filename,
        extension,
        relativePath,
        absolutePath,
        fileSize,
        width: 1200,
        height: 800,
        mediaType,
        mimeType: getMimeTypeFromExtension(extension),
        durationMs: null,
        fingerprint: createFingerprint(relativePath, fileSize, capturedAt),
        mtimeMs: capturedAt,
        firstSeenAt: '2026-03-01T00:00:00.000Z',
        sortTimestamp: capturedAt,
        takenAt: capturedAt,
        takenAtSource: 'mtime',
        exifJson: '{}',
        thumbnailPath: thumbnailRelativePath,
        previewPath: previewRelativePath
      });

      if (index === 0) {
        await folderRepository.setAvatar(folder.id, image.id);
      }
    }

    return { folder };
  }
});
