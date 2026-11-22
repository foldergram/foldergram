import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { appConfig } from '../config/env.js';
import { databaseManager } from '../db/database.js';
import { listLocalSources } from '../sources/local-source.js';
import type { ImageRecord, LocalVideoMetadata } from '../types/models.js';
import { isSameOrWithinPath } from '../utils/path-utils.js';
import {
  encodeHlsWindow, HLS_MANIFEST, HLS_SEGMENT, HLS_OPENING_SECONDS, HLS_WINDOW_SECONDS, HlsDeliveryError,
  hlsWindowReservation, type HlsProfile
} from './hls-encoder.js';

const MAX_WINDOWS = 256;
const MAX_CONSUMERS_PER_WINDOW = 24;
const LEASE_MS = 30_000;
const LEASE_UPDATE_MS = 5_000;
const CACHE_VERSION = 1;
const DIRECTORY_ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const WINDOW_PREFIX = 'hls-v1-';
const CACHE_FILE = /^(?:stream\.m3u8|segment-\d{3}\.ts)(?:\.[1-9]\d?\.part)?$/;
const MAX_CACHE_ENTRIES = MAX_WINDOWS * 4;
const MAX_WINDOW_FILES = 64;
const unavailableSourceErrors = new Set([
  'EACCES', 'EPERM', 'ENOTDIR', 'EIO', 'ESTALE', 'ENODEV', 'ENXIO',
  'ENETUNREACH', 'EHOSTUNREACH', 'EHOSTDOWN', 'ENOTCONN', 'ETIMEDOUT'
]);
const database = () => databaseManager.connection;

interface WindowRow {
  id: string;
  cache_key: string;
  image_id: number;
  revision: string;
  bytes: number;
  reserved_bytes: number;
  state: 'encoding' | 'ready';
  accessed_at: number;
}

interface ActiveWindow {
  controller: AbortController;
  firstManifest: Promise<void>;
  finished: Promise<void>;
  warmup: boolean;
  running: boolean;
  error?: unknown;
}

interface OpenWindow {
  row: WindowRow;
  lease: string;
  offsetSeconds: number;
  durationSeconds: number;
  windowSeconds: number;
  profile: HlsProfile;
}

interface RequestWindow {
  image: ImageRecord;
  sourcePath: string;
  metadata: LocalVideoMetadata;
  at: number;
  profile: HlsProfile;
  signal: AbortSignal;
  warmup?: boolean;
}

function overlaps(a: string, b: string) {
  return isSameOrWithinPath(a, b) || isSameOrWithinPath(b, a);
}

