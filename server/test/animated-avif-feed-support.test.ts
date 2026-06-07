import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFingerprint,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';
import { AVIF_METADATA_REPAIR_VERSION_SETTING_KEY } from '../src/constants/app-setting-keys.js';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];

const generateDerivativesMock = vi.fn();
const generateThumbnailDerivativeMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('animated AVIF feed support', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-animated-avif-feed-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    generateDerivativesMock.mockReset();
    generateThumbnailDerivativeMock.mockReset();
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
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({folderRepository, imageRepository, appSettingsRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const extension = path.extname(sourcePath).toLowerCase();

      if (extension === '.avif') {
        return {
          width: 800,
          height: 450,
          displayOrientation: 1,
          takenAt: null,
          exif: null,
          durationMs: null,
          mediaType: 'image',
          playbackStrategy: 'preview',
          isAnimated: true
        };
      }

      return {
        width: 1600,
        height: 1200,
        displayOrientation: 1,
        takenAt: null,
        exif: null,
        durationMs: null,
        mediaType: 'image',
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });

    generateThumbnailDerivativeMock.mockResolvedValue({
      thumbnailPath: 'unused.webp',
      generatedThumbnail: true
    });

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string) => ({
      width: path.extname(relativePath).toLowerCase() === '.avif' ? 800 : 1600,
      height: path.extname(relativePath).toLowerCase() === '.avif' ? 450 : 1200,
      displayOrientation: 1,
      takenAt: null,
      exif: null,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: path.extname(relativePath).toLowerCase() === '.avif',
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, 'image'),
      generatedThumbnail: true,
      generatedPreview: true
    }));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('repairs legacy animated AVIF timestamps so recent feed ordering follows scan-time fallback values', async () => {
    const folder = await createFolder('albums');
    const recentRelativePath = 'albums/recent.jpg';
    const avifRelativePath = 'albums/animated.avif';
    const recentAbsolutePath = await createSourceFile(recentRelativePath, 'recent-jpg');
    const avifAbsolutePath = await createSourceFile(avifRelativePath, 'animated-avif');
    const recentTimestamp = Date.parse('2025-04-01T08:30:00.000Z');
    const avifTimestamp = Date.parse('2026-05-21T15:05:24.146Z');

    await Promise.all([
      fs.utimes(recentAbsolutePath, recentTimestamp / 1000, recentTimestamp / 1000),
      fs.utimes(avifAbsolutePath, avifTimestamp / 1000, avifTimestamp / 1000)
    ]);

    const recentStats = await fs.stat(recentAbsolutePath);
    const avifStats = await fs.stat(avifAbsolutePath);

    const recentImage = await imageRepository.upsert({
      folderId: folder.id,
      filename: 'recent.jpg',
      extension: '.jpg',
      relativePath: recentRelativePath,
      absolutePath: recentAbsolutePath,
      fileSize: recentStats.size,
      width: 1600,
      height: 1200,
      displayOrientation: 1,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      isAnimated: false,
      fingerprint: createFingerprint(recentRelativePath, recentStats.size, recentStats.mtimeMs),
      mtimeMs: recentStats.mtimeMs,
      firstSeenAt: new Date(recentTimestamp + 2_000).toISOString(),
      sortTimestamp: Math.round(recentStats.mtimeMs),
      takenAt: Math.round(recentStats.mtimeMs),
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: getThumbnailRelativePath(recentRelativePath),
      previewPath: getPreviewRelativePath(recentRelativePath, 'image'),
      playbackStrategy: 'preview'
    });

    const avifImage = await imageRepository.upsert({
      folderId: folder.id,
      filename: 'animated.avif',
      extension: '.avif',
      relativePath: avifRelativePath,
      absolutePath: avifAbsolutePath,
      fileSize: avifStats.size,
      width: 800,
      height: 450,
      displayOrientation: 1,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.avif'),
      durationMs: null,
      isAnimated: true,
      fingerprint: createFingerprint(avifRelativePath, avifStats.size, avifStats.mtimeMs),
      mtimeMs: avifStats.mtimeMs,
      firstSeenAt: new Date(avifTimestamp + 5_000).toISOString(),
      sortTimestamp: Math.round(avifStats.mtimeMs),
      takenAt: Date.parse('2020-09-13T22:30:13.000Z'),
      takenAtSource: 'exif',
      exifJson: '{}',
      thumbnailPath: getThumbnailRelativePath(avifRelativePath),
      previewPath: getPreviewRelativePath(avifRelativePath, 'image'),
      playbackStrategy: 'preview'
    });

    expect((await galleryService.getFeed(1, 10, 'recent')).items.map((item) => item.id)).toEqual([recentImage.id, avifImage.id]);

    await scannerService.scanAll('manual');

    expect(readMediaMetadataMock).toHaveBeenCalledTimes(1);
    expect(readMediaMetadataMock).toHaveBeenCalledWith(avifAbsolutePath, 'image', {
      fileSize: avifStats.size
    });

    const refreshedAvif = await imageRepository.getByRelativePath(avifRelativePath);
    expect(refreshedAvif?.taken_at).toBe(Math.round(avifStats.mtimeMs));
    expect(refreshedAvif?.taken_at_source).toBe('mtime');
    expect(await appSettingsRepository.get(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY)).toBe('1');

    expect((await galleryService.getFeed(1, 10, 'recent')).items.map((item) => item.id)).toEqual([avifImage.id, recentImage.id]);

    readMediaMetadataMock.mockClear();

    await scannerService.scanAll('manual');

    expect(readMediaMetadataMock).not.toHaveBeenCalled();
  });

  it('repairs stale animated AVIF flags stored as non-animated rows during the one-time AVIF metadata repair scan', async () => {
    const folder = await createFolder('legacy');
    const relativePath = 'legacy/animated.avif';
    const absolutePath = await createSourceFile(relativePath, 'legacy-animated-avif');
    const timestamp = Date.parse('2026-05-21T16:40:00.000Z');

    await fs.utimes(absolutePath, timestamp / 1000, timestamp / 1000);

    const stats = await fs.stat(absolutePath);
    const image = await imageRepository.upsert({
      folderId: folder.id,
      filename: 'animated.avif',
      extension: '.avif',
      relativePath,
      absolutePath,
      fileSize: stats.size,
      width: 800,
      height: 450,
      displayOrientation: 1,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.avif'),
      durationMs: null,
      isAnimated: false,
      fingerprint: createFingerprint(relativePath, stats.size, stats.mtimeMs),
      mtimeMs: stats.mtimeMs,
      firstSeenAt: new Date(timestamp).toISOString(),
      sortTimestamp: Math.round(stats.mtimeMs),
      takenAt: Math.round(stats.mtimeMs),
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, 'image'),
      playbackStrategy: 'preview'
    });

    expect(image.is_animated).toBe(0);

    await scannerService.scanAll('manual');

    const refreshed = await imageRepository.getByRelativePath(relativePath);
    expect(refreshed?.is_animated).toBe(1);
  });

  it('does not keep re-reading unchanged animated AVIF rows that legitimately retain EXIF timestamps after the one-time repair pass', async () => {
    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const extension = path.extname(sourcePath).toLowerCase();

      if (extension === '.avif') {
        return {
          width: 800,
          height: 450,
          displayOrientation: 1,
          takenAt: Date.parse('2024-07-10T08:30:00.000Z'),
          exif: null,
          durationMs: null,
          mediaType: 'image',
          playbackStrategy: 'preview',
          isAnimated: true
        };
      }

      return {
        width: 1600,
        height: 1200,
        displayOrientation: 1,
        takenAt: null,
        exif: null,
        durationMs: null,
        mediaType: 'image',
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });

    const folder = await createFolder('exif-album');
    const relativePath = 'exif-album/animated.avif';
    const absolutePath = await createSourceFile(relativePath, 'exif-animated-avif');
    const timestamp = Date.parse('2026-05-21T17:05:00.000Z');

    await fs.utimes(absolutePath, timestamp / 1000, timestamp / 1000);

    const stats = await fs.stat(absolutePath);
    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'animated.avif',
      extension: '.avif',
      relativePath,
      absolutePath,
      fileSize: stats.size,
      width: 800,
      height: 450,
      displayOrientation: 1,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.avif'),
      durationMs: null,
      isAnimated: true,
      fingerprint: createFingerprint(relativePath, stats.size, stats.mtimeMs),
      mtimeMs: stats.mtimeMs,
      firstSeenAt: new Date(timestamp).toISOString(),
      sortTimestamp: Math.round(stats.mtimeMs),
      takenAt: Date.parse('2024-07-10T08:30:00.000Z'),
      takenAtSource: 'exif',
      exifJson: '{}',
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, 'image'),
      playbackStrategy: 'preview'
    });

    await scannerService.scanAll('manual');
    expect(readMediaMetadataMock).toHaveBeenCalledTimes(1);

    readMediaMetadataMock.mockClear();

    await scannerService.scanAll('manual');
    expect(readMediaMetadataMock).not.toHaveBeenCalled();
  });

  async function createFolder(folderPath: string): Promise<FolderRecord> {
    return await folderRepository.upsert({
      slug: folderPath,
      name: path.posix.basename(folderPath),
      folderPath
    });
  }

  async function createSourceFile(relativePath: string, contents: string): Promise<string> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, contents);
    return absolutePath;
  }
});
