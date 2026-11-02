import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';
import {
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
  LIBRARY_REBUILD_REQUIRED_SETTING_KEY,
  PREVIOUS_GALLERY_ROOT_SETTING_KEY
} from '../src/constants/app-setting-keys.js';
import { generateAssetKey, getPreviewPathForAssetKey, getThumbnailPathForAssetKey } from '../src/utils/derivative-paths.js';
import { normalizePath } from '../src/utils/path-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('startup behavior', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let scanRunRepository: RepositoriesModule['scanRunRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-startup-behavior-'));

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
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({
      folderRepository,
      imageRepository,
      maintenanceRepository,
      scanRunRepository,
      appSettingsRepository
    } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(sourcePath));
      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 12_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 12_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false,
        thumbnailPath: getThumbnailRelativePath(relativePath),
        previewPath: getPreviewRelativePath(relativePath, mediaType),
        generatedThumbnail: true,
        generatedPreview: true
      };
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('queues a startup scan when the library has no indexed folders yet', async () => {
    await createSourceFile('fresh/photo-1.jpg');

    const action = scannerService.handleStartup('startup');

    expect(action).toBe('scan');

    await waitFor(() => scanRunRepository.latestCompleted()?.status === 'completed');
    expect(imageRepository.countFeed()).toBe(1);
  });

  it('skips the startup scan when an index already exists for the current gallery root', async () => {
    await createSourceFile('fresh/photo-1.jpg');
    maintenanceRepository.resetLibraryIndex();
    await scannerService.scanAll('manual');
    const lastRunId = scanRunRepository.latest()?.id ?? null;

    const action = scannerService.handleStartup('startup');

    expect(action).toBe('idle');
    await wait(50);
    expect(scanRunRepository.latest()?.id ?? null).toBe(lastRunId);
  });

  it('keeps startup idle when legacy derivative migration is still pending and waits for a manual scan', async () => {
    const relativePath = 'legacy/photo-1.jpg';
    const absolutePath = await createSourceFile(relativePath);
    const thumbnailPath = getThumbnailRelativePath(relativePath);
    const previewPath = getPreviewRelativePath(relativePath, 'image');
    const folder = folderRepository.upsert({
      slug: 'legacy',
      name: 'legacy',
      folderPath: 'legacy'
    });

    await fs.mkdir(path.dirname(path.join(appConfig.thumbnailsDir, thumbnailPath)), { recursive: true });
    await fs.mkdir(path.dirname(path.join(appConfig.previewsDir, previewPath)), { recursive: true });
    await fs.writeFile(path.join(appConfig.thumbnailsDir, thumbnailPath), 'legacy-thumb');
    await fs.writeFile(path.join(appConfig.previewsDir, previewPath), 'legacy-preview');

    imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo-1.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: Buffer.byteLength(`source:${relativePath}`),
      width: 1600,
      height: 1200,
      mediaType: 'image',
      mimeType: 'image/jpeg',
      durationMs: null,
      fingerprint: `${relativePath}:1`,
      mtimeMs: Date.parse('2026-03-07T12:00:00.000Z'),
      firstSeenAt: '2026-03-07T12:00:00.000Z',
      sortTimestamp: Date.parse('2026-03-07T12:00:00.000Z'),
      takenAt: Date.parse('2026-03-07T12:00:00.000Z'),
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath,
      previewPath
    });

    const action = scannerService.handleStartup('startup');

    expect(action).toBe('idle');
    await wait(50);

    const untouched = imageRepository.getByRelativePath(relativePath);
    expect(untouched?.asset_key).toBeNull();
    expect(untouched?.thumbnail_path).toBe(thumbnailPath);
    expect(untouched?.preview_path).toBe(previewPath);

    await scannerService.scanAll('manual');

    const migrated = imageRepository.getByRelativePath(relativePath);
    expect(migrated?.asset_key).toMatch(/^[a-f0-9]{32}$/);
    expect(migrated?.thumbnail_path).not.toBe(thumbnailPath);
    expect(migrated?.preview_path).not.toBe(previewPath);
  });

  it('validates a moved gallery root and refreshes cached absolute paths without requiring a rebuild', async () => {
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    const indexed = await createIndexedRelocationMedia({
      relativePath: 'relocated/photo-1.jpg',
      storedGalleryRoot: oldGalleryRoot
    });
    appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, oldGalleryRoot);

    const action = scannerService.handleStartup('startup');

    expect(action).toBe('idle');
    expect(appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY)).toBeNull();
    expect(appSettingsRepository.get(PREVIOUS_GALLERY_ROOT_SETTING_KEY)).toBeNull();
    expect(appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY)).toBe(normalizePath(appConfig.galleryRoot));

    const refreshed = imageRepository.getByRelativePath(indexed.relative_path);
    expect(refreshed?.absolute_path).toBe(path.join(appConfig.galleryRoot, indexed.relative_path));
  });

  it('waits for a temporary reader lock while committing relocated paths', async () => {
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    const indexed = await createIndexedRelocationMedia({
      relativePath: 'relocated/photo-1.jpg',
      storedGalleryRoot: oldGalleryRoot
    });
    appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, oldGalleryRoot);

    // Release the other connection from a worker: the main thread is blocked
    // inside SQLite while COMMIT waits for this read transaction to finish.
    const reader = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const database = new DatabaseSync(workerData.databasePath);
      database.exec('BEGIN');
      database.prepare('SELECT COUNT(*) FROM images').get();
      parentPort.postMessage('locked');
      setTimeout(() => {
        database.exec('ROLLBACK');
        database.close();
      }, 500);
    `, { eval: true, workerData: { databasePath: appConfig.databasePath } });

    try {
      await new Promise<void>((resolve, reject) => {
        reader.once('message', () => resolve());
        reader.once('error', reject);
      });

      expect(scannerService.handleStartup('startup')).toBe('idle');
      expect(imageRepository.getByRelativePath(indexed.relative_path)?.absolute_path)
        .toBe(path.join(appConfig.galleryRoot, indexed.relative_path));
      expect(appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY))
        .toBe(normalizePath(appConfig.galleryRoot));
    } finally {
      await reader.terminate();
    }
  });

  it('rolls back all relocated paths if an update fails partway through', async () => {
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    const first = await createIndexedRelocationMedia({
      relativePath: 'relocated/photo-1.jpg',
      storedGalleryRoot: oldGalleryRoot
    });
    const second = await createIndexedRelocationMedia({
      relativePath: 'relocated/photo-2.jpg',
      storedGalleryRoot: oldGalleryRoot
    });
    const { databaseManager } = await import('../src/db/database.js');
    const database = databaseManager.connection;
    database.exec(`
      CREATE TEMP TRIGGER fail_relocation BEFORE UPDATE OF absolute_path ON images
      WHEN OLD.id = ${second.id}
      BEGIN
        SELECT RAISE(ABORT, 'relocation update failed');
      END;
    `);

    try {
      expect(() => imageRepository.refreshAbsolutePathsForGalleryRoot(appConfig.galleryRoot))
        .toThrow('relocation update failed');
      expect(imageRepository.getByRelativePath(first.relative_path)?.absolute_path).toBe(first.absolute_path);
      expect(imageRepository.getByRelativePath(second.relative_path)?.absolute_path).toBe(second.absolute_path);
    } finally {
      database.exec('DROP TRIGGER fail_relocation');
    }

    expect(imageRepository.refreshAbsolutePathsForGalleryRoot(appConfig.galleryRoot)).toBe(2);
    expect(imageRepository.refreshAbsolutePathsForGalleryRoot(appConfig.galleryRoot)).toBe(0);
  });

  it('requires a rebuild when a moved gallery root is missing an indexed active file', async () => {
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    await createIndexedRelocationMedia({
      relativePath: 'missing/photo-1.jpg',
      storedGalleryRoot: oldGalleryRoot,
      skipSourceFile: true
    });
    appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, oldGalleryRoot);

    const action = scannerService.handleStartup('startup');

    expect(action).toBe('blocked');
    expect(appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY)).toBe('1');
    expect(appSettingsRepository.get(PREVIOUS_GALLERY_ROOT_SETTING_KEY)).toBe(normalizePath(oldGalleryRoot));
  });

  it('requires a rebuild when a moved gallery root has a size mismatch', async () => {
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    await createIndexedRelocationMedia({
      relativePath: 'mismatch/photo-1.jpg',
      storedGalleryRoot: oldGalleryRoot,
      indexedFileSizeOffset: 1
    });
    appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, oldGalleryRoot);

    const action = scannerService.handleStartup('startup');

    expect(action).toBe('blocked');
    expect(appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY)).toBe('1');
  });

  it('requires a rebuild when a moved gallery root has an mtime mismatch', async () => {
    const oldGalleryRoot = path.join(tempRoot, 'old-gallery-root');
    await createIndexedRelocationMedia({
      relativePath: 'mtime/photo-1.jpg',
      storedGalleryRoot: oldGalleryRoot,
      indexedMtimeMs: Date.parse('2026-03-08T12:00:00.000Z')
    });
    appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, oldGalleryRoot);

    const action = scannerService.handleStartup('startup');

    expect(action).toBe('blocked');
    expect(appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY)).toBe('1');
  });

  async function createSourceFile(relativePath: string): Promise<string> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
    return absolutePath;
  }

  async function createIndexedRelocationMedia(options: {
    relativePath: string;
    storedGalleryRoot: string;
    indexedFileSizeOffset?: number;
    indexedMtimeMs?: number;
    skipSourceFile?: boolean;
  }) {
    const folderPath = path.posix.dirname(options.relativePath);
    const filename = path.posix.basename(options.relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const assetKey = generateAssetKey();
    const contents = `source:${options.relativePath}`;
    const actualMtimeMs = Date.parse('2026-03-07T12:00:00.000Z');
    const sourcePath = path.join(appConfig.galleryRoot, options.relativePath);
    const folder = folderRepository.upsert({
      slug: folderPath.replaceAll('/', '-'),
      name: path.posix.basename(folderPath),
      folderPath
    });

    if (!options.skipSourceFile) {
      await fs.mkdir(path.dirname(sourcePath), { recursive: true });
      await fs.writeFile(sourcePath, contents);
      await fs.utimes(sourcePath, new Date(actualMtimeMs), new Date(actualMtimeMs));
    }

    return imageRepository.upsert({
      folderId: folder.id,
      assetKey,
      filename,
      extension,
      relativePath: options.relativePath,
      absolutePath: path.join(options.storedGalleryRoot, options.relativePath),
      fileSize: Buffer.byteLength(contents) + (options.indexedFileSizeOffset ?? 0),
      width: 1600,
      height: 1200,
      mediaType,
      mimeType: mediaType === 'video' ? 'video/mp4' : 'image/jpeg',
      durationMs: mediaType === 'video' ? 12_000 : null,
      fingerprint: `${options.relativePath}:relocation`,
      mtimeMs: options.indexedMtimeMs ?? actualMtimeMs,
      firstSeenAt: '2026-03-07T12:00:00.000Z',
      sortTimestamp: actualMtimeMs,
      takenAt: actualMtimeMs,
      takenAtSource: 'mtime',
      exifJson: mediaType === 'image' ? '{}' : null,
      thumbnailPath: getThumbnailPathForAssetKey(assetKey),
      previewPath: getPreviewPathForAssetKey(assetKey, mediaType),
      playbackStrategy: 'preview'
    });
  }
});

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();

  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for startup scan to finish');
    }

    await wait(25);
  }
}
