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

describe.sequential('recent feed ordering', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-recent-feed-'));

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
    ({ appSettingsRepository, folderRepository, imageRepository } = await import('../src/db/repositories.js'));

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

  it('keeps recent mode in strict reverse chronological order even when one folder has a burst', async () => {
    const julyNewer = await createIndexedImage('mi-11t', 'IMG_20220710_071100.jpg', Date.UTC(2022, 6, 10, 7, 11, 0));
    const julyOlder = await createIndexedImage('mi-11t', 'IMG_20220710_071048.jpg', Date.UTC(2022, 6, 10, 7, 10, 48));
    const octoberOlder = await createIndexedImage('note9', 'Samsung_Note9_20211019_103000.jpg', Date.UTC(2021, 9, 19, 10, 30, 0));

    const payload = galleryService.getFeed(1, 10, 'recent');

    expect(payload.mode).toBe('recent');
    expect(payload.items.map((item) => item.id)).toEqual([julyNewer.id, julyOlder.id, octoberOlder.id]);
  });

  // Pull-to-refresh sends the ids already on screen so the next batch is new content
  // rather than a reshuffle of the same rows.
  it('skips excluded post ids in both recent and random mode', async () => {
    const newest = await createIndexedImage('mi-11t', 'IMG_20220710_071100.jpg', Date.UTC(2022, 6, 10, 7, 11, 0));
    const middle = await createIndexedImage('mi-11t', 'IMG_20220710_071048.jpg', Date.UTC(2022, 6, 10, 7, 10, 48));
    const oldest = await createIndexedImage('note9', 'Samsung_Note9_20211019_103000.jpg', Date.UTC(2021, 9, 19, 10, 30, 0));

    const recent = galleryService.getFeed(1, 10, 'recent', undefined, [newest.id, middle.id]);
    expect(recent.items.map((item) => item.id)).toEqual([oldest.id]);

    const random = galleryService.getFeed(1, 10, 'random', 42, [newest.id, oldest.id]);
    expect(random.items.map((item) => item.id)).toEqual([middle.id]);

    // Excluding nothing has to stay the plain query, otherwise refreshing a small
    // library would come back empty.
    const unfiltered = galleryService.getFeed(1, 10, 'recent', undefined, []);
    expect(unfiltered.items).toHaveLength(3);
  });

  it('uses selected scan folders as display scope without deleting indexed rows', async () => {
    const selected = await createIndexedImage('selected', 'selected.jpg', Date.UTC(2022, 6, 10, 7, 11, 0));
    const hidden = await createIndexedImage('hidden', 'hidden.jpg', Date.UTC(2022, 6, 10, 7, 10, 48));

    appSettingsRepository.set('library.scan_folders', JSON.stringify(['selected']));
    expect(galleryService.getFeed(1, 10, 'recent').items.map((item) => item.id)).toEqual([selected.id]);
    expect(galleryService.listFolders().map((folder) => folder.folderPath)).toEqual(['selected']);
    expect(imageRepository.getById(hidden.id)?.is_deleted).toBe(0);

    appSettingsRepository.set('library.scan_folders', JSON.stringify([]));
    expect(galleryService.getFeed(1, 10, 'recent').items).toEqual([]);
    expect(imageRepository.getById(selected.id)?.is_deleted).toBe(0);

    appSettingsRepository.set('library.scan_folders', JSON.stringify(['hidden']));
    expect(galleryService.getFeed(1, 10, 'recent').items.map((item) => item.id)).toEqual([hidden.id]);
  });

  async function createIndexedImage(folderPath: string, filename: string, timestamp: number): Promise<ImageRecord> {
    const folder = folderRepository.upsert({
      slug: folderPath.replaceAll('/', '-'),
      name: path.posix.basename(folderPath),
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