async function canonicalStoragePath(directory: string): Promise<string> {
  try {
    return await fs.realpath(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(directory);
    if (parent === directory) throw error;
    return path.join(await canonicalStoragePath(parent), path.basename(directory));
  }
}

async function resolveCacheRoot(): Promise<string> {
  const root = await canonicalStoragePath(appConfig.hlsCacheDir);
  const assertSeparate = (directory: string) => {
    if (overlaps(root, directory) || overlaps(appConfig.hlsCacheDir, directory)) {
      throw new HlsDeliveryError(503, 'HLS cache storage overlaps a gallery or managed storage.');
    }
  };
  for (const directory of [
    appConfig.dbDir, appConfig.thumbnailsDir, appConfig.previewsDir, appConfig.scanErrorReportDir, appConfig.geodataDir
  ]) {
    assertSeparate(directory);
    assertSeparate(await canonicalStoragePath(directory));
  }
  assertSeparate(appConfig.galleryRoot);
  for (const { config } of listLocalSources()) {
    assertSeparate(config.rootPath);
    if (config.canonicalRootPath) assertSeparate(config.canonicalRootPath);
    try {
      assertSeparate(await canonicalStoragePath(config.rootPath));
    } catch (error) {
      // Registration records the real root. Keep enforcing that boundary when a drive is inaccessible.
      if (!config.canonicalRootPath || !unavailableSourceErrors.has((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if (await fs.realpath(root) !== root) throw new HlsDeliveryError(503, 'The HLS cache location changed.');
  return root;
}

class HlsCache {
  private jobs = new Map<string, ActiveWindow>();
  private leases = new Map<string, Map<string, number>>();
  private readers = new Map<string, number>();
  private queue = Promise.resolve();
  private root?: string;
  private timer?: ReturnType<typeof setInterval>;

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private directory(id: string): string {
    if (!this.root || !DIRECTORY_ID.test(id)) throw new Error('Invalid HLS inventory entry.');
    return path.join(this.root, WINDOW_PREFIX + id);
  }

  private async remove(id: string): Promise<void> {
    const actual = await fs.realpath(this.root!).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (actual !== null && actual !== this.root) throw new Error('The HLS cache location changed.');
    if (actual) await fs.rm(this.directory(id), { recursive: true, force: true });
    database().prepare('DELETE FROM local_hls_windows WHERE root = ? AND id = ?').run(this.root!, id);
  }

  private async initialize(): Promise<void> {
    if (this.root) {
      const actual = await fs.realpath(this.root).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (actual === null) {
        if (await resolveCacheRoot() !== this.root) throw new Error('The HLS cache location changed.');
      } else if (actual !== this.root) {
        throw new Error('The HLS cache location changed.');
      }
      return;
    }
    const root = await resolveCacheRoot();
    this.root = root;
    try {
      const abandoned = database().prepare("SELECT id FROM local_hls_windows WHERE root = ? AND state = 'encoding' LIMIT ?")
        .all(root, MAX_WINDOWS) as Array<{ id: string }>;
      for (const row of abandoned) await this.remove(row.id);
      await this.sweep(0);
    } catch (error) {
      this.root = undefined;
      throw error;
    }
    this.timer = setInterval(() => { void this.serialize(() => this.sweep(0)).catch(() => undefined); }, 10_000);
    this.timer.unref();
  }

  private pruneLeases(now: number) {
    for (const [id, consumers] of this.leases) {
      for (const [lease, expiry] of consumers) if (expiry <= now) consumers.delete(lease);
      if (consumers.size === 0) {
        this.leases.delete(id);
        this.jobs.get(id)?.controller.abort();
      }
    }
  }

  private async reconcileOrphans(): Promise<void> {
    const inventory = database().prepare('SELECT id FROM local_hls_windows WHERE root = ? LIMIT ?')
      .all(this.root!, MAX_WINDOWS + 1) as Array<{ id: string }>;
    if (inventory.length > MAX_WINDOWS) throw new HlsDeliveryError(507, 'The HLS cache inventory exceeds its window limit.');
    const known = new Set(inventory.map(row => row.id));
    let entries = 0;
    const root = await fs.opendir(this.root!);
    for await (const entry of root) {
      if (++entries > MAX_CACHE_ENTRIES) throw new HlsDeliveryError(507, 'The HLS cache directory exceeds its inventory limit.');
      if (!entry.name.startsWith(WINDOW_PREFIX)) continue;
      const id = entry.name.slice(WINDOW_PREFIX.length);
      if (!DIRECTORY_ID.test(id) || known.has(id)) continue;

      const directory = this.directory(id);
      if (!entry.isDirectory() || this.jobs.has(id) || this.leases.has(id) || this.readers.has(id) ||
          await fs.realpath(directory) !== directory) {
        throw new HlsDeliveryError(507, 'The HLS cache contains an unverified playback window.');
      }
      const files: string[] = [];
      const orphan = await fs.opendir(directory);
      for await (const file of orphan) {
        if (files.length >= MAX_WINDOW_FILES || !file.isFile() || !CACHE_FILE.test(file.name)) {
          throw new HlsDeliveryError(507, 'The HLS cache contains an unverified playback file.');
        }
        files.push(file.name);
      }
      if (await fs.realpath(directory) !== directory) {
        throw new HlsDeliveryError(507, 'The HLS cache window location changed.');
      }
      for (const file of files) await fs.unlink(path.join(directory, file));
      await fs.rmdir(directory);
    }
  }

  private async sweep(reservation: number, warmup = false): Promise<void> {
    const now = Date.now();
    this.pruneLeases(now);
    await this.reconcileOrphans();
    const db = database();
    const stats = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(reserved_bytes), 0) AS bytes FROM local_hls_windows WHERE root = ?')
      .get(this.root!) as { count: number; bytes: number };
    const ordered = db.prepare('SELECT * FROM local_hls_windows WHERE root = ? ORDER BY accessed_at LIMIT ?')
      .all(this.root!, MAX_WINDOWS) as unknown as WindowRow[];
    for (const row of ordered) {
      if (this.jobs.has(row.id) || this.leases.has(row.id) || this.readers.has(row.id)) continue;
      if (row.state === 'encoding' || now - row.accessed_at >= appConfig.hlsCacheMaxAgeMs ||
          (!warmup && (stats.bytes + reservation > appConfig.hlsCacheMaxBytes || (reservation > 0 && stats.count >= MAX_WINDOWS)))) {
        await this.remove(row.id);
        stats.bytes -= row.reserved_bytes;
        stats.count--;
      }
    }
    if (stats.bytes + reservation > appConfig.hlsCacheMaxBytes || (reservation > 0 && stats.count >= MAX_WINDOWS)) {
      throw new HlsDeliveryError(507, 'The HLS cache is full. Try again shortly or use a lower quality.');
    }
  }

  recover(): Promise<void> {
    return this.serialize(() => this.initialize());
  }

  hasWarmupCapacity(): boolean {
    const running = [...this.jobs.values()].filter(job => job.running);
    return running.length < appConfig.hlsTranscodeConcurrency && !running.some(job => job.warmup);
  }

  async open(request: RequestWindow): Promise<OpenWindow> {
    const { image, metadata, sourcePath, signal, warmup = false } = request;
    const durationSeconds = (metadata.durationMs ?? 0) / 1000;
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new HlsDeliveryError(422, 'The video duration is unavailable.');
    }
    const offsetSeconds = Math.min(Math.max(0, durationSeconds - 0.25), Math.floor(request.at));
    const fullSeconds = Math.min(HLS_WINDOW_SECONDS, durationSeconds - offsetSeconds);
    const openingSeconds = Math.min(HLS_OPENING_SECONDS, fullSeconds);
    const requestedSeconds = warmup ? openingSeconds : fullSeconds;
    const profile = hlsWindowReservation[request.profile] > appConfig.hlsCacheMaxBytes ? 'low' : request.profile;
    const copyVideo = profile === 'standard' && offsetSeconds === 0 && metadata.video?.codec === 'h264' &&
      metadata.video.pixelFormat === 'yuv420p' && metadata.video.colorTransfer !== 'smpte2084' &&
      metadata.video.colorTransfer !== 'arib-std-b67' && !metadata.rotation &&
      metadata.video.sampleAspectRatio === '1:1' && Math.max(metadata.displayWidth, metadata.displayHeight) <= 1280 &&
      Math.min(metadata.displayWidth, metadata.displayHeight) <= 720 && (metadata.bitrate ?? Infinity) <= 2_000_000;
    const keyFor = (windowSeconds: number) => createHash('sha256').update(JSON.stringify([
      CACHE_VERSION, image.source_id, image.id, image.checksum_or_fingerprint, metadata,
      offsetSeconds, windowSeconds, profile, copyVideo
    ])).digest('hex');

    const reserved = await this.serialize(async () => {
      signal.throwIfAborted();
      await this.initialize();
      if (overlaps(this.root!, sourcePath)) throw new HlsDeliveryError(503, 'HLS cache storage overlaps the source video.');
      const db = database();
      const lookup = db.prepare('SELECT * FROM local_hls_windows WHERE root = ? AND cache_key = ?');
      let windowSeconds = fullSeconds;
      let row = lookup.get(this.root!, keyFor(fullSeconds)) as unknown as WindowRow | undefined;
      // An opening window is useful only after its entire playlist is cached.
      if (!row && offsetSeconds === 0 && openingSeconds < fullSeconds) {
        const opening = lookup.get(this.root!, keyFor(openingSeconds)) as unknown as WindowRow | undefined;
        if (warmup || opening?.state === 'ready') {
          row = opening;
          windowSeconds = openingSeconds;
        }
      }
      if (row?.state === 'ready' &&
          !(await fs.stat(path.join(this.directory(row.id), HLS_MANIFEST)).catch(() => undefined))?.isFile()) {
        if (this.leases.has(row.id) || this.readers.has(row.id)) {
          throw new HlsDeliveryError(503, 'The cached playback window is temporarily unavailable.');
        }
        await this.remove(row.id);
        row = undefined;
      }
      const existing = row ? this.jobs.get(row.id) : undefined;
      if (warmup && existing?.running) {
        throw new HlsDeliveryError(503, 'This video is already being prepared.');
      }
      if (existing?.running && existing.controller.signal.aborted) {
        throw new HlsDeliveryError(503, 'The previous conversion is stopping. Try again shortly.');
      }
      if (!row) {
        const running = [...this.jobs].filter(([, job]) => job.running);
        const speculative = running.find(([, job]) => job.warmup);
        const full = running.length >= appConfig.hlsTranscodeConcurrency;
        if (warmup ? full || speculative : full && !speculative) {
          throw new HlsDeliveryError(503, 'All video encoders are busy. Try again shortly.');
        }
        if (!warmup && speculative) {
          const [id, job] = speculative;
          job.controller.abort();
          await job.finished;
          // Job finalization queues cleanup behind this reservation. Reclaim
          // the warmup here so its bytes cannot block the foreground request.
          this.jobs.delete(id);
          this.leases.delete(id);
          await this.remove(id);
        }
        windowSeconds = requestedSeconds;
        const reserve = hlsWindowReservation[profile];
        await this.sweep(reserve, warmup);
        signal.throwIfAborted();
        row = {
          id: randomUUID(), cache_key: keyFor(windowSeconds), image_id: image.id,
          revision: image.checksum_or_fingerprint, bytes: 0, reserved_bytes: reserve,
          state: 'encoding', accessed_at: Date.now()
        };
        db.prepare('INSERT INTO local_hls_windows VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .run(row.id, this.root!, row.cache_key, image.id, row.revision, 0, reserve, 'encoding', row.accessed_at);
        this.start(row, { sourcePath, metadata, durationSeconds: windowSeconds, offsetSeconds, profile, copyVideo }, warmup,
          offsetSeconds === 0 && windowSeconds > openingSeconds ? keyFor(openingSeconds) : undefined);
      }
      if (row.state === 'encoding' && !this.jobs.has(row.id)) {
        await this.remove(row.id);
        throw new HlsDeliveryError(503, 'The interrupted conversion was discarded. Try again.');
      }
      const consumers = this.leases.get(row.id) ?? new Map<string, number>();
      if (consumers.size >= MAX_CONSUMERS_PER_WINDOW) throw new HlsDeliveryError(503, 'This window has too many viewers.');
      const lease = randomUUID();
      consumers.set(lease, Date.now() + LEASE_MS);
      this.leases.set(row.id, consumers);
      this.touch(row.id);
      const job = this.jobs.get(row.id);
      if (job && !warmup) job.warmup = false;
      return { row, lease, job, windowSeconds };
    });

    try {
      const { job } = reserved;
      if (job) {
        await new Promise<void>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          if (signal.aborted) abort();
          const ready = warmup ? job.finished : job.firstManifest;
          void ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
        });
        if (job.error) throw job.error;
      }
      return { row: reserved.row, lease: reserved.lease, offsetSeconds, durationSeconds, windowSeconds: reserved.windowSeconds, profile };
    } catch (error) {
      this.release(reserved.row.id, reserved.lease);
      throw error;
    }
  }

  private start(
    row: WindowRow,
    inputs: Omit<Parameters<typeof encodeHlsWindow>[0], 'outputDirectory' | 'signal' | 'onFile'>,
    warmup: boolean,
    openingKey?: string
  ) {
    const directory = this.directory(row.id);
    const controller = new AbortController();
    const files = new Map<string, number>();
    let publish!: () => void;
    const firstManifest = new Promise<void>(resolve => { publish = resolve; });
    const job: ActiveWindow = { controller, firstManifest, finished: Promise.resolve(), warmup, running: true };
    this.jobs.set(row.id, job);
    job.finished = (async () => {
      try {
        await fs.mkdir(directory, { mode: 0o700 });
        await encodeHlsWindow({
          ...inputs, outputDirectory: directory, signal: controller.signal,
          onFile(name, size) {
            files.set(name, size);
            if (name === HLS_MANIFEST) publish();
          }
        });
        let bytes = 0;
        for (const size of files.values()) bytes += size;
        database().prepare("UPDATE local_hls_windows SET state = 'ready', bytes = ?, reserved_bytes = ?, accessed_at = ? WHERE id = ?")
          .run(bytes, bytes, Date.now(), row.id);
      } catch (error) {
        // A swipe cancels the remaining conversion, but a completed opening
        // segment is still useful when returning to this Reel.
        const retained = controller.signal.aborted && openingKey && await this.retainOpening(row, openingKey, files);
        if (!retained) {
          const errno = (error as NodeJS.ErrnoException | undefined)?.code;
          job.error = errno === 'ENOSPC' || errno === 'EDQUOT'
            ? new HlsDeliveryError(507, 'HLS storage is full. Free space or retry at a lower quality.')
            : error;
        }
      } finally {
        job.running = false;
        publish();
        void this.serialize(async () => {
          this.jobs.delete(row.id);
          if (job.error && !this.readers.has(row.id)) {
            this.leases.delete(row.id);
            await this.remove(row.id);
          }
        }).catch(() => undefined);
      }
    })();
  }

  private async retainOpening(row: WindowRow, cacheKey: string, files: Map<string, number>): Promise<boolean> {
    const directory = this.directory(row.id);
    const temporary = path.join(directory, HLS_MANIFEST + '.99.part');
    try {
      const manifest = await fs.readFile(path.join(directory, HLS_MANIFEST), 'utf8');
      const first = /#EXTINF:([\d.]+),[^\n]*\r?\n(segment-\d{3}\.ts)\r?\n/.exec(manifest);
      if (!first || first[2] !== 'segment-000.ts' || !files.has(first[2]) ||
          !Number.isFinite(Number(first[1])) || Math.abs(Number(first[1]) - HLS_OPENING_SECONDS) > 0.05) return false;
      const opening = (manifest.slice(0, first.index) + first[0] + '#EXT-X-ENDLIST\n')
        .replace('#EXT-X-PLAYLIST-TYPE:EVENT', '#EXT-X-PLAYLIST-TYPE:VOD');
      const bytes = Buffer.byteLength(opening) + files.get(first[2])!;
      if (bytes > row.reserved_bytes) return false;
      await fs.writeFile(temporary, opening, { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, path.join(directory, HLS_MANIFEST));
      for (const name of files.keys()) {
        if (name !== HLS_MANIFEST && name !== first[2]) await fs.unlink(path.join(directory, name));
      }
      database().prepare("UPDATE local_hls_windows SET cache_key = ?, state = 'ready', bytes = ?, reserved_bytes = ?, accessed_at = ? WHERE id = ?")
        .run(cacheKey, bytes, bytes, Date.now(), row.id);
      return true;
    } catch {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
      return false;
    }
  }

  private touch(id: string) {
    const now = Date.now();
    database().prepare('UPDATE local_hls_windows SET accessed_at = ? WHERE id = ? AND accessed_at < ?')
      .run(now, id, now - LEASE_UPDATE_MS);
  }

  releaseForImage(imageId: number, id: string, lease: string): void {
    if (!this.root || !this.leases.has(id)) return;
    if (database().prepare('SELECT 1 FROM local_hls_windows WHERE id = ? AND root = ? AND image_id = ?').get(id, this.root, imageId)) {
      this.release(id, lease);
    }
  }

  release(id: string, lease: string): void {
    const consumers = this.leases.get(id);
    if (!consumers?.delete(lease) || consumers.size) return;
    this.leases.delete(id);
    const job = this.jobs.get(id);
    if (job?.running) job.controller.abort();
  }

  acquireFile(image: ImageRecord, id: string, lease: string, name: string): { file: string; end: () => void } | undefined {
    if (!this.root || !DIRECTORY_ID.test(id) || (name !== HLS_MANIFEST && !HLS_SEGMENT.test(name))) return;
    const consumers = this.leases.get(id);
    const expiry = consumers?.get(lease);
    if (!expiry || expiry <= Date.now() || this.jobs.get(id)?.error) return;
    const row = database().prepare('SELECT image_id, revision FROM local_hls_windows WHERE id = ? AND root = ?')
      .get(id, this.root) as { image_id: number; revision: string } | undefined;
    if (row?.image_id !== image.id || row.revision !== image.checksum_or_fingerprint) return;
    consumers!.set(lease, Date.now() + LEASE_MS);
    this.touch(id);
    this.readers.set(id, (this.readers.get(id) ?? 0) + 1);
    let ended = false;
    return {
      file: path.join(this.directory(id), name),
      end: () => {
        if (ended) return;
        ended = true;
        const remaining = (this.readers.get(id) ?? 1) - 1;
        if (remaining) this.readers.set(id, remaining);
        else this.readers.delete(id);
      }
    };
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    const jobs = [...this.jobs.values()];
    for (const job of jobs) job.controller.abort();
    await Promise.all(jobs.map(job => job.finished));
    await this.queue;
    this.root = undefined;
    this.leases.clear();
    this.readers.clear();
  }
}

export const hlsCache = new HlsCache();
