import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { Express, Request, Response } from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { requestTestApp } from './http-test-utils.js';

const run = promisify(execFile);
const binariesAvailable = await Promise.all(['ffmpeg', 'ffprobe'].map(binary =>
  run(binary, ['-version']).then(() => true, () => false)));

describe.skipIf(binariesAvailable.includes(false)).sequential('local on-demand streaming', () => {
  let temp = '';
  let app: Express;
  let config: typeof import('../src/config/env.js')['appConfig'];
  let scanner: typeof import('../src/services/scanner-service.js')['scannerService'];
  let repos: typeof import('../src/db/repositories.js');
  let db: typeof import('../src/db/database.js')['databaseManager'];
  let cache: typeof import('../src/services/hls-cache.js')['hlsCache'];
  const intent = { 'x-foldergram-intent': '1', 'content-type': 'application/json' };

  async function fixture(name: string, encoding: string[], seconds: number) {
    const input = path.join(config.galleryRoot, 'Album', name);
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=10:d=' + seconds,
      '-threads', '1', ...encoding, input]);
  }

  beforeAll(async () => {
    temp = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-hls-'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DERIVATIVE_MODE', 'eager');
    vi.stubEnv('VIDEO_DELIVERY_MODE', 'streaming');
    vi.stubEnv('HLS_TRANSCODE_CONCURRENCY', '1');
    vi.stubEnv('PUBLIC_DEMO_MODE', 'false');
    for (const [key, name] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', PREVIEWS_DIR: 'previews',
      THUMBNAILS_DIR: 'thumbnails', HLS_CACHE_DIR: 'hls'
    })) vi.stubEnv(key, path.join(temp, name));
    vi.resetModules();
    ({ appConfig: config } = await import('../src/config/env.js'));
    ({ scannerService: scanner } = await import('../src/services/scanner-service.js'));
    ({ databaseManager: db } = await import('../src/db/database.js'));
    ({ hlsCache: cache } = await import('../src/services/hls-cache.js'));
    repos = await import('../src/db/repositories.js');
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await fs.mkdir(path.join(config.galleryRoot, 'Album'), { recursive: true });
    await fixture('stream.mkv', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime'], 28);
    await fixture('direct.mp4', ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'], 2);
    await scanner.scanAll('manual');
  }, 30_000);

  afterAll(async () => {
    await cache?.stop();
    db?.close();
    vi.unstubAllEnvs();
    if (temp) await fs.rm(temp, { recursive: true, force: true });
  });

  const eventually = (check: () => void | Promise<void>) => vi.waitFor(check, { timeout: 8_000 });

  function get(url: string, headers: Record<string, string> = {}) {
    return requestTestApp(app, 'GET', url, headers);
  }

  function post(url: string, payload = {}, headers: Record<string, string> = intent) {
    return requestTestApp(app, 'POST', url, headers, payload);
  }

  it('uses indexed playback policies for the overview and checks leftover files only on assessment', async () => {
    const endpoint = '/api/admin/video-previews/reclamation';
    const image = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    const original = repos.imageRepository.getByRelativePath('Album/direct.mp4')!;
    const preview = path.join(config.previewsDir, image.preview_path);
    const setPolicy = db.connection.prepare('UPDATE images SET video_delivery_policy = ? WHERE id = ?');

    expect((await get(endpoint)).body.cleanupPending).toBe(false);
    try {
      setPolicy.run('previews', image.id);
      expect((await get(endpoint)).body.cleanupPending).toBe(true);
      setPolicy.run('streaming', image.id);
      await fs.mkdir(path.dirname(preview), { recursive: true });
      await fs.copyFile(path.join(config.galleryRoot, original.relative_path), preview);
      expect((await get(endpoint)).body.cleanupPending).toBe(false);
      const assessed = await post(endpoint, { sourceId: image.source_id });
      expect(assessed.status).toBe(202);
      await eventually(async () => {
        expect((await get(endpoint + '/' + assessed.body.id)).body)
          .toMatchObject({ state: 'ready', assessment: { videos: 0, files: 1 } });
      });
      config.videoDeliveryMode = 'previews';
      expect((await get(endpoint)).body.cleanupPending).toBe(false);
      expect((await get('/api/admin/video-previews/generation')).body.streamingCount).toBe(2);
    } finally {
      config.videoDeliveryMode = 'streaming';
      setPolicy.run('streaming', image.id);
      await fs.rm(preview, { force: true });
    }
    expect((await get(endpoint)).body.cleanupPending).toBe(false);
  });

  it('does not probe preview paths when opening Settings for a large streaming library', async () => {
    const seed = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    // The overview must not do one filesystem call per indexed video.
    db.connection.prepare(`
      WITH RECURSIVE sequence(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM sequence WHERE n < 128)
      INSERT INTO images (
        source_id, folder_id, relative_path, filename, extension, absolute_path, file_size, width, height,
        media_type, mime_type, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp,
        thumbnail_path, preview_path, playback_strategy, video_delivery_policy
      )
      SELECT image.source_id, image.folder_id, '__overview__/clip-' || n || '.mkv',
        'clip-' || n || '.mkv', '.mkv', '/missing/clip-' || n || '.mkv', image.file_size,
        image.width, image.height, 'video', image.mime_type, 'overview-' || n,
        image.mtime_ms, image.first_seen_at, image.sort_timestamp,
        '__overview__/clip-' || n || '.webp', '__overview__/clip-' || n || '.mp4',
        image.playback_strategy, 'streaming'
      FROM images AS image CROSS JOIN sequence WHERE image.id = ?
    `).run(seed.id);
    const lstat = vi.spyOn(fs, 'lstat');
    try {
      const response = await get('/api/admin/video-previews/reclamation');
      expect(response.status).toBe(200);
      expect(response.body.cleanupPending).toBe(false);
      expect(lstat).not.toHaveBeenCalled();
    } finally {
      lstat.mockRestore();
      db.connection.prepare("DELETE FROM images WHERE relative_path LIKE '__overview__/%' AND source_id = ?")
        .run(seed.source_id);
    }
  });

  it('indexes posters only, negotiates originals, and serves decodable bounded HLS across seeks', async () => {
    const converted = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    const direct = repos.imageRepository.getByRelativePath('Album/direct.mp4')!;
    expect(converted.video_delivery_policy).toBe('streaming');
    expect((await fs.stat(path.join(config.thumbnailsDir, converted.thumbnail_path))).isFile()).toBe(true);
    await expect(fs.stat(path.join(config.previewsDir, converted.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });

    const directUrl = '/api/videos/' + direct.id + '/playback';
    const negotiated = await get(directUrl);
    expect(negotiated.body.original).toMatchObject({ url: directUrl + '/original', type: expect.stringContaining('avc1.') });
    expect((await get(directUrl + '/original', { Range: 'bytes=0-99' })).status).toBe(206);
    expect((await get('/previews/' + converted.preview_path)).status).toBe(410);

    const base = '/api/videos/' + converted.id + '/playback';
    expect((await get('/api/feed')).body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ videoPlaybackUrl: base, mediaItems: [expect.objectContaining({ imageId: converted.id, videoPlaybackUrl: base })] })
    ]));
    expect((await get(base)).body.original).toBeNull();
    expect((await post(base + '/sessions', { at: 0 }, { 'content-type': 'application/json' })).status).toBe(403);
    const first = await post(base + '/sessions', { at: 0 });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ offset: 0, duration: 28, window: 24 });
    const manifest = await get(first.body.url);
    expect(manifest.status).toBe(200);
    expect(manifest.body).toContain('#EXT-X-INDEPENDENT-SEGMENTS');
    const uri = new URL('segment-000.ts', 'http://localhost' + first.body.url).pathname;
    expect((await get(uri, { Range: 'bytes=0-187' })).status).toBe(206);
    const id = first.body.url.split('/').at(-3);
    await run('ffmpeg', ['-v', 'error', '-xerror', '-i', path.join(config.hlsCacheDir, 'hls-v1-' + id, 'segment-000.ts'),
      '-frames:v', '4', '-f', 'null', '-']);

    const second = await post(base + '/sessions', { at: 0 });
    expect(second.status).toBe(200);
    expect(second.body.url.split('/').at(-3)).toBe(id);
    expect(second.body.url).not.toBe(first.body.url);
    await eventually(() => {
      expect(db.connection.prepare('SELECT state FROM local_hls_windows WHERE id = ?').get(id)?.state).toBe('ready');
    });
    const quota = config.hlsCacheMaxBytes;
    config.hlsCacheMaxBytes = 4 * 1024 * 1024;
    try {
      const pressure = await post(base + '/sessions', { at: 25, profile: 'low' });
      expect(pressure.status, JSON.stringify(pressure.body)).toBe(507);
      expect((await get(first.body.url)).status).toBe(200);
    } finally {
      config.hlsCacheMaxBytes = quota;
    }
    expect((await post(first.body.releaseUrl)).status).toBe(204);
    expect((await get(second.body.url)).status).toBe(200);
    expect((await get(first.body.url)).status).toBe(404);
    await post(second.body.releaseUrl);

    const sought = await post(base + '/sessions', { at: 25.4, profile: 'low' });
    expect(sought.status).toBe(200);
    expect(sought.body).toMatchObject({ offset: 25, duration: 28, window: 3, profile: 'low' });
    await post(sought.body.releaseUrl);
    expect((await scanner.scanAll('manual', { repairUnchangedDerivatives: true }))?.status).toBe('completed');
    await expect(fs.stat(path.join(config.previewsDir, converted.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('caches only the three-second opening and reuses it without exposing a warmup lease', async () => {
    await fixture('warm-opening.mkv', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime'], 28);
    await scanner.scanAll('manual');
    const image = repos.imageRepository.getByRelativePath('Album/warm-opening.mkv')!;
    const endpoint = '/api/videos/' + image.id + '/playback/sessions';
    expect((await post(endpoint, { at: 1, warmup: true })).status).toBe(400);
    expect((await post(endpoint, { at: 0, warmup: true }, { 'content-type': 'application/json' })).status).toBe(403);
    const warmed = await post(endpoint, { at: 0, warmup: true });
    expect(warmed.status, JSON.stringify(warmed.body)).toBe(200);
    expect(warmed.body).toEqual({ warmed: true });
    const rows = db.connection.prepare('SELECT id, state FROM local_hls_windows WHERE image_id = ?').all(image.id);
    expect(rows).toEqual([{ id: expect.any(String), state: 'ready' }]);

    const opening = await post(endpoint, { at: 0 });
    expect(opening.body).toMatchObject({ offset: 0, duration: 28, window: 3 });
    expect(opening.body.url.split('/').at(-3)).toBe(rows[0].id);
    const manifest = (await get(opening.body.url)).body;
    expect(manifest).toContain('#EXT-X-ENDLIST');
    expect(manifest.match(/#EXTINF:/g)).toHaveLength(1);
    await post(opening.body.releaseUrl);

    const continuation = await post(endpoint, { at: opening.body.window });
    expect(continuation.status, JSON.stringify(continuation.body)).toBe(200);
    expect(continuation.body).toMatchObject({ offset: 3, duration: 28, window: 24 });
    await post(continuation.body.releaseUrl);
  }, 30_000);

  it('keeps a completed opening when a swipe cancels the rest of a window', async () => {
    const encoder = await import('../src/services/hls-encoder.js');
    const encode = encoder.encodeHlsWindow;
    let openingComplete = false;
    const stub = vi.spyOn(encoder, 'encodeHlsWindow').mockImplementation(async options => {
      await encode({ ...options, durationSeconds: 3 });
      openingComplete = true;
      await new Promise<void>((_, reject) => {
        const abort = () => reject(options.signal.reason);
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    });
    try {
      await fixture('swiped-opening.mkv', ['-c:v', 'libvpx-vp9', '-deadline', 'realtime'], 28);
      await scanner.scanAll('manual');
      const image = repos.imageRepository.getByRelativePath('Album/swiped-opening.mkv')!;
      const endpoint = '/api/videos/' + image.id + '/playback/sessions';
      const initial = await post(endpoint, { at: 0 });
      expect(initial.status).toBe(200);
      expect(cache.hasWarmupCapacity()).toBe(false);
      await eventually(() => expect(openingComplete).toBe(true));
      await post(initial.body.releaseUrl);
      await eventually(() => expect(db.connection.prepare('SELECT state FROM local_hls_windows WHERE image_id = ?')
        .get(image.id)?.state).toBe('ready'));
      expect(cache.hasWarmupCapacity()).toBe(true);
      const resumed = await post(endpoint, { at: 0 });
      expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
      expect(resumed.body).toMatchObject({ window: 3, offset: 0 });
      expect(stub).toHaveBeenCalledTimes(1);
      const manifest = (await get(resumed.body.url)).body;
      expect(manifest).toContain('#EXT-X-ENDLIST');
      expect(manifest.match(/#EXTINF:/g)).toHaveLength(1);
      await post(resumed.body.releaseUrl);
    } finally {
      stub.mockRestore();
    }
  }, 30_000);

  it.each([1, 2])('preempts speculative conversion for a seek with %i encoders and a full cache', async concurrency => {
    const encoder = await import('../src/services/hls-encoder.js');
    const encode = encoder.encodeHlsWindow;
    let warmSignal: AbortSignal | undefined;
    const stub = vi.spyOn(encoder, 'encodeHlsWindow').mockImplementation(options => {
      if (options.durationSeconds !== 3) return encode(options);
      warmSignal = options.signal;
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    });

    const filename = 'warm-interrupted-' + concurrency + '.mkv';
    await fixture(filename, ['-c:v', 'libvpx-vp9', '-deadline', 'realtime'], 28);
    await scanner.scanAll('manual');
    const image = repos.imageRepository.getByRelativePath('Album/' + filename)!;
    const active = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    const warmUrl = '/api/videos/' + image.id + '/playback/sessions';
    const activeUrl = '/api/videos/' + active.id + '/playback/sessions';
    const quota = config.hlsCacheMaxBytes;
    const encoders = config.hlsTranscodeConcurrency;
    config.hlsTranscodeConcurrency = concurrency;
    const warm = post(warmUrl, { at: 0, warmup: true });
    try {
      await eventually(() => expect(warmSignal).toBeDefined());
      // The speculative reservation must be reclaimed before admitting the seek.
      config.hlsCacheMaxBytes = encoder.hlsWindowReservation.standard;
      expect((await post(warmUrl, { at: 0, warmup: true })).status).toBe(503);
      const seek = await post(activeUrl, { at: 7 });
      expect(seek.status, JSON.stringify(seek.body)).toBe(200);
      expect(seek.body).toMatchObject({ offset: 7, duration: 28, window: 21 });
      expect(warmSignal?.aborted).toBe(true);
      expect((await warm).status).toBe(503);
      await post(seek.body.releaseUrl);
      await eventually(() => expect(db.connection.prepare('SELECT id FROM local_hls_windows WHERE image_id = ?')
        .get(image.id)).toBeUndefined());
    } finally {
      config.hlsCacheMaxBytes = quota;
      config.hlsTranscodeConcurrency = encoders;
      stub.mockRestore();
    }
  }, 30_000);

  it('publishes a complete short-segment window for H.264 with sparse keyframes', async () => {
    const original = path.join(config.galleryRoot, 'Album', 'long-gop.mov');
    await run('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=15:d=30',
      '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-g', '250', original
    ]);
    await scanner.scanAll('manual');
    const image = repos.imageRepository.getByRelativePath('Album/long-gop.mov')!;
    const endpoint = '/api/videos/' + image.id + '/playback/sessions';
    const opened = await post(endpoint, { at: 0 });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    await eventually(async () => {
      const manifest = await get(opened.body.url);
      expect(manifest.body).toContain('#EXT-X-ENDLIST');
      expect(manifest.body).toContain('#EXT-X-TARGETDURATION:3');
    });
    const windowId = opened.body.url.split('/').at(-3);
    await run('ffmpeg', ['-v', 'error', '-xerror', '-i', path.join(config.hlsCacheDir, 'hls-v1-' + windowId, 'segment-007.ts'),
      '-frames:v', '1', '-f', 'null', '-']);
    await post(opened.body.releaseUrl);
  }, 30_000);

  it('uses the correct registered gallery and produces SDR HLS from HDR HEVC', async () => {
    const external = path.join(temp, 'external');
    await fs.mkdir(path.join(external, 'Album'), { recursive: true });
    const hdrPath = path.join(external, 'Album', 'stream.mkv');
    await run('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=10:d=2',
      '-vf', 'format=yuv420p10le', '-threads', '1', '-c:v', 'libx265',
      '-x265-params', 'colorprim=9:transfer=16:colormatrix=9:pools=1:frame-threads=1:log-level=error',
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc',
      hdrPath
    ]);
    const { createLocalSource } = await import('../src/sources/source-service.js');
    const id = await createLocalSource({ kind: 'local', name: 'External gallery', rootPath: external, readOnlyOriginals: true, enabled: true });
    config.derivativeMode = 'lazy';
    try {
      expect((await scanner.scanSource(id))?.status).toBe('completed');
    } finally {
      config.derivativeMode = 'eager';
    }
    const externalAsset = repos.imageRepository.getByRelativePath('Album/stream.mkv', id)!;
    const primaryAsset = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    expect(externalAsset.id).not.toBe(primaryAsset.id);
    expect(externalAsset.video_delivery_policy).toBe('streaming');
    expect(externalAsset.duration_ms).toBe(2000);
    expect(JSON.parse(externalAsset.video_metadata_json!).video).toMatchObject({ codec: 'hevc', colorTransfer: 'smpte2084' });
    await expect(fs.stat(path.join(config.previewsDir, externalAsset.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });
    const opened = await post('/api/videos/' + externalAsset.id + '/playback/sessions', { at: 0 });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const cacheId = opened.body.url.split('/').at(-3);
    const output = path.join(config.hlsCacheDir, 'hls-v1-' + cacheId, 'segment-000.ts');
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-of', 'json', output]);
    expect(JSON.parse(probe.stdout).streams[0]).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p', color_transfer: 'bt709' });
    await post(opened.body.releaseUrl);
  }, 30_000);

  it('reconciles orphan windows without blocking healthy playback on an unavailable secondary gallery', async () => {
    const { createLocalSource } = await import('../src/sources/source-service.js');
    const offline = path.join(temp, 'offline');
    await fs.mkdir(offline);
    await createLocalSource({ kind: 'local', name: 'Offline gallery', rootPath: offline, readOnlyOriginals: true, enabled: false });

    await cache.stop();
    const orphan = path.join(config.hlsCacheDir, 'hls-v1-' + randomUUID());
    const protectedPath = path.join(config.hlsCacheDir, 'other-data');
    const symlink = path.join(config.hlsCacheDir, 'hls-v1-' + randomUUID());
    await fs.mkdir(orphan, { recursive: true });
    await fs.writeFile(path.join(orphan, 'segment-000.ts'), Buffer.alloc(5 * 1024 * 1024));
    await fs.mkdir(protectedPath);
    await fs.writeFile(path.join(protectedPath, 'keep.txt'), 'keep');

    const realpath = fs.realpath;
    const resolve = vi.spyOn(fs, 'realpath').mockImplementation((target, options) =>
      target === offline
        ? Promise.reject(Object.assign(new Error('offline gallery'), { code: 'EACCES' }))
        : realpath(target, options));
    const oldQuota = config.hlsCacheMaxBytes;
    config.hlsCacheMaxBytes = 4 * 1024 * 1024;
    try {
      const image = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
      const endpoint = '/api/videos/' + image.id + '/playback/sessions';
      const opened = await post(endpoint, { at: 7, profile: 'low' });
      expect(opened.status, JSON.stringify(opened.body)).toBe(200);
      expect(resolve.mock.calls.some(([target]) => target === offline)).toBe(true);
      await expect(fs.lstat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
      await post(opened.body.releaseUrl);
      await cache.stop();

      await fs.symlink(protectedPath, symlink, 'dir');
      expect((await post(endpoint, { at: 8, profile: 'low' })).status).toBe(507);
      expect(await fs.readFile(path.join(protectedPath, 'keep.txt'), 'utf8')).toBe('keep');
      expect((await fs.lstat(symlink)).isSymbolicLink()).toBe(true);
    } finally {
      resolve.mockRestore();
      config.hlsCacheMaxBytes = oldQuota;
      await fs.rm(symlink, { force: true });
      await cache.stop();
    }
  }, 30_000);

  it('releases a cache reservation after the filesystem refuses a new window', async () => {
    await cache.recover();
    const image = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    const endpoint = '/api/videos/' + image.id + '/playback/sessions';
    const mkdir = fs.mkdir;
    const refused = vi.spyOn(fs, 'mkdir').mockImplementation((directory, options) =>
      String(directory).startsWith(path.join(config.hlsCacheDir, 'hls-v1-'))
        ? Promise.reject(Object.assign(new Error('full cache device'), { code: 'ENOSPC' }))
        : mkdir(directory, options));
    try {
      expect((await post(endpoint, { at: 14, profile: 'low' })).status).toBe(507);
    } finally {
      refused.mockRestore();
    }
    await eventually(() => {
      expect(db.connection.prepare("SELECT COUNT(*) AS count FROM local_hls_windows WHERE state = 'encoding'").get()?.count)
        .toBe(0);
    });
    const retried = await post(endpoint, { at: 14, profile: 'low' });
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    await post(retried.body.releaseUrl);
    await cache.stop();
  }, 30_000);

  it.each(['ETIMEDOUT', 'ENOTCONN'])('tolerates an unrelated gallery with a %s mount error', async code => {
    const offline = path.join(temp, 'offline');
    const realpath = fs.realpath;
    const unavailable = vi.spyOn(fs, 'realpath').mockImplementation((target, options) =>
      target === offline
        ? Promise.reject(Object.assign(new Error('unavailable mount'), { code }))
        : realpath(target, options));
    try {
      const image = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
      const opened = await post('/api/videos/' + image.id + '/playback/sessions', { at: 15, profile: 'low' });
      expect(opened.status, JSON.stringify(opened.body)).toBe(200);
      await post(opened.body.releaseUrl);
    } finally {
      unavailable.mockRestore();
      await cache.stop();
    }
  }, 30_000);

  it.each(['ENOSPC', 'EDQUOT'])('recovers after %s while publishing a segment', async code => {
    const image = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    const endpoint = '/api/videos/' + image.id + '/playback/sessions';
    const at = code === 'ENOSPC' ? 12 : 13;
    const writeFile = fs.writeFile;
    const refused = vi.spyOn(fs, 'writeFile').mockImplementation((file, data, options) =>
      String(file).startsWith(path.join(config.hlsCacheDir, 'hls-v1-'))
        ? Promise.reject(Object.assign(new Error('cache write refused'), { code }))
        : writeFile(file, data, options));
    try {
      expect((await post(endpoint, { at, profile: 'low' })).status).toBe(507);
      expect(refused).toHaveBeenCalled();
    } finally {
      refused.mockRestore();
    }
    await eventually(() => {
      expect(db.connection.prepare("SELECT COUNT(*) AS count FROM local_hls_windows WHERE state = 'encoding'").get()?.count)
        .toBe(0);
    });
    const retried = await post(endpoint, { at, profile: 'low' });
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    await post(retried.body.releaseUrl);
    await cache.stop();
  }, 30_000);

  it('reuses completed windows after restart and discards interrupted output before retrying', async () => {
    const image = repos.imageRepository.getByRelativePath('Album/stream.mkv')!;
    const endpoint = '/api/videos/' + image.id + '/playback/sessions';
    const opened = await post(endpoint, { at: 9, profile: 'low' });
    expect(opened.status, JSON.stringify(opened.body)).toBe(200);
    const id = opened.body.url.split('/').at(-3);
    await eventually(() => {
      expect(db.connection.prepare('SELECT state FROM local_hls_windows WHERE id = ?').get(id)?.state).toBe('ready');
    });
    await cache.stop();
    expect((await get(opened.body.url)).status).toBe(404);
    const reused = await post(endpoint, { at: 9, profile: 'low' });
    expect(reused.status, JSON.stringify(reused.body)).toBe(200);
    expect(reused.body.url.split('/').at(-3)).toBe(id);
    expect(reused.body.url).not.toBe(opened.body.url);
    await cache.stop();

    const directory = path.join(config.hlsCacheDir, 'hls-v1-' + id);
    await fs.writeFile(path.join(directory, 'segment-001.ts.2.part'), 'interrupted output');
    db.connection.prepare("UPDATE local_hls_windows SET state = 'encoding' WHERE id = ?").run(id);
    await cache.recover();
    expect(db.connection.prepare('SELECT id FROM local_hls_windows WHERE id = ?').get(id)).toBeUndefined();
    await expect(fs.lstat(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    const retried = await post(endpoint, { at: 9, profile: 'low' });
    expect(retried.status, JSON.stringify(retried.body)).toBe(200);
    expect(retried.body.url.split('/').at(-3)).not.toBe(id);
    await post(retried.body.releaseUrl);
    await cache.stop();
  }, 30_000);

  it('preserves playable previews when the original stops decoding without a size or mtime change', async () => {
    const filenames = ['corrupt-before-assessment.mov', 'corrupt-before-confirmation.mov'];
    const originalPaths = filenames.map(name => path.join(config.galleryRoot, 'Album', name));
    const stamp = new Date('2026-01-01T00:00:00Z');
    config.videoDeliveryMode = 'previews';
    try {
      await fixture(filenames[0], ['-c:v', 'libx264'], 2);
      await fixture(filenames[1], ['-vf', 'setsar=2/1', '-c:v', 'libx264'], 2);
      for (const original of originalPaths) await fs.utimes(original, stamp, stamp);
      await scanner.scanAll('manual');
    } finally {
      config.videoDeliveryMode = 'streaming';
    }

    const [early, late] = filenames.map(name => repos.imageRepository.getByRelativePath('Album/' + name)!);
    expect(late).toMatchObject({ width: 192, height: 64 });
    const metadata = JSON.parse(late.video_metadata_json!);
    expect(metadata).toMatchObject({ displayWidth: 192, displayHeight: 64, video: { sampleAspectRatio: '2:1' } });
    db.connection.prepare('UPDATE images SET video_metadata_json = ?, width = ?, video_delivery_policy = ? WHERE id = ?')
      .run(JSON.stringify({ ...metadata, version: 1, displayWidth: 96 }), 96, 'streaming', late.id);
    const refreshed = await get('/api/videos/' + late.id + '/playback');
    expect(refreshed.status, JSON.stringify(refreshed.body)).toBe(200);
    expect(refreshed.body).toMatchObject({ width: 192, height: 64 });
    expect(repos.imageRepository.getById(late.id)?.width).toBe(192);
    db.connection.prepare('UPDATE images SET video_delivery_policy = ? WHERE id = ?').run('previews', late.id);

    async function corrupt(original: string) {
      const before = await fs.stat(original);
      const contents = await fs.readFile(original);
      const payload = contents.indexOf('mdat');
      expect(payload).toBeGreaterThan(4);
      const end = payload - 4 + contents.readUInt32BE(payload - 4);
      // Preserve the container and track metadata; only compressed media stops decoding.
      contents.fill(0, payload + 4, end);
      await fs.writeFile(original, contents);
      await fs.utimes(original, stamp, stamp);
      expect(await fs.stat(original)).toMatchObject({ size: before.size, mtimeMs: before.mtimeMs });
      const probed = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name', '-of', 'json', original]);
      expect(JSON.parse(probed.stdout).streams).toEqual([expect.objectContaining({ codec_name: 'h264' })]);
    }

    await corrupt(originalPaths[0]);
    const endpoint = '/api/admin/video-previews/reclamation';
    const assessed = await post(endpoint, { sourceId: early.source_id });
    expect(assessed.status).toBe(202);
    const url = endpoint + '/' + assessed.body.id;
    await eventually(async () => {
      expect((await get(url)).body).toMatchObject({
        state: 'ready', assessment: { files: 1, reasons: { unsupported: 1 } }
      });
    });

    await corrupt(originalPaths[1]);
    expect((await post(url + '/confirm')).status).toBe(202);
    await eventually(async () => {
      expect((await get(url)).body).toMatchObject({
        state: 'complete', result: { switched: 0, files: 0, skipped: 1, reasons: { unsupported: 1 } }
      });
    });
    for (const image of [early, late]) {
      expect(repos.imageRepository.getById(image.id)?.video_delivery_policy).toBe('previews');
      const preview = path.join(config.previewsDir, image.preview_path);
      await run('ffmpeg', ['-v', 'error', '-xerror', '-i', preview, '-frames:v', '1', '-f', 'null', '-']);
    }
    db.connection.prepare("UPDATE images SET video_delivery_policy = 'streaming' WHERE id = ?").run(late.id);
    try {
      expect((await post('/api/videos/' + late.id + '/playback/sessions', { at: 0 })).status).toBe(422);
      await eventually(() => {
        expect(db.connection.prepare('SELECT COUNT(*) AS count FROM local_hls_windows WHERE image_id = ?').get(late.id)?.count)
          .toBe(0);
      });
    } finally {
      db.connection.prepare("UPDATE images SET video_delivery_policy = 'previews' WHERE id = ?").run(late.id);
    }
  }, 30_000);

  it('cancels reclamation between items and resumes only the remaining confirmed work', async () => {
    const sourceRoot = path.join(temp, 'cancellation-source');
    const album = path.join(sourceRoot, 'Album');
    await fs.mkdir(album, { recursive: true });
    await run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=10:d=1',
      '-c:v', 'libx264', '-threads', '1', path.join(album, 'a.mov')]);
    await fs.copyFile(path.join(album, 'a.mov'), path.join(album, 'b.mov'));
    const { createLocalSource } = await import('../src/sources/source-service.js');
    const sourceId = await createLocalSource({ kind: 'local', name: 'Cancellation gallery', rootPath: sourceRoot,
      readOnlyOriginals: true, enabled: true });
    config.videoDeliveryMode = 'previews';
    try {
      expect((await scanner.scanSource(sourceId))?.status).toBe('completed');
    } finally {
      config.videoDeliveryMode = 'streaming';
    }
    const videos = ['a.mov', 'b.mov'].map(name => repos.imageRepository.getByRelativePath('Album/' + name, sourceId)!)
      .sort((left, right) => left.id - right.id);
    const previews = videos.map(image => path.join(config.previewsDir, image.preview_path));
    const endpoint = '/api/admin/video-previews/reclamation';
    const assessed = await post(endpoint, { sourceId });
    expect(assessed.status).toBe(202);
    const url = endpoint + '/' + assessed.body.id;
    await eventually(async () => {
      expect((await get(url)).body).toMatchObject({ state: 'ready', assessment: { videos: 2, files: 2 } });
    });
    const unlink = fs.unlink;
    const cancelAfterFirst = vi.spyOn(fs, 'unlink').mockImplementation(async file => {
      await unlink(file);
      if (file === previews[0]) expect((await post(url + '/cancel')).status).toBe(202);
    });
    try {
      expect((await post(url + '/confirm')).status).toBe(202);
      await eventually(async () => {
        expect((await get(url)).body).toMatchObject({ state: 'cancelled', result: { processed: 1, switched: 1, files: 1 } });
      });
    } finally {
      cancelAfterFirst.mockRestore();
    }
    expect(repos.imageRepository.getById(videos[0].id)?.video_delivery_policy).toBe('streaming');
    await expect(fs.stat(previews[0])).rejects.toMatchObject({ code: 'ENOENT' });
    expect(repos.imageRepository.getById(videos[1].id)?.video_delivery_policy).toBe('previews');
    expect((await fs.stat(previews[1])).size).toBeGreaterThan(0);
    expect((await post(url + '/retry')).status).toBe(202);
    await eventually(async () => {
      expect((await get(url)).body).toMatchObject({ state: 'complete', result: { processed: 2, switched: 2, files: 2 } });
    });
    expect(repos.imageRepository.getById(videos[1].id)?.video_delivery_policy).toBe('streaming');
    await expect(fs.stat(previews[1])).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('switches a selected source to previews after generation, preserving streaming on failure', async () => {
    const sourceRoot = path.join(temp, 'generation-source');
    const album = path.join(sourceRoot, 'Videos');
    await fs.mkdir(album, { recursive: true });
    const create = (name: string) => run('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=10:d=1',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-threads', '1', path.join(album, name)]);
    await create('direct.mp4');
    await fs.copyFile(path.join(album, 'direct.mp4'), path.join(album, 'preview.mov'));
    await fs.copyFile(path.join(album, 'direct.mp4'), path.join(album, 'retry.mov'));
    const { createLocalSource } = await import('../src/sources/source-service.js');
    const sourceId = await createLocalSource({ kind: 'local', name: 'Preview generation', rootPath: sourceRoot,
      readOnlyOriginals: true, enabled: true });
    expect((await scanner.scanSource(sourceId))?.status).toBe('completed');
    const direct = repos.imageRepository.getByRelativePath('Videos/direct.mp4', sourceId)!;
    const preview = repos.imageRepository.getByRelativePath('Videos/preview.mov', sourceId)!;
    const retry = repos.imageRepository.getByRelativePath('Videos/retry.mov', sourceId)!;
    const retryPath = path.join(config.previewsDir, retry.preview_path);
    const generation = '/api/admin/video-previews/generation';
    // Isolate this test’s administrative request budget from the cleanup tests.
    app.set('trust proxy', 'loopback');
    const fromGenerationTest = { ...intent, 'x-forwarded-for': '192.0.2.42' };
    const startGeneration = (url: string, body = {}) => post(url, body, fromGenerationTest);
    try {
      expect((await startGeneration(generation, { sourceId })).status).toBe(409);

      config.videoDeliveryMode = 'previews';
      config.derivativeMode = 'lazy';
      expect((await get(generation)).body.streamingCount).toBeGreaterThanOrEqual(3);
      expect((await post(generation, { sourceId }, { 'content-type': 'application/json' })).status).toBe(403);
      const assessed = await startGeneration(generation, { sourceId });
      expect(assessed.status).toBe(202);
      const url = generation + '/' + assessed.body.id;
      await eventually(async () => {
        expect((await get(url)).body).toMatchObject({
          state: 'ready', assessment: { videos: 3, files: 2 }
        });
      });
      expect((await get('/api/admin/video-previews/reclamation/' + assessed.body.id)).status).toBe(404);
      await expect(fs.stat(path.join(config.previewsDir, preview.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });

      const rename = fs.rename;
      const failPublication = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
        if (to === retryPath) throw new Error('Preview storage is full');
        if (to === path.join(config.previewsDir, preview.preview_path)) {
          expect(repos.imageRepository.getById(preview.id)?.video_delivery_policy).toBe('streaming');
        }
        return rename(from, to);
      });
      try {
        expect((await startGeneration(url + '/confirm')).status).toBe(202);
        await eventually(async () => {
          expect((await get(url)).body).toMatchObject({
            state: 'complete', result: { switched: 2, files: 1, failed: 1 }, failedVideos: ['retry.mov']
          });
        });
      } finally {
        failPublication.mockRestore();
      }
      expect(repos.imageRepository.getById(direct.id)?.video_delivery_policy).toBe('previews');
      await expect(fs.stat(path.join(config.previewsDir, direct.preview_path))).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await get('/api/originals/' + direct.id)).status).toBe(200);
      expect((await get('/previews/' + preview.preview_path)).status).toBe(200);
      expect(repos.imageRepository.getById(retry.id)?.video_delivery_policy).toBe('streaming');
      expect((await get('/api/videos/' + retry.id + '/playback')).status).toBe(200);
      expect(repos.imageRepository.getByRelativePath('Album/stream.mkv')?.video_delivery_policy).toBe('streaming');

      expect((await startGeneration(url + '/retry')).status).toBe(202);
      await eventually(async () => {
        expect((await get(url)).body).toMatchObject({ state: 'complete', result: { switched: 3, files: 2, failed: 0 } });
      });
      expect((await get('/api/videos/' + retry.id + '/playback')).status).toBe(404);
      await run('ffmpeg', ['-v', 'error', '-xerror', '-i', retryPath, '-f', 'null', '-']);
      expect((await fs.stat(path.join(album, 'retry.mov'))).isFile()).toBe(true);
    } finally {
      app.set('trust proxy', false);
      config.videoDeliveryMode = 'streaming';
      config.derivativeMode = 'eager';
    }
  }, 30_000);

  it('transitions a confirmed local video before removing its preview and respects a scoped share', async () => {
    config.videoDeliveryMode = 'previews';
    try {
      await fixture('preview.mov', ['-c:v', 'libx264'], 2);
      await scanner.scanAll('manual');
    } finally {
      config.videoDeliveryMode = 'streaming';
    }
    const image = repos.imageRepository.getByRelativePath('Album/preview.mov')!;
    const preview = path.join(config.previewsDir, image.preview_path);
    const bytes = (await fs.stat(preview)).size;
    const endpoint = '/api/admin/video-previews/reclamation';
    const assessed = await post(endpoint, { sourceId: image.source_id });
    expect(assessed.status, JSON.stringify(assessed.body)).toBe(202);
    const jobUrl = endpoint + '/' + assessed.body.id;
    await eventually(async () => {
      expect((await get(jobUrl)).body).toMatchObject({
        state: 'ready', assessment: { videos: 1, files: 1, bytes }
      });
    });
    expect(repos.imageRepository.getById(image.id)?.video_delivery_policy).toBe('previews');
    expect((await fs.stat(preview)).size).toBe(bytes);

    expect((await post(jobUrl + '/confirm', {}, { 'content-type': 'application/json' })).status).toBe(403);
    const { beginPreviewRead } = await import('../src/services/video-preview-access.js');
    const releaseRead = beginPreviewRead(preview)!;
    try {
      expect((await post(jobUrl + '/confirm')).status).toBe(202);
      await eventually(async () => {
        expect((await get(jobUrl)).body).toMatchObject({
          state: 'complete', result: { switched: 0, files: 0, deferred: 1, reasons: { inUse: 1 } }
        });
      });
      expect((await fs.stat(preview)).size).toBe(bytes);
    } finally {
      releaseRead();
    }
    const unlink = fs.unlink;
    const failingDelete = vi.spyOn(fs, 'unlink').mockImplementation(file => file === preview
      ? Promise.reject(Object.assign(new Error('preview not writable'), { code: 'EACCES' }))
      : unlink(file));
    try {
      expect((await post(jobUrl + '/retry')).status).toBe(202);
      await eventually(async () => {
        expect((await get(jobUrl)).body).toMatchObject({
          state: 'complete', result: { switched: 1, files: 0, bytes: 0, failed: 1, deferred: 0 }
        });
      });
      expect((await fs.stat(preview)).size).toBe(bytes);
    } finally {
      failingDelete.mockRestore();
    }

    // Simulate a process stopping after it unlinked the preview but before accounting for it.
    const interrupted = (await get(jobUrl)).body;
    interrupted.state = 'running';
    Object.assign(interrupted.result, { processed: 0, failed: 0, reasons: {} });
    await fs.unlink(preview);
    db.connection.prepare("UPDATE video_preview_reclamation SET state = 'running', data = ? WHERE id = ?")
      .run(JSON.stringify(interrupted), interrupted.id);
    db.connection.prepare("UPDATE video_preview_reclamation_items SET state = 'pending', reason = NULL WHERE job_id = ? AND image_id = ?")
      .run(interrupted.id, image.id);
    // Older job records have no target mode. They must remain recoverable after a mode change.
    delete interrupted.targetMode;
    db.connection.prepare('UPDATE video_preview_reclamation SET data = ? WHERE id = ?')
      .run(JSON.stringify(interrupted), interrupted.id);
    config.videoDeliveryMode = 'previews';
    app.set('trust proxy', 'loopback');
    const recoveryRequest = { ...intent, 'x-forwarded-for': '192.0.2.43' };
    try {
      expect((await post(endpoint, { sourceId: image.source_id }, recoveryRequest)).status).toBe(409);
      expect((await get(endpoint)).body.job).toMatchObject({ id: interrupted.id, state: 'interrupted' });
      expect((await post(jobUrl + '/retry', {}, recoveryRequest)).status).toBe(202);
      await eventually(async () => {
        expect((await get(jobUrl)).body).toMatchObject({
          state: 'complete', result: { switched: 1, files: 1, bytes, failed: 0, deferred: 0 }
        });
      });
    } finally {
      app.set('trust proxy', false);
      config.videoDeliveryMode = 'streaming';
    }
    expect(repos.imageRepository.getById(image.id)?.video_delivery_policy).toBe('streaming');
    await expect(fs.stat(preview)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.stat(path.join(config.galleryRoot, image.relative_path))).isFile()).toBe(true);

    const { folderShareService } = await import('../src/services/folder-share-service.js');
    const { authService } = await import('../src/services/auth-service.js');
    const folder = repos.folderRepository.getById(image.folder_id)!;
    const link = folderShareService.createLink(folder.slug, { expiresAt: null })!;
    const grant = folderShareService.verifyLinkToken(folder.slug, link.rawToken)!;
    const fake = { cookie: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    folderShareService.setShareSession(fake as unknown as Response, { secure: false, get: () => undefined } as unknown as Request, grant);
    authService.setAdminPassword('admin12345');
    const cookie = { Cookie: 'foldergram_share_session=' + fake.cookie.mock.calls.at(-1)?.[1] };
    const sharedUrl = '/api/share/images/' + image.id + '/playback';
    expect((await get('/api/originals/' + image.id, cookie)).status).toBe(401);
    expect((await post(endpoint, {}, { ...intent, ...cookie })).status).toBe(401);
    const shared = await post(sharedUrl + '/sessions', { at: 0 }, { ...intent, ...cookie });
    expect(shared.status).toBe(200);
    expect((await get(shared.body.url, cookie)).status).toBe(200);
    folderShareService.revokeLink(folder.slug, link.link.id);
    expect((await get(shared.body.url, cookie)).status).toBe(401);
    expect((await post(sharedUrl + '/sessions', { at: 0, warmup: true }, { ...intent, ...cookie })).status).toBe(401);
  }, 30_000);
});
