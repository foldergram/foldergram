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
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type DatabaseModule = typeof import('../src/db/database.js');
type ModelsModule = typeof import('../src/types/models.js');
type AppSettingKeysModule = typeof import('../src/constants/app-setting-keys.js');

type FolderRecord = ModelsModule['FolderRecord'];
type ImageRecord = ModelsModule['ImageRecord'];

const generateThumbnailDerivativeMock = vi.fn<
  (sourcePath: string, relativePath: string, force?: boolean) => Promise<{ thumbnailPath: string; generatedThumbnail: boolean }>
>();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('thumbnail-only rebuild', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let libraryRebuildRequiredMessage: typeof ScannerServiceModule['LIBRARY_REBUILD_REQUIRED_MESSAGE'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let likeRepository: RepositoriesModule['likeRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];
  let scanRunRepository: RepositoriesModule['scanRunRepository'];
  let databaseManager: DatabaseModule['databaseManager'];
  let libraryRebuildRequiredSettingKey: typeof AppSettingKeysModule['LIBRARY_REBUILD_REQUIRED_SETTING_KEY'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-thumbnail-rebuild-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    generateThumbnailDerivativeMock.mockReset();
    generateDerivativesMock.mockReset();
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
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService, LIBRARY_REBUILD_REQUIRED_MESSAGE: libraryRebuildRequiredMessage } = await import(
      '../src/services/scanner-service.js'
    ));
    ({
      folderRepository,
      imageRepository,
      likeRepository,
      appSettingsRepository,
      scanRunRepository
    } = await import('../src/db/repositories.js'));
    ({ databaseManager } = await import('../src/db/database.js'));
    ({ LIBRARY_REBUILD_REQUIRED_SETTING_KEY: libraryRebuildRequiredSettingKey } = await import(
      '../src/constants/app-setting-keys.js'
    ));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    generateThumbnailDerivativeMock.mockImplementation(async (sourcePath, relativePath) => {
      try {
        await fs.access(sourcePath);
      } catch {
        throw new Error(`ENOENT: source file missing for ${relativePath}`);
      }

      const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
      const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailRelativePath);
      await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
      await fs.writeFile(thumbnailAbsolutePath, `thumb:${relativePath}`);

      return {
        thumbnailPath: thumbnailRelativePath,
        generatedThumbnail: true
      };
    });
    generateDerivativesMock.mockImplementation(async () => {
      throw new Error('generateDerivatives should not be called during thumbnail rebuilds');
    });
    readMediaMetadataMock.mockImplementation(async () => {
      throw new Error('readMediaMetadata should not be called during thumbnail rebuilds');
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('rebuilds thumbnails from indexed media without touching previews or indexed state', async () => {
    const previousScan = createCompletedScanRun({
      scanned_files: 2,
      new_files: 0,
      updated_files: 0,
      removed_files: 0
    });
    const indexed = await createIndexedFolder('summer', [
      { filename: 'photo-1.jpg', like: true },
      { filename: 'clip-1.mp4' }
    ]);

    const previousThumbnailUrl = galleryService
      .getFeed(1, 10, 'recent')
      .items.find((item) => item.id === indexed.images[0]?.id)?.thumbnailUrl;
    expect(previousThumbnailUrl).toContain(`?v=${previousScan.id}`);

    const previewContentsBefore = await Promise.all(indexed.previewPaths.map((previewPath) => fs.readFile(previewPath, 'utf8')));
    const scanRunCountBefore = getScanRunCount();

    const lastScan = await scannerService.rebuildThumbnails();

    expect(lastScan?.status).toBe('completed');
    expect(lastScan?.scanned_files).toBe(2);
    expect(lastScan?.new_files).toBe(0);
    expect(lastScan?.updated_files).toBe(0);
    expect(lastScan?.removed_files).toBe(0);
    expect(lastScan?.error_text).toBeNull();

    expect(generateThumbnailDerivativeMock).toHaveBeenCalledTimes(2);
    expect(generateDerivativesMock).not.toHaveBeenCalled();

    for (const [index, thumbnailPath] of indexed.thumbnailPaths.entries()) {
      await expect(fs.readFile(thumbnailPath, 'utf8')).resolves.toBe(`thumb:${indexed.images[index]?.relative_path}`);
    }

    for (const [index, previewPath] of indexed.previewPaths.entries()) {
      await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe(previewContentsBefore[index]);
    }

    expect(folderRepository.getBySlug(indexed.folder.slug)).toBeDefined();
    expect(imageRepository.countByFolder(indexed.folder.id)).toBe(2);
    expect(likeRepository.getByImageId(indexed.images[0]!.id)).toBeDefined();
    expect(getScanRunCount()).toBe(scanRunCountBefore + 1);

    const refreshedFeedItem = galleryService
      .getFeed(1, 10, 'recent')
      .items.find((item) => item.id === indexed.images[0]?.id);
    expect(refreshedFeedItem?.thumbnailUrl).toContain(`?v=${lastScan?.id}`);
    expect(refreshedFeedItem?.previewUrl).toContain(`?v=${lastScan?.id}`);
  });

  it('reports missing indexed source files without deleting previews or indexed rows', async () => {
    await createCompletedScanRun({
      scanned_files: 2,
      new_files: 0,
      updated_files: 0,
      removed_files: 0
    });
    const indexed = await createIndexedFolder('broken', [
      { filename: 'photo-1.jpg' },
      { filename: 'clip-missing.mp4', missingSource: true }
    ]);

    const previewContentsBefore = await Promise.all(indexed.previewPaths.map((previewPath) => fs.readFile(previewPath, 'utf8')));

    const lastScan = await scannerService.rebuildThumbnails();

    expect(lastScan?.status).toBe('completed_with_errors');
    expect(lastScan?.error_text).toContain('broken/clip-missing.mp4');
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledTimes(2);

    await expect(fs.readFile(indexed.thumbnailPaths[0]!, 'utf8')).resolves.toBe('thumb:broken/photo-1.jpg');
    await expect(fs.stat(indexed.thumbnailPaths[1]!)).rejects.toMatchObject({
      code: 'ENOENT'
    });

    for (const [index, previewPath] of indexed.previewPaths.entries()) {
      await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe(previewContentsBefore[index]);
    }

    expect(imageRepository.getByRelativePath('broken/clip-missing.mp4')?.is_deleted).toBe(0);
  });

  it('rebuilds thumbnails from the current gallery root when cached absolute paths are stale', async () => {
    await createCompletedScanRun({
      scanned_files: 1,
      new_files: 0,
      updated_files: 0,
      removed_files: 0
    });
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    const indexed = await createIndexedFolder('relocated', [
      { filename: 'photo-1.jpg', storedGalleryRoot: oldGalleryRoot }
    ]);

    const lastScan = await scannerService.rebuildThumbnails('relocated');

    expect(lastScan?.status).toBe('completed');
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledWith(
      path.join(appConfig.galleryRoot, indexed.images[0]!.relative_path),
      indexed.images[0]!.relative_path,
      true,
      { thumbnailPath: indexed.images[0]!.thumbnail_path }
    );
  });

  it('refuses thumbnail rebuilds when a full library rebuild is required', async () => {
    appSettingsRepository.set(libraryRebuildRequiredSettingKey, '1');

    await expect(scannerService.rebuildThumbnails()).rejects.toThrow(libraryRebuildRequiredMessage);

    expect(generateThumbnailDerivativeMock).not.toHaveBeenCalled();
    expect(getScanRunCount()).toBe(0);
  });

  it('compacts selected folders and rebuilds thumbnails only inside the selected scope', async () => {
    const saved = scannerService.setSelectedScanFolders(['Trips/day-two', 'Trips', 'Archive']);
    expect(saved.selectedFolders).toEqual(['Trips', 'Archive']);
    expect(scannerService.getSelectedScanFolders()).toEqual(['Trips', 'Archive']);

    await createCompletedScanRun({
      scanned_files: 2,
      new_files: 0,
      updated_files: 0,
      removed_files: 0
    });
    await createIndexedFolder('Trips/day-one', [{ filename: 'selected.jpg' }]);
    await createIndexedFolder('Other', [{ filename: 'untouched.jpg' }]);

    await scannerService.rebuildThumbnails();

    expect(generateThumbnailDerivativeMock).toHaveBeenCalledTimes(1);
    expect(generateThumbnailDerivativeMock).toHaveBeenCalledWith(
      path.join(appConfig.galleryRoot, 'Trips/day-one/selected.jpg'),
      'Trips/day-one/selected.jpg',
      true,
      expect.anything()
    );
  });

  async function createIndexedFolder(
    relativeFolderPath: string,
    entries: Array<{ filename: string; missingSource?: boolean; like?: boolean; storedGalleryRoot?: string }>
  ): Promise<{
    folder: FolderRecord;
    images: ImageRecord[];
    thumbnailPaths: string[];
    previewPaths: string[];
  }> {
    const slug = relativeFolderPath.replaceAll('/', '-');
    const folderName = path.posix.basename(relativeFolderPath);
    const folder = folderRepository.upsert({
      slug,
      name: folderName,
      folderPath: relativeFolderPath
    });
    const images: ImageRecord[] = [];
    const thumbnailPaths: string[] = [];
    const previewPaths: string[] = [];

    for (const [index, entry] of entries.entries()) {
      const relativePath = `${relativeFolderPath}/${entry.filename}`;
      const sourceAbsolutePath = path.join(appConfig.galleryRoot, relativePath);
      const absolutePath = entry.storedGalleryRoot
        ? path.join(entry.storedGalleryRoot, relativePath)
        : sourceAbsolutePath;
      const extension = path.extname(entry.filename).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);
      const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
      const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
      const thumbnailPath = path.join(appConfig.thumbnailsDir, thumbnailRelativePath);
      const previewPath = path.join(appConfig.previewsDir, previewRelativePath);
      const sourceContents = `source:${relativePath}`;
      const fileSize = Buffer.byteLength(sourceContents);
      const mtimeMs = 1_700_000_000_000 + index;

      if (!entry.missingSource) {
        await fs.mkdir(path.dirname(sourceAbsolutePath), { recursive: true });
        await fs.writeFile(sourceAbsolutePath, sourceContents);
      }

      await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
      await fs.mkdir(path.dirname(previewPath), { recursive: true });
      await fs.writeFile(thumbnailPath, `stale-thumb:${relativePath}`);
      await fs.writeFile(previewPath, `preview:${relativePath}`);

      const image = imageRepository.upsert({
        folderId: folder.id,
        filename: entry.filename,
        extension,
        relativePath,
        absolutePath,
        fileSize,
        width: 1200,
        height: 800,
        mediaType,
        mimeType: getMimeTypeFromExtension(extension),
        durationMs: mediaType === 'video' ? 12_000 : null,
        fingerprint: createFingerprint(relativePath, fileSize, mtimeMs),
        mtimeMs,
        firstSeenAt: '2026-03-01T00:00:00.000Z',
        sortTimestamp: mtimeMs,
        takenAt: mtimeMs,
        takenAtSource: 'mtime',
        exifJson: mediaType === 'image' ? '{}' : null,
        thumbnailPath: thumbnailRelativePath,
        previewPath: previewRelativePath
      });

      if (entry.like) {
        likeRepository.upsert(image.id);
      }

      images.push(image);
      thumbnailPaths.push(thumbnailPath);
      previewPaths.push(previewPath);
    }

    folderRepository.setAvatar(folder.id, images[0]?.id ?? null);

    return {
      folder,
      images,
      thumbnailPaths,
      previewPaths
    };
  }

  function createCompletedScanRun(
    summary: Pick<ModelsModule['ScanRunRecord'], 'scanned_files' | 'new_files' | 'updated_files' | 'removed_files'>,
    status = 'completed'
  ) {
    const runId = scanRunRepository.start();
    scanRunRepository.finish(runId, {
      finished_at: '2026-03-12T12:00:00.000Z',
      status,
      scanned_files: summary.scanned_files,
      new_files: summary.new_files,
      updated_files: summary.updated_files,
      removed_files: summary.removed_files,
      error_text: null
    });

    return scanRunRepository.latestCompleted()!;
  }

  function getScanRunCount(): number {
    return Number(
      (databaseManager.connection.prepare('SELECT COUNT(*) AS count FROM scan_runs').get() as { count: number }).count
    );
  }
});
