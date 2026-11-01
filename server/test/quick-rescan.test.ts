import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AVIF_METADATA_REPAIR_VERSION_SETTING_KEY,
  DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY,
  DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY,
  DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY,
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY
} from '../src/constants/app-setting-keys.js';
import { getPreviewPathForAssetKey, getThumbnailPathForAssetKey } from '../src/utils/derivative-paths.js';
import { createFingerprint, getMediaTypeFromExtension, getMimeTypeFromExtension, getPreviewRelativePath, getThumbnailRelativePath } from '../src/utils/image-utils.js';

const {
  generateDerivativesMock,
  generateThumbnailDerivativeMock,
  generatePreviewDerivativeMock,
  readMediaMetadataMock
} = vi.hoisted(() => ({
  generateDerivativesMock: vi.fn(),
  generateThumbnailDerivativeMock: vi.fn(),
  generatePreviewDerivativeMock: vi.fn(),
  readMediaMetadataMock: vi.fn()
}));

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

describe.sequential('quick rescans and selective video previews', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];
  let derivativeMigrationService: typeof import('../src/services/derivative-migration-service.js')['derivativeMigrationService'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-quick-rescan-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DERIVATIVE_MODE', 'eager');
    vi.stubEnv('SCAN_MEDIA_ERROR_MODE', 'skip');
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data',
      GALLERY_ROOT: 'gallery',
      DB_DIR: 'db',
      THUMBNAILS_DIR: 'thumbnails',
      PREVIEWS_DIR: 'previews'
    })) {
      vi.stubEnv(key, path.join(tempRoot, directory));
    }

    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      generatePreviewDerivative: generatePreviewDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    vi.resetModules();
    ({ appConfig } = await import('../src/config/env.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({
      folderRepository,
      imageRepository,
      maintenanceRepository,
      appSettingsRepository
    } = await import('../src/db/repositories.js'));
    ({ derivativeMigrationService } = await import('../src/services/derivative-migration-service.js'));
  });

  beforeEach(async () => {
    generateDerivativesMock.mockReset();
    generateThumbnailDerivativeMock.mockReset();
    generatePreviewDerivativeMock.mockReset();
    readMediaMetadataMock.mockReset();

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

    maintenanceRepository.resetLibraryIndex();
    for (const key of [
      AVIF_METADATA_REPAIR_VERSION_SETTING_KEY,
      DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY,
      DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY,
      DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY,
      LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY
    ]) {
      appSettingsRepository.remove(key);
    }

    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(sourcePath));
      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 5000 : null,
        mediaType,
        playbackStrategy: mediaType === 'video' ? 'original' : 'preview',
        isAnimated: false
      };
    });

    generateDerivativesMock.mockImplementation(async (
      _sourcePath: string,
      relativePath: string,
      _force: boolean,
      overrides: { thumbnailPath?: string; previewPath?: string; videoPreviewPolicy?: 'auto' | 'required' | 'skip' } = {}
    ) => {
      const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
      const thumbnailPath = overrides.thumbnailPath ?? getThumbnailRelativePath(relativePath);
      const previewPath = overrides.previewPath ?? getPreviewRelativePath(relativePath, mediaType);
      const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
      const previewAbsolutePath = path.join(appConfig.previewsDir, previewPath);

      const thumbnailExists = await fs.stat(thumbnailAbsolutePath).then(() => true).catch(() => false);
      const previewExists = await fs.stat(previewAbsolutePath).then(() => true).catch(() => false);
      const shouldWritePreview = overrides.videoPreviewPolicy !== 'skip' && !previewExists;

      if (!thumbnailExists) {
        await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
        await fs.writeFile(thumbnailAbsolutePath, `thumbnail:${relativePath}`);
      }

      if (shouldWritePreview) {
        await fs.mkdir(path.dirname(previewAbsolutePath), { recursive: true });
        await fs.writeFile(previewAbsolutePath, `preview:${relativePath}`);
      }

      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 5000 : null,
        mediaType,
        playbackStrategy: mediaType === 'video' ? 'original' : 'preview',
        isAnimated: false,
        thumbnailPath,
        previewPath,
        generatedThumbnail: !thumbnailExists,
        generatedPreview: shouldWritePreview
      };
    });

    await fs.mkdir(path.join(appConfig.galleryRoot, 'album'), { recursive: true });
    await fs.writeFile(path.join(appConfig.galleryRoot, 'album', 'clip.mp4'), Buffer.alloc(1024));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.doUnmock('../src/services/derivative-service.js');
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function scan(repairUnchangedDerivatives: boolean) {
    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives });
    expect(result?.status).toBe('completed');
    return imageRepository.getByRelativePath('album/clip.mp4')!;
  }

  it('generates a poster but skips a video preview for eligible media during an eager scan', async () => {
    const image = await scan(false);

    expect(generateDerivativesMock).toHaveBeenCalledOnce();
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({
      videoPreviewPolicy: 'skip'
    });
    await expect(fs.stat(path.join(appConfig.thumbnailsDir, image.thumbnail_path))).resolves.toBeDefined();
    await expect(fs.stat(path.join(appConfig.previewsDir, image.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves a missing image preview untouched during a quick scan and restores it during repair', async () => {
    await fs.writeFile(path.join(appConfig.galleryRoot, 'album', 'photo.jpg'), Buffer.alloc(512));
    await scan(false);
    const image = imageRepository.getByRelativePath('album/photo.jpg')!;
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.rm(previewPath);

    generateDerivativesMock.mockClear();
    await scan(false);
    expect(generateDerivativesMock).not.toHaveBeenCalled();
    await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });

    await scan(true);
    await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('preview:album/photo.jpg');
  });

  it('does not queue unchanged derivative work during a second quick scan', async () => {
    const image = await scan(false);
    generateDerivativesMock.mockClear();

    await scan(false);

    expect(generateDerivativesMock).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(appConfig.previewsDir, image.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('switches a changed video back to a generated preview when it no longer qualifies', async () => {
    await scan(false);
    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(sourcePath));
      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 5000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });
    await fs.writeFile(path.join(appConfig.galleryRoot, 'album', 'clip.mp4'), Buffer.alloc(2048));
    generateDerivativesMock.mockClear();

    const image = await scan(false);

    expect(image.playback_strategy).toBe('preview');
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({
      videoPreviewPolicy: 'required'
    });
    await expect(fs.readFile(path.join(appConfig.previewsDir, image.preview_path), 'utf8')).resolves.toBe('preview:album/clip.mp4');
  });

  it.each(['eager', 'lazy'] as const)('invalidates a changed video preview before sharing is enabled in %s mode', async (mode) => {
    const image = await scan(false);
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, 'previous-source-preview');
    await fs.writeFile(path.join(appConfig.galleryRoot, image.relative_path), Buffer.alloc(2048));

    appConfig.derivativeMode = mode;
    try {
      const changed = await scan(false);
      expect(changed.id).toBe(image.id);
      expect(changed.sort_timestamp).toBe(image.sort_timestamp);
      expect(changed.playback_strategy).toBe('original');
      await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });

      const { folderShareService } = await import('../src/services/folder-share-service.js');
      folderShareService.createLink('album', { expiresAt: null });
      appConfig.derivativeMode = 'eager';
      await scan(true);
      await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('preview:album/clip.mp4');
      await scan(true);
      await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('preview:album/clip.mp4');
    } finally {
      appConfig.derivativeMode = 'eager';
    }
  });

  it('completes pending AVIF metadata repair during a quick scan with a matching folder signature', async () => {
    const relativePath = 'album/animation.avif';
    await fs.writeFile(path.join(appConfig.galleryRoot, relativePath), Buffer.alloc(512));
    await scan(false);
    const before = imageRepository.getByRelativePath(relativePath)!;
    expect(before.is_animated).toBe(0);
    appSettingsRepository.remove(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY);
    const originalMetadata = readMediaMetadataMock.getMockImplementation()!;
    readMediaMetadataMock.mockImplementation(async (...args) => ({
      ...await originalMetadata(...args),
      isAnimated: String(args[0]).endsWith('.avif')
    }));
    readMediaMetadataMock.mockClear();
    generateDerivativesMock.mockClear();

    await scan(false);

    const repaired = imageRepository.getByRelativePath(relativePath)!;
    expect(repaired.is_animated).toBe(1);
    expect(repaired.sort_timestamp).toBe(before.sort_timestamp);
    expect(readMediaMetadataMock).toHaveBeenCalledOnce();
    expect(readMediaMetadataMock.mock.calls[0]?.[0]).toBe(path.join(appConfig.galleryRoot, relativePath));
    expect(generateDerivativesMock).not.toHaveBeenCalled();
    expect(appSettingsRepository.get(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY)).toBe('1');
    readMediaMetadataMock.mockClear();
    await scan(true);
    expect(imageRepository.getByRelativePath(relativePath)?.is_animated).toBe(1);
    expect(readMediaMetadataMock).not.toHaveBeenCalled();
  });

  it('keeps AVIF repair pending after a metadata failure and retries it on the next quick scan', async () => {
    const relativePath = 'album/animation.avif';
    await fs.writeFile(path.join(appConfig.galleryRoot, relativePath), Buffer.alloc(512));
    await scan(false);
    appSettingsRepository.remove(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY);
    readMediaMetadataMock.mockRejectedValueOnce(new Error('Metadata unavailable'));

    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    expect(result?.status).toBe('completed_with_errors');
    expect(appSettingsRepository.get(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY)).toBeNull();
    await scan(false);
    expect(appSettingsRepository.get(AVIF_METADATA_REPAIR_VERSION_SETTING_KEY)).toBe('1');
  });

  it.each(['link', 'password'] as const)('retains a preview when a %s share is enabled during source validation', async (kind) => {
    const image = await scan(false);
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, 'shared-preview');
    const { folderShareService } = await import('../src/services/folder-share-service.js');
    const sourcePath = path.join(appConfig.galleryRoot, image.relative_path);
    const originalStat = fs.stat.bind(fs);
    let enabled = false;
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
      const result = await originalStat(...args);
      if (String(args[0]) === sourcePath && !enabled) {
        if (kind === 'link') folderShareService.createLink('album', { expiresAt: null });
        else folderShareService.setPassword('album', 'shared12345');
        enabled = true;
      }
      return result;
    });
    try {
      // Exercise the reclamation phase directly to interleave configuration
      // changes after its batched share snapshot and before removal.
      const reclaimer = scannerService as unknown as {
        reclaimObsoleteVideoPreviews(errors: { add: ReturnType<typeof vi.fn> }): Promise<number>;
      };
      expect(await reclaimer.reclaimObsoleteVideoPreviews({ add: vi.fn() })).toBe(0);
      expect(enabled).toBe(true);
      await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('shared-preview');
    } finally {
      statSpy.mockRestore();
    }
  });

  it('leaves an obsolete preview alone during quick scans but reclaims it during repair', async () => {
    const image = await scan(false);
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, 'stale-preview');

    await scan(false);
    await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('stale-preview');

    generateDerivativesMock.mockClear();
    await scan(true);
    expect(generateDerivativesMock).toHaveBeenCalledOnce();
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({
      videoPreviewPolicy: 'skip'
    });
    await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(appConfig.thumbnailsDir, image.thumbnail_path))).resolves.toBeDefined();
  });

  it('reports preview removal failures without deleting unrelated data and retries later', async () => {
    const image = await scan(false);
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.mkdir(previewPath);

    const failedScan = await scannerService.scanAll('manual', { repairUnchangedDerivatives: true });

    expect(failedScan?.status).toBe('completed_with_errors');
    expect(failedScan?.error_text).toContain('Unable to remove obsolete video preview');
    await expect(fs.stat(previewPath)).resolves.toBeDefined();

    await fs.rmdir(previewPath);
    const retryScan = await scannerService.scanAll('manual', { repairUnchangedDerivatives: true });
    expect(retryScan?.status).toBe('completed');
    await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not restore a preview on later quick or repair scans after reclamation', async () => {
    const image = await scan(false);
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, 'stale-preview');
    await scan(true);
    await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });

    generateDerivativesMock.mockClear();
    await scan(true);
    await scan(false);

    await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const previewWrites = generateDerivativesMock.mock.results
      .filter((result) => result.type === 'return')
      .some((result) => result.value && typeof result.value === 'object' && 'generatedPreview' in result.value && result.value.generatedPreview);
    expect(previewWrites).toBe(false);
    await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains an eligible preview while a folder share is active and reclaims it after revocation', async () => {
    const image = await scan(false);
    const { folderShareService } = await import('../src/services/folder-share-service.js');
    const link = folderShareService.createLink('album', { expiresAt: null })!;
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, 'shared-preview');

    generateDerivativesMock.mockClear();
    await scan(true);
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({
      videoPreviewPolicy: 'required'
    });
    await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('shared-preview');

    folderShareService.revokeLink('album', link.link.id);
    await scan(true);
    await expect(fs.stat(previewPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not count an intentionally absent normal video preview as a migration gap', async () => {
    const folder = folderRepository.upsert({ slug: 'migration-video', name: 'Migration Video', folderPath: 'migration-video' });
    const relativePath = 'migration-video/clip.mp4';
    const sourcePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.alloc(1024));
    const sourceStats = await fs.stat(sourcePath);
    const assetKey = '00112233445566778899aabbccddeeff';
    const thumbnailPath = getThumbnailPathForAssetKey(assetKey);
    const previewPath = getPreviewPathForAssetKey(assetKey, 'video');
    const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
    await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
    await fs.writeFile(thumbnailAbsolutePath, 'poster');

    imageRepository.upsert({
      folderId: folder.id,
      assetKey,
      filename: 'clip.mp4',
      extension: '.mp4',
      relativePath,
      absolutePath: sourcePath,
      fileSize: sourceStats.size,
      width: 1080,
      height: 1920,
      mediaType: 'video',
      mimeType: getMimeTypeFromExtension('.mp4'),
      durationMs: 5000,
      playbackStrategy: 'original',
      fingerprint: createFingerprint(relativePath, sourceStats.size, sourceStats.mtimeMs),
      mtimeMs: sourceStats.mtimeMs,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: sourceStats.mtimeMs,
      takenAt: sourceStats.mtimeMs,
      takenAtSource: 'mtime',
      exifJson: null,
      thumbnailPath,
      previewPath
    });

    const summary = await derivativeMigrationService.ensureMigrated({
      sharedPreviewFolderIds: new Set()
    });

    expect(summary.missingFiles).toBe(0);
    expect(generateDerivativesMock).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(appConfig.previewsDir, previewPath))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps migration repair focused on a required shared preview for eligible videos', async () => {
    const folder = folderRepository.upsert({ slug: 'migration-share', name: 'Migration Share', folderPath: 'migration-share' });
    const relativePath = 'migration-share/clip.mp4';
    const sourcePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.writeFile(sourcePath, Buffer.alloc(1024));
    const sourceStats = await fs.stat(sourcePath);
    const assetKey = 'ffeeddccbbaa00998877665544332211';
    const thumbnailPath = getThumbnailPathForAssetKey(assetKey);
    const previewPath = getPreviewPathForAssetKey(assetKey, 'video');
    const thumbnailAbsolutePath = path.join(appConfig.thumbnailsDir, thumbnailPath);
    await fs.mkdir(path.dirname(thumbnailAbsolutePath), { recursive: true });
    await fs.writeFile(thumbnailAbsolutePath, 'poster');

    imageRepository.upsert({
      folderId: folder.id,
      assetKey,
      filename: 'clip.mp4',
      extension: '.mp4',
      relativePath,
      absolutePath: sourcePath,
      fileSize: sourceStats.size,
      width: 1080,
      height: 1920,
      mediaType: 'video',
      mimeType: getMimeTypeFromExtension('.mp4'),
      durationMs: 5000,
      playbackStrategy: 'original',
      fingerprint: createFingerprint(relativePath, sourceStats.size, sourceStats.mtimeMs),
      mtimeMs: sourceStats.mtimeMs,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: sourceStats.mtimeMs,
      takenAt: sourceStats.mtimeMs,
      takenAtSource: 'mtime',
      exifJson: null,
      thumbnailPath,
      previewPath
    });

    await derivativeMigrationService.ensureMigrated({
      sharedPreviewFolderIds: new Set([folder.id])
    });

    expect(generateDerivativesMock).toHaveBeenCalledOnce();
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({
      videoPreviewPolicy: 'required'
    });
    await expect(fs.readFile(path.join(appConfig.previewsDir, previewPath), 'utf8')).resolves.toBe('preview:migration-share/clip.mp4');
  });

  it('treats carousel source folders as shared when their owner folder is shared', async () => {
    const ownerFolder = folderRepository.upsert({ slug: 'shared-owner', name: 'Shared Owner', folderPath: 'shared-owner' });
    const sourceFolder = folderRepository.upsert({
      slug: 'shared-owner-carousel',
      name: 'Trip',
      folderPath: 'shared-owner/carousels/trip',
      role: 'carousel_source',
      carouselOwnerFolderId: ownerFolder.id
    });
    const { folderShareService } = await import('../src/services/folder-share-service.js');
    const link = folderShareService.createLink(ownerFolder.slug, { expiresAt: null })!;
    const { listFolderIdsRequiringSharedPreviews } = await import('../src/db/repositories.js');

    expect(listFolderIdsRequiringSharedPreviews().has(sourceFolder.id)).toBe(true);

    folderShareService.revokeLink(ownerFolder.slug, link.link.id);
    expect(listFolderIdsRequiringSharedPreviews().has(sourceFolder.id)).toBe(false);
  });

  it('creates a required shared preview during eager scanning when a share exists before indexing', async () => {
    maintenanceRepository.resetLibraryIndex();
    const folder = folderRepository.upsert({
      slug: 'album',
      name: 'album',
      folderPath: 'album'
    });
    const { folderShareService } = await import('../src/services/folder-share-service.js');
    folderShareService.createLink(folder.slug, { expiresAt: null });

    await scan(false);

    expect(generateDerivativesMock).toHaveBeenCalledOnce();
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({
      videoPreviewPolicy: 'required'
    });
  });
});
