import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type StorageServiceModule = typeof import('../src/services/storage-service.js');
type AppSettingKeysModule = typeof import('../src/constants/app-setting-keys.js');

describe.sequential('viewer-safe status payload', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];
  let scanRunRepository: RepositoriesModule['scanRunRepository'];
  let storageService: StorageServiceModule['storageService'];
  let APP_DEFAULT_LOCALE_SETTING_KEY: AppSettingKeysModule['APP_DEFAULT_LOCALE_SETTING_KEY'];
  let HOME_FEED_DEFAULT_MODE_SETTING_KEY: AppSettingKeysModule['HOME_FEED_DEFAULT_MODE_SETTING_KEY'];
  let REELS_FEED_DEFAULT_MODE_SETTING_KEY: AppSettingKeysModule['REELS_FEED_DEFAULT_MODE_SETTING_KEY'];
  let FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY: AppSettingKeysModule['FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY'];
  let NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY: AppSettingKeysModule['NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-viewer-status-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository, maintenanceRepository, appSettingsRepository, scanRunRepository } = await import('../src/db/repositories.js'));
    ({ storageService } = await import('../src/services/storage-service.js'));
    ({
      APP_DEFAULT_LOCALE_SETTING_KEY,
      HOME_FEED_DEFAULT_MODE_SETTING_KEY,
      REELS_FEED_DEFAULT_MODE_SETTING_KEY,
      FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY,
      NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY
    } = await import('../src/constants/app-setting-keys.js'));
  });

  beforeEach(async () => {
    maintenanceRepository.resetLibraryIndex();
    appSettingsRepository.remove(APP_DEFAULT_LOCALE_SETTING_KEY);
    appSettingsRepository.remove(HOME_FEED_DEFAULT_MODE_SETTING_KEY);
    appSettingsRepository.remove(REELS_FEED_DEFAULT_MODE_SETTING_KEY);
    appSettingsRepository.remove(FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY);
    appSettingsRepository.remove(NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY);
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

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('redacts admin-only scan and gallery-root details', () => {
    const completedRunId = scanRunRepository.start();
    scanRunRepository.finish(completedRunId, {
      finished_at: '2026-03-20T00:00:00.000Z',
      status: 'completed_with_errors',
      scanned_files: 4,
      new_files: 1,
      updated_files: 2,
      removed_files: 1,
      error_text: '/private/gallery/trips/broken.jpg'
    });

    const status = galleryService.getStatus();

    expect(status.scan.lastCompletedScan).toMatchObject({
      id: completedRunId,
      status: 'completed_with_errors',
      error_text: null
    });
    expect(status.scan.currentFolder).toBeNull();
    expect(status.scan.currentFile).toBeNull();
    expect(status).not.toHaveProperty('lastScan');
    expect(status.storage).not.toHaveProperty('usingInMemoryDatabase');
    expect(status.libraryIndex).not.toHaveProperty('currentGalleryRoot');
    expect(status.libraryIndex).not.toHaveProperty('previousGalleryRoot');
    expect(status.libraryIndex).not.toHaveProperty('lastSuccessfulGalleryRoot');
    expect(status.libraryIndex).not.toHaveProperty('legacyDerivativeMigrationPending');
    expect(status.libraryIndex).not.toHaveProperty('pendingDerivativeMigrationRows');
  });

  it('keeps legacy derivative migration state in the admin-only stats payload', () => {
    const pendingSpy = vi.spyOn(imageRepository, 'countPendingDerivativeMigrationRows').mockReturnValue(14);

    const status = galleryService.getStatus();
    const adminStats = galleryService.getStats();

    expect(status.libraryIndex).not.toHaveProperty('legacyDerivativeMigrationPending');
    expect(status.libraryIndex).not.toHaveProperty('pendingDerivativeMigrationRows');
    expect(adminStats.libraryIndex).toMatchObject({
      legacyDerivativeMigrationPending: true,
      pendingDerivativeMigrationRows: 14
    });

    pendingSpy.mockRestore();
  });

  it('includes the nested folder title format preference in viewer and admin status payloads', () => {
    expect(galleryService.getStatus().preferences.nestedFolderTitleFormat).toBe('folder');

    galleryService.setNestedFolderTitleFormat('parent-plus-folder');

    expect(galleryService.getStatus().preferences.nestedFolderTitleFormat).toBe('parent-plus-folder');
    expect(galleryService.getStats().preferences.nestedFolderTitleFormat).toBe('parent-plus-folder');
  });

  it('keeps detailed file and folder context in the admin-only scan progress payload', () => {
    const progressSpy = vi.spyOn(scannerService, 'getProgress').mockReturnValue({
      isScanning: true,
      scanReason: 'manual',
      phase: 'migration',
      startedAt: '2026-03-21T00:00:00.000Z',
      runId: 9,
      migrationTotalRows: 12,
      processedMigrationRows: 4,
      migratedDerivativeFiles: 2,
      missingDerivativeFiles: 1,
      repairedDerivativeFiles: 3,
      backfilledAssetKeys: 4,
      discoveredFolders: 0,
      processedFolders: 0,
      discoveredImages: 0,
      processedImages: 0,
      queuedDerivativeJobs: 0,
      processedDerivativeJobs: 0,
      generatedThumbnails: 0,
      generatedPreviews: 0,
      currentOperation: 'moving_preview',
      currentFile: 'private/album/photo.jpg',
      currentPhaseMessage: 'Upgrading legacy thumbnails and previews before indexing starts.',
      currentFolder: 'private/album',
      lastCompletedScan: null
    });

    expect(galleryService.getScanProgress()).toMatchObject({
      currentFile: null,
      currentFolder: null,
      currentOperation: 'moving_preview'
    });
    expect(galleryService.getAdminScanProgress()).toMatchObject({
      currentFile: 'private/album/photo.jpg',
      currentFolder: 'private/album',
      currentOperation: 'moving_preview'
    });

    progressSpy.mockRestore();
  });

  it('replaces storage failure details with a generic viewer-safe message', () => {
    const storageStateSpy = vi.spyOn(storageService, 'getState').mockReturnValue({
      libraryAvailable: false,
      reason: 'Gallery directory unavailable at /private/gallery: ENOENT',
      usingInMemoryDatabase: true,
      databasePath: ':memory:'
    });

    const status = galleryService.getStatus();

    expect(status.storage).toEqual({
      available: false,
      reason: 'Configured library storage is unavailable.'
    });
    expect(status.folders).toBe(0);
    expect(status.indexedImages).toBe(0);
    expect(status.indexedVideos).toBe(0);

    storageStateSpy.mockRestore();
  });

  it('uses random as the viewer-safe home and reels defaults when nothing is configured', () => {
    const status = galleryService.getStatus();

    expect(status.preferences).toEqual({
      defaultLocale: null,
      defaultHomeFeedMode: 'random',
      defaultReelsFeedMode: 'random',
      defaultFolderImageOrder: 'newest',
      nestedFolderTitleFormat: 'folder',
      treatStoriesAsFolders: false,
      treatCarouselsAsFolders: false,
      allowDownloads: true
    });
  });

  it('includes configured home, reels, and folder defaults in the viewer-safe status payload', () => {
    appSettingsRepository.set(APP_DEFAULT_LOCALE_SETTING_KEY, 'zh');
    appSettingsRepository.set(HOME_FEED_DEFAULT_MODE_SETTING_KEY, 'rediscover');
    appSettingsRepository.set(REELS_FEED_DEFAULT_MODE_SETTING_KEY, 'recommended');
    appSettingsRepository.set(FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY, 'oldest');

    const status = galleryService.getStatus();

    expect(status.preferences).toEqual({
      defaultLocale: 'zh',
      defaultHomeFeedMode: 'rediscover',
      defaultReelsFeedMode: 'recommended',
      defaultFolderImageOrder: 'oldest',
      nestedFolderTitleFormat: 'folder',
      treatStoriesAsFolders: false,
      treatCarouselsAsFolders: false,
      allowDownloads: true
    });
  });
});
