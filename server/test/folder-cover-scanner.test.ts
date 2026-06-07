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
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('folder cover scanner', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-folder-cover-scanner-'));

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
    ({imageRepository, folderRepository, maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockResolvedValue({
      width: 1000,
      height: 1000,
      takenAt: null,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: false
    });

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string) => ({
      width: 1000,
      height: 1000,
      takenAt: null,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: false,
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, 'image'),
      generatedThumbnail: true,
      generatedPreview: true
    }));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('detects cover.jpg in a folder and prioritizes it as the avatar', async () => {
    await maintenanceRepository.resetLibraryIndex();

    await createSourceFile('holiday/photo-1.jpg');
    await createSourceFile('holiday/photo-2.jpg');
    // We add cover.jpg as the oldest file to prove it gets prioritized over newer files
    await createSourceFile('holiday/cover.jpg', 1000);

    await scannerService.scanAll('manual');

    const folder = await folderRepository.getBySlug('holiday');
    expect(folder).toBeDefined();

    const avatarImage = await imageRepository.getById(folder!.avatar_image_id!);
    expect(avatarImage).toBeDefined();
    expect(avatarImage!.filename).toBe('cover.jpg');
  });

  it('respects cover.png when cover.jpg is not present', async () => {
    await maintenanceRepository.resetLibraryIndex();

    await createSourceFile('party/photo-1.jpg');
    await createSourceFile('party/cover.png');

    await scannerService.scanAll('manual');

    const folder = await folderRepository.getBySlug('party');
    const avatarImage = await imageRepository.getById(folder!.avatar_image_id!);
    expect(avatarImage!.filename).toBe('cover.png');
  });

  it('respects cover.avif when higher-priority cover files are absent', async () => {
    await maintenanceRepository.resetLibraryIndex();

    await createSourceFile('nature/photo-1.jpg');
    await createSourceFile('nature/cover.avif');

    await scannerService.scanAll('manual');

    const folder = await folderRepository.getBySlug('nature');
    const avatarImage = await imageRepository.getById(folder!.avatar_image_id!);
    expect(avatarImage!.filename).toBe('cover.avif');
  });

  async function createSourceFile(relativePath: string, mtimeOffsetMs = 0): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
    
    if (mtimeOffsetMs) {
      const now = new Date();
      now.setMilliseconds(now.getMilliseconds() - mtimeOffsetMs);
      await fs.utimes(absolutePath, now, now);
    }
  }
});
