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
type PlaybackStrategy = ModelsModule['PlaybackStrategy'];

describe.sequential('IMAGE_DETAIL_SOURCE config', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  async function setup(imageDetailSource: string) {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('IMAGE_DETAIL_SOURCE', imageDetailSource);
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ folderRepository, imageRepository, maintenanceRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  }

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-image-detail-source-'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a preview URL for image detail when IMAGE_DETAIL_SOURCE=preview (default)', async () => {
    await setup('preview');

    maintenanceRepository.resetLibraryIndex();
    const folder = folderRepository.upsert({ slug: 'album', name: 'Album', folderPath: 'album' });
    const image = createIndexedMedia(folder, 'photo.jpg', 1000, 'preview');

    const detail = galleryService.getImageDetail(image.id);
    expect(detail?.previewUrl).toMatch(/^\/previews\//);
    expect(detail?.previewUrl).not.toMatch(/^\/api\/originals\//);
  });

  it('returns an original URL for image detail when IMAGE_DETAIL_SOURCE=original', async () => {
    await setup('original');

    maintenanceRepository.resetLibraryIndex();
    const folder = folderRepository.upsert({ slug: 'album2', name: 'Album2', folderPath: 'album2' });
    const image = createIndexedMedia(folder, 'photo.jpg', 1000, 'preview');

    const detail = galleryService.getImageDetail(image.id);
    expect(detail?.previewUrl).toBe(`/api/originals/${image.id}`);
  });

  it('streams videos with playbackStrategy=preview over HLS regardless of IMAGE_DETAIL_SOURCE', async () => {
    await setup('original');

    maintenanceRepository.resetLibraryIndex();
    const folder = folderRepository.upsert({ slug: 'vids', name: 'Vids', folderPath: 'vids' });
    const video = createIndexedMedia(folder, 'clip.webm', 2000, 'preview', 8000);

    const detail = galleryService.getImageDetail(video.id);
    expect(detail?.previewUrl).toBe(`/api/videos/${video.id}/hls/master.m3u8`);
    expect(detail?.streamUrl).toBe(`/api/videos/${video.id}/hls/master.m3u8`);
    expect(detail?.playbackStrategy).toBe('preview');
  });

  it('plays browser-decodable videos straight from the original file with no stream URL', async () => {
    await setup('preview');

    maintenanceRepository.resetLibraryIndex();
    const folder = folderRepository.upsert({ slug: 'vids2', name: 'Vids2', folderPath: 'vids2' });
    const compatibleMp4 = createIndexedMedia(folder, 'compatible.mp4', 3000, 'original', 5000);

    const detail = galleryService.getImageDetail(compatibleMp4.id);
    expect(detail?.previewUrl).toBe(`/api/originals/${compatibleMp4.id}`);
    expect(detail?.streamUrl).toBe(`/api/videos/${compatibleMp4.id}/hls/master.m3u8`);
    expect(detail?.originalUrl).toBe(`/api/originals/${compatibleMp4.id}`);
    expect(detail?.playbackStrategy).toBe('original');
  });

  it('feed items always use preview URLs regardless of IMAGE_DETAIL_SOURCE=original', async () => {
    await setup('original');

    maintenanceRepository.resetLibraryIndex();
    const folder = folderRepository.upsert({ slug: 'feed', name: 'Feed', folderPath: 'feed' });
    createIndexedMedia(folder, 'photo.jpg', 1000, 'preview');
    folderRepository.setAvatar(folder.id, imageRepository.getLatestFolderImageId(folder.id));

    const feedItems = galleryService.getFeed(1, 10, 'recent').items;
    expect(feedItems.length).toBe(1);
    // Feed images always use preview URLs, not originals
    expect(feedItems[0]!.previewUrl).toMatch(/^\/previews\//);
  });

  function createIndexedMedia(
    folder: FolderRecord,
    filename: string,
    mtimeMs: number,
    playbackStrategy: PlaybackStrategy,
    durationMs: number | null = null
  ) {
    const relativePath = `${folder.folder_path}/${filename}`;
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
    const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
    const fileSize = 2_048 + mtimeMs;

    return imageRepository.upsert({
      folderId: folder.id,
      filename,
      extension,
      relativePath,
      absolutePath,
      fileSize,
      width: 1280,
      height: 960,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs,
      fingerprint: createFingerprint(relativePath, fileSize, mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: mediaType === 'image' ? '{}' : null,
      thumbnailPath: thumbnailRelativePath,
      previewPath: previewRelativePath,
      playbackStrategy
    });
  }
});
