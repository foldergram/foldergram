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
    ({imageRepository, maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

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

    await maintenanceRepository.resetLibraryIndex();
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
    ({imageRepository, maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
    await maintenanceRepository.resetLibraryIndex();

    await createSourceFile('Trips/photo-1.jpg');
    await createSourceFile('Trips/@eaDir/ignored.jpg');
    await createSourceFile('Archive/cache/ignored-2.jpg');

    await scannerService.scanAll('manual');

    expect((await galleryService.listFolders()).map((folder) => folder.folderPath)).toEqual(['Trips']);
    expect(await imageRepository.getByRelativePath('Trips/@eaDir/ignored.jpg')).toBeUndefined();
    expect(await imageRepository.getByRelativePath('Archive/cache/ignored-2.jpg')).toBeUndefined();
    expect((await galleryService.getStats()).excludedFolders).toEqual({
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

    expect((await galleryService.listFolders()).map((folder) => folder.folderPath).sort()).toEqual([
      'Archive/cache',
      'Trips',
      'Trips/cache'
    ]);

    expect(await galleryService.setExcludedFolders(['cache'])).toEqual({
      envExcludedFolders: [],
      customExcludedFolders: ['cache'],
      effectiveExcludedFolders: ['cache'],
      requiresScan: true
    });

    await createSourceFile('Trips/cache/new-3.jpg');
    await scannerService.scanChangedPaths(['Trips/cache/new-3.jpg'], 'watcher');

    expect(await imageRepository.getByRelativePath('Trips/cache/new-3.jpg')).toBeUndefined();

    await scannerService.scanAll('manual');

    expect((await galleryService.listFolders()).map((folder) => folder.folderPath)).toEqual(['Trips']);
    expect((await imageRepository.getByRelativePath('Trips/cache/old-1.jpg'))?.is_deleted).toBe(1);
    expect((await imageRepository.getByRelativePath('Archive/cache/old-2.jpg'))?.is_deleted).toBe(1);
  });

  it('prevents reserved stories folders from being indexed when the exclusion rules match them', async () => {
    await galleryService.setExcludedFolders(['stories']);

    await createSourceFile('Albums/beach/photo-main.jpg');
    await createSourceFile('Albums/beach/stories/avatar-1.jpg');
    await createSourceFile('Albums/beach/stories/highlights/day-1.jpg');

    await scannerService.scanAll('manual');

    const folder = (await galleryService.listFolders())[0]!;
    expect(folder.folderPath).toBe('Albums/beach');
    expect(folder.hasAvatarStory).toBe(false);
    expect((await galleryService.getFolderStories(folder.slug))?.items).toEqual([]);
    expect((await galleryService.searchMedia('avatar-1', 1, 20)).total).toBe(0);
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
    ({imageRepository, maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
    await maintenanceRepository.resetLibraryIndex();

    await createSourceFile('thumbnails/managed-1.jpg');
    await createSourceFile('Trips/photo-1.jpg');
    await createSourceFile('Trips/thumbnails/photo-2.jpg');

    await scannerService.scanAll('manual');

    expect((await galleryService.listFolders()).map((folder) => folder.folderPath).sort()).toEqual(['Trips', 'Trips/thumbnails']);
    expect(await imageRepository.getByRelativePath('thumbnails/managed-1.jpg')).toBeUndefined();
    expect((await imageRepository.getByRelativePath('Trips/thumbnails/photo-2.jpg'))?.is_deleted).toBe(0);

    await createSourceFile('Trips/thumbnails/photo-3.jpg');
    await scannerService.scanChangedPaths(['Trips/thumbnails/photo-3.jpg'], 'watcher');

    expect((await imageRepository.getByRelativePath('Trips/thumbnails/photo-3.jpg'))?.is_deleted).toBe(0);
  });

  async function createSourceFile(relativePath: string): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
  }
});
