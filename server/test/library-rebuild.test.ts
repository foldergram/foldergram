import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';
import { LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY } from '../src/constants/app-setting-keys.js';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('library rebuild reuses existing derivatives', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-library-rebuild-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DERIVATIVE_MODE', 'eager');
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
    ({imageRepository, appSettingsRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

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

    generateDerivativesMock.mockImplementation(async (sourcePath: string, relativePath: string, force = false, overrides?: {
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

  it('generates missing asset-key derivatives without forcing writes during a rebuild with no previous index', async () => {
    await createSourceFile('summer/photo-1.jpg');
    await createSourceFile('summer/clip-1.mp4');

    const lastScan = await scannerService.rebuildLibraryIndex();

    expect(lastScan?.status).toBe('completed');
    expect(lastScan?.scanned_files).toBe(2);
    expect(await imageRepository.countFeed()).toBe(2);

    expect(generateDerivativesMock).toHaveBeenCalledTimes(2);
    for (const [, , force] of generateDerivativesMock.mock.calls) {
      expect(force).toBe(false);
    }

    for (const image of await imageRepository.listActive()) {
      await expect(fs.readFile(path.join(appConfig.thumbnailsDir, image.thumbnail_path), 'utf8')).resolves.toBe(`thumb:${image.relative_path}`);
      await expect(fs.readFile(path.join(appConfig.previewsDir, image.preview_path), 'utf8')).resolves.toBe(`preview:${image.relative_path}`);
    }
  });

  it('reuses asset-key derivative paths from the previous index when rebuilding after the gallery root moved', async () => {
    await createSourceFile('summer/photo-1.jpg');
    await createSourceFile('summer/clip-1.mp4');

    await scannerService.scanAll('initial', {
      repairUnchangedDerivatives: false
    });

    const beforeRows = await imageRepository.listActive();
    expect(beforeRows).toHaveLength(2);
    const beforeByRelativePath = new Map(beforeRows.map((image) => [image.relative_path, image]));
    for (const image of beforeRows) {
      await expect(fs.readFile(path.join(appConfig.thumbnailsDir, image.thumbnail_path), 'utf8')).resolves.toBe(`thumb:${image.relative_path}`);
      await expect(fs.readFile(path.join(appConfig.previewsDir, image.preview_path), 'utf8')).resolves.toBe(`preview:${image.relative_path}`);
    }

    generateDerivativesMock.mockClear();
    await appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, path.join(tempRoot, 'old-gallery-root'));

    const lastScan = await scannerService.rebuildLibraryIndex();

    expect(lastScan?.status).toBe('completed');
    expect(lastScan?.scanned_files).toBe(2);
    expect(generateDerivativesMock).toHaveBeenCalledTimes(2);

    for (const [, relativePath, force, overrides] of generateDerivativesMock.mock.calls) {
      const previous = beforeByRelativePath.get(relativePath as string);
      expect(previous).toBeDefined();
      expect(force).toBe(false);
      expect(overrides).toMatchObject({
        thumbnailPath: previous!.thumbnail_path,
        previewPath: previous!.preview_path
      });
    }

    const afterRows = await imageRepository.listActive();
    expect(afterRows).toHaveLength(2);

    for (const image of afterRows) {
      const previous = beforeByRelativePath.get(image.relative_path);
      expect(previous).toBeDefined();
      expect(image.asset_key).toBe(previous!.asset_key);
      expect(image.thumbnail_path).toBe(previous!.thumbnail_path);
      expect(image.preview_path).toBe(previous!.preview_path);
      await expect(fs.readFile(path.join(appConfig.thumbnailsDir, image.thumbnail_path), 'utf8')).resolves.toBe(`thumb:${image.relative_path}`);
      await expect(fs.readFile(path.join(appConfig.previewsDir, image.preview_path), 'utf8')).resolves.toBe(`preview:${image.relative_path}`);
    }
  });

  it('does not force derivative regeneration when a file is reconciled as moved', async () => {
    const initialRelativePath = 'phones/set-a/photo.jpg';
    const movedRelativePath = 'phones/photo.jpg';

    await createSourceFile(initialRelativePath);
    await scannerService.scanAll('initial', {
      repairUnchangedDerivatives: false
    });

    const original = await imageRepository.getByRelativePath(initialRelativePath);
    expect(original).toBeDefined();

    await fs.mkdir(path.join(appConfig.galleryRoot, 'phones'), { recursive: true });
    await fs.rename(
      path.join(appConfig.galleryRoot, initialRelativePath),
      path.join(appConfig.galleryRoot, movedRelativePath)
    );
    await appSettingsRepository.set(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY, appConfig.galleryRoot);
    generateDerivativesMock.mockClear();

    const lastScan = await scannerService.scanAll('move', {
      repairUnchangedDerivatives: false
    });

    expect(lastScan?.status).toBe('completed');
    const moved = await imageRepository.getByRelativePath(movedRelativePath);
    expect(moved?.id).toBe(original?.id);
    expect(moved?.asset_key).toBe(original?.asset_key);
    expect(moved?.thumbnail_path).toBe(original?.thumbnail_path);
    expect(moved?.preview_path).toBe(original?.preview_path);
    expect(generateDerivativesMock).toHaveBeenCalledTimes(1);
    expect(generateDerivativesMock.mock.calls[0]?.[2]).toBe(false);
    await expect(fs.readFile(path.join(appConfig.thumbnailsDir, moved!.thumbnail_path), 'utf8')).resolves.toBe(`thumb:${initialRelativePath}`);
    await expect(fs.readFile(path.join(appConfig.previewsDir, moved!.preview_path), 'utf8')).resolves.toBe(`preview:${initialRelativePath}`);
  });

  async function createSourceFile(relativePath: string): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);
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
