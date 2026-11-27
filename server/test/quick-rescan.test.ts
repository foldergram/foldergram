import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AVIF_METADATA_REPAIR_VERSION_SETTING_KEY,
  CAROUSELS_APPLIED_MODE_SETTING_KEY,
  CAROUSELS_MIGRATION_DECISION_SETTING_KEY,
  DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY,
  DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY,
  DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY,
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
  TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY
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
      CAROUSELS_APPLIED_MODE_SETTING_KEY,
      CAROUSELS_MIGRATION_DECISION_SETTING_KEY,
      DERIVATIVE_STORAGE_LAYOUT_VERSION_SETTING_KEY,
      DERIVATIVE_STORAGE_MIGRATION_COMPLETE_AT_SETTING_KEY,
      DERIVATIVE_STORAGE_MIGRATION_CURSOR_SETTING_KEY,
      LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
      TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY
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

  afterEach(() => {
    vi.restoreAllMocks();
    appConfig.scanMediaErrorMode = 'skip';
    appConfig.derivativeMode = 'eager';
  });

  function failReadingDirectory(relativePath: string) {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const readdir = fs.readdir.bind(fs);
    return vi.spyOn(fs, 'readdir').mockImplementation((...args) => {
      if (String(args[0]) === absolutePath) {
        return Promise.reject(Object.assign(new Error(`EIO: i/o error, scandir '${absolutePath}'`), {
          code: 'EIO', syscall: 'scandir', path: absolutePath
        }));
      }
      return readdir(...args);
    });
  }

  async function writeMedia(relativePath: string, content = relativePath): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }

  async function scan(repairUnchangedDerivatives: boolean) {
    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives });
    expect(result?.status).toBe('completed');
    return imageRepository.getByRelativePath('album/clip.mp4')!;
  }

  it('reconciles moves and generates posters outside an unreadable subtree without deleting its index', async () => {
    const { likeRepository, folderScanStateRepository } = await import('../src/db/repositories.js');
    for (const [relativePath, size] of [
      ['incoming/moved.mp4', 2048], ['broken/deep/keep.jpg', 512], ['album/removed.jpg', 256]
    ] as const) {
      await fs.mkdir(path.dirname(path.join(appConfig.galleryRoot, relativePath)), { recursive: true });
      await fs.writeFile(path.join(appConfig.galleryRoot, relativePath), Buffer.alloc(size));
    }
    await scan(false);
    const movedBefore = imageRepository.getByRelativePath('incoming/moved.mp4')!;
    const protectedBefore = imageRepository.getByRelativePath('broken/deep/keep.jpg')!;
    const protectedFolder = folderRepository.getAll().find(folder => folder.id === protectedBefore.folder_id)!;
    const protectedState = folderScanStateRepository.getAll().find(state => state.folder_path === protectedFolder.folder_path);
    likeRepository.upsert(movedBefore.id);
    await fs.rename(path.join(appConfig.galleryRoot, movedBefore.relative_path), path.join(appConfig.galleryRoot, 'album/moved.mp4'));
    await fs.rm(path.join(appConfig.galleryRoot, 'incoming'), { recursive: true });
    await fs.rm(path.join(appConfig.galleryRoot, 'album/removed.jpg'));
    await fs.rm(path.join(appConfig.galleryRoot, protectedBefore.relative_path));
    await fs.mkdir(path.join(appConfig.galleryRoot, 'z-new'));
    await fs.writeFile(path.join(appConfig.galleryRoot, 'z-new/new.mp4'), Buffer.alloc(4096));
    generateDerivativesMock.mockClear();
    const failure = failReadingDirectory('broken');

    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });

    expect(result?.status).toBe('completed_with_errors');
    expect(result?.error_text).toContain('EIO');
    expect(result?.error_text).toContain('broken');
    expect(result?.removed_files).toBe(1);
    const moved = imageRepository.getByRelativePath('album/moved.mp4')!;
    expect(moved).toMatchObject({ id: movedBefore.id, asset_key: movedBefore.asset_key, sort_timestamp: movedBefore.sort_timestamp });
    expect(imageRepository.getByRelativePath(movedBefore.relative_path)).toBeUndefined();
    expect(likeRepository.getByImageId(moved.id)).toBeDefined();
    expect(imageRepository.getByRelativePath(protectedBefore.relative_path)?.is_deleted).toBe(0);
    expect(folderRepository.getAll().find(folder => folder.id === protectedFolder.id)?.avatar_image_id).toBe(protectedFolder.avatar_image_id);
    expect(folderScanStateRepository.getAll().find(state => state.folder_path === protectedFolder.folder_path)).toEqual(protectedState);
    const added = imageRepository.getByRelativePath('z-new/new.mp4')!;
    await expect(fs.readFile(path.join(appConfig.thumbnailsDir, added.thumbnail_path), 'utf8')).resolves.toBe('thumbnail:z-new/new.mp4');

    failure.mockRestore();
    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('completed');
    expect(imageRepository.getByRelativePath(protectedBefore.relative_path)?.is_deleted).toBe(1);
  });

  it.each(['stories/trip/nested', 'carousels/trip'])('preserves reserved media when %s cannot be read', async (unreadable) => {
    const { postRepository } = await import('../src/db/repositories.js');
    const reservedPath = `album/${unreadable}/keep.jpg`;
    await fs.mkdir(path.dirname(path.join(appConfig.galleryRoot, reservedPath)), { recursive: true });
    await fs.writeFile(path.join(appConfig.galleryRoot, reservedPath), 'reserved');
    await scan(false);
    const before = imageRepository.getByRelativePath(reservedPath)!;
    const postBefore = postRepository.findByImageId(before.id);
    const albumBefore = folderRepository.getAll().find(folder => folder.folder_path === 'album')!;
    await fs.rm(path.join(appConfig.galleryRoot, reservedPath));
    failReadingDirectory(`album/${unreadable}`);

    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });

    expect(result?.status).toBe('completed_with_errors');
    expect(imageRepository.getByRelativePath(reservedPath)).toMatchObject({ id: before.id, is_deleted: 0 });
    expect(postRepository.findByImageId(before.id)).toEqual(postBefore);
    expect(folderRepository.getAll().find(folder => folder.id === albumBefore.id)?.avatar_image_id).toBe(albumBefore.avatar_image_id);
  });

  it('repairs posters left by an aborted discovery even when a different subtree is still unreadable', async () => {
    await scan(false);
    await fs.mkdir(path.join(appConfig.galleryRoot, 'z-broken'));
    await fs.writeFile(path.join(appConfig.galleryRoot, 'album/new.mp4'), Buffer.alloc(2048));
    appConfig.scanMediaErrorMode = 'fail';
    failReadingDirectory('z-broken');
    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('failed');
    const partial = imageRepository.getByRelativePath('album/new.mp4')!;
    expect(partial).toBeDefined();
    await expect(fs.stat(path.join(appConfig.thumbnailsDir, partial.thumbnail_path))).rejects.toMatchObject({ code: 'ENOENT' });
    appConfig.scanMediaErrorMode = 'skip';

    const recovered = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });

    expect(recovered?.status).toBe('completed_with_errors');
    expect(imageRepository.getByRelativePath(partial.relative_path)?.id).toBe(partial.id);
    await expect(fs.readFile(path.join(appConfig.thumbnailsDir, partial.thumbnail_path), 'utf8')).resolves.toBe('thumbnail:album/new.mp4');
  });

  it('preserves unreadable carousel posts during a switch to normal folders', async () => {
    const { TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY } = await import('../src/constants/app-setting-keys.js');
    const { postRepository } = await import('../src/db/repositories.js');
    const relativePath = 'album/carousels/trip/keep.jpg';
    await fs.mkdir(path.dirname(path.join(appConfig.galleryRoot, relativePath)), { recursive: true });
    await fs.writeFile(path.join(appConfig.galleryRoot, relativePath), 'carousel');
    await scan(false);
    const image = imageRepository.getByRelativePath(relativePath)!;
    const post = postRepository.findByImageId(image.id)!;
    const failure = failReadingDirectory('album/carousels/trip');
    appSettingsRepository.set(TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY, '1');
    try {
      expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('completed_with_errors');
      expect(postRepository.findByImageId(image.id)).toEqual(post);
      expect(imageRepository.getByRelativePath(relativePath)?.is_deleted).toBe(0);
    } finally {
      failure.mockRestore();
      appSettingsRepository.remove(TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY);
    }
  });

  it.each(['later-sibling', 'destination'])('keeps split carousel history through an unreadable %s and recovery', async (failedScope) => {
    const { postRepository, likeRepository, collectionRepository } = await import('../src/db/repositories.js');
    const original = 'album/carousels/original';
    const renamed = 'album/carousels/a-renamed';
    const destination = 'z-other/carousels/new';
    for (let index = 1; index <= 3; index++) await writeMedia(`${original}/${index}.jpg`);
    await scan(false);
    const post = postRepository.findBySourcePath(original)!;
    const originalIds = postRepository.listImageRecords(post.id).map(image => image.id);
    postRepository.updateCaption(post.id, 'Original history');
    likeRepository.upsert(post.id);
    const collection = collectionRepository.create(`Original collection ${failedScope}`);
    collectionRepository.addItem(collection.id, post.id);
    await fs.rename(path.join(appConfig.galleryRoot, original), path.join(appConfig.galleryRoot, renamed));
    await writeMedia(`${destination}/new.jpg`);
    await fs.rename(path.join(appConfig.galleryRoot, renamed, '1.jpg'), path.join(appConfig.galleryRoot, destination, '1.jpg'));
    await fs.mkdir(path.join(appConfig.galleryRoot, 'album/carousels/z-broken'));
    const failure = failReadingDirectory(failedScope === 'destination' ? renamed : 'album/carousels/z-broken');

    const assertHistory = () => {
      expect(postRepository.findById(post.id)).toMatchObject({ source_path: original, caption: 'Original history', is_deleted: 0 });
      expect(postRepository.listImageRecords(post.id).map(image => image.id)).toEqual(originalIds);
      expect(likeRepository.getByImageId(post.id)).toBeDefined();
      expect(collectionRepository.listCollectionImages(collection.slug, 1, 10).map(image => image.id)).toContain(post.id);
    };
    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    expect(result?.status).toBe(failedScope === 'destination' ? 'completed_with_errors' : 'failed');
    if (failedScope === 'later-sibling') expect(result?.error_text).toContain('multiple carousel destinations');
    assertHistory();
    failure.mockRestore();
    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('failed');
    assertHistory();
  });

  it('defers carousel history transfers until all directories can be discovered', async () => {
    const { postRepository, likeRepository } = await import('../src/db/repositories.js');
    const original = 'album/carousels/original';
    const destination = 'album/carousels/renamed';
    for (let index = 1; index <= 3; index++) await writeMedia(`${original}/${index}.jpg`);
    await scan(false);
    const post = postRepository.findBySourcePath(original)!;
    const originalIds = postRepository.listImageRecords(post.id).map(image => image.id);
    postRepository.updateCaption(post.id, 'Keep history');
    likeRepository.upsert(post.id);
    await fs.rename(path.join(appConfig.galleryRoot, original), path.join(appConfig.galleryRoot, destination));
    await fs.mkdir(path.join(appConfig.galleryRoot, 'z-broken'));
    const failure = failReadingDirectory('z-broken');
    await writeMedia('album/added.jpg');

    const partial = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    expect(partial?.status).toBe('completed_with_errors');
    expect(postRepository.findById(post.id)).toMatchObject({ source_path: original, caption: 'Keep history', is_deleted: 0 });
    expect(postRepository.listImageRecords(post.id).map(image => image.id)).toEqual(originalIds);
    const added = imageRepository.getByRelativePath('album/added.jpg')!;
    await expect(fs.stat(path.join(appConfig.thumbnailsDir, added.thumbnail_path))).resolves.toBeDefined();
    failure.mockRestore();

    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('completed');
    expect(postRepository.findById(post.id)).toMatchObject({ source_path: destination, caption: 'Keep history', is_deleted: 0 });
    expect(postRepository.listImageRecords(post.id).map(image => image.id)).toEqual(originalIds);
    expect(likeRepository.getByImageId(post.id)).toBeDefined();
  });

  it.each(['eager', 'lazy'].flatMap(mode =>
    ['removed-folder', 'retained-folder', 'removed-sibling'].map(origin => [mode, origin] as const)
  ))('keeps a deferred normal post visible in %s mode with a %s origin', async (mode, origin) => {
    const { postRepository, likeRepository, collectionRepository } = await import('../src/db/repositories.js');
    appConfig.derivativeMode = mode as 'eager' | 'lazy';
    const source = 'incoming/keep.jpg';
    const destination = 'z-owner/carousels/trip/keep.jpg';
    await writeMedia(source);
    if (origin === 'retained-folder') await writeMedia('incoming/other.jpg');
    if (origin === 'removed-sibling') await writeMedia('incoming/removed.jpg');
    await scan(false);
    const before = imageRepository.getByRelativePath(source)!;
    const post = postRepository.findByImageId(before.id)!;
    postRepository.updateCaption(post.id, 'Keep normal history');
    likeRepository.upsert(post.id);
    const collection = collectionRepository.create(`Normal history ${mode} ${origin}`);
    collectionRepository.addItem(collection.id, post.id);
    await fs.mkdir(path.dirname(path.join(appConfig.galleryRoot, destination)), { recursive: true });
    await fs.rename(path.join(appConfig.galleryRoot, source), path.join(appConfig.galleryRoot, destination));
    if (origin === 'removed-sibling') await fs.rm(path.join(appConfig.galleryRoot, 'incoming/removed.jpg'));
    if (origin !== 'retained-folder') await fs.rmdir(path.join(appConfig.galleryRoot, 'incoming'));
    await fs.mkdir(path.join(appConfig.galleryRoot, 'zz-broken'));
    const failure = failReadingDirectory('zz-broken');

    const assertVisibleHistory = (sourcePath: string, folderId: number) => {
      expect(postRepository.findById(post.id)).toMatchObject({
        source_path: sourcePath, folder_id: folderId, caption: 'Keep normal history',
        is_deleted: 0, sort_timestamp: post.sort_timestamp
      });
      expect(postRepository.listImageRecords(post.id).map(image => image.id)).toEqual([before.id]);
      expect(likeRepository.getByImageId(post.id)).toBeDefined();
      expect(postRepository.listFeed(1, 100).map(item => item.id)).toContain(post.id);
      expect(collectionRepository.listCollectionImages(collection.slug, 1, 10).map(item => item.id)).toEqual([post.id]);
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
      expect(result?.status).toBe('completed_with_errors');
      assertVisibleHistory(source, post.folder_id);
      expect(imageRepository.getByRelativePath(destination)).toMatchObject({ id: before.id, is_deleted: 0 });
      if (origin === 'retained-folder') expect(imageRepository.getByRelativePath('incoming/other.jpg')?.is_deleted).toBe(0);
      if (origin === 'removed-sibling') {
        expect(imageRepository.getByRelativePath('incoming/removed.jpg')?.is_deleted).toBe(1);
        expect(result?.removed_files).toBe(attempt === 0 ? 1 : 0);
      }
    }
    failure.mockRestore();

    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('completed');
    const targetOwner = folderRepository.getAll().find(folder => folder.folder_path === 'z-owner')!;
    assertVisibleHistory('z-owner/carousels/trip', targetOwner.id);
    expect(folderRepository.getAllSummaries().some(folder => folder.folder_path === 'incoming')).toBe(origin === 'retained-folder');
  });

  it.each(['stories', 'carousels'])('finishes readable %s siblings, including additions and removals', async (kind) => {
    const { postRepository } = await import('../src/db/repositories.js');
    const prefix = `album/${kind}`;
    for (const relativePath of [
      `${prefix}/a-readable/keep.jpg`, `${prefix}/a-readable/remove.jpg`,
      `${prefix}/b-broken/keep.jpg`, `${prefix}/c-removed/old.jpg`
    ]) await writeMedia(relativePath);
    await scan(false);
    const readableImage = imageRepository.getByRelativePath(`${prefix}/a-readable/keep.jpg`)!;
    const previousPost = postRepository.findByImageId(readableImage.id);
    const protectedImage = imageRepository.getByRelativePath(`${prefix}/b-broken/keep.jpg`)!;
    const protectedPost = postRepository.findByImageId(protectedImage.id);
    await fs.rm(path.join(appConfig.galleryRoot, `${prefix}/a-readable/remove.jpg`));
    await fs.rm(path.join(appConfig.galleryRoot, `${prefix}/c-removed`), { recursive: true });
    await writeMedia(`${prefix}/a-readable/added.jpg`);
    await writeMedia(`${prefix}/z-new/new.jpg`);
    failReadingDirectory(`${prefix}/b-broken`);

    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    expect(result?.status).toBe('completed_with_errors');
    expect(result?.scanned_files).toBe(4);
    expect(result?.new_files).toBe(2);
    expect(result?.removed_files).toBe(2);
    expect(result?.error_text).toContain(`Indexed content in ${prefix}/b-broken was preserved`);
    expect(imageRepository.getByRelativePath(`${prefix}/a-readable/remove.jpg`)?.is_deleted).toBe(1);
    expect(imageRepository.getByRelativePath(`${prefix}/c-removed/old.jpg`)?.is_deleted).toBe(1);
    expect(imageRepository.getByRelativePath(protectedImage.relative_path)?.is_deleted).toBe(0);
    expect(postRepository.findByImageId(protectedImage.id)).toEqual(protectedPost);
    const added = imageRepository.getByRelativePath(`${prefix}/a-readable/added.jpg`)!;
    const newSibling = imageRepository.getByRelativePath(`${prefix}/z-new/new.jpg`)!;
    for (const image of [added, newSibling]) {
      await expect(fs.stat(path.join(appConfig.thumbnailsDir, image.thumbnail_path))).resolves.toBeDefined();
    }
    if (kind === 'carousels') {
      const updatedPost = postRepository.findBySourcePath(`${prefix}/a-readable`)!;
      expect(updatedPost.id).toBe(previousPost?.id);
      expect(postRepository.listImageRecords(updatedPost.id).map(image => image.id).sort()).toEqual([readableImage.id, added.id].sort());
      expect(postRepository.findBySourcePath(`${prefix}/z-new`)?.is_deleted).toBe(0);
    }
  });

  it.each(['stories', 'carousels'])('continues the other reserved tree when the %s root is unreadable', async (unreadable) => {
    const { postRepository } = await import('../src/db/repositories.js');
    for (const kind of ['stories', 'carousels']) await writeMedia(`album/${kind}/existing/keep.jpg`);
    await scan(false);
    const protectedImage = imageRepository.getByRelativePath(`album/${unreadable}/existing/keep.jpg`)!;
    const protectedPost = postRepository.findByImageId(protectedImage.id);
    const readable = unreadable === 'stories' ? 'carousels' : 'stories';
    const addedPath = `album/${readable}/new/added.jpg`;
    await writeMedia(addedPath);
    failReadingDirectory(`album/${unreadable}`);

    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('completed_with_errors');
    expect(imageRepository.getByRelativePath(addedPath)?.is_deleted).toBe(0);
    expect(imageRepository.getByRelativePath(protectedImage.relative_path)?.is_deleted).toBe(0);
    expect(postRepository.findByImageId(protectedImage.id)).toEqual(protectedPost);
  });

  it.each([false, true])('preserves an unreadable carousel owner while reconciling missing direct media=%s', async (removeDirectMedia) => {
    const { postRepository } = await import('../src/db/repositories.js');
    const relativePath = 'z-owner/carousels/trip/keep.jpg';
    await writeMedia(relativePath);
    if (removeDirectMedia) await writeMedia('z-owner/removed.jpg');
    await scan(false);
    const image = imageRepository.getByRelativePath(relativePath)!;
    const post = postRepository.findByImageId(image.id)!;
    const owner = folderRepository.getAll().find(folder => folder.id === post.folder_id)!;
    if (removeDirectMedia) await fs.rm(path.join(appConfig.galleryRoot, 'z-owner/removed.jpg'));
    failReadingDirectory('z-owner/carousels/trip');

    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('completed_with_errors');
    expect(postRepository.findById(post.id)).toEqual(post);
    expect(imageRepository.getByRelativePath(relativePath)?.is_deleted).toBe(0);
    if (removeDirectMedia) expect(imageRepository.getByRelativePath('z-owner/removed.jpg')?.is_deleted).toBe(1);
    else expect(folderRepository.getAll().find(folder => folder.id === owner.id)?.avatar_image_id).toBe(owner.avatar_image_id);
  });

  it.each([false, true])('keeps an incomplete carousel mode transition pending from normal folders=%s', async (initialMode) => {
    const { galleryService } = await import('../src/services/gallery-service.js');
    const selectedMode = !initialMode;
    const relativePath = 'album/carousels/trip/keep.jpg';
    appSettingsRepository.set(TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY, initialMode ? '1' : '0');
    appSettingsRepository.set(CAROUSELS_MIGRATION_DECISION_SETTING_KEY, initialMode ? 'restore' : 'carousels');
    await writeMedia(relativePath);
    await scan(false);
    const previousRole = folderRepository.getAll().find(folder => folder.folder_path === 'album/carousels/trip')?.role;
    expect(appSettingsRepository.get(CAROUSELS_APPLIED_MODE_SETTING_KEY)).toBe(initialMode ? '1' : '0');
    appSettingsRepository.set(TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY, selectedMode ? '1' : '0');
    const failure = failReadingDirectory('album/carousels/trip');

    const partial = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    expect(partial?.status).toBe('completed_with_errors');
    expect(folderRepository.getAll().find(folder => folder.folder_path === 'album/carousels/trip')?.role).toBe(previousRole);
    expect(appSettingsRepository.get(CAROUSELS_APPLIED_MODE_SETTING_KEY)).toBe(initialMode ? '1' : '0');
    expect(galleryService.getStatus().carouselsMigration.reconciliationPending).toBe(true);
    failure.mockRestore();

    expect((await scannerService.scanAll('manual', { repairUnchangedDerivatives: false }))?.status).toBe('completed');
    expect(appSettingsRepository.get(CAROUSELS_APPLIED_MODE_SETTING_KEY)).toBe(selectedMode ? '1' : '0');
    expect(galleryService.getStatus().carouselsMigration.reconciliationPending).toBe(false);
    expect(folderRepository.getAll().find(folder => folder.folder_path === 'album/carousels/trip')?.role).toBe(selectedMode ? 'normal' : 'carousel_source');
  });

  it.each(['root', 'strict'] as const)('aborts a %s directory failure without applying removals', async (mode) => {
    const before = await scan(false);
    await fs.rm(path.join(appConfig.galleryRoot, before.relative_path));
    if (mode === 'strict') appConfig.scanMediaErrorMode = 'fail';
    failReadingDirectory(mode === 'root' ? '' : 'album');

    const result = await scannerService.scanAll('manual', { repairUnchangedDerivatives: false });

    expect(result?.status).toBe('failed');
    expect(result?.error_text).toContain('EIO');
    expect(imageRepository.getByRelativePath(before.relative_path)?.is_deleted).toBe(0);
  });

  it('drains discovery before pausing and preserves unvisited content when cancelled', async () => {
    await fs.mkdir(path.join(appConfig.galleryRoot, 'later'));
    await fs.writeFile(path.join(appConfig.galleryRoot, 'later/keep.jpg'), 'original');
    await scan(false);
    const unvisited = imageRepository.getByRelativePath('later/keep.jpg')!;
    await fs.writeFile(path.join(appConfig.galleryRoot, 'album/new.jpg'), 'new');
    await fs.rm(path.join(appConfig.galleryRoot, 'later/keep.jpg'));

    const originalMetadata = readMediaMetadataMock.getMockImplementation()!;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    readMediaMetadataMock.mockImplementation(async (sourcePath: string) => {
      if (path.basename(sourcePath) === 'new.jpg') {
        entered.resolve();
        await release.promise;
      }
      return originalMetadata(sourcePath);
    });

    const pending = scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    await entered.promise;
    const operation = scannerService.getProgress().operation!;
    const { maintenanceOperationLock } = await import('../src/services/maintenance-operation-lock.js');
    const conflicting = maintenanceOperationLock.runExclusive(async () => 'mutation');
    const conflictResult = expect(conflicting).rejects.toMatchObject({ status: 409 });
    try {
      expect(scannerService.controlOperation(operation.id, 'pause').state).toBe('pausing');
      expect(scannerService.controlOperation(operation.id, 'pause').state).toBe('pausing');
      await conflictResult;
      expect(scannerService.getProgress().phase).toBe('discovery');
      release.resolve();
      await vi.waitFor(() => expect(scannerService.getProgress().operation?.state).toBe('paused'));
      expect(scannerService.getProgress().isScanning).toBe(true);
      expect(scannerService.controlOperation(operation.id, 'cancel').state).toBe('cancelling');
      const result = await pending;
      expect(result?.status).toBe('cancelled');
      expect(scannerService.controlOperation(operation.id, 'cancel').state).toBe('cancelled');
      expect(imageRepository.getByRelativePath(unvisited.relative_path)?.is_deleted).toBe(0);
      await expect(maintenanceOperationLock.runExclusive(async () => 'ready')).resolves.toBe('ready');
    } finally {
      release.resolve();
      if (scannerService.getProgress().operation?.controls.includes('cancel')) scannerService.controlOperation(operation.id, 'cancel');
      await pending;
    }
  });

  it('resumes the same derivative run and repairs unstarted outputs after cancellation', async () => {
    // Establish the library layout so the gate is on ordinary derivative work.
    await scan(false);
    generateDerivativesMock.mockClear();
    for (let index = 0; index < appConfig.scanDerivativeConcurrency + 3; index++) {
      await fs.writeFile(path.join(appConfig.galleryRoot, `album/photo-${index}.jpg`), 'photo');
    }

    const generate = generateDerivativesMock.getMockImplementation()!;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const resumed = Promise.withResolvers<void>();
    const settleResumed = Promise.withResolvers<void>();
    const admitted = appConfig.scanDerivativeConcurrency;
    let calls = 0;

    generateDerivativesMock.mockImplementation(async (...args: unknown[]) => {
      calls++;
      if (calls <= admitted) {
        if (calls === admitted) entered.resolve();
        await release.promise;
      } else {
        resumed.resolve();
        await settleResumed.promise;
      }
      return generate(...args);
    });
    const pending = scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    await entered.promise;
    const { operation, runId } = scannerService.getProgress();
    try {
      expect(scannerService.getProgress().phase).toBe('derivatives');
      expect(scannerService.controlOperation(operation!.id, 'pause').state).toBe('pausing');
      release.resolve();
      await vi.waitFor(() => expect(scannerService.getProgress().operation?.state).toBe('paused'));
      expect(generateDerivativesMock).toHaveBeenCalledTimes(admitted);
      expect(scannerService.controlOperation(operation!.id, 'resume').state).toBe('running');
      await resumed.promise;
      expect(scannerService.getProgress()).toMatchObject({ operation: { id: operation!.id }, runId });
      expect(scannerService.controlOperation(operation!.id, 'cancel').state).toBe('cancelling');
      settleResumed.resolve();
      expect((await pending)?.status).toBe('cancelled');
    } finally {
      release.resolve();
      settleResumed.resolve();
      if (scannerService.getProgress().operation?.controls.includes('cancel')) scannerService.controlOperation(operation!.id, 'cancel');
      await pending;
    }

    // Add a second wave with enough jobs that cancellation leaves a pending output.
    for (let index = 0; index < admitted + 2; index++) {
      await fs.writeFile(path.join(appConfig.galleryRoot, `album/extra-${index}.jpg`), 'extra');
    }
    const blocked = Promise.withResolvers<void>();
    const unblock = Promise.withResolvers<void>();
    generateDerivativesMock.mockImplementation(async (...args: unknown[]) => {
      blocked.resolve();
      await unblock.promise;
      return generate(...args);
    });
    const interrupted = scannerService.scanAll('manual', { repairUnchangedDerivatives: false });
    await blocked.promise;
    const secondOperation = scannerService.getProgress().operation!;
    try {
      expect(() => scannerService.controlOperation(operation!.id, 'cancel')).toThrow(/no longer current/);
      scannerService.controlOperation(secondOperation.id, 'cancel');
      unblock.resolve();
      expect((await interrupted)?.status).toBe('cancelled');
    } finally {
      unblock.resolve();
      await interrupted;
    }
    generateDerivativesMock.mockImplementation(generate);
    await scan(false);
    const repaired = imageRepository.getByRelativePath(`album/extra-${admitted + 1}.jpg`)!;
    await expect(fs.stat(path.join(appConfig.thumbnailsDir, repaired.thumbnail_path))).resolves.toBeDefined();
  });

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

  it('preserves existing video previews during quick scans, repairs, and share revocation', async () => {
    const image = await scan(false);
    const { folderShareService } = await import('../src/services/folder-share-service.js');
    const link = folderShareService.createLink('album', { expiresAt: null })!;
    const previewPath = path.join(appConfig.previewsDir, image.preview_path);
    await fs.mkdir(path.dirname(previewPath), { recursive: true });
    await fs.writeFile(previewPath, 'existing-preview');

    await scan(false);
    await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('existing-preview');

    generateDerivativesMock.mockClear();
    await scan(true);
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({ videoPreviewPolicy: 'required' });
    await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('existing-preview');

    folderShareService.revokeLink('album', link.link.id);
    generateDerivativesMock.mockClear();
    await scan(true);
    expect(generateDerivativesMock.mock.calls[0]?.[3]).toMatchObject({ videoPreviewPolicy: 'skip' });
    await expect(fs.readFile(previewPath, 'utf8')).resolves.toBe('existing-preview');
    await expect(fs.stat(path.join(appConfig.thumbnailsDir, image.thumbnail_path))).resolves.toBeDefined();
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
