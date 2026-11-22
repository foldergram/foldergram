import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { requestTestApp } from './http-test-utils.js';

const ffmpeg = promisify(execFile);
const smoke = process.argv.includes('--smoke');
const output = process.argv.find(argument => argument.startsWith('--output='))?.slice('--output='.length);
const photoCount = smoke ? 100 : 50_000;
const shortVideoCount = smoke ? 1 : 45;
const sampleCodecs = ['libx264', 'libvpx-vp9', 'libx265'];
const migrationRoot = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-video-benchmark-'));
const gallery = path.join(temp, 'gallery');
const album = path.join(gallery, 'Benchmark');
const previews = path.join(temp, 'previews');
const dbDir = path.join(temp, 'db');
const cacheDir = path.join(temp, 'hls');
const intent = { 'x-foldergram-intent': '1', 'content-type': 'application/json' };
const metrics: Record<string, unknown> = { photos: photoCount, videos: shortVideoCount + sampleCodecs.length * 2, encoderConcurrency: 1 };

function percentiles(samples: number[]) {
  const ordered = [...samples].sort((left, right) => left - right);
  return {
    samples: ordered.length,
    p50Ms: Math.round(ordered[Math.ceil(ordered.length * 0.5) - 1]),
    p95Ms: Math.round(ordered[Math.ceil(ordered.length * 0.95) - 1])
  };
}

async function timed<T>(operation: () => Promise<T> | T) {
  const start = performance.now();
  const value = await operation();
  return { value, elapsed: performance.now() - start };
}

async function waitFor<T>(read: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const deadline = performance.now() + (smoke ? 12_000 : 90_000);
  while (performance.now() < deadline) {
    const value = await read();
    if (value !== undefined) return value;
    await setTimeout(20);
  }
  throw new Error('Benchmark operation did not settle within 90 seconds.');
}

async function bytesUnder(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    total += entry.isDirectory() ? await bytesUnder(target) : (await fs.stat(target)).size;
  }
  return total;
}

