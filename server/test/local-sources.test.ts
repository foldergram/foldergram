import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heicFixture } from './fixtures/heic.js';
import { requestTestApp } from './http-test-utils.js';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

describe('local gallery sources', () => {
  let root: string;
  let primary: string;
  let secondary: string;
  let app: ReturnType<typeof import('../src/app.js')['createApp']>;
  let scanner: typeof import('../src/services/scanner-service.js')['scannerService'];
  let db: typeof import('../src/db/database.js')['databaseManager'];
  const mutation = { 'x-foldergram-intent': '1' };
  const request = (method: string, url: string, body?: unknown) => requestTestApp(app, method, url, mutation, body);

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-local-sources-'));
    primary = path.join(root, 'primary');
    secondary = path.join(root, 'secondary');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(root, 'data'));
    vi.stubEnv('GALLERY_ROOT', primary);
    vi.stubEnv('DB_DIR', path.join(root, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(root, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(root, 'previews'));
    vi.stubEnv('DERIVATIVE_MODE', 'eager');
    vi.stubEnv('HEIC_ENABLED', undefined);
    vi.resetModules();
    ({ databaseManager: db } = await import('../src/db/database.js'));
    ({ scannerService: scanner } = await import('../src/services/scanner-service.js'));
    app = (await import('../src/app.js')).createApp();
  });

  afterEach(async () => {
    db?.close();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  async function writePhoto(directory: string, relativePath: string, color: string) {
    const file = path.join(directory, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await sharp({ create: { width: 16, height: 12, channels: 3, background: color } }).jpeg().toFile(file);
    return file;
  }

  async function writeHeic(directory: string, relativePath: string) {
    const file = path.join(directory, relativePath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, heicFixture);
    return file;
  }

  async function addSource(directory: string, name = 'Backup drive') {
    const response = await request('POST', '/api/admin/sources', { kind: 'local', rootPath: directory, name });
    expect(response.status).toBe(201);
    const source = response.body as { id: number; readOnlyOriginals: boolean };
    await scanner.scanSource(source.id);
    return source;
  }

  it('indexes equal relative paths separately and preserves cached content through offline and empty mounts', async () => {
    const relativePath = 'Family/photo.jpg';
    const primaryPhoto = await writePhoto(primary, relativePath, '#963342');
    const secondaryPhoto = await writePhoto(secondary, relativePath, '#225599');
    await writePhoto(secondary, 'ignored.jpg', '#888888');
    await scanner.scanAll('fixture');
    const created = await addSource(secondary);
    expect(created.readOnlyOriginals).toBe(true);
    const rows = db.connection.prepare('SELECT id, source_id, relative_path, thumbnail_path FROM images ORDER BY id').all() as Array<{ id: number; source_id: number; relative_path: string; thumbnail_path: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].relative_path).toBe(rows[1].relative_path);
    expect(rows[0].source_id).not.toBe(rows[1].source_id);
    expect(rows[0].thumbnail_path).not.toBe(rows[1].thumbnail_path);
    expect(db.connection.prepare('SELECT slug FROM folders ORDER BY id').all()).toEqual([{ slug: 'family' }, { slug: 'family-2' }]);
    expect((await request('GET', `/api/originals/${rows[0].id}`)).rawBody).toEqual(await fs.readFile(primaryPhoto));
    expect((await request('GET', `/api/originals/${rows[1].id}`)).rawBody).toEqual(await fs.readFile(secondaryPhoto));

    const unmounted = path.join(root, 'unmounted');
    await fs.rename(secondary, unmounted);
    await scanner.scanSource(created.id);
    expect((await request('GET', `/api/originals/${rows[1].id}`)).status).toBe(503);
    expect((await request('GET', `/thumbnails/${rows[1].thumbnail_path}`)).status).toBe(200);
    expect((await request('GET', `/api/originals/${rows[0].id}`)).status).toBe(200);
    const statuses = await request('GET', '/api/sources/status?retry=1');
    expect(statuses.rawBody.toString()).not.toContain(root);

    await fs.mkdir(secondary);
    await scanner.scanSource(created.id);
    expect(db.connection.prepare('SELECT status, asset_count FROM media_sources WHERE id=?').get(created.id)).toMatchObject({ status: 'empty_review', asset_count: 1 });
    expect(db.connection.prepare('SELECT is_deleted FROM images WHERE id=?').get(rows[1].id)).toMatchObject({ is_deleted: 0 });

    await fs.rmdir(secondary);
    await fs.rename(unmounted, secondary);
    await scanner.scanSource(created.id);
    expect(db.connection.prepare('SELECT id, thumbnail_path FROM images WHERE source_id=?').get(created.id)).toMatchObject({ id: rows[1].id, thumbnail_path: rows[1].thumbnail_path });
    expect((await request('PATCH', `/api/admin/sources/${created.id}`, { kind: 'local', enabled: false })).status).toBe(200);
    expect((await request('GET', `/thumbnails/${rows[1].thumbnail_path}`)).status).toBe(404);
    expect((await request('GET', `/api/originals/${rows[1].id}`)).status).toBe(404);
    expect((await request('DELETE', `/api/admin/sources/${created.id}`)).status).toBe(200);
    expect(await fs.stat(secondaryPhoto)).toBeTruthy();
    expect(await fs.stat(primaryPhoto)).toBeTruthy();
    expect(db.connection.prepare('SELECT source_id FROM images ORDER BY id').all()).toEqual([{ source_id: rows[0].source_id }]);
    expect(db.connection.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  });

  it.each(['eager', 'lazy'] as const)('indexes and serves HEIC from both local sources in %s mode', async (mode) => {
    const { appConfig } = await import('../src/config/env.js');
    appConfig.heicEnabledOverride = true;
    appConfig.derivativeMode = mode;
    appConfig.imageDetailSource = 'original';
    app = (await import('../src/app.js')).createApp();
    const relativePath = 'Family/photo.HEIF';
    const original = path.join(primary, relativePath);
    await writePhoto(primary, 'Family/photo.jpg', '#123456');
    await fs.mkdir(path.join(secondary, 'Family'), { recursive: true });
    await fs.writeFile(original, heicFixture);
    await fs.writeFile(path.join(secondary, relativePath), heicFixture);
    await scanner.scanAll('fixture');
    await addSource(secondary);
    const rows = db.connection.prepare("SELECT * FROM images WHERE relative_path = ? ORDER BY id")
      .all(relativePath) as Array<{ id: number; source_id: number; width: number; height: number; mime_type: string; thumbnail_path: string; preview_path: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].source_id).not.toBe(rows[1].source_id);
    expect(rows[0].thumbnail_path).not.toBe(rows[1].thumbnail_path);
    expect(db.connection.prepare('SELECT DISTINCT thumbnail_path FROM images').all()).toHaveLength(3);

    for (const row of rows) {
      expect(row).toMatchObject({ width: 96, height: 64, mime_type: 'image/heif' });
      const oldPreview = path.join(appConfig.previewsDir, row.preview_path);
      if (mode === 'lazy') await expect(fs.stat(oldPreview)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect((await fs.stat(oldPreview)).size).toBeGreaterThan(0);

      const detail = await request('GET', `/api/images/${row.id}`);
      expect(detail.status).toBe(200);
      const item = detail.body as { previewUrl: string; originalUrl: string };
      expect(item.previewUrl).toContain('/previews/');
      expect(item.originalUrl).toBe(`/api/originals/${row.id}`);
      const preview = await request('GET', item.previewUrl);
      expect(preview.status).toBe(200);
      expect(await sharp(preview.rawBody).metadata()).toMatchObject({ format: 'webp', width: 96, height: 64 });

      const download = await request('GET', `${item.originalUrl}?download=1`);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe('image/heif');
      expect(download.headers.get('content-disposition')).toContain('photo.HEIF');
      expect(download.rawBody).toEqual(heicFixture);
    }

    await fs.utimes(original, new Date(), new Date(Date.now() + 5000));
    await scanner.scanAll('fixture');
    const replacement = db.connection.prepare('SELECT id, preview_path FROM images WHERE id = ?').get(rows[0].id) as { id: number; preview_path: string };
    expect(replacement.id).toBe(rows[0].id);
    expect(replacement.preview_path).not.toBe(rows[0].preview_path);
    expect((await request('GET', `/previews/${rows[0].preview_path}`)).status).toBe(404);

    const { authService } = await import('../src/services/auth-service.js');
    const { folderShareService } = await import('../src/services/folder-share-service.js');
    authService.setAdminPassword('admin12345');
    authService.setViewerAccess('password', 'viewer12345');
    const link = folderShareService.createLink('family', { expiresAt: null })!;
    const grant = folderShareService.verifyLinkToken('family', link.rawToken)!;
    const mockResponse = { cookie: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    folderShareService.setShareSession(mockResponse as any, { secure: false, get: () => undefined } as any, grant);
    const shareCookie = `foldergram_share_session=${mockResponse.cookie.mock.calls.at(-1)?.[1]}`;
    const shared = await requestTestApp(app, 'GET', `/api/share/images/${rows[0].id}/preview`, { Cookie: shareCookie });
    expect(shared.status).toBe(200);
    expect(await sharp(shared.rawBody).metadata()).toMatchObject({ format: 'webp', width: 96, height: 64 });
    const outsideShare = await requestTestApp(app, 'GET', `/api/share/images/${rows[1].id}/preview`, { Cookie: shareCookie });
    expect(outsideShare.status).toBe(401);
  }, 20_000);

  it('admits scan and on-demand HEIC jobs during a mixed-format scan', async () => {
    const { appConfig } = await import('../src/config/env.js');
    const { derivativeWorkLimit } = await import('../src/services/heic/service.js');
    const derivatives = await import('../src/services/derivative-service.js');
    const originalGenerate = derivatives.generateDerivatives;
    const originalConcurrency = derivativeWorkLimit.concurrency;

    appConfig.heicEnabledOverride = true;
    appConfig.derivativeMode = 'lazy';
    await writeHeic(primary, 'Album/on-demand.heic');
    await scanner.scanAll('fixture');
    const cached = db.connection.prepare('SELECT thumbnail_path FROM images WHERE filename = ?')
      .get('on-demand.heic') as { thumbnail_path: string };

    appConfig.derivativeMode = 'eager';
    derivativeWorkLimit.concurrency = 1;
    await Promise.all(Array.from({ length: 10 }, (_, index) =>
      writePhoto(primary, `Album/${index}.jpg`, '#123456')
    ));
    await writeHeic(primary, 'Album/z-background.heic');

    let releaseFirstJpeg!: () => void;
    const holdFirstJpeg = new Promise<void>(resolve => { releaseFirstJpeg = resolve; });
    let releaseLastJpeg!: () => void;
    const holdLastJpeg = new Promise<void>(resolve => { releaseLastJpeg = resolve; });
    let ordinaryJobsStarted = 0;
    const generate = vi.spyOn(derivatives, 'generateDerivatives').mockImplementation(async (...args) => {
      if (args[1].endsWith('.jpg')) {
        ordinaryJobsStarted += 1;
        if (ordinaryJobsStarted === 1) await holdFirstJpeg;
        if (ordinaryJobsStarted === 10) await holdLastJpeg;
      }
      return originalGenerate(...args);
    });

    let scan: ReturnType<typeof scanner.scanAll> | undefined;
    let foreground: ReturnType<typeof request> | undefined;
    try {
      scan = scanner.scanAll('fixture', { repairUnchangedDerivatives: false });
      await vi.waitFor(() => expect(ordinaryJobsStarted).toBe(1));
      foreground = request('GET', `/thumbnails/${cached.thumbnail_path}`);
      await vi.waitFor(() => expect(generate).toHaveBeenCalledWith(
        expect.any(String), 'Album/z-background.heic', expect.any(Boolean), expect.any(Object)
      ));
      expect(derivativeWorkLimit.pendingCount)
        .toBeLessThanOrEqual(appConfig.scanDerivativeConcurrency + appConfig.heicDecodeConcurrency);
      releaseFirstJpeg();
      // At most a few JPEGs run before the foreground worker can acquire a
      // slot. The last JPEG stays blocked until the response has been sent.
      let foregroundResult: number | undefined;
      void foreground.then(response => { foregroundResult = response.status; });
      await vi.waitFor(() => expect(foregroundResult).toBe(200), { timeout: 5000 });
      releaseLastJpeg();
      expect(await scan).toMatchObject({ status: 'completed' });
      const indexed = db.connection.prepare('SELECT preview_path FROM images WHERE filename = ?')
        .get('z-background.heic') as { preview_path: string };
      expect((await fs.stat(path.join(appConfig.previewsDir, indexed.preview_path))).size).toBeGreaterThan(0);
    } finally {
      releaseFirstJpeg();
      releaseLastJpeg();
      await Promise.allSettled([scan, foreground]);
      generate.mockRestore();
      derivativeWorkLimit.concurrency = originalConcurrency;
    }
  }, 20_000);

  it('rebuilds and lazily regenerates thumbnails for trashed HEIC files', async () => {
    const { appConfig } = await import('../src/config/env.js');
    appConfig.heicEnabledOverride = true;
    await writeHeic(primary, 'Family/trash.heic');
    expect(await scanner.scanAll('fixture')).toMatchObject({ status: 'completed' });
    const row = db.connection.prepare('SELECT id, thumbnail_path, preview_path FROM images WHERE filename = ?')
      .get('trash.heic') as { id: number; thumbnail_path: string; preview_path: string };
    expect((await request('POST', `/api/images/${row.id}/trash`)).status).toBe(200);
    expect(await scanner.rebuildThumbnails()).toMatchObject({ status: 'completed' });

    const filename = path.join(appConfig.thumbnailsDir, row.thumbnail_path);
    expect(await sharp(filename).metadata()).toMatchObject({ format: 'webp', width: 96, height: 64 });
    expect((await request('GET', `/previews/${row.preview_path}`)).status).toBe(404);
    const trash = await request('GET', '/api/trash/images');
    expect(trash.body.items).toEqual([expect.objectContaining({ thumbnailUrl: expect.stringContaining(row.thumbnail_path) })]);

    const { authService } = await import('../src/services/auth-service.js');
    authService.setAdminPassword('admin12345');
    authService.setViewerAccess('password', 'viewer12345');
    const mockResponse = { cookie: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    const makeCookie = (role: 'admin' | 'viewer') => {
      authService.setAuthenticatedSession(mockResponse as any, { secure: false, get: () => undefined } as any, role);
      return `foldergram_session=${mockResponse.cookie.mock.calls.at(-1)?.[1]}`;
    };
    const thumbnailUrl = `/thumbnails/${row.thumbnail_path}`;
    const viewerCookie = makeCookie('viewer');
    expect((await requestTestApp(app, 'GET', thumbnailUrl, { Cookie: viewerCookie })).status).toBe(404);

    await fs.unlink(filename);
    const regenerated = await requestTestApp(app, 'GET', thumbnailUrl, { Cookie: makeCookie('admin') });
    expect(regenerated.status).toBe(200);
    expect(await sharp(regenerated.rawBody).metadata()).toMatchObject({ format: 'webp', width: 96, height: 64 });
    expect(db.connection.prepare('SELECT is_trashed FROM images WHERE id = ?').get(row.id)).toMatchObject({ is_trashed: 1 });
  }, 20_000);

  it('indexes and renders new HEIC files on the first scan after restoring an empty mount', async () => {
    const { appConfig } = await import('../src/config/env.js');
    appConfig.heicEnabledOverride = true;
    await writePhoto(secondary, 'Family/old.jpg', '#123456');
    const source = await addSource(secondary);
    const temporarilyUnmounted = path.join(root, 'unmounted');
    await fs.rename(secondary, temporarilyUnmounted);
    await fs.mkdir(secondary);
    expect(await scanner.scanSource(source.id)).toMatchObject({ status: 'failed' });
    expect(db.connection.prepare('SELECT status FROM media_sources WHERE id = ?').get(source.id))
      .toMatchObject({ status: 'empty_review' });

    await fs.rmdir(secondary);
    await fs.rename(temporarilyUnmounted, secondary);
    await writeHeic(secondary, 'Family/new.HEIF');
    expect(await scanner.scanSource(source.id)).toMatchObject({ status: 'completed', new_files: 1 });
    const row = db.connection.prepare('SELECT preview_path FROM images WHERE source_id = ? AND filename = ?')
      .get(source.id, 'new.HEIF') as { preview_path: string };
    expect(await sharp(path.join(appConfig.previewsDir, row.preview_path)).metadata()).toMatchObject({ format: 'webp' });
    expect(db.connection.prepare('SELECT status, asset_count FROM media_sources WHERE id = ?').get(source.id))
      .toMatchObject({ status: 'ready', asset_count: 2 });
  }, 20_000);

  it.each(['primary', 'registered'] as const)(
    'uses the saved HEIC preference and reconciles indexed originals in the %s gallery',
    async (kind) => {
      const directory = kind === 'primary' ? primary : secondary;
      const heicPath = 'Family/photo.HEIC';
      await writePhoto(directory, 'Family/photo.jpg', '#123456');
      const heic = await writeHeic(directory, heicPath);
      await writeHeic(directory, 'OnlyHeic/only.heif');
      const source = kind === 'registered' ? await addSource(directory) : null;
      const scan = () => source ? scanner.scanSource(source.id) : scanner.scanAll('fixture');
      const scanChangedPaths = () => scanner.scanChangedPaths([heicPath], 'watcher', source?.id);

      expect(await scan()).toMatchObject({ status: 'completed' });
      expect(db.connection.prepare('SELECT filename FROM images').all()).toEqual([{ filename: 'photo.jpg' }]);

      expect((await request('PUT', '/api/admin/settings/heic-import', { enabled: true })).status).toBe(200);
      expect(await scan()).toMatchObject({ status: 'completed', new_files: 2 });
      const originalRow = db.connection.prepare('SELECT id, asset_key, preview_path FROM images WHERE filename = ?')
        .get('photo.HEIC') as { id: number; asset_key: string; preview_path: string };

      expect((await request('PUT', '/api/admin/settings/heic-import', { enabled: false })).status).toBe(200);
      await writeHeic(directory, 'Family/ignored.heic');
      await writeHeic(directory, 'Unindexed/ignored.heif');
      expect(await scan()).toMatchObject({ status: 'completed', new_files: 0, removed_files: 0 });
      expect(db.connection.prepare('SELECT filename, is_deleted FROM images ORDER BY filename').all()).toEqual([
        { filename: 'only.heif', is_deleted: 0 },
        { filename: 'photo.HEIC', is_deleted: 0 },
        { filename: 'photo.jpg', is_deleted: 0 }
      ]);
      expect((await request('GET', `/previews/${originalRow.preview_path}`)).status).toBe(200);

      await fs.utimes(heic, new Date(), new Date(Date.now() + 2000));
      expect(await scanChangedPaths()).toMatchObject({ status: 'completed', updated_files: 1 });
      expect(db.connection.prepare('SELECT asset_key, is_deleted FROM images WHERE id = ?').get(originalRow.id))
        .toMatchObject({ asset_key: originalRow.asset_key, is_deleted: 0 });

      await fs.unlink(heic);
      expect(await scanChangedPaths()).toMatchObject({ status: 'completed', removed_files: 1 });
      expect(db.connection.prepare('SELECT is_deleted FROM images WHERE id = ?').get(originalRow.id))
        .toMatchObject({ is_deleted: 1 });

      await writeHeic(directory, heicPath);
      expect(await scanChangedPaths()).toMatchObject({ status: 'completed' });
      const restored = db.connection.prepare('SELECT asset_key, is_deleted, preview_path FROM images WHERE id = ?')
        .get(originalRow.id) as { asset_key: string; is_deleted: number; preview_path: string };
      expect(restored).toMatchObject({ asset_key: originalRow.asset_key, is_deleted: 0 });
      expect((await request('GET', `/previews/${restored.preview_path}`)).status).toBe(200);
    },
    20_000
  );

  it('serves only indexed, enabled derivatives in eager mode', async () => {
    await writePhoto(secondary, 'Family/photo.jpg', '#123456');
    const source = await addSource(secondary);
    const image = db.connection.prepare('SELECT thumbnail_path, preview_path FROM images WHERE source_id = ?')
      .get(source.id) as { thumbnail_path: string; preview_path: string };
    const { appConfig } = await import('../src/config/env.js');

    for (const [route, directory, file] of [
      ['thumbnails', appConfig.thumbnailsDir, image.thumbnail_path],
      ['previews', appConfig.previewsDir, image.preview_path]
    ]) {
      const canonical = await request('GET', `/${route}/${file}`);
      expect(canonical.status).toBe(200);
      expect(canonical.rawBody).toEqual(await fs.readFile(path.join(directory, file)));
      expect((await request('GET', `/${route}/extra/%2E/${file}`)).status).toBe(400);
      await fs.writeFile(path.join(directory, 'unindexed.webp'), canonical.rawBody);
      expect((await request('GET', `/${route}/unindexed.webp`)).status).toBe(404);
    }

    expect((await request('PATCH', `/api/admin/sources/${source.id}`, { kind: 'local', enabled: false })).status).toBe(200);
    for (const [route, file] of [['thumbnails', image.thumbnail_path], ['previews', image.preview_path]]) {
      expect((await request('GET', `/${route}/${file}`)).status).toBe(404);
      expect((await request('GET', `/${route}/extra/%2E%2E/${file}`)).status).toBe(400);
    }
  });

  it('limits representative place synchronization to the requested source', async () => {
    await writePhoto(primary, 'Family/photo.jpg', '#963342');
    await writePhoto(secondary, 'Family/photo.jpg', '#225599');
    await scanner.scanAll('fixture');
    const source = await addSource(secondary);
    const { postRepository } = await import('../src/db/repositories.js');
    db.connection.exec(`
      INSERT INTO places (id, slug, display_name, kind, source) VALUES (17, 'fixture', 'Fixture', 'city', 'manual');
      UPDATE posts SET place_id = 17;
    `);
    const primaryPost = db.connection.prepare('SELECT id, source_id FROM posts WHERE source_id <> ?').get(source.id) as { id: number; source_id: number };
    const secondaryPost = db.connection.prepare('SELECT id FROM posts WHERE source_id = ?').get(source.id) as { id: number };

    expect(postRepository.syncRepresentativePlaces(primaryPost.source_id)).toBe(1);
    expect(postRepository.findById(primaryPost.id)?.place_id).toBeNull();
    expect(postRepository.findById(secondaryPost.id)?.place_id).toBe(17);
    expect(postRepository.syncRepresentativePlaces()).toBe(1);
    expect(postRepository.findById(secondaryPost.id)?.place_id).toBeNull();
  });

  it('requires confirmation before applying an empty scan and keeps saved associations', async () => {
    await writePhoto(secondary, 'Family/photo.jpg', '#123456');
    const source = await addSource(secondary);
    const post = db.connection.prepare('SELECT id FROM posts WHERE source_id=?').get(source.id) as { id: number };
    db.connection.prepare('INSERT INTO likes(post_id) VALUES (?)').run(post.id);
    await fs.rm(path.join(secondary, 'Family'), { recursive: true });
    await scanner.scanSource(source.id);
    expect(db.connection.prepare('SELECT is_deleted FROM posts WHERE id=?').get(post.id)).toMatchObject({ is_deleted: 0 });

    await scanner.scanSource(source.id, 'source', { confirmEmpty: true });
    expect(db.connection.prepare('SELECT is_deleted FROM posts WHERE id=?').get(post.id)).toMatchObject({ is_deleted: 1 });
    expect(db.connection.prepare('SELECT post_id FROM likes').get()).toMatchObject({ post_id: post.id });
  });

  it('allows database Trash but blocks original deletion for read-only sources', async () => {
    const original = await writePhoto(secondary, 'Family/photo.jpg', '#123456');
    const source = await addSource(secondary);
    const post = db.connection.prepare('SELECT id FROM posts WHERE source_id=?').get(source.id) as { id: number };
    const { galleryService } = await import('../src/services/gallery-service.js');
    const detail = await request('GET', `/api/posts/${post.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.canWriteOriginals).toBe(false);
    expect(galleryService.trashImage(post.id)).toMatchObject({ id: post.id });
    await expect(galleryService.deleteImage(post.id)).rejects.toThrow('does not permit original-file deletion');
    expect(await fs.stat(original)).toBeTruthy();
    expect(db.connection.prepare('SELECT is_trashed FROM posts WHERE id=?').get(post.id)).toMatchObject({ is_trashed: 1 });
  });

  it('recovers an interrupted deletion from its writable source without touching the same path in the primary gallery', async () => {
    const relativePath = 'Family/photo.jpg';
    const primaryPhoto = await writePhoto(primary, relativePath, '#963342');
    const secondaryPhoto = await writePhoto(secondary, relativePath, '#225599');
    await scanner.scanAll('fixture');
    const source = await addSource(secondary);
    expect((await request('PATCH', `/api/admin/sources/${source.id}`, { kind: 'local', readOnlyOriginals: false })).status).toBe(200);
    const post = db.connection.prepare('SELECT id FROM posts WHERE source_id=?').get(source.id) as { id: number };
    const secondaryContent = await fs.readFile(secondaryPhoto);
    const primaryContent = await fs.readFile(primaryPhoto);
    const { PermanentDeletionService, SimulatedDeletionInterruptionError } = await import('../src/services/permanent-deletion-service.js');
    const interrupted = new PermanentDeletionService({
      afterQuarantine: journal => {
        expect(journal.sourceId).toBe(source.id);
        expect(journal.rootPath).toBe(secondary);
        throw new SimulatedDeletionInterruptionError();
      }
    });

    await expect(interrupted.deletePost(post.id)).rejects.toBeInstanceOf(SimulatedDeletionInterruptionError);
    await expect(fs.stat(secondaryPhoto)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(primaryPhoto)).toEqual(primaryContent);
    const recovered = new PermanentDeletionService();
    await recovered.recoverPendingDeletions();
    expect(recovered.getRecoveryStatus().failedCount).toBe(0);
    expect(await fs.readFile(secondaryPhoto)).toEqual(secondaryContent);
    expect(await fs.readFile(primaryPhoto)).toEqual(primaryContent);
    expect(db.connection.prepare('SELECT id FROM posts WHERE source_id=?').get(source.id)).toMatchObject({ id: post.id });
  });

  it('rejects missing folders, overlapping roots and aliases without creating directories', async () => {
    const missing = path.join(root, 'missing');
    const rejected = await request('POST', '/api/admin/sources/local/test', { rootPath: missing });
    expect(rejected.status).toBe(400);
    expect(rejected.body).toMatchObject({ field: 'rootPath', code: 'missing' });
    await expect(fs.stat(missing)).rejects.toMatchObject({ code: 'ENOENT' });

    const child = path.join(primary, 'child');
    await fs.mkdir(child, { recursive: true });
    const overlap = await request('POST', '/api/admin/sources/local/test', { rootPath: child });
    expect(overlap.body).toMatchObject({ code: 'overlap' });
    const alias = path.join(root, 'alias');
    await fs.symlink(child, alias, 'dir');
    expect((await request('POST', '/api/admin/sources/local/test', { rootPath: alias })).body).toMatchObject({ code: 'overlap' });
    expect((await request('POST', '/api/admin/sources/local/test', { rootPath: path.join(root, 'db') })).body).toMatchObject({ code: 'private_storage' });
  });
});
