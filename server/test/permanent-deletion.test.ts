import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type express from 'express';
import type { FolderRecord, ImageRecord, PostRecord } from '../src/types/models.js';

import { requestTestApp } from './http-test-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type DatabaseModule = typeof import('../src/db/database.js');
type DeletionServiceModule = typeof import('../src/services/permanent-deletion-service.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

interface CreatedPost {
  post: PostRecord;
  images: ImageRecord[];
  ownerFolder: FolderRecord;
  sourceDirectory: string;
}

describe.sequential('crash-recoverable permanent post deletion', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let databaseManager: DatabaseModule['databaseManager'];
  let PermanentDeletionService: DeletionServiceModule['PermanentDeletionService'];
  let SimulatedDeletionInterruptionError: DeletionServiceModule['SimulatedDeletionInterruptionError'];
  let permanentDeletionService: DeletionServiceModule['permanentDeletionService'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let postRepository: RepositoriesModule['postRepository'];
  let likeRepository: RepositoriesModule['likeRepository'];
  let collectionRepository: RepositoriesModule['collectionRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let app: express.Application;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-permanent-delete-'));
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
    databaseManager?.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });
    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ databaseManager } = await import('../src/db/database.js'));
    ({ PermanentDeletionService, SimulatedDeletionInterruptionError, permanentDeletionService } = await import('../src/services/permanent-deletion-service.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({
      folderRepository,
      imageRepository,
      postRepository,
      likeRepository,
      collectionRepository,
      maintenanceRepository
    } = await import('../src/db/repositories.js'));
    app = (await import('../src/app.js')).createApp();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
    maintenanceRepository.resetLibraryIndex();
    collectionRepository.ensureDefaultCollection();
    generateThumbnailDerivativeMock.mockImplementation(async (_sourcePath: string, relativePath: string) => ({
      thumbnailPath: `generated/${relativePath}.thumbnail.webp`,
      generatedThumbnail: true
    }));
  });

  afterAll(async () => {
    databaseManager?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('permanently deletes one post, its derivatives, relationships, and image row', async () => {
    const created = await createSingle('single/photo.jpg');
    const image = created.images[0];
    likeRepository.upsert(created.post.id);
    collectionRepository.saveToDefault(created.post.id);
    folderRepository.setAvatar(created.ownerFolder.id, image.id, 'manual');

    await expect(galleryService.deleteImage(created.post.id)).resolves.toEqual({
      id: created.post.id,
      folderSlug: created.ownerFolder.slug
    });

    expect(postRepository.findById(created.post.id)).toBeUndefined();
    expect(imageRepository.getById(image.id)).toBeUndefined();
    expect(likeRepository.getByPostId(created.post.id)).toBeUndefined();
    expect(collectionRepository.isImageSaved(created.post.id)).toBe(false);
    expect(countRows('post_items', 'post_id', created.post.id)).toBe(0);
    expect(countRows('likes', 'post_id', created.post.id)).toBe(0);
    expect(countRows('collection_items', 'post_id', created.post.id)).toBe(0);
    expect(folderRepository.getById(created.ownerFolder.id)?.avatar_image_id).toBeNull();
    await expectPostFiles(created.images, false);
  });

  it('deletes every Carousel item and derivative while preserving sibling and unrelated files', async () => {
    const siblingSingle = await createSingle('album/sibling.jpg');
    const deletedCarousel = await createCarousel('album', 'first', ['01.jpg', '02.jpg', '03.jpg']);
    const siblingCarousel = await createCarousel('album', 'second', ['01.jpg', '02.jpg']);
    const unsupportedPath = path.join(appConfig.galleryRoot, 'album', 'notes.txt');
    await fs.writeFile(unsupportedPath, 'unrelated');

    await expect(galleryService.deleteImage(deletedCarousel.post.id)).resolves.toMatchObject({ id: deletedCarousel.post.id });

    expect(postRepository.findById(deletedCarousel.post.id)).toBeUndefined();
    for (const image of deletedCarousel.images) expect(imageRepository.getById(image.id)).toBeUndefined();
    await expectPostFiles(deletedCarousel.images, false);
    await expect(fs.stat(deletedCarousel.sourceDirectory)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(postRepository.findById(siblingSingle.post.id)).toBeDefined();
    expect(postRepository.findById(siblingCarousel.post.id)).toBeDefined();
    await expectPostFiles(siblingSingle.images, true);
    await expectPostFiles(siblingCarousel.images, true);
    await expect(fs.readFile(unsupportedPath, 'utf8')).resolves.toBe('unrelated');
  });

  it('restores earlier Carousel moves and leaves every database relationship unchanged when a later move fails', async () => {
    const created = await createCarousel('rollback', 'moving', ['01.jpg', '02.jpg']);
    const firstImage = created.images[0];
    likeRepository.upsert(created.post.id);
    collectionRepository.saveToDefault(created.post.id);
    folderRepository.setAvatar(created.ownerFolder.id, firstImage.id, 'manual');
    let moveCount = 0;
    const service = new PermanentDeletionService({
      rename: async (sourcePath, destinationPath) => {
        moveCount += 1;
        if (moveCount === 4) throw new Error('injected second-slide move failure');
        await fs.rename(sourcePath, destinationPath);
      }
    });

    await expect(service.deletePost(created.post.id)).rejects.toThrow('injected second-slide move failure');

    expect(postRepository.findById(created.post.id)).toEqual(created.post);
    expect(postRepository.listImageRecords(created.post.id).map((image) => image.id)).toEqual(created.images.map((image) => image.id));
    expect(likeRepository.getByPostId(created.post.id)).toBeDefined();
    expect(collectionRepository.isImageSaved(created.post.id)).toBe(true);
    expect(countRows('post_items', 'post_id', created.post.id)).toBe(2);
    expect(countRows('likes', 'post_id', created.post.id)).toBe(1);
    expect(countRows('collection_items', 'post_id', created.post.id)).toBe(1);
    expect(folderRepository.getById(created.ownerFolder.id)?.avatar_image_id).toBe(firstImage.id);
    await expectPostFiles(created.images, true);
  });

  it('restores completed moves when a later Carousel source disappears before its rename', async () => {
    const created = await createCarousel('rollback', 'disappearing', ['01.jpg', '02.jpg']);
    let moveCount = 0;
    const service = new PermanentDeletionService({
      rename: async (sourcePath, destinationPath) => {
        moveCount += 1;
        if (moveCount === 4) {
          await fs.rm(sourcePath, { force: true });
        }
        await fs.rename(sourcePath, destinationPath);
      }
    });

    await expect(service.deletePost(created.post.id)).rejects.toMatchObject({ code: 'ENOENT' });

    expect(postRepository.findById(created.post.id)).toBeDefined();
    expect(postRepository.listImageRecords(created.post.id)).toHaveLength(2);
    await expectPostFiles([created.images[0]], true);
    await expect(fs.stat(originalPath(created.images[1]))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(thumbnailPath(created.images[1]))).resolves.toBeDefined();
    await expect(fs.stat(previewPath(created.images[1]))).resolves.toBeDefined();
    expect(await journalFiles()).toEqual([]);
    await expect(new PermanentDeletionService().recoverPendingDeletions()).resolves.toBeUndefined();
  });

  it('restores every quarantined file when the SQLite deletion transaction fails', async () => {
    const created = await createCarousel('rollback', 'database', ['01.jpg', '02.jpg']);
    likeRepository.upsert(created.post.id);
    collectionRepository.saveToDefault(created.post.id);
    folderRepository.setAvatar(created.ownerFolder.id, created.images[0].id, 'manual');
    databaseManager.connection.exec(`
      CREATE TRIGGER reject_test_post_delete
      BEFORE DELETE ON posts
      WHEN OLD.id = ${created.post.id}
      BEGIN
        SELECT RAISE(ABORT, 'injected database failure');
      END;
    `);

    await expect(new PermanentDeletionService().deletePost(created.post.id)).rejects.toThrow('injected database failure');

    expect(postRepository.findById(created.post.id)).toEqual(created.post);
    expect(postRepository.listImageRecords(created.post.id)).toHaveLength(2);
    expect(likeRepository.getByPostId(created.post.id)).toBeDefined();
    expect(collectionRepository.isImageSaved(created.post.id)).toBe(true);
    expect(countRows('post_items', 'post_id', created.post.id)).toBe(2);
    expect(countRows('likes', 'post_id', created.post.id)).toBe(1);
    expect(countRows('collection_items', 'post_id', created.post.id)).toBe(1);
    expect(folderRepository.getById(created.ownerFolder.id)?.avatar_image_id).toBe(created.images[0].id);
    await expectPostFiles(created.images, true);
  });

  it('tolerates originals and derivatives that were already missing', async () => {
    const created = await createCarousel('missing', 'partial', ['01.jpg', '02.jpg']);
    await fs.rm(originalPath(created.images[0]), { force: true });
    await fs.rm(thumbnailPath(created.images[1]), { force: true });
    await fs.rm(previewPath(created.images[0]), { force: true });

    await expect(galleryService.deleteImage(created.post.id)).resolves.toMatchObject({ id: created.post.id });

    expect(postRepository.findById(created.post.id)).toBeUndefined();
    for (const image of created.images) expect(imageRepository.getById(image.id)).toBeUndefined();
    await expectPostFiles(created.images, false);
  });

  it('preserves a non-empty Carousel source directory', async () => {
    const created = await createCarousel('keep-directory', 'carousel', ['01.jpg', '02.jpg']);
    const unrelatedPath = path.join(created.sourceDirectory, 'metadata.json');
    await fs.writeFile(unrelatedPath, '{"keep":true}');

    await galleryService.deleteImage(created.post.id);

    await expect(fs.stat(created.sourceDirectory)).resolves.toBeDefined();
    await expect(fs.readFile(unrelatedPath, 'utf8')).resolves.toBe('{"keep":true}');
  });

  it('recovers an interruption after quarantine by restoring files when the post still exists', async () => {
    const created = await createCarousel('recovery', 'before-commit', ['01.jpg', '02.jpg']);
    const interruptedService = new PermanentDeletionService({
      afterQuarantine: () => {
        throw new SimulatedDeletionInterruptionError();
      }
    });

    await expect(interruptedService.deletePost(created.post.id)).rejects.toBeInstanceOf(SimulatedDeletionInterruptionError);
    expect(postRepository.findById(created.post.id)).toBeDefined();
    await expectPostFiles(created.images, false);

    await new PermanentDeletionService().recoverPendingDeletions();

    expect(postRepository.findById(created.post.id)).toBeDefined();
    expect(postRepository.listImageRecords(created.post.id)).toHaveLength(2);
    await expectPostFiles(created.images, true);
    expect(await journalFiles()).toEqual([]);
  });

  it('recovers an interruption after commit by cleaning quarantine without restoring the post', async () => {
    const created = await createCarousel('recovery', 'after-commit', ['01.jpg', '02.jpg']);
    const interruptedService = new PermanentDeletionService({
      afterDatabaseCommit: () => {
        throw new SimulatedDeletionInterruptionError();
      }
    });

    await expect(interruptedService.deletePost(created.post.id)).rejects.toBeInstanceOf(SimulatedDeletionInterruptionError);
    expect(postRepository.findById(created.post.id)).toBeUndefined();
    await expectPostFiles(created.images, false);
    expect(await journalFiles()).toHaveLength(1);

    await new PermanentDeletionService().recoverPendingDeletions();

    expect(postRepository.findById(created.post.id)).toBeUndefined();
    for (const image of created.images) expect(imageRepository.getById(image.id)).toBeUndefined();
    await expectPostFiles(created.images, false);
    await expect(fs.stat(created.sourceDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await journalFiles()).toEqual([]);
  });

  it('keeps the server status available and reports a warning when one recovery journal cannot be restored', async () => {
    const created = await createSingle('recovery/unrestorable.jpg');
    const interruptedService = new PermanentDeletionService({
      afterQuarantine: () => {
        throw new SimulatedDeletionInterruptionError();
      }
    });

    await expect(interruptedService.deletePost(created.post.id)).rejects.toBeInstanceOf(SimulatedDeletionInterruptionError);
    const journalName = (await journalFiles())[0];
    const journal = JSON.parse(await fs.readFile(
      path.join(appConfig.galleryRoot, '.foldergram-delete-quarantine', 'journals', journalName),
      'utf8'
    )) as {
      entries: Array<{ root: string; quarantineRelativePath: string }>;
    };
    const originalEntry = journal.entries.find((entry) => entry.root === 'gallery');
    expect(originalEntry).toBeDefined();
    await fs.appendFile(path.join(appConfig.galleryRoot, ...originalEntry!.quarantineRelativePath.split('/')), ':changed');

    await expect(permanentDeletionService.recoverPendingDeletions()).resolves.toBeUndefined();

    expect(postRepository.findById(created.post.id)).toBeDefined();
    expect(await journalFiles()).toEqual([journalName]);
    expect(galleryService.getStats().deletionRecovery).toMatchObject({
      failedCount: 1,
      failures: [{
        journalName,
        postId: created.post.id,
        folderSlug: created.ownerFolder.slug,
        message: 'Unable to restore 1 quarantined deletion target(s)'
      }]
    });
  });

  it('serializes deletion and thumbnail rebuilds in both directions', async () => {
    const deletedFirst = await createSingle('maintenance/delete-first.jpg');
    await createSingle('maintenance/rebuild-survivor.jpg');
    let releaseDeletion!: () => void;
    let reportQuarantined!: () => void;
    const deletionPaused = new Promise<void>((resolve) => { reportQuarantined = resolve; });
    const deletionRelease = new Promise<void>((resolve) => { releaseDeletion = resolve; });
    const pausingDeletion = new PermanentDeletionService({
      afterQuarantine: async () => {
        reportQuarantined();
        await deletionRelease;
      }
    });

    const deletionPromise = pausingDeletion.deletePost(deletedFirst.post.id);
    await deletionPaused;
    let rebuildSettled = false;
    const queuedRebuild = scannerService.rebuildThumbnails('lock-after-delete').finally(() => { rebuildSettled = true; });
    await wait(30);
    expect(rebuildSettled).toBe(false);
    expect(await journalFiles()).toHaveLength(1);

    releaseDeletion();
    await deletionPromise;
    await queuedRebuild;
    expect(postRepository.findById(deletedFirst.post.id)).toBeUndefined();

    const deletedSecond = await createSingle('maintenance/delete-second.jpg');
    let releaseRebuild!: () => void;
    let reportRebuildStarted!: () => void;
    const rebuildPaused = new Promise<void>((resolve) => { reportRebuildStarted = resolve; });
    const rebuildRelease = new Promise<void>((resolve) => { releaseRebuild = resolve; });
    generateThumbnailDerivativeMock.mockImplementationOnce(async (_sourcePath: string, relativePath: string) => {
      reportRebuildStarted();
      await rebuildRelease;
      return {
        thumbnailPath: `generated/${relativePath}.thumbnail.webp`,
        generatedThumbnail: true
      };
    });

    const runningRebuild = scannerService.rebuildThumbnails('lock-before-delete');
    await rebuildPaused;
    let secondDeletionSettled = false;
    const queuedDeletion = new PermanentDeletionService().deletePost(deletedSecond.post.id).finally(() => {
      secondDeletionSettled = true;
    });
    await wait(30);
    expect(secondDeletionSettled).toBe(false);
    await expect(fs.stat(originalPath(deletedSecond.images[0]))).resolves.toBeDefined();
    expect(await journalFiles()).toEqual([]);

    releaseRebuild();
    await runningRebuild;
    await queuedDeletion;
    expect(postRepository.findById(deletedSecond.post.id)).toBeUndefined();
  });

  it('keeps pending quarantine intact when committed cleanup cannot finish before a thumbnail rebuild', async () => {
    const created = await createSingle('cleanup-pending/photo.jpg');
    const interruptedService = new PermanentDeletionService({
      afterDatabaseCommit: () => {
        throw new SimulatedDeletionInterruptionError();
      }
    });
    await expect(interruptedService.deletePost(created.post.id)).rejects.toBeInstanceOf(SimulatedDeletionInterruptionError);

    const journalName = (await journalFiles())[0];
    const journalPath = path.join(appConfig.galleryRoot, '.foldergram-delete-quarantine', 'journals', journalName);
    const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as {
      entries: Array<{ root: string; quarantineRelativePath: string }>;
    };
    const thumbnailEntry = journal.entries.find((entry) => entry.root === 'thumbnails');
    expect(thumbnailEntry).toBeDefined();
    const quarantinedThumbnailPath = path.join(appConfig.thumbnailsDir, ...thumbnailEntry!.quarantineRelativePath.split('/'));
    await fs.appendFile(quarantinedThumbnailPath, ':identity-changed');

    await expect(scannerService.rebuildThumbnails('cleanup-pending')).resolves.toBeDefined();

    expect(postRepository.findById(created.post.id)).toBeUndefined();
    expect(await journalFiles()).toEqual([journalName]);
    await expect(fs.stat(quarantinedThumbnailPath)).resolves.toBeDefined();
  });

  it('keeps canonical and legacy delete routes pointed at their respective posts', async () => {
    const single = await createSingle('routes/single.jpg');
    const carouselA = await createCarousel('routes', 'carousel-a', ['01.jpg', '02.jpg']);
    const carouselB = await createCarousel('routes', 'carousel-b', ['01.jpg', '02.jpg']);
    expect(carouselA.images[1].id).toBe(carouselB.post.id);

    const canonical = await requestDelete(`/api/posts/${carouselB.post.id}`);
    expect(canonical.status).toBe(200);
    expect(canonical.body).toMatchObject({ ok: true, id: carouselB.post.id });
    expect(postRepository.findById(carouselB.post.id)).toBeUndefined();
    expect(postRepository.findById(carouselA.post.id)).toBeDefined();
    await expectPostFiles(carouselA.images, true);

    const legacy = await requestDelete(`/api/images/${carouselA.images[1].id}`);
    expect(legacy.status).toBe(200);
    expect(legacy.body).toMatchObject({ ok: true, id: carouselA.post.id });
    expect(postRepository.findById(carouselA.post.id)).toBeUndefined();
    expect(postRepository.findById(single.post.id)).toBeDefined();
    await expectPostFiles(single.images, true);
  });

  it('validates every stored path before moving files and rejects traversal without touching outside files', async () => {
    const created = await createCarousel('validation', 'carousel', ['01.jpg', '02.jpg']);
    const outsidePath = path.join(tempRoot, 'outside.webp');
    await fs.writeFile(outsidePath, 'outside');
    databaseManager.connection
      .prepare('UPDATE images SET preview_path = ? WHERE id = ?')
      .run('../outside.webp', created.images[1].id);

    await expect(galleryService.deleteImage(created.post.id)).rejects.toThrow('outside its configured root');

    expect(postRepository.findById(created.post.id)).toBeDefined();
    await expectPostFiles(created.images, true, { ignoreStoredPreviewPaths: true });
    await expect(fs.readFile(outsidePath, 'utf8')).resolves.toBe('outside');
  });

  it('rejects a source path whose parent was replaced by a symlink outside the gallery root', async () => {
    const created = await createSingle('symlink-guard/photo.jpg');
    const sourceDirectory = path.dirname(originalPath(created.images[0]));
    const escapedDirectory = path.join(tempRoot, 'escaped-source');
    await fs.rename(sourceDirectory, escapedDirectory);
    await fs.symlink(escapedDirectory, sourceDirectory, process.platform === 'win32' ? 'junction' : 'dir');

    await expect(galleryService.deleteImage(created.post.id)).rejects.toThrow('symbolic link');

    expect(postRepository.findById(created.post.id)).toBeDefined();
    await expect(fs.readFile(path.join(escapedDirectory, 'photo.jpg'), 'utf8')).resolves.toBe('original:symlink-guard/photo.jpg');
    await expect(fs.stat(thumbnailPath(created.images[0]))).resolves.toBeDefined();
    await expect(fs.stat(previewPath(created.images[0]))).resolves.toBeDefined();
    expect(await journalFiles()).toEqual([]);
  });

  async function createSingle(relativePath: string): Promise<CreatedPost> {
    const folderPath = relativePath.split('/').slice(0, -1).join('/');
    const ownerFolder = folderRepository.getByFolderPath(folderPath) ?? folderRepository.upsert({
      slug: folderPath.replaceAll('/', '-'),
      name: path.posix.basename(folderPath),
      folderPath
    });
    const image = await createImage(ownerFolder.id, relativePath);
    const post = postRepository.findByImageId(image.id);
    expect(post).toBeDefined();
    return { post: post!, images: [image], ownerFolder, sourceDirectory: path.dirname(originalPath(image)) };
  }

  async function createCarousel(ownerPath: string, name: string, filenames: string[]): Promise<CreatedPost> {
    const ownerFolder = folderRepository.getByFolderPath(ownerPath) ?? folderRepository.upsert({
      slug: ownerPath.replaceAll('/', '-'),
      name: path.posix.basename(ownerPath),
      folderPath: ownerPath
    });
    const carouselPath = `${ownerPath}/carousels/${name}`;
    const sourceFolder = folderRepository.upsert({
      slug: `${ownerFolder.slug}-carousel-${name}`,
      name,
      folderPath: carouselPath,
      role: 'carousel_source',
      carouselOwnerFolderId: ownerFolder.id
    });
    const images: ImageRecord[] = [];
    for (const filename of filenames) {
      images.push(await createImage(sourceFolder.id, `${carouselPath}/${filename}`));
    }
    const now = Date.now();
    const post = postRepository.upsertPostWithItems({
      folderId: ownerFolder.id,
      sourcePath: carouselPath,
      postType: 'carousel',
      sortTimestamp: now,
      takenAt: now,
      takenAtSource: 'mtime',
      isDeleted: 0,
      isTrashed: 0
    }, images.map((image, index) => ({ imageId: image.id, position: index + 1 })));
    return {
      post,
      images,
      ownerFolder,
      sourceDirectory: path.join(appConfig.galleryRoot, ...carouselPath.split('/'))
    };
  }

  async function createImage(folderId: number, relativePath: string): Promise<ImageRecord> {
    const absolutePath = path.join(appConfig.galleryRoot, ...relativePath.split('/'));
    const storedThumbnailPath = `generated/${relativePath}.thumbnail.webp`;
    const storedPreviewPath = `generated/${relativePath}.preview.webp`;
    const createdAt = Date.now();
    await Promise.all([
      writeFile(absolutePath, `original:${relativePath}`),
      writeFile(path.join(appConfig.thumbnailsDir, ...storedThumbnailPath.split('/')), `thumbnail:${relativePath}`),
      writeFile(path.join(appConfig.previewsDir, ...storedPreviewPath.split('/')), `preview:${relativePath}`)
    ]);
    const stats = await fs.stat(absolutePath);
    return imageRepository.upsert({
      folderId,
      filename: path.posix.basename(relativePath),
      extension: path.posix.extname(relativePath),
      relativePath,
      absolutePath,
      fileSize: stats.size,
      width: 1200,
      height: 800,
      mediaType: 'image',
      mimeType: 'image/jpeg',
      durationMs: null,
      fingerprint: `${relativePath}:${stats.size}:${stats.mtimeMs}`,
      mtimeMs: stats.mtimeMs,
      firstSeenAt: new Date(createdAt).toISOString(),
      sortTimestamp: createdAt,
      takenAt: createdAt,
      takenAtSource: 'mtime',
      exifJson: null,
      thumbnailPath: storedThumbnailPath,
      previewPath: storedPreviewPath
    });
  }

  async function writeFile(targetPath: string, contents: string): Promise<void> {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, contents);
  }

  function originalPath(image: ImageRecord): string {
    return path.join(appConfig.galleryRoot, ...image.relative_path.split('/'));
  }

  function thumbnailPath(image: ImageRecord): string {
    return path.join(appConfig.thumbnailsDir, ...image.thumbnail_path.split('/'));
  }

  function previewPath(image: ImageRecord): string {
    return path.join(appConfig.previewsDir, ...image.preview_path.split('/'));
  }

  async function expectPostFiles(
    images: ImageRecord[],
    shouldExist: boolean,
    options: { ignoreStoredPreviewPaths?: boolean } = {}
  ): Promise<void> {
    for (const image of images) {
      const paths = [originalPath(image), thumbnailPath(image)];
      if (!options.ignoreStoredPreviewPaths) paths.push(previewPath(image));
      for (const targetPath of paths) {
        if (shouldExist) {
          await expect(fs.stat(targetPath)).resolves.toBeDefined();
        } else {
          await expect(fs.stat(targetPath)).rejects.toMatchObject({ code: 'ENOENT' });
        }
      }
    }
  }

  async function journalFiles(): Promise<string[]> {
    const journalDirectory = path.join(appConfig.galleryRoot, '.foldergram-delete-quarantine', 'journals');
    try {
      return (await fs.readdir(journalDirectory)).filter((name) => name.endsWith('.json'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  function requestDelete(urlPath: string) {
    return requestTestApp(app, 'DELETE', urlPath, { 'x-foldergram-intent': '1' });
  }

  function wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function countRows(table: 'post_items' | 'likes' | 'collection_items', column: 'post_id', id: number): number {
    return Number(
      (databaseManager.connection.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = ?`).get(id) as { count: number }).count
    );
  }
});