let cleanup: (() => Promise<void>) | undefined;
const delay = monitorEventLoopDelay({ resolution: 10 });
try {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATA_ROOT: temp,
    GALLERY_ROOT: gallery,
    PREVIEWS_DIR: previews,
    THUMBNAILS_DIR: path.join(temp, 'thumbnails'),
    DB_DIR: dbDir,
    HLS_CACHE_DIR: cacheDir,
    HLS_TRANSCODE_CONCURRENCY: '1',
    VIDEO_DELIVERY_MODE: 'streaming',
    DERIVATIVE_MODE: 'eager',
    PUBLIC_DEMO_MODE: 'false',
    AUTH_ENABLED: 'false'
  });
  await fs.mkdir(album, { recursive: true });
  const { runStartupMigrations } = await import('../src/db/migration.js');
  const { createFingerprint, getPreviewRelativePath } = await import('../src/utils/image-utils.js');

  const short = path.join(album, 'video-0.mov');
  await ffmpeg('ffmpeg', [
    '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=15:d=2',
    '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', short
  ]);
  const previewTemplate = path.join(temp, 'preview.mp4');
  await ffmpeg('ffmpeg', ['-v', 'error', '-i', short, '-c', 'copy', '-movflags', '+faststart', previewTemplate]);
  for (let i = 1; i < shortVideoCount; i++) await fs.copyFile(short, path.join(album, 'video-' + i + '.mov'));
  for (const [i, codec] of sampleCodecs.entries()) {
    const output = path.join(album, 'sample-' + i + (codec === 'libvpx-vp9' ? '.webm' : '.mov'));
    const tuning = codec === 'libvpx-vp9' ? ['-deadline', 'realtime', '-cpu-used', '6']
      : codec === 'libx265' ? ['-preset', 'ultrafast', '-x265-params', 'pools=1:frame-threads=1:log-level=error']
        : ['-preset', 'ultrafast'];
    await ffmpeg('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=15:d=30',
      '-c:v', codec, '-threads', '2', '-pix_fmt', 'yuv420p', ...tuning, output
    ]);
    await fs.copyFile(output, path.join(album, 'warm-' + path.basename(output)));
  }
  const videoFixtures = await Promise.all((await fs.readdir(album)).map(async filename => {
    const source = path.join(album, filename);
    const relativePath = 'Benchmark/' + filename;
    const stat = await fs.stat(source);
    const previewPath = getPreviewRelativePath(relativePath, 'video');
    const output = path.join(previews, previewPath);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.copyFile(previewTemplate, output);
    return { filename, source, relativePath, stat, previewPath,
      long: /^(?:warm-)?sample-/.test(filename), fingerprint: createFingerprint(relativePath, stat.size, stat.mtimeMs) };
  }));

  const legacyDirectory = path.join(temp, 'pre-streaming-migrations');
  await fs.mkdir(legacyDirectory);
  for (const file of await fs.readdir(migrationRoot)) {
    if (/^\d+_.*\.sql$/.test(file) && Number(file.split('_')[0]) <= 7) {
      await fs.copyFile(path.join(migrationRoot, file), path.join(legacyDirectory, file));
    }
  }
  const { databasePath } = runStartupMigrations({ migrationsDirectory: legacyDirectory });
  const seed = new DatabaseSync(databasePath);
  try {
    seed.exec("PRAGMA foreign_keys = ON; BEGIN IMMEDIATE");
    const primary = seed.prepare("SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'").get() as { id: number };
    const folder = Number(seed.prepare("INSERT INTO folders(slug, name, folder_path, source_id) VALUES ('benchmark','Benchmark','Benchmark',?)")
      .run(primary.id).lastInsertRowid);
    const insert = seed.prepare(`
      INSERT INTO images (id, folder_id, source_id, filename, extension, relative_path, absolute_path, file_size,
        width, height, media_type, mime_type, duration_ms, checksum_or_fingerprint, mtime_ms, first_seen_at,
        sort_timestamp, thumbnail_path, preview_path, playback_strategy)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?, 'preview')
    `);
    for (let i = 1; i <= photoCount; i++) {
      const filename = 'photo-' + i + '.jpg';
      const relativePath = 'Benchmark/' + filename;
      insert.run(i, folder, primary.id, filename, '.jpg', relativePath, path.join(gallery, relativePath),
        1000, 1200, 800, 'image', 'image/jpeg', null, 'fixture-' + i, 0, i,
        relativePath + '.webp', relativePath + '.webp');
    }
    for (const [i, video] of videoFixtures.entries()) {
      const id = photoCount + i + 1;
      const extension = path.extname(video.filename);
      insert.run(id, folder, primary.id, video.filename, extension, video.relativePath, video.source,
        video.stat.size, video.long ? 640 : 320, video.long ? 360 : 180, 'video',
        extension === '.webm' ? 'video/webm' : 'video/quicktime', video.long ? 30_000 : 2000, video.fingerprint,
        video.stat.mtimeMs, id, video.relativePath + '.webp', video.previewPath);
    }
    seed.exec(`
      INSERT INTO posts (id, folder_id, source_id, source_path, sort_timestamp)
        SELECT id, folder_id, source_id, relative_path, sort_timestamp FROM images;
      INSERT INTO post_items(post_id, image_id, position) SELECT id, id, 1 FROM images;
      COMMIT;
    `);
  } finally {
    seed.close();
  }

  delay.enable();
  const migration = await timed(() => runStartupMigrations({ databasePath }));
  metrics.upgradeMs = Math.round(migration.elapsed);

  const { databaseManager } = await import('../src/db/database.js');
  const { createApp } = await import('../src/app.js');
  const { hlsCache } = await import('../src/services/hls-cache.js');
  cleanup = async () => {
    await hlsCache.stop();
    databaseManager.close();
  };
  const startup = await timed(() => {
    assert.equal(databaseManager.connection.prepare('SELECT COUNT(*) AS count FROM images').get()?.count,
      photoCount + videoFixtures.length);
    return createApp();
  });
  metrics.databaseAndAppInitMs = Math.round(startup.elapsed);
  const app = startup.value;

  async function get(url: string) {
    const response = await requestTestApp(app, 'GET', url);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }

  async function post(url: string, body: object, status: number) {
    const response = await requestTestApp(app, 'POST', url, intent, body);
    assert.equal(response.status, status, `${url} ${JSON.stringify(body)} ${JSON.stringify(response.body)}`);
    return response.body;
  }

  for (const [name, route] of Object.entries({
    feed: '/api/feed?limit=24', folder: '/api/folders/benchmark/images?limit=24', reels: '/api/reels?limit=24'
  })) {
    const first = await timed(() => get(route));
    const warm: number[] = [];
    for (let i = 0; i < 20; i++) warm.push((await timed(() => get(route))).elapsed);
    metrics[name] = { firstMs: Math.round(first.elapsed), warm: percentiles(warm) };
  }

  const endpoint = '/api/admin/video-previews/reclamation';
  const assessment = await timed(async () => {
    const job = await post(endpoint, {}, 202);
    return waitFor(async () => {
      const next = await get(endpoint + '/' + job.id);
      assert.ok(['assessing', 'ready'].includes(next.state), JSON.stringify(next));
      return next.state === 'ready' ? next : undefined;
    });
  });
  assert.equal(assessment.value.assessment.checked, videoFixtures.length);
  assert.equal(assessment.value.assessment.files, videoFixtures.length, JSON.stringify(assessment.value.assessment));
  const jobUrl = endpoint + '/' + assessment.value.id;
  const reclamation = await timed(async () => {
    await post(jobUrl + '/confirm', {}, 202);
    return waitFor(async () => {
      const next = await get(jobUrl);
      assert.ok(['running', 'complete'].includes(next.state), JSON.stringify(next));
      return next.state === 'complete' ? next : undefined;
    });
  });
  assert.equal(reclamation.value.result.files, videoFixtures.length, JSON.stringify(reclamation.value.result));
  metrics.reclamation = {
    assessmentMs: Math.round(assessment.elapsed), removalMs: Math.round(reclamation.elapsed),
    filesRemoved: reclamation.value.result.files, bytesFreed: reclamation.value.result.bytes
  };

  async function openAndDecode(playback: string, at: number) {
    const session = await post(playback + '/sessions', { at }, 200);
    const windowId = session.url.split('/').at(-3);
    await get(session.url);
    await ffmpeg('ffmpeg', ['-v', 'error', '-xerror', '-i', path.join(cacheDir, 'hls-v1-' + windowId, 'segment-000.ts'),
      '-threads', '2', '-frames:v', '1', '-f', 'null', '-']);
    return { session, windowId };
  }

  const initial: number[] = [];
  const seek: number[] = [];
  const encodes: number[] = [];
  const warmup: number[] = [];
  const warmed: number[] = [];
  for (const filename of videoFixtures.filter(video => video.long).map(video => video.filename)) {
    const id = databaseManager.connection.prepare('SELECT id FROM images WHERE filename = ?').get(filename)?.id;
    const playback = '/api/videos/' + id + '/playback';
    if (filename.startsWith('warm-')) {
      const prepared = await timed(() => post(playback + '/sessions', { at: 0, warmup: true }, 200));
      assert.deepEqual(prepared.value, { warmed: true });
      warmup.push(prepared.elapsed);
      const opening = await timed(() => openAndDecode(playback, 0));
      assert.equal(opening.value.session.window, 3);
      warmed.push(opening.elapsed);
      await post(opening.value.session.releaseUrl, {}, 204);
      continue;
    }
    for (const at of [0, 25]) {
      const startedAt = performance.now();
      const { session, windowId } = await openAndDecode(playback, at);
      (at === 0 ? initial : seek).push(performance.now() - startedAt);
      await waitFor(() => {
        const state = databaseManager.connection.prepare('SELECT state FROM local_hls_windows WHERE id = ?').get(windowId)?.state;
        return state === 'ready' ? state : undefined;
      });
      encodes.push(performance.now() - startedAt);
      await post(session.releaseUrl, {}, 204);
    }
  }
  metrics.initialDecodableFrame = percentiles(initial);
  metrics.seekDecodableFrame = percentiles(seek);
  metrics.windowComplete = percentiles(encodes);
  metrics.openingWarmup = percentiles(warmup);
  metrics.warmedDecodableFrame = percentiles(warmed);
  metrics.completedCacheBytes = await bytesUnder(cacheDir);
  metrics.maxEventLoopDelayMs = Math.round(delay.max / 1e6);
  metrics.eventLoopP95Ms = Math.round(delay.percentile(95) / 1e6);
  metrics.nodePeakRssKiB = process.resourceUsage().maxRSS;
  const report = JSON.stringify(metrics, null, 2);
  if (output) await fs.writeFile(output, report + '\n', { flag: 'wx' });
  console.log(report);
} finally {
  delay.disable();
  await cleanup?.();
  await fs.rm(temp, { recursive: true, force: true });
}
