import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
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
type StorageServiceModule = typeof import('../src/services/storage-service.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];

describe.sequential('admin stats derivative counts', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let storageService: StorageServiceModule['storageService'];

  beforeAll(async () => {
    tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'insta-admin-stats-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ folderRepository, imageRepository, maintenanceRepository } = await import('../src/db/repositories.js'));
    ({ storageService } = await import('../src/services/storage-service.js'));
  });

  beforeEach(async () => {
    maintenanceRepository.resetLibraryIndex();
    await Promise.all([
      fsPromises.rm(appConfig.galleryRoot, { recursive: true, force: true }),
      fsPromises.rm(appConfig.thumbnailsDir, { recursive: true, force: true }),
      fsPromises.rm(appConfig.previewsDir, { recursive: true, force: true })
    ]);
    await Promise.all([
      fsPromises.mkdir(appConfig.galleryRoot, { recursive: true }),
      fsPromises.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fsPromises.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
  });

  it('counts indexed derivative references without traversing derivative directories', async () => {
    const folder = folderRepository.upsert({ slug: 'clips', name: 'Clips', folderPath: 'clips' });
    createIndexedMedia(folder, 'photo-1.jpg', 1_000);
    createIndexedMedia(folder, 'photo-2.jpg', 2_000);
    createIndexedMedia(folder, 'photo-3.jpg', 3_000, { thumbnailPath: '', previewPath: '' });

    // Physical disk state intentionally disagrees with the index: a stale file for
    // an indexed row plus an orphan file that the index does not reference at all.
    await fsPromises.mkdir(path.join(appConfig.thumbnailsDir, 'clips'), { recursive: true });
    await fsPromises.writeFile(path.join(appConfig.thumbnailsDir, 'clips', 'photo-1.webp'), 'stale thumbnail');
    await fsPromises.mkdir(path.join(appConfig.thumbnailsDir, 'orphan'), { recursive: true });
    await fsPromises.writeFile(path.join(appConfig.thumbnailsDir, 'orphan', 'orphan.webp'), 'unrelated file');

    const readdirSyncSpy = vi.spyOn(fs, 'readdirSync');

    try {
      const stats = galleryService.getStats();

      const traversedPaths = readdirSyncSpy.mock.calls.map((call) => String(call[0]));
      expect(traversedPaths.some((calledPath) => calledPath.startsWith(appConfig.thumbnailsDir))).toBe(false);
      expect(traversedPaths.some((calledPath) => calledPath.startsWith(appConfig.previewsDir))).toBe(false);
      expect(stats.thumbnailCount).toBe(2);
      expect(stats.previewCount).toBe(2);
    } finally {
      readdirSyncSpy.mockRestore();
    }
  });

  it('keeps soft-deleted rows counted and excludes rows without derivative targets', () => {
    const folder = folderRepository.upsert({ slug: 'clips', name: 'Clips', folderPath: 'clips' });
    createIndexedMedia(folder, 'photo-1.jpg', 1_000);
    const softDeleted = createIndexedMedia(folder, 'photo-2.jpg', 2_000);
    createIndexedMedia(folder, 'photo-3.jpg', 3_000, { thumbnailPath: '', previewPath: '' });

    imageRepository.markDeleted(softDeleted.relative_path);

    const stats = galleryService.getStats();

    expect(stats.deletedImages).toBe(1);
    expect(stats.thumbnailCount).toBe(2);
    expect(stats.previewCount).toBe(2);
  });

  it('returns zero derivative counts when library storage is unavailable', () => {
    const stateSpy = vi.spyOn(storageService, 'getState').mockReturnValue({
      libraryAvailable: false,
      reason: 'Gallery directory unavailable',
      usingInMemoryDatabase: false,
      databasePath: ':memory:'
    });

    try {
      const stats = galleryService.getStats();

      expect(stats.thumbnailCount).toBe(0);
      expect(stats.previewCount).toBe(0);
    } finally {
      stateSpy.mockRestore();
    }
  });

  function createIndexedMedia(
    folder: FolderRecord,
    filename: string,
    mtimeMs: number,
    overrides: { thumbnailPath?: string; previewPath?: string } = {}
  ) {
    const relativePath = `${folder.folder_path}/${filename}`;
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const fileSize = 2_048 + mtimeMs;

    return imageRepository.upsert({
      folderId: folder.id,
      filename,
      extension,
      relativePath,
      absolutePath,
      fileSize,
      width: 1600,
      height: 1200,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs: null,
      fingerprint: createFingerprint(relativePath, fileSize, mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-03-01T00:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: null,
      thumbnailPath: overrides.thumbnailPath ?? getThumbnailRelativePath(relativePath),
      previewPath: overrides.previewPath ?? getPreviewRelativePath(relativePath, mediaType)
    });
  }
});
