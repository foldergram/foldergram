import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFingerprint,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];

const generateDerivativesMock = vi.fn();
const generateThumbnailDerivativeMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('image orientation backfill', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-image-orientation-backfill-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    generateDerivativesMock.mockReset();
    generateThumbnailDerivativeMock.mockReset();
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
    ({folderRepository, imageRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockResolvedValue({
      width: 800,
      height: 1200,
      displayOrientation: 6,
      takenAt: null,
      exif: null,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: false
    });

    generateThumbnailDerivativeMock.mockResolvedValue({
      thumbnailPath: 'unused.webp',
      generatedThumbnail: true
    });

    generateDerivativesMock.mockResolvedValue({
      width: 800,
      height: 1200,
      displayOrientation: 6,
      takenAt: null,
      exif: null,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: false,
      thumbnailPath: 'phones/rotated-note9.webp',
      previewPath: 'phones/rotated-note9.webp',
      generatedThumbnail: true,
      generatedPreview: true
    });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('refreshes unchanged legacy rows whose display orientation has not been backfilled yet', async () => {
    const folder = await createFolder('phones');
    const relativePath = 'phones/rotated-note9.jpg';
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const sourceContents = 'legacy-jpeg-contents';

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, sourceContents);

    const stats = await fs.stat(absolutePath);
    const fingerprint = createFingerprint(relativePath, stats.size, stats.mtimeMs);
    const thumbnailPath = getThumbnailRelativePath(relativePath);
    const previewPath = getPreviewRelativePath(relativePath, 'image');

    const indexed = await imageRepository.upsert({
      folderId: folder.id,
      filename: 'rotated-note9.jpg',
      extension: '.jpg',
      relativePath,
      absolutePath,
      fileSize: stats.size,
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: getMimeTypeFromExtension('.jpg'),
      durationMs: null,
      isAnimated: false,
      fingerprint,
      mtimeMs: stats.mtimeMs,
      firstSeenAt: '2026-04-02T00:00:00.000Z',
      sortTimestamp: Math.round(stats.mtimeMs),
      takenAt: Math.round(stats.mtimeMs),
      takenAtSource: 'mtime',
      exifJson: '{}',
      thumbnailPath,
      previewPath,
      playbackStrategy: 'preview'
    });

    expect(indexed.display_orientation).toBeNull();

    await scannerService.scanAll('manual');

    expect(readMediaMetadataMock).toHaveBeenCalledTimes(1);
    expect(generateDerivativesMock).toHaveBeenCalled();

    const refreshed = await imageRepository.getByRelativePath(relativePath);
    expect(refreshed?.width).toBe(800);
    expect(refreshed?.height).toBe(1200);
    expect(refreshed?.display_orientation).toBe(6);
  });

  async function createFolder(folderPath: string): Promise<FolderRecord> {
    return await folderRepository.upsert({
      slug: folderPath,
      name: path.posix.basename(folderPath),
      folderPath
    });
  }
});
