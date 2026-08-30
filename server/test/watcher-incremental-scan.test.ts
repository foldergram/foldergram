import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getMediaTypeFromExtension, getPreviewRelativePath, getThumbnailRelativePath } from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('watcher directory events stay incremental', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let scanRunRepository: RepositoriesModule['scanRunRepository'];

  async function createSourceFile(relativePath: string) {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `media:${relativePath}`);
  }

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-watcher-incremental-'));
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
    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository, maintenanceRepository, scanRunRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (absolutePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(absolutePath));
      return {
        width: 1600,
        height: 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 4000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string) => {
      const mediaType = getMediaTypeFromExtension(path.extname(relativePath));
      return {
        width: 1600,
        height: 1200,
        takenAt: null,
        durationMs: mediaType === 'video' ? 4000 : null,
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

  it('indexes a newly added folder subtree without rescanning untouched folders', async () => {
    await createSourceFile('Trips/photo-1.jpg');
    await scannerService.scanAll('manual');

    generateDerivativesMock.mockClear();

    await createSourceFile('Fresh/nested/photo-2.jpg');
    // Chokidar reports the new subtree as addDir events, not file events.
    await scannerService.scanChangedPaths(['Fresh', 'Fresh/nested'], 'watcher');

    expect(scanRunRepository.latest()?.status).toBe('completed');
    expect(imageRepository.getByRelativePath('Fresh/nested/photo-2.jpg')?.is_deleted).toBe(0);
    expect(galleryService.listFolders().map((folder) => folder.folderPath).sort()).toEqual([
      'Fresh/nested',
      'Trips'
    ]);

    // Only the new file needed derivatives; the untouched folder was not re-processed.
    const processedPaths = generateDerivativesMock.mock.calls.map((call) => call[1] as string);
    expect(processedPaths).toEqual(['Fresh/nested/photo-2.jpg']);
  });

  it('clears indexed folders when their directory is removed', async () => {
    await createSourceFile('Trips/photo-1.jpg');
    await createSourceFile('Temp/nested/photo-2.jpg');
    await scannerService.scanAll('manual');

    expect(imageRepository.getByRelativePath('Temp/nested/photo-2.jpg')?.is_deleted).toBe(0);

    await fs.rm(path.join(appConfig.galleryRoot, 'Temp'), { recursive: true, force: true });
    await scannerService.scanChangedPaths(['Temp'], 'watcher');

    expect(imageRepository.getByRelativePath('Temp/nested/photo-2.jpg')?.is_deleted).toBe(1);
    expect(imageRepository.getByRelativePath('Trips/photo-1.jpg')?.is_deleted).toBe(0);
  });
});
