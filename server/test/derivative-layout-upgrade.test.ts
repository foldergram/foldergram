import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY,
  DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY,
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY
} from '../src/constants/app-setting-keys.js';
import { getPreviewPathForAssetKey, getThumbnailPathForAssetKey } from '../src/utils/derivative-paths.js';
import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type DerivativeMigrationServiceModule = typeof import('../src/services/derivative-migration-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('derivative layout upgrade', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let derivativeMigrationService: DerivativeMigrationServiceModule['derivativeMigrationService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let likeRepository: RepositoriesModule['likeRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-derivative-layout-upgrade-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DERIVATIVE_MODE', 'lazy');
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
    ({ derivativeMigrationService } = await import('../src/services/derivative-migration-service.js'));
    ({folderRepository,
      imageRepository,
      likeRepository,
      appSettingsRepository,
      maintenanceRepository} = await import('../src/db/repositories.js'));
      await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    await maintenanceRepository.resetLibraryIndex();

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

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string, force = false, overrides?: {
      thumbnailPath?: string;
      previewPath?: string;
    }) => {
      const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
      const thumbnailPath = overrides?.thumbnailPath ?? getThumbnailRelativePath(relativePath);
      const previewPath = overrides?.previewPath ?? getPreviewRelativePath(relativePath, mediaType);
      const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
      const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
      const shouldWriteThumbnail = force || !(await pathExists(thumbnailAbsolutePath));
      const shouldWritePreview = force || !(await pathExists(previewAbsolutePath));

      if (shouldWriteThumbnail) {
        await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
        await fs.writeFile(thumbnailAbsolutePath, `thumb:${relativePath}`);
      }

      if (shouldWritePreview) {
        await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
        await fs.writeFile(previewAbsolutePath, `preview:${relativePath}`);
      }

      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 12_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false,
        thumbnailPath,
        previewPath,
        generatedThumbnail: shouldWriteThumbnail,
        generatedPreview: shouldWritePreview
      };
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('backfills asset keys, migrates mirrored derivatives, and updates stored paths on the next full scan', async () => {
    const folder = await folderRepository.upsert({
      slug: 'legacy',
      name: 'legacy',
      folderPath: 'legacy'
    });
    const relativePath = 'legacy/photo.jpg';
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const thumbnailPath = getThumbnailRelativePath(relativePath);
    const previewPath = getPreviewRelativePath(relativePath, 'image');
    const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
    const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
    const sourceContents = `source:${relativePath}`;
    const mtimeMs = Date.parse('2026-03-01T12:00:00.000Z');

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
    await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
    await fs.writeFile(absolutePath, sourceContents);
    await fs.writeFile(thumbnailAbsolutePath, 'legacy-thumb');
    await fs.writeFile(previewAbsolutePath, 'legacy-preview');
    await fs.utimes(absolutePath, mtimeMs / 1000, mtimeMs / 1000);

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: Buffer.byteLength(sourceContents),
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: createFingerprint(relativePath, Buffer.byteLength(sourceContents), mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-03-01T12:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath,
      previewPath
    });

    await scannerService.scanAll('manual', {
      repairUnchangedDerivatives: false
    });

    const migrated = await imageRepository.getByRelativePath(relativePath);
    expect(migrated?.asset_key).toMatch(/^[a-f0-9]{32}$/);
    expect(migrated?.thumbnail_path).toBe(getThumbnailPathForAssetKey(migrated!.asset_key!));
    expect(migrated?.preview_path).toBe(getPreviewPathForAssetKey(migrated!.asset_key!, 'image'));
    await expect(fs.readFile(path.join(appConfig.thumbnailsDir, migrated!.thumbnail_path), 'utf8')).resolves.toBe('legacy-thumb');
    await expect(fs.readFile(path.join(appConfig.previewsDir, migrated!.preview_path), 'utf8')).resolves.toBe('legacy-preview');
    await expect(fs.stat(thumbnailAbsolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(previewAbsolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reruns derivative migration when the completion flags were set but legacy rows still remain', async () => {
    const folder = await folderRepository.upsert({
      slug: 'legacy-flags',
      name: 'legacy-flags',
      folderPath: 'legacy-flags'
    });
    const relativePath = 'legacy-flags/photo.jpg';
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const thumbnailPath = getThumbnailRelativePath(relativePath);
    const previewPath = getPreviewRelativePath(relativePath, 'image');
    const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
    const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
    const sourceContents = `source:${relativePath}`;
    const mtimeMs = Date.parse('2026-03-02T12:00:00.000Z');

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
    await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
    await fs.writeFile(absolutePath, sourceContents);
    await fs.writeFile(thumbnailAbsolutePath, 'legacy-thumb');
    await fs.writeFile(previewAbsolutePath, 'legacy-preview');
    await fs.utimes(absolutePath, mtimeMs / 1000, mtimeMs / 1000);

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: Buffer.byteLength(sourceContents),
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: createFingerprint(relativePath, Buffer.byteLength(sourceContents), mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-03-02T12:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath,
      previewPath
    });

    await appSettingsRepository.set(DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY, '3');
    await appSettingsRepository.set(DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY, '2026-04-03T10:13:01.386Z');

    expect(await derivativeMigrationService.isMigrationComplete()).toBe(false);

    await scannerService.scanAll('manual', {
      repairUnchangedDerivatives: false
    });

    const migrated = await imageRepository.getByRelativePath(relativePath);
    expect(migrated?.asset_key).toMatch(/^[a-f0-9]{32}$/);
    expect(migrated?.thumbnail_path).toBe(getThumbnailPathForAssetKey(migrated!.asset_key!));
    expect(migrated?.preview_path).toBe(getPreviewPathForAssetKey(migrated!.asset_key!, 'image'));
    await expect(fs.readFile(path.join(appConfig.thumbnailsDir, migrated!.thumbnail_path), 'utf8')).resolves.toBe('legacy-thumb');
    await expect(fs.readFile(path.join(appConfig.previewsDir, migrated!.preview_path), 'utf8')).resolves.toBe('legacy-preview');
  });

  it('reports migration progress instead of discovery while derivative storage is being migrated', async () => {
    const folder = await folderRepository.upsert({
      slug: 'legacy-progress',
      name: 'legacy-progress',
      folderPath: 'legacy-progress'
    });
    const relativePath = 'legacy-progress/photo.jpg';
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const sourceContents = `source:${relativePath}`;
    const mtimeMs = Date.parse('2026-03-03T10:00:00.000Z');

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, sourceContents);
    await fs.utimes(absolutePath, mtimeMs / 1000, mtimeMs / 1000);

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: Buffer.byteLength(sourceContents),
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: createFingerprint(relativePath, Buffer.byteLength(sourceContents), mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-03-03T10:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, 'image')
    });

    let releaseMigration: ((value: Awaited<ReturnType<typeof derivativeMigrationService.ensureMigrated>>) => void) | null = null;
    const ensureMigratedSpy = vi
      .spyOn(derivativeMigrationService, 'ensureMigrated')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            releaseMigration = resolve;
          })
      );

    const scanPromise = scannerService.scanAll('manual', {
      repairUnchangedDerivatives: false
    });

    await vi.waitFor(() => {
      const progress = scannerService.getProgress();
      expect(progress.isScanning).toBe(true);
      expect(progress.phase).toBe('migration');
      expect(progress.migrationTotalRows).toBe(1);
      expect(progress.processedMigrationRows).toBe(0);
      expect(progress.currentOperation).toBe('checking_derivatives');
      expect(progress.currentPhaseMessage).toBe('Upgrading legacy thumbnails and previews before indexing starts.');
    });

    releaseMigration?.({
      totalRows: 1,
      processedRows: 1,
      repairedFiles: 0,
      backfilledAssetKeys: 1,
      movedFiles: 0,
      missingFiles: 2,
      currentOperation: null,
      currentFile: null,
      currentPhaseMessage: 'Upgrading legacy thumbnails and previews before indexing starts.',
      migratedRows: 1,
      repairedRows: 0,
      repairErrors: 0,
      complete: true
    });

    await scanPromise;
    ensureMigratedSpy.mockRestore();
  });

  it('emits migration actions with the current relative file during derivative upgrades', async () => {
    const folder = await folderRepository.upsert({
      slug: 'legacy-events',
      name: 'legacy-events',
      folderPath: 'legacy-events'
    });
    const relativePath = 'legacy-events/photo.jpg';
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const thumbnailPath = getThumbnailRelativePath(relativePath);
    const previewPath = getPreviewRelativePath(relativePath, 'image');
    const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
    const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);
    const sourceContents = `source:${relativePath}`;
    const mtimeMs = Date.parse('2026-03-03T12:00:00.000Z');
    const progressEvents: Array<{
      currentOperation: string | null;
      currentFile: string | null;
      processedRows: number;
      currentPhaseMessage: string | null;
    }> = [];

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
    await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
    await fs.writeFile(absolutePath, sourceContents);
    await fs.writeFile(thumbnailAbsolutePath, 'legacy-thumb');
    await fs.writeFile(previewAbsolutePath, 'legacy-preview');
    await fs.utimes(absolutePath, mtimeMs / 1000, mtimeMs / 1000);

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: Buffer.byteLength(sourceContents),
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: createFingerprint(relativePath, Buffer.byteLength(sourceContents), mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-03-03T12:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath,
      previewPath
    });

    await derivativeMigrationService.ensureMigrated({
      onProgress: (progress) => {
        progressEvents.push({
          currentOperation: progress.currentOperation,
          currentFile: progress.currentFile,
          processedRows: progress.processedRows,
          currentPhaseMessage: progress.currentPhaseMessage
        });
      }
    });

    expect(progressEvents.some((progress) => progress.currentOperation === 'backfilling_asset_key' && progress.currentFile === relativePath)).toBe(true);
    expect(progressEvents.some((progress) => progress.currentOperation === 'moving_thumbnail' && progress.currentFile === relativePath)).toBe(true);
    expect(progressEvents.some((progress) => progress.currentOperation === 'moving_preview' && progress.currentFile === relativePath)).toBe(true);
    expect(progressEvents.at(-1)).toMatchObject({
      processedRows: 1,
      currentPhaseMessage: 'Upgrading legacy thumbnails and previews before indexing starts.'
    });
  });

  it('updates only the derivative path whose migrated target exists', async () => {
    const folder = await folderRepository.upsert({
      slug: 'partial-upgrade',
      name: 'partial-upgrade',
      folderPath: 'partial-upgrade'
    });
    const relativePath = 'partial-upgrade/photo.jpg';
    const legacyThumbnailPath = getThumbnailRelativePath(relativePath);
    const legacyPreviewPath = getPreviewRelativePath(relativePath, 'image');
    const legacyThumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, legacyThumbnailPath);
    const assetKey = 'aabbccddeeff00112233445566778899';
    const nextThumbnailPath = getThumbnailPathForAssetKey(assetKey);
    const nextPreviewPath = getPreviewPathForAssetKey(assetKey, 'image');

    await fs.mkdir(path.dirname(legacyThumbnailAbsolutePath), { recursive: true });
    await fs.writeFile(legacyThumbnailAbsolutePath, 'legacy-thumb');

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath: path.join(appConfig.galleryRoot, relativePath),
      fileSize: 12,
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: 'missing-source',
      mtimeMs: Date.parse('2026-03-04T10:00:00.000Z'),
      firstSeenAt: '2026-03-04T10:00:00.000Z',
      sortTimestamp: Date.parse('2026-03-04T10:00:00.000Z'),
      takenAt: Date.parse('2026-03-04T10:00:00.000Z'),
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: legacyThumbnailPath,
      previewPath: legacyPreviewPath,
      assetKey
    });

    const summary = await derivativeMigrationService.ensureMigrated();
    const migrated = await imageRepository.getByRelativePath(relativePath);

    expect(summary.missingFiles).toBe(1);
    expect(migrated?.thumbnail_path).toBe(nextThumbnailPath);
    expect(migrated?.preview_path).toBe(legacyPreviewPath);
    await expect(fs.readFile(path.join(appConfig.thumbnailsDir, nextThumbnailPath), 'utf8')).resolves.toBe('legacy-thumb');
    await expect(fs.stat(path.join(appConfig.previewsDir, nextPreviewPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps stored derivative paths unchanged when neither migrated target nor repair source exists', async () => {
    const folder = await folderRepository.upsert({
      slug: 'broken-upgrade',
      name: 'broken-upgrade',
      folderPath: 'broken-upgrade'
    });
    const relativePath = 'broken-upgrade/photo.jpg';
    const legacyThumbnailPath = getThumbnailRelativePath(relativePath);
    const legacyPreviewPath = getPreviewRelativePath(relativePath, 'image');
    const assetKey = '11223344556677889900aabbccddeeff';

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath: path.join(appConfig.galleryRoot, relativePath),
      fileSize: 8,
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: 'missing-everything',
      mtimeMs: Date.parse('2026-03-05T10:00:00.000Z'),
      firstSeenAt: '2026-03-05T10:00:00.000Z',
      sortTimestamp: Date.parse('2026-03-05T10:00:00.000Z'),
      takenAt: Date.parse('2026-03-05T10:00:00.000Z'),
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: legacyThumbnailPath,
      previewPath: legacyPreviewPath,
      assetKey
    });

    const summary = await derivativeMigrationService.ensureMigrated();
    const migrated = await imageRepository.getByRelativePath(relativePath);

    expect(summary.missingFiles).toBe(2);
    expect(migrated?.thumbnail_path).toBe(legacyThumbnailPath);
    expect(migrated?.preview_path).toBe(legacyPreviewPath);
  });

  it('skips corrupt sources during derivative repair and reports the failing file', async () => {
    const folder = await folderRepository.upsert({
      slug: 'corrupt-repair',
      name: 'corrupt-repair',
      folderPath: 'corrupt-repair'
    });
    const relativePath = 'corrupt-repair/photo.jpg';
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const legacyThumbnailPath = getThumbnailRelativePath(relativePath);
    const legacyPreviewPath = getPreviewRelativePath(relativePath, 'image');
    const sourceContents = `source:${relativePath}`;
    const mtimeMs = Date.parse('2026-03-05T12:00:00.000Z');

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, sourceContents);
    await fs.utimes(absolutePath, mtimeMs / 1000, mtimeMs / 1000);

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: Buffer.byteLength(sourceContents),
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: createFingerprint(relativePath, Buffer.byteLength(sourceContents), mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-03-05T12:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: legacyThumbnailPath,
      previewPath: legacyPreviewPath
    });

    generateDerivativesMock.mockRejectedValueOnce(new Error('VipsJpeg: premature end of JPEG image'));

    const lastScan = await scannerService.scanAll('manual', {
      repairUnchangedDerivatives: false
    });
    const migrated = await imageRepository.getByRelativePath(relativePath);

    expect(lastScan?.status).toBe('completed_with_errors');
    expect(lastScan?.error_text).toContain(relativePath);
    expect(lastScan?.error_text).toContain('VipsJpeg: premature end of JPEG image');
    expect(lastScan?.error_text).toContain('Full error report:');
    const reportPath = lastScan?.error_text?.match(/Full error report: (.+)$/m)?.[1];
    expect(reportPath).toBeTruthy();
    await expect(fs.readFile(reportPath!, 'utf8')).resolves.toContain(relativePath);
    await expect(fs.readFile(reportPath!, 'utf8')).resolves.toContain('Error count: 1');
    expect(migrated?.asset_key).toMatch(/^[a-f0-9]{32}$/);
    expect(migrated?.thumbnail_path).toBe(legacyThumbnailPath);
    expect(migrated?.preview_path).toBe(legacyPreviewPath);
    expect(generateDerivativesMock).toHaveBeenCalledWith(absolutePath, relativePath, false, {
      thumbnailPath: getThumbnailPathForAssetKey(migrated!.asset_key!),
      previewPath: getPreviewPathForAssetKey(migrated!.asset_key!, 'image')
    });
  });

  it('repairs broken rows by moving legacy mirrored derivatives into the current asset-key layout', async () => {
    const folder = await folderRepository.upsert({
      slug: 'repair-upgrade',
      name: 'repair-upgrade',
      folderPath: 'repair-upgrade'
    });
    const relativePath = 'repair-upgrade/photo.jpg';
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const assetKey = 'ffeeddccbbaa00998877665544332211';
    const brokenThumbnailPath = getThumbnailPathForAssetKey(assetKey, '2');
    const brokenPreviewPath = getPreviewPathForAssetKey(assetKey, 'image', '2');
    const repairedThumbnailPath = getThumbnailPathForAssetKey(assetKey);
    const repairedPreviewPath = getPreviewPathForAssetKey(assetKey, 'image');
    const legacyThumbnailPath = getThumbnailRelativePath(relativePath);
    const legacyPreviewPath = getPreviewRelativePath(relativePath, 'image');

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.mkdir(path.join(appConfig.thumbnailsDir, path.dirname(legacyThumbnailPath)), { recursive: true });
    await fs.mkdir(path.join(appConfig.previewsDir, path.dirname(legacyPreviewPath)), { recursive: true });
    await fs.writeFile(absolutePath, 'source:repair-upgrade/photo.jpg');
    await fs.writeFile(path.join(appConfig.thumbnailsDir, legacyThumbnailPath), 'legacy-thumb');
    await fs.writeFile(path.join(appConfig.previewsDir, legacyPreviewPath), 'legacy-preview');

    await imageRepository.upsert({
      folderId: folder.id,
      filename: 'photo.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: Buffer.byteLength('source:repair-upgrade/photo.jpg'),
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      fingerprint: 'broken-v2-row',
      mtimeMs: Date.parse('2026-03-06T10:00:00.000Z'),
      firstSeenAt: '2026-03-06T10:00:00.000Z',
      sortTimestamp: Date.parse('2026-03-06T10:00:00.000Z'),
      takenAt: Date.parse('2026-03-06T10:00:00.000Z'),
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath: brokenThumbnailPath,
      previewPath: brokenPreviewPath,
      assetKey
    });

    const summary = await derivativeMigrationService.ensureMigrated();
    const repaired = await imageRepository.getByRelativePath(relativePath);

    expect(summary.missingFiles).toBe(0);
    expect(repaired?.thumbnail_path).toBe(repairedThumbnailPath);
    expect(repaired?.preview_path).toBe(repairedPreviewPath);
    await expect(fs.readFile(path.join(appConfig.thumbnailsDir, repairedThumbnailPath), 'utf8')).resolves.toBe('legacy-thumb');
    await expect(fs.readFile(path.join(appConfig.previewsDir, repairedPreviewPath), 'utf8')).resolves.toBe('legacy-preview');
    await expect(fs.stat(path.join(appConfig.thumbnailsDir, legacyThumbnailPath))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(appConfig.previewsDir, legacyPreviewPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves the same row, likes, and derivative paths when a file is moved to a new folder path', async () => {
    const initialRelativePath = 'phones/set-a/photo.jpg';
    const movedRelativePath = 'phones/photo.jpg';
    const movedAt = new Date('2026-03-02T15:30:00.000Z');

    await createSourceFile(initialRelativePath, movedAt);
    await scannerService.scanAll('initial', {
      repairUnchangedDerivatives: false
    });

    const original = await imageRepository.getByRelativePath(initialRelativePath);
    expect(original).toBeDefined();
    await likeRepository.upsert(original!.id);

    await fs.mkdir(path.join(appConfig.galleryRoot, 'phones'), { recursive: true });
    await fs.copyFile(path.join(appConfig.galleryRoot, initialRelativePath), path.join(appConfig.galleryRoot, movedRelativePath));
    await fs.utimes(path.join(appConfig.galleryRoot, movedRelativePath), movedAt, movedAt);
    await fs.unlink(path.join(appConfig.galleryRoot, initialRelativePath));
    await appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, appConfig.galleryRoot);

    await scannerService.scanAll('move', {
      repairUnchangedDerivatives: false
    });

    const moved = await imageRepository.getByRelativePath(movedRelativePath);
    expect(moved?.id).toBe(original?.id);
    expect(moved?.asset_key).toBe(original?.asset_key);
    expect(moved?.thumbnail_path).toBe(original?.thumbnail_path);
    expect(moved?.preview_path).toBe(original?.preview_path);
    expect(await imageRepository.getByRelativePath(initialRelativePath)).toBeUndefined();
    expect(await likeRepository.getByImageId(moved!.id)).toBeDefined();
  });

  async function createSourceFile(relativePath: string, modifiedAt: Date): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
    await fs.utimes(absolutePath, modifiedAt, modifiedAt);
  }
});

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}
