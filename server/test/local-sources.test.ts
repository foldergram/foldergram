import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';

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
