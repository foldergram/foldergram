import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { requestTestApp as requestApp } from './http-test-utils.js';

type DatabaseModule = typeof import('../src/db/database.js');

describe.sequential('post share links', () => {
  let tempRoot = '';
  let app: express.Application;
  let postAId = 0;
  let postBId = 0;
  let imageAId = 0;
  let imageBId = 0;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-post-share-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    try {
      const dbModule: DatabaseModule = await import('../src/db/database.js');
      dbModule.databaseManager.close();
    } catch {
      // Not loaded yet.
    }

    await fs.rm(tempRoot, { recursive: true, force: true });
    await Promise.all([
      fs.mkdir(path.join(tempRoot, 'db'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'gallery', 'album'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'thumbnails', 'album'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'previews', 'album'), { recursive: true })
    ]);

    vi.resetModules();
    const { createApp } = await import('../src/app.js');
    const { authService } = await import('../src/services/auth-service.js');
    const { folderRepository, imageRepository, maintenanceRepository } = await import('../src/db/repositories.js');

    maintenanceRepository.resetLibraryIndex();
    // Auth on, viewer access locked: a share token has to stand on its own.
    authService.setAdminPassword('admin12345');
    authService.setViewerAccess('password', 'viewer12345');

    const folder = folderRepository.upsert({ slug: 'album', name: 'Album', folderPath: 'album' });

    const createImage = (filename: string, fingerprint: string) =>
      imageRepository.upsert({
        folderId: folder.id,
        filename,
        extension: 'jpg',
        relativePath: `album/${filename}`,
        absolutePath: path.join(tempRoot, 'gallery', 'album', filename),
        fileSize: 1024,
        width: 800,
        height: 600,
        mediaType: 'image',
        mimeType: 'image/jpeg',
        durationMs: null,
        fingerprint,
        mtimeMs: Date.now(),
        firstSeenAt: new Date().toISOString(),
        sortTimestamp: Date.now(),
        takenAt: Date.now(),
        takenAtSource: 'mtime',
        thumbnailPath: `album/${filename.replace(/\.jpg$/, '.webp')}`,
        previewPath: `album/${filename.replace(/\.jpg$/, '.webp')}`,
        exifJson: null
      });

    const imageA = createImage('shared.jpg', 'fp-shared');
    const imageB = createImage('secret.jpg', 'fp-secret');
    imageAId = imageA.id;
    imageBId = imageB.id;

    const { postRepository } = await import('../src/db/repositories.js');
    postAId = postRepository.findByImageId(imageA.id)!.id;
    postBId = postRepository.findByImageId(imageB.id)!.id;

    await fs.writeFile(path.join(tempRoot, 'thumbnails', 'album', 'shared.webp'), 'thumb-shared');
    await fs.writeFile(path.join(tempRoot, 'thumbnails', 'album', 'secret.webp'), 'thumb-secret');
    await fs.writeFile(path.join(tempRoot, 'previews', 'album', 'shared.webp'), 'preview-shared');
    await fs.writeFile(path.join(tempRoot, 'previews', 'album', 'secret.webp'), 'preview-secret');

    app = createApp();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    try {
      const dbModule: DatabaseModule = await import('../src/db/database.js');
      dbModule.databaseManager.close();
    } catch {
      // Ignore
    }
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('serves only the shared post through a valid token', async () => {
    const { postShareService } = await import('../src/services/post-share-service.js');
    const created = postShareService.createLink(postAId, { expiresAt: null })!;

    const detail = await requestApp(app, 'GET', `/api/share/post-links/${created.rawToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.id).toBe(postAId);
    expect(detail.body.thumbnailUrl).toContain(`/api/share/post-links/${created.rawToken}/images/${imageAId}/thumbnail`);
    // Neighbour ids would let a viewer walk the whole album.
    expect(detail.body.nextImageId).toBeNull();
    expect(detail.body.previousImageId).toBeNull();

    const thumbnail = await requestApp(
      app,
      'GET',
      `/api/share/post-links/${created.rawToken}/images/${imageAId}/thumbnail`
    );
    expect(thumbnail.status).toBe(200);
  });

  it('refuses ids the token was not minted for', async () => {
    const { postShareService } = await import('../src/services/post-share-service.js');
    const created = postShareService.createLink(postAId, { expiresAt: null })!;

    const foreignThumbnail = await requestApp(
      app,
      'GET',
      `/api/share/post-links/${created.rawToken}/images/${imageBId}/thumbnail`
    );
    expect(foreignThumbnail.status).toBe(404);

    const otherToken = postShareService.createLink(postBId, { expiresAt: null })!;
    const otherDetail = await requestApp(app, 'GET', `/api/share/post-links/${otherToken.rawToken}`);
    expect(otherDetail.status).toBe(200);
    expect(otherDetail.body.id).toBe(postBId);
  });

  it('stops serving a revoked or expired token', async () => {
    const { postShareService } = await import('../src/services/post-share-service.js');
    const revoked = postShareService.createLink(postAId, { expiresAt: null })!;
    postShareService.revokeLink(postAId, revoked.link.id);

    const afterRevoke = await requestApp(app, 'GET', `/api/share/post-links/${revoked.rawToken}`);
    expect(afterRevoke.status).toBe(404);

    const expired = postShareService.createLink(postAId, { expiresAt: new Date(Date.now() - 1000) })!;
    const afterExpiry = await requestApp(app, 'GET', `/api/share/post-links/${expired.rawToken}`);
    expect(afterExpiry.status).toBe(404);

    const garbage = await requestApp(app, 'GET', '/api/share/post-links/not-a-real-token');
    expect(garbage.status).toBe(404);
  });

  it('requires admin rights to mint a link', async () => {
    const anonymous = await requestApp(app, 'POST', `/api/share/posts/${postAId}`, {
      'x-foldergram-intent': '1'
    });
    expect(anonymous.status).toBe(401);
  });
});
