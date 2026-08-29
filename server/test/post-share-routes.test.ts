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
  let videoPostId = 0;
  let videoImageId = 0;

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

    // A video record is what exercises the HLS mount; images never reach it.
    const video = imageRepository.upsert({
      folderId: folder.id,
      filename: 'clip.mp4',
      extension: 'mp4',
      relativePath: 'album/clip.mp4',
      absolutePath: path.join(tempRoot, 'gallery', 'album', 'clip.mp4'),
      fileSize: 4096,
      width: 720,
      height: 1280,
      mediaType: 'video',
      mimeType: 'video/mp4',
      durationMs: 12_400,
      fingerprint: 'fp-clip',
      mtimeMs: Date.now(),
      firstSeenAt: new Date().toISOString(),
      sortTimestamp: Date.now(),
      takenAt: Date.now(),
      takenAtSource: 'mtime',
      thumbnailPath: 'album/clip.webp',
      previewPath: 'album/clip.webp',
      exifJson: null
    });
    videoImageId = video.id;

    const { postRepository } = await import('../src/db/repositories.js');
    postAId = postRepository.findByImageId(imageA.id)!.id;
    postBId = postRepository.findByImageId(imageB.id)!.id;
    videoPostId = postRepository.findByImageId(video.id)!.id;

    await fs.writeFile(path.join(tempRoot, 'thumbnails', 'album', 'shared.webp'), 'thumb-shared');
    await fs.writeFile(path.join(tempRoot, 'thumbnails', 'album', 'secret.webp'), 'thumb-secret');
    await fs.writeFile(path.join(tempRoot, 'previews', 'album', 'shared.webp'), 'preview-shared');
    await fs.writeFile(path.join(tempRoot, 'previews', 'album', 'secret.webp'), 'preview-secret');
    await fs.writeFile(path.join(tempRoot, 'gallery', 'album', 'clip.mp4'), 'not-a-real-clip');
    await fs.writeFile(path.join(tempRoot, 'thumbnails', 'album', 'clip.webp'), 'thumb-clip');
    await fs.writeFile(path.join(tempRoot, 'previews', 'album', 'clip.webp'), 'preview-clip');

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

  it('streams the shared video over HLS with token-scoped playlist paths', async () => {
    const { postShareService } = await import('../src/services/post-share-service.js');
    const created = postShareService.createLink(videoPostId, { expiresAt: null })!;
    const base = `/api/share/post-links/${created.rawToken}/videos`;

    // Regression: the stream router is mounted under `:token`, so it needs
    // `mergeParams` or the grant lookup never sees the token and 404s.
    const master = await requestApp(app, 'GET', `${base}/${videoImageId}/hls/master.m3u8`);
    expect(master.status).toBe(200);
    expect(master.headers.get('content-type')).toContain('application/vnd.apple.mpegurl');
    expect(master.body).toContain(
      `/api/share/post-links/${created.rawToken}/videos/${videoImageId}/hls/720p/index.m3u8`
    );
    // A viewer must never be handed the library-wide route.
    expect(master.body).not.toContain('/api/videos/');

    const media = await requestApp(app, 'GET', `${base}/${videoImageId}/hls/720p/index.m3u8`);
    expect(media.status).toBe(200);
    expect(media.body).toContain('#EXTM3U');

    const foreign = await requestApp(app, 'GET', `${base}/${imageAId}/hls/master.m3u8`);
    expect(foreign.status).toBe(404);

    postShareService.revokeLink(videoPostId, created.link.id);
    const afterRevoke = await requestApp(app, 'GET', `${base}/${videoImageId}/hls/master.m3u8`);
    expect(afterRevoke.status).toBe(404);
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
