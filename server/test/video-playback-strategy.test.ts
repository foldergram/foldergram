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

describe.sequential('video playback strategy mapping', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let scanRunRepository: RepositoriesModule['scanRunRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-video-playback-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ folderRepository, imageRepository, maintenanceRepository, scanRunRepository } = await import('../src/db/repositories.js'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    maintenanceRepository.resetLibraryIndex();
    await Promise.all([
      fs.rm(appConfig.galleryRoot, { recursive: true, force: true }),
      fs.rm(appConfig.thumbnailsDir, { recursive: true, force: true }),
      fs.rm(appConfig.previewsDir, { recursive: true, force: true })
    ]);
    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  it('routes videos to the original file or to on-demand HLS instead of a preview file', async () => {
    const folder = folderRepository.upsert({
      slug: 'clips',
      name: 'Clips',
      folderPath: 'clips'
    });

    const image = createIndexedMedia(folder, 'photo-1.jpg', 1_000, 'preview');
    const compatibleVideo = createIndexedMedia(folder, 'reel-1.mp4', 2_000, 'original', 14_000);
    const transcodedVideo = createIndexedMedia(folder, 'reel-2.webm', 3_000, 'preview', 17_000);

    folderRepository.setAvatar(folder.id, image.id);

    const feedItems = new Map(galleryService.getFeed(1, 10, 'recent').items.map((item) => [item.id, item]));

    expect(feedItems.get(image.id)?.previewUrl).toBe('/previews/clips/photo-1.webp');
    expect(feedItems.get(compatibleVideo.id)?.previewUrl).toBe(`/api/originals/${compatibleVideo.id}`);
    expect(feedItems.get(compatibleVideo.id)?.streamUrl).toBeNull();
    expect(feedItems.get(transcodedVideo.id)?.previewUrl).toBe(
      `/api/videos/${transcodedVideo.id}/hls/master.m3u8`
    );
    expect(feedItems.get(transcodedVideo.id)?.streamUrl).toBe(
      `/api/videos/${transcodedVideo.id}/hls/master.m3u8`
    );

    const compatibleVideoDetail = galleryService.getImageDetail(compatibleVideo.id, 'video');
    expect(compatibleVideoDetail?.previewUrl).toBe(`/api/originals/${compatibleVideo.id}`);
    expect(compatibleVideoDetail?.originalUrl).toBe(`/api/originals/${compatibleVideo.id}`);
    expect(compatibleVideoDetail?.playbackStrategy).toBe('original');

    await fs.mkdir(path.join(appConfig.previewsDir, 'clips'), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(appConfig.previewsDir, 'clips', 'photo-1.webp'), 'preview-image'),
      fs.writeFile(path.join(appConfig.previewsDir, 'clips', 'reel-1.mp4'), 'preview-video-hd'),
      fs.writeFile(path.join(appConfig.previewsDir, 'clips', 'reel-2.mp4'), 'preview-video-transcoded')
    ]);

    const stats = galleryService.getStats();
    expect(stats.previewCount).toBe(3);
  });

  it('reports the latest completed scan in stats even when a newer run is still in progress', () => {
    const completedRunId = scanRunRepository.start();
    scanRunRepository.finish(completedRunId, {
      finished_at: '2026-03-02T00:00:00.000Z',
      status: 'completed',
      scanned_files: 3,
      new_files: 1,
      updated_files: 1,
      removed_files: 0,
      error_text: null
    });

    scanRunRepository.start();

    const stats = galleryService.getStats();
    expect(stats.lastScan?.id).toBe(completedRunId);
    expect(stats.lastScan?.status).toBe('completed');
    expect(stats.scan.lastCompletedScan?.id).toBe(completedRunId);
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
      width: mediaType === 'video' ? 1080 : 1600,
      height: mediaType === 'video' ? 1920 : 1200,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs,
      fingerprint: createFingerprint(relativePath, fileSize, mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-03-01T00:00:00.000Z',
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
