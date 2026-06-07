import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];
type ImageRecord = ModelsModule['ImageRecord'];

describe.sequential('gallery folder deletion', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let folderScanStateRepository: RepositoriesModule['folderScanStateRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-gallery-delete-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));

    ({folderRepository,
      imageRepository,
      folderScanStateRepository,
      maintenanceRepository} = await import('../src/db/repositories.js'));
      await (await import('../src/db/repositories.js')).initRepositories();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await maintenanceRepository.resetLibraryIndex();
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

  it('deletes a direct-image folder cleanly and removes its empty directories', async () => {
    await createIndexedFolder('parent', ['photo-1.jpg']);

    const result = await galleryService.deleteFolder('parent');

    expect(result).toEqual({
      slug: 'parent',
      deletedImageCount: 1,
      deletedFolderCount: 1,
      deletedSourceFolder: false
    });
    expect(await folderRepository.getBySlug('parent')).toBeUndefined();
    expect(await imageRepository.getByRelativePath('parent/photo-1.jpg')).toBeUndefined();
    expect(await folderScanStateRepository.getAll()).toEqual([]);
    await expectPathMissing(path.join(appConfig.galleryRoot, 'parent'));
    await expectPathMissing(path.join(appConfig.thumbnailsDir, 'parent'));
    await expectPathMissing(path.join(appConfig.previewsDir, 'parent'));
  });

  it('deletes indexed videos and their generated preview mp4 files', async () => {
    await createIndexedFolder('clips', ['clip-1.mp4']);

    const result = await galleryService.deleteFolder('clips');

    expect(result).toEqual({
      slug: 'clips',
      deletedImageCount: 1,
      deletedFolderCount: 1,
      deletedSourceFolder: false
    });
    await expectPathMissing(path.join(appConfig.galleryRoot, 'clips'));
    await expectPathMissing(path.join(appConfig.thumbnailsDir, 'clips'));
    await expectPathMissing(path.join(appConfig.previewsDir, 'clips'));
  });

  it('keeps child source folders on disk and in the database when only direct images are deleted', async () => {
    await createIndexedFolder('parent', ['photo-1.jpg']);
    await createIndexedFolder('parent/child-a', ['photo-2.jpg']);

    const result = await galleryService.deleteFolder('parent');

    expect(result).toEqual({
      slug: 'parent',
      deletedImageCount: 1,
      deletedFolderCount: 1,
      deletedSourceFolder: false
    });
    expect(await folderRepository.getBySlug('parent')).toBeUndefined();
    expect(await folderRepository.getBySlug('parent-child-a')).toBeDefined();
    expect(await imageRepository.getByRelativePath('parent/photo-1.jpg')).toBeUndefined();
    expect(await imageRepository.getByRelativePath('parent/child-a/photo-2.jpg')).toBeDefined();
    expect((await folderScanStateRepository.getAll()).map((entry) => entry.folder_path)).toEqual(['parent/child-a']);
    await expectPathMissing(path.join(appConfig.galleryRoot, 'parent', 'photo-1.jpg'));
    await expectPathPresent(path.join(appConfig.galleryRoot, 'parent'));
    await expectPathPresent(path.join(appConfig.galleryRoot, 'parent', 'child-a'));
    await expectPathPresent(path.join(appConfig.galleryRoot, 'parent', 'child-a', 'photo-2.jpg'));
    await expectPathPresent(path.join(appConfig.thumbnailsDir, 'parent', 'child-a'));
    await expectPathPresent(path.join(appConfig.previewsDir, 'parent', 'child-a'));
  });

  it('removes the full source subtree when subtree deletion is requested', async () => {
    await createIndexedFolder('parent', ['photo-1.jpg']);
    await createIndexedFolder('parent/child-a', ['photo-2.jpg']);
    await fs.writeFile(path.join(appConfig.galleryRoot, 'parent', 'notes.txt'), 'keep me only in direct-delete mode');
    await fs.writeFile(path.join(appConfig.galleryRoot, 'parent', 'child-a', 'clip.mp4'), 'also deleted in subtree mode');

    const result = await galleryService.deleteFolder('parent', {
      deleteSourceFolder: true
    });

    expect(result).toEqual({
      slug: 'parent',
      deletedImageCount: 2,
      deletedFolderCount: 2,
      deletedSourceFolder: true
    });
    expect(await folderRepository.getBySlug('parent')).toBeUndefined();
    expect(await folderRepository.getBySlug('parent-child-a')).toBeUndefined();
    expect(await imageRepository.getByRelativePath('parent/photo-1.jpg')).toBeUndefined();
    expect(await imageRepository.getByRelativePath('parent/child-a/photo-2.jpg')).toBeUndefined();
    expect(await folderScanStateRepository.getAll()).toEqual([]);
    await expectPathMissing(path.join(appConfig.galleryRoot, 'parent'));
    await expectPathMissing(path.join(appConfig.thumbnailsDir, 'parent'));
    await expectPathMissing(path.join(appConfig.previewsDir, 'parent'));
  });

  async function createIndexedFolder(relativeFolderPath: string, filenames: string[]): Promise<{
    folder: FolderRecord;
    images: ImageRecord[];
  }> {
    const slug = relativeFolderPath.replaceAll('/', '-');
    const folderName = path.posix.basename(relativeFolderPath);
    const folder = await folderRepository.upsert({
      slug,
      name: folderName,
      folderPath: relativeFolderPath
    });
    const images: ImageRecord[] = [];

    for (const [index, filename] of filenames.entries()) {
      const relativePath = `${relativeFolderPath}/${filename}`;
      const absolutePath = path.join(appConfig.galleryRoot, relativePath);
      const extension = path.extname(filename).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);
      const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
      const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
      const thumbnailPath = path.join(appConfig.thumbnailsDir, thumbnailRelativePath);
      const previewPath = path.join(appConfig.previewsDir, previewRelativePath);

      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.mkdir(path.dirname(thumbnailPath), { recursive: true });
      await fs.mkdir(path.dirname(previewPath), { recursive: true });
      await fs.writeFile(absolutePath, `source:${relativePath}`);
      await fs.writeFile(thumbnailPath, `thumb:${relativePath}`);
      await fs.writeFile(previewPath, `preview:${relativePath}`);

      const fileSize = Buffer.byteLength(`source:${relativePath}`);
      const mtimeMs = 1_700_000_000_000 + index;
      const image = await imageRepository.upsert({
        folderId: folder.id,
        filename,
        extension,
        relativePath,
        absolutePath,
        fileSize,
        width: 1200,
        height: 800,
        mediaType,
        mimeType: getMimeTypeFromExtension(extension),
        durationMs: mediaType === 'video' ? 15_000 : null,
        fingerprint: createFingerprint(relativePath, fileSize, mtimeMs),
        mtimeMs,
        firstSeenAt: '2026-03-01T00:00:00.000Z',
        sortTimestamp: mtimeMs,
        takenAt: mtimeMs,
        takenAtSource: 'mtime',
        exifJson: mediaType === 'image' ? '{}' : null,
        thumbnailPath: thumbnailRelativePath,
        previewPath: previewRelativePath
      });

      images.push(image);
    }

    await folderRepository.setAvatar(folder.id, images.at(0)?.id ?? null);
    await folderScanStateRepository.upsert({
      folderPath: relativeFolderPath,
      signature: `signature:${relativeFolderPath}`,
      fileCount: filenames.length,
      maxMtimeMs: images.length > 0 ? Math.max(...images.map((image) => image.mtime_ms)) : 0,
      totalSize: images.reduce((total, image) => total + image.file_size, 0)
    });

    return {
      folder,
      images
    };
  }

  async function expectPathPresent(targetPath: string): Promise<void> {
    await expect(fs.stat(targetPath)).resolves.toBeDefined();
  }

  async function expectPathMissing(targetPath: string): Promise<void> {
    await expect(fs.stat(targetPath)).rejects.toMatchObject({
      code: 'ENOENT'
    });
  }
});
