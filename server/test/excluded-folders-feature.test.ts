import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('excluded folders feature', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let postRepository: RepositoriesModule['postRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-excluded-folders-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
    vi.stubEnv('GALLERY_EXCLUDED_FOLDERS', '');
  });

  beforeEach(async () => {
    generateThumbnailDerivativeMock.mockReset();
    generateDerivativesMock.mockReset();
    readMediaMetadataMock.mockReset();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
    vi.stubEnv('GALLERY_EXCLUDED_FOLDERS', '');
    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository, maintenanceRepository, postRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (absolutePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(absolutePath));
      return {
        width: mediaType === 'video' ? 1080 : 1600,
        height: mediaType === 'video' ? 1920 : 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 4_000 : null,
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
        durationMs: mediaType === 'video' ? 4_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false,
        thumbnailPath: getThumbnailRelativePath(relativePath),
        previewPath: getPreviewRelativePath(relativePath, mediaType),
        generatedThumbnail: true,
        generatedPreview: true
      };
    });

    maintenanceRepository.resetLibraryIndex();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('applies env exclusions on the first scan and exposes them in admin stats', async () => {
    vi.stubEnv('GALLERY_EXCLUDED_FOLDERS', '@eaDir,Archive/cache');
    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository, maintenanceRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('Trips/photo-1.jpg');
    await createSourceFile('Trips/@eaDir/ignored.jpg');
    await createSourceFile('Archive/cache/ignored-2.jpg');

    await scannerService.scanAll('manual');

    expect(galleryService.listFolders().map((folder) => folder.folderPath)).toEqual(['Trips']);
    expect(imageRepository.getByRelativePath('Trips/@eaDir/ignored.jpg')).toBeUndefined();
    expect(imageRepository.getByRelativePath('Archive/cache/ignored-2.jpg')).toBeUndefined();
    expect(galleryService.getStats().excludedFolders).toEqual({
      envExcludedFolders: ['@eaDir', 'Archive/cache'],
      customExcludedFolders: [],
      effectiveExcludedFolders: ['@eaDir', 'Archive/cache']
    });
  });

  it('stores custom exclusions, skips incremental updates under excluded folders, and soft-deletes them on the next full scan', async () => {
    await createSourceFile('Trips/photo-1.jpg');
    await createSourceFile('Trips/cache/old-1.jpg');
    await createSourceFile('Archive/cache/old-2.jpg');

    await scannerService.scanAll('manual');

    expect(galleryService.listFolders().map((folder) => folder.folderPath).sort()).toEqual([
      'Archive/cache',
      'Trips',
      'Trips/cache'
    ]);

    expect(galleryService.setExcludedFolders(['cache'])).toEqual({
      envExcludedFolders: [],
      customExcludedFolders: ['cache'],
      effectiveExcludedFolders: ['cache'],
      requiresScan: true
    });

    await createSourceFile('Trips/cache/new-3.jpg');
    await scannerService.scanChangedPaths(['Trips/cache/new-3.jpg'], 'watcher');

    expect(imageRepository.getByRelativePath('Trips/cache/new-3.jpg')).toBeUndefined();

    await scannerService.scanAll('manual');

    expect(galleryService.listFolders().map((folder) => folder.folderPath)).toEqual(['Trips']);
    expect(imageRepository.getByRelativePath('Trips/cache/old-1.jpg')?.is_deleted).toBe(1);
    expect(imageRepository.getByRelativePath('Archive/cache/old-2.jpg')?.is_deleted).toBe(1);
  });

  it('prevents reserved stories folders from being indexed when the exclusion rules match them', async () => {
    galleryService.setExcludedFolders(['stories']);

    await createSourceFile('Albums/beach/photo-main.jpg');
    await createSourceFile('Albums/beach/stories/avatar-1.jpg');
    await createSourceFile('Albums/beach/stories/highlights/day-1.jpg');

    await scannerService.scanAll('manual');

    const folder = galleryService.listFolders()[0]!;
    expect(folder.folderPath).toBe('Albums/beach');
    expect(folder.hasAvatarStory).toBe(false);
    expect(galleryService.getFolderStories(folder.slug)?.items).toEqual([]);
    expect(galleryService.searchMedia('avatar-1', 1, 20).total).toBe(0);
  });

  it('keeps managed gallery roots separate from bare-name excluded folder matching', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'gallery', 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
    vi.stubEnv('GALLERY_EXCLUDED_FOLDERS', '');
    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository, maintenanceRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('thumbnails/managed-1.jpg');
    await createSourceFile('Trips/photo-1.jpg');
    await createSourceFile('Trips/thumbnails/photo-2.jpg');

    await scannerService.scanAll('manual');

    expect(galleryService.listFolders().map((folder) => folder.folderPath).sort()).toEqual(['Trips', 'Trips/thumbnails']);
    expect(imageRepository.getByRelativePath('thumbnails/managed-1.jpg')).toBeUndefined();
    expect(imageRepository.getByRelativePath('Trips/thumbnails/photo-2.jpg')?.is_deleted).toBe(0);

    await createSourceFile('Trips/thumbnails/photo-3.jpg');
    await scannerService.scanChangedPaths(['Trips/thumbnails/photo-3.jpg'], 'watcher');

    expect(imageRepository.getByRelativePath('Trips/thumbnails/photo-3.jpg')?.is_deleted).toBe(0);
  });

  it('prunes marked folders and all descendants before metadata or derivative work', async () => {
    await createSourceFile('Trips/photo.jpg');
    await createSourceFile('Archive/old.jpg');
    await createSourceFile('Archive/Nested/deep.jpg');
    await createSourceFile('Archive/stories/capsule/story.jpg');
    await createSourceFile('Archive/carousels/post/01.jpg');
    await createMarker('Archive');

    await scannerService.scanAll('manual');

    expect(galleryService.listFolders().map((folder) => folder.folderPath)).toEqual(['Trips']);
    expect(imageRepository.getByRelativePath('Archive/old.jpg')).toBeUndefined();
    expect(imageRepository.getByRelativePath('Archive/Nested/deep.jpg')).toBeUndefined();
    expectProcessedMedia(['Trips/photo.jpg']);
    expect(generateThumbnailDerivativeMock).not.toHaveBeenCalled();
  });

  it('soft-deletes a marked subtree and restores the same records and ordering after removal', async () => {
    const paths = ['Archive/old.jpg', 'Archive/Nested/deep.jpg'];
    for (const relativePath of [...paths, 'Trips/photo.jpg']) await createSourceFile(relativePath);
    await scannerService.scanAll('manual');
    const originalRows = paths.map((relativePath) => imageRepository.getByRelativePath(relativePath)!);

    await createMarker('Archive');
    await scannerService.scanAll('manual');
    expect(galleryService.listFolders().map((folder) => folder.folderPath)).toEqual(['Trips']);
    for (const row of originalRows) {
      expect(imageRepository.getByRelativePath(row.relative_path)).toMatchObject({ id: row.id, is_deleted: 1 });
    }

    await fs.unlink(path.join(appConfig.galleryRoot, 'Archive/.nofoldergram'));
    await scannerService.scanAll('manual');
    for (const row of originalRows) {
      expect(imageRepository.getByRelativePath(row.relative_path)).toMatchObject({
        id: row.id, is_deleted: 0, sort_timestamp: row.sort_timestamp
      });
    }
  });

  it.each(['Archive', 'Archive/Nested'])('does not reactivate content on incremental events under a marker in %s', async (markedFolder) => {
    await createSourceFile('Archive/Nested/old.jpg');
    await scannerService.scanAll('manual');
    await createMarker(markedFolder);
    await scannerService.scanAll('manual');
    readMediaMetadataMock.mockClear();
    generateDerivativesMock.mockClear();
    await createSourceFile('Archive/Nested/new.jpg');

    await scannerService.scanChangedPaths(['Archive/Nested/old.jpg', 'Archive/Nested/new.jpg'], 'watcher');

    expect(imageRepository.getByRelativePath('Archive/Nested/old.jpg')?.is_deleted).toBe(1);
    expect(imageRepository.getByRelativePath('Archive/Nested/new.jpg')).toBeUndefined();
    expect(readMediaMetadataMock).not.toHaveBeenCalled();
    expect(generateDerivativesMock).not.toHaveBeenCalled();
  });

  it('ignores a root marker, a marker directory, and differently named dotfiles', async () => {
    await createMarker('');
    await createSourceFile('Directory/photo.jpg');
    await fs.mkdir(path.join(appConfig.galleryRoot, 'Directory/.nofoldergram'));
    await createSourceFile('Uppercase/photo.jpg');
    await createSourceFile('Uppercase/.NOFOLDERGRAM');
    await createSourceFile('Other/photo.jpg');
    await createSourceFile('Other/.ignore');

    await scannerService.scanAll('manual');
    expect(galleryService.listFolders().map((folder) => folder.folderPath).sort()).toEqual(['Directory', 'Other', 'Uppercase']);
  });

  it('does not treat a symlink as a regular marker file', async () => {
    await createSourceFile('Trips/photo.jpg');
    await fs.writeFile(path.join(tempRoot, 'marker-target'), '');
    await fs.symlink(path.join(tempRoot, 'marker-target'), path.join(appConfig.galleryRoot, 'Trips/.nofoldergram'));
    await scannerService.scanAll('manual');
    await createSourceFile('Trips/new.jpg');
    await scannerService.scanChangedPaths(['Trips/new.jpg'], 'watcher');
    expect(imageRepository.getByRelativePath('Trips/new.jpg')?.is_deleted).toBe(0);
  });

  it.each(['Linked', 'Album/Linked'])('reconciles incrementally changed media under a directory symlink in %s through full discovery', async (relativeFolder) => {
    const oldPath = `${relativeFolder}/old.jpg`;
    await createSourceFile(oldPath);
    await scannerService.scanAll('manual');
    const original = imageRepository.getByRelativePath(oldPath)!;

    const external = path.join(tempRoot, 'external');
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, '.nofoldergram'), '');
    await fs.writeFile(path.join(external, 'new.jpg'), 'external media');
    await fs.rm(path.join(appConfig.galleryRoot, relativeFolder), { recursive: true });
    await fs.symlink(external, path.join(appConfig.galleryRoot, relativeFolder), 'dir');
    readMediaMetadataMock.mockClear();
    generateDerivativesMock.mockClear();
    generateThumbnailDerivativeMock.mockClear();

    await scannerService.scanChangedPaths([`${relativeFolder}/new.jpg`], 'watcher');

    expect(imageRepository.getByRelativePath(oldPath)).toMatchObject({ id: original.id, is_deleted: 1 });
    expect(imageRepository.getByRelativePath(`${relativeFolder}/new.jpg`)).toBeUndefined();
    expect(readMediaMetadataMock).not.toHaveBeenCalled();
    expect(generateDerivativesMock).not.toHaveBeenCalled();
    expect(generateThumbnailDerivativeMock).not.toHaveBeenCalled();
  });

  it('uses marker presence regardless of file contents alongside env and Settings rules', async () => {
    appConfig.galleryExcludedFolders.push('EnvBlocked');
    galleryService.setExcludedFolders(['SettingsBlocked']);
    for (const folder of ['EnvBlocked', 'SettingsBlocked', 'Marked', 'Trips']) {
      await createSourceFile(`${folder}/photo.jpg`);
    }
    await createSourceFile('Marked/.nofoldergram');
    await scannerService.scanAll('manual');
    expect(galleryService.listFolders().map((folder) => folder.folderPath)).toEqual(['Trips']);
    expect(readMediaMetadataMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Albums/stories', []],
    ['Albums/stories/hidden', ['Albums/stories/avatar.jpg', 'Albums/stories/visible/story.jpg']],
    ['Albums/stories/hidden/deeper', ['Albums/stories/avatar.jpg', 'Albums/stories/hidden/story.jpg', 'Albums/stories/visible/story.jpg']]
  ])('prunes reserved story media below %s and preserves siblings', async (markedFolder, activeStories) => {
    const storyPaths = ['Albums/stories/avatar.jpg', 'Albums/stories/hidden/story.jpg', 'Albums/stories/hidden/deeper/nested.jpg', 'Albums/stories/visible/story.jpg'];
    await createSourceFile('Albums/main.jpg');
    for (const relativePath of storyPaths) await createSourceFile(relativePath);
    await createMarker(markedFolder);
    await scannerService.scanAll('manual');

    const owner = galleryService.listFolders()[0]!;
    expect(owner.folderPath).toBe('Albums');
    expect(galleryService.getFeed(1, 20, 'recent').total).toBe(1);
    for (const relativePath of storyPaths) {
      if (activeStories.includes(relativePath)) {
        expect(imageRepository.getByRelativePath(relativePath)?.is_deleted).toBe(0);
      } else {
        expect(imageRepository.getByRelativePath(relativePath)).toBeUndefined();
      }
    }
    expectProcessedMedia(['Albums/main.jpg', ...activeStories]);
    if (activeStories.length === 0) expect(galleryService.getFolderStories(owner.slug)?.items).toEqual([]);
  });

  it.each(['Albums', 'Albums/stories', 'Albums/stories/hidden'])('soft-deletes and reactivates story records after changing a marker in %s', async (markedFolder) => {
    await createSourceFile('Albums/main.jpg');
    await createSourceFile('Albums/stories/hidden/story.jpg');
    await scannerService.scanAll('manual');
    const original = imageRepository.getByRelativePath('Albums/stories/hidden/story.jpg')!;
    await createMarker(markedFolder);
    await scannerService.scanAll('manual');
    expect(imageRepository.getByRelativePath(original.relative_path)).toMatchObject({ id: original.id, is_deleted: 1 });
    await fs.unlink(path.join(appConfig.galleryRoot, markedFolder, '.nofoldergram'));
    await scannerService.scanAll('manual');
    expect(imageRepository.getByRelativePath(original.relative_path)).toMatchObject({ id: original.id, is_deleted: 0, sort_timestamp: original.sort_timestamp });
  });

  it.each(['Albums/carousels', 'Albums/carousels/hidden'])('prunes carousel media below %s before indexing', async (markedFolder) => {
    await createSourceFile('Albums/main.jpg');
    for (const post of ['hidden', 'visible']) {
      await createSourceFile(`Albums/carousels/${post}/01.jpg`);
      await createSourceFile(`Albums/carousels/${post}/02.jpg`);
    }
    await createMarker(markedFolder);
    await scannerService.scanAll('manual');
    expect(imageRepository.getByRelativePath('Albums/carousels/hidden/01.jpg')).toBeUndefined();
    expect(postRepository.findBySourcePath('Albums/carousels/hidden')).toBeUndefined();
    const rootMarked = markedFolder === 'Albums/carousels';
    expectProcessedMedia(rootMarked ? ['Albums/main.jpg'] : [
      'Albums/main.jpg', 'Albums/carousels/visible/01.jpg', 'Albums/carousels/visible/02.jpg'
    ]);
    expect(galleryService.getFeed(1, 20, 'recent').total).toBe(rootMarked ? 1 : 2);
  });

  it.each(['Albums', 'Albums/carousels', 'Albums/carousels/hidden'])('soft-deletes and reactivates carousel posts and media after changing a marker in %s', async (markedFolder) => {
    await createSourceFile('Albums/main.jpg');
    for (const post of ['hidden', 'visible']) {
      await createSourceFile(`Albums/carousels/${post}/01.jpg`);
      await createSourceFile(`Albums/carousels/${post}/02.jpg`);
    }
    await scannerService.scanAll('manual');
    const original = postRepository.findBySourcePath('Albums/carousels/hidden')!;
    const originalImage = imageRepository.getByRelativePath('Albums/carousels/hidden/01.jpg')!;
    await createMarker(markedFolder);
    await scannerService.scanAll('manual');
    expect(postRepository.findBySourcePath(original.source_path)).toMatchObject({ id: original.id, is_deleted: 1 });
    expect(imageRepository.getByRelativePath(originalImage.relative_path)).toMatchObject({ id: originalImage.id, is_deleted: 1 });
    expect(galleryService.getFeed(1, 20, 'recent').total).toBe(markedFolder === 'Albums' ? 0 : markedFolder === 'Albums/carousels' ? 1 : 2);
    await fs.unlink(path.join(appConfig.galleryRoot, markedFolder, '.nofoldergram'));
    await scannerService.scanAll('manual');
    expect(postRepository.findBySourcePath(original.source_path)).toMatchObject({ id: original.id, is_deleted: 0, sort_timestamp: original.sort_timestamp });
    expect(imageRepository.getByRelativePath(originalImage.relative_path)).toMatchObject({ id: originalImage.id, is_deleted: 0 });
    expect(galleryService.getFeed(1, 20, 'recent').total).toBe(3);
  });

  function expectProcessedMedia(relativePaths: string[]): void {
    const absolutePaths = relativePaths.map((relativePath) => path.join(appConfig.galleryRoot, relativePath)).sort();
    expect(readMediaMetadataMock.mock.calls.map(([source]) => source).sort()).toEqual(absolutePaths);
    for (const derivativeMock of [generateDerivativesMock, generateThumbnailDerivativeMock]) {
      expect(derivativeMock.mock.calls.every(([source]) => absolutePaths.includes(source))).toBe(true);
    }
  }

  async function createMarker(relativeFolder: string): Promise<void> {
    const directory = path.join(appConfig.galleryRoot, relativeFolder);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, '.nofoldergram'), '');
  }

  async function createSourceFile(relativePath: string): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
  }
});
