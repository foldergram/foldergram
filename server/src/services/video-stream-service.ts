import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import pLimit from 'p-limit';

import { appConfig } from '../config/env.js';
import type { VideoPlaybackQuality } from '../types/models.js';
import { acquireHlsCacheGroup, touchHlsCacheGroup } from './hls-cache-service.js';
import { log } from './log-service.js';

const execFileAsync = promisify(execFile);

// Segment length drives both start-up latency and seek granularity. Segments here are
// transcoded on demand, so the first one is on the critical path for every start and
// every seek: two seconds halves that work, at the cost of more requests overall,
// which a LAN NAS can absorb. Every HLS client tolerates this target duration.
export const HLS_SEGMENT_SECONDS = 2;
/** Cold seeks encode this many 2-second segments in one ffmpeg run (8s). */
export const HLS_SEEK_WINDOW_SEGMENTS = 4;

// Shorter segments mean more, cheaper ffmpeg invocations, so one more in flight keeps
// the prefetch queue draining without starving playback of CPU.
const SEGMENT_CONCURRENCY = Math.max(1, Math.min(4, appConfig.scanDerivativeConcurrency));
const segmentLimit = pLimit(SEGMENT_CONCURRENCY);
const inflightSegments = new Map<string, Promise<Buffer>>();
const inflightWindows = new Map<string, Promise<void>>();
const invalidatedImageIds = new Set<number>();

class FfmpegAbortedError extends Error {
  constructor(message = 'ffmpeg aborted') {
    super(message);
    this.name = 'FfmpegAbortedError';
  }
}

interface TrackedEncode {
  imageId: number;
  quality: VideoStreamQuality;
  startIndex: number;
  child: ChildProcess;
}

const activeEncodes = new Set<TrackedEncode>();

function isAbortError(error: unknown): boolean {
  return error instanceof FfmpegAbortedError;
}

function killChild(child: ChildProcess): void {
  if (child.killed || child.exitCode != null) {
    return;
  }

  try {
    child.kill('SIGKILL');
  } catch {
    // The process may have already exited.
  }
}

function supersedesEncode(existing: TrackedEncode, next: { imageId: number; startIndex: number }): boolean {
  return existing.imageId === next.imageId
    && Math.abs(existing.startIndex - next.startIndex) >= HLS_SEEK_WINDOW_SEGMENTS;
}

function abortSupersededEncodes(next: { imageId: number; startIndex: number }): void {
  for (const encode of [...activeEncodes]) {
    if (supersedesEncode(encode, next)) {
      killChild(encode.child);
    }
  }
}

function parseWindowKey(key: string): { imageId: number; quality: string; startIndex: number; count: number } | null {
  const [imageIdRaw, quality, startRaw, countRaw] = key.split(':');
  const imageId = Number(imageIdRaw);
  const startIndex = Number(startRaw);
  const count = Number(countRaw);
  if (!Number.isInteger(imageId) || !quality || !Number.isInteger(startIndex) || !Number.isInteger(count)) {
    return null;
  }

  return { imageId, quality, startIndex, count };
}

function findCoveringWindow(imageId: number, quality: VideoStreamQuality, index: number): Promise<void> | null {
  for (const [key, promise] of inflightWindows) {
    const parsed = parseWindowKey(key);
    if (!parsed) {
      continue;
    }

    if (parsed.imageId === imageId && parsed.quality === quality && index >= parsed.startIndex && index < parsed.startIndex + parsed.count) {
      return promise;
    }
  }

  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function whenSettled(promise: Promise<unknown>): Promise<'done'> {
  return promise.then(() => 'done' as const, () => 'done' as const);
}

export type VideoStreamQuality = Exclude<VideoPlaybackQuality, 'auto' | 'original'>;

export const STREAM_QUALITIES: VideoStreamQuality[] = ['480p', '720p', '1080p'];

interface QualityProfile {
  shortEdge: number;
  /** Video bit rate in bits per second. */
  videoBitrate: number;
  /** Audio bit rate in bits per second. */
  audioBitrate: number;
}

const QUALITY_PROFILES: Record<VideoStreamQuality, QualityProfile> = {
  // The first rendition must have enough headroom for a variable 2-3 Mbps WAN
  // connection. The old 720p rendition alone was already too close to that limit.
  '480p': { shortEdge: 480, videoBitrate: 800_000, audioBitrate: 64_000 },
  '720p': { shortEdge: 720, videoBitrate: 1_700_000, audioBitrate: 96_000 },
  '1080p': { shortEdge: 1080, videoBitrate: 3_500_000, audioBitrate: 128_000 }
};

interface HardwareState {
  mode: 'vaapi' | 'none';
  device: string | null;
}

const durationCache = new Map<string, number | null>();

let hardwareStatePromise: Promise<HardwareState> | null = null;

async function probeHardware(): Promise<HardwareState> {
  if (appConfig.videoHwaccel === 'none') {
    return { mode: 'none', device: null };
  }

  const device = appConfig.videoHwaccelDevice;

  try {
    await fs.access(device);
  } catch {
    log.info(`Video hardware acceleration unavailable | reason missing-device | device ${device}`);
    return { mode: 'none', device: null };
  }

  // A real encode of a synthetic clip is the only reliable capability check;
  // ffmpeg advertises h264_vaapi even when the driver cannot initialize it.
  try {
    await execFileAsync(
      'ffmpeg',
      [
        '-hide_banner', '-v', 'error',
        '-vaapi_device', device,
        '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=25:duration=1',
        '-vf', 'format=nv12,hwupload',
        '-c:v', 'h264_vaapi', '-f', 'null', '-'
      ],
      { timeout: 30_000 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.info(`Video hardware acceleration unavailable | reason probe-failed | ${message.split('\n')[0]}`);
    return { mode: 'none', device: null };
  }

  log.info(`Video hardware acceleration enabled | mode vaapi | device ${device}`);
  return { mode: 'vaapi', device };
}

export function getHardwareState(): Promise<HardwareState> {
  if (!hardwareStatePromise) {
    hardwareStatePromise = probeHardware();
  }

  return hardwareStatePromise;
}

export function getSegmentCount(durationMs: number | null): number {
  const durationSeconds = (durationMs ?? 0) / 1000;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }

  return Math.max(1, Math.ceil(durationSeconds / HLS_SEGMENT_SECONDS));
}

function getSegmentDuration(durationMs: number | null, index: number): number {
  const durationSeconds = (durationMs ?? 0) / 1000;
  const start = index * HLS_SEGMENT_SECONDS;
  return Math.max(0.1, Math.min(HLS_SEGMENT_SECONDS, durationSeconds - start));
}

/**
 * Scales the source down so its short edge matches the requested quality while
 * keeping both dimensions even, which H.264 in yuv420p requires. Sources already
 * smaller than the target are left alone.
 */
export function resolveTargetDimensions(
  width: number,
  height: number,
  quality: VideoStreamQuality
): { width: number; height: number } {
  const target = QUALITY_PROFILES[quality].shortEdge;
  const shortEdge = Math.min(width, height);

  if (shortEdge <= 0 || shortEdge <= target) {
    return { width: makeEven(width), height: makeEven(height) };
  }

  const scale = target / shortEdge;
  return {
    width: makeEven(Math.round(width * scale)),
    height: makeEven(Math.round(height * scale))
  };
}

function makeEven(value: number): number {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

export function buildMediaPlaylist(durationMs: number | null): string {
  const segmentCount = getSegmentCount(durationMs);
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${HLS_SEGMENT_SECONDS}`,
    '#EXT-X-MEDIA-SEQUENCE:0'
  ];

  for (let index = 0; index < segmentCount; index += 1) {
    lines.push(`#EXTINF:${getSegmentDuration(durationMs, index).toFixed(3)},`);
    lines.push(`segment-${index}.ts`);
  }

  lines.push('#EXT-X-ENDLIST');
  return `${lines.join('\n')}\n`;
}

function defaultMediaPlaylistPath(imageId: number, quality: string): string {
  return `/api/videos/${imageId}/hls/${quality}/index.m3u8`;
}

export function buildMasterPlaylist(
  imageId: number,
  width: number,
  height: number,
  qualities: VideoStreamQuality[],
  buildPlaylistPath: (imageId: number, quality: string) => string = defaultMediaPlaylistPath
): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  for (const quality of qualities) {
    const dimensions = resolveTargetDimensions(width, height, quality);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${Math.ceil((QUALITY_PROFILES[quality].videoBitrate + QUALITY_PROFILES[quality].audioBitrate) * 1.12)},RESOLUTION=${dimensions.width}x${dimensions.height}`
    );
    lines.push(buildPlaylistPath(imageId, quality));
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Drops qualities that would upscale the source. A 480x852 clip only ever needs
 * its own resolution, so offering 1080p there would waste GPU time for no gain.
 */
export function resolveOfferedQualities(width: number, height: number): VideoStreamQuality[] {
  const shortEdge = Math.min(width, height);
  const offered = STREAM_QUALITIES.filter((quality) => QUALITY_PROFILES[quality].shortEdge < shortEdge);
  return offered.length > 0 ? offered : ['480p'];
}

function buildFfmpegArgs(options: {
  sourcePath: string;
  startSeconds: number;
  durationSeconds: number;
  target: { width: number; height: number };
  quality: VideoStreamQuality;
  hardware: HardwareState;
}): string[] {
  const { sourcePath, startSeconds, durationSeconds, target, quality, hardware } = options;
  const profile = QUALITY_PROFILES[quality];
  // Keep decoding on CPU. VAAPI decode is fast but several camera/profile
  // combinations on the NAS render green frames; hardware encoding remains safe.
  const canDecodeOnGpu = false;
  const args = ['-hide_banner', '-v', 'error', '-nostdin'];

  if (hardware.mode === 'vaapi' && hardware.device) {
    if (canDecodeOnGpu) {
      args.push(
        '-hwaccel', 'vaapi',
        '-hwaccel_device', hardware.device,
        '-hwaccel_output_format', 'vaapi'
      );
    } else {
      args.push('-vaapi_device', hardware.device);
    }
  }

  // Placing -ss before -i lets ffmpeg seek by index and then decode up to the
  // exact requested timestamp, so segments line up without needing keyframes at
  // segment boundaries in the source.
  args.push('-ss', startSeconds.toFixed(3), '-t', durationSeconds.toFixed(3), '-i', sourcePath);
  args.push('-map', '0:v:0', '-map', '0:a:0?');

  if (hardware.mode === 'vaapi') {
    const filter = canDecodeOnGpu
      ? `scale_vaapi=w=${target.width}:h=${target.height}`
      : `format=nv12,hwupload,scale_vaapi=w=${target.width}:h=${target.height}`;
    args.push(
      '-vf', filter,
      '-c:v', 'h264_vaapi',
      '-b:v', String(profile.videoBitrate),
      '-maxrate', String(profile.videoBitrate),
      '-bufsize', String(profile.videoBitrate * 2)
    );
  } else {
    args.push(
      '-vf', `scale=${target.width}:${target.height}:flags=fast_bilinear`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2',
      '-b:v', String(profile.videoBitrate),
      '-maxrate', String(profile.videoBitrate),
      '-bufsize', String(profile.videoBitrate * 2),
      '-pix_fmt', 'yuv420p'
    );
  }

  args.push('-c:a', 'aac', '-b:a', String(profile.audioBitrate), '-ac', '2');
  // Absolute timestamps keep independently produced segments continuous for the
  // player, which is what makes seeking land cleanly on any segment.
  args.push(
    '-output_ts_offset', startSeconds.toFixed(3),
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-f', 'mpegts',
    'pipe:1'
  );

  return args;
}

function buildFfmpegWindowArgs(options: {
  sourcePath: string;
  startSeconds: number;
  durationSeconds: number;
  startIndex: number;
  target: { width: number; height: number };
  quality: VideoStreamQuality;
  hardware: HardwareState;
  outputDir: string;
}): string[] {
  const { sourcePath, startSeconds, durationSeconds, startIndex, target, quality, hardware, outputDir } = options;
  const profile = QUALITY_PROFILES[quality];
  const args = ['-hide_banner', '-v', 'error', '-nostdin', '-y'];

  if (hardware.mode === 'vaapi' && hardware.device) {
    args.push('-vaapi_device', hardware.device);
  }

  args.push('-ss', startSeconds.toFixed(3), '-t', durationSeconds.toFixed(3), '-i', sourcePath);
  args.push('-map', '0:v:0', '-map', '0:a:0?');

  if (hardware.mode === 'vaapi') {
    args.push(
      '-vf', `format=nv12,hwupload,scale_vaapi=w=${target.width}:h=${target.height}`,
      '-c:v', 'h264_vaapi',
      '-b:v', String(profile.videoBitrate),
      '-maxrate', String(profile.videoBitrate),
      '-bufsize', String(profile.videoBitrate * 2)
    );
  } else {
    args.push(
      '-vf', `scale=${target.width}:${target.height}:flags=fast_bilinear`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-threads', '2',
      '-b:v', String(profile.videoBitrate),
      '-maxrate', String(profile.videoBitrate),
      '-bufsize', String(profile.videoBitrate * 2),
      '-pix_fmt', 'yuv420p'
    );
  }

  args.push(
    '-c:a', 'aac', '-b:a', String(profile.audioBitrate), '-ac', '2',
    '-force_key_frames', `expr:gte(t,n_forced*${HLS_SEGMENT_SECONDS})`,
    '-sc_threshold', '0',
    '-output_ts_offset', startSeconds.toFixed(3),
    '-muxdelay', '0',
    '-muxpreload', '0',
    '-f', 'hls',
    '-hls_time', String(HLS_SEGMENT_SECONDS),
    '-hls_list_size', '0',
    '-hls_flags', 'independent_segments+split_by_time',
    '-start_number', String(startIndex),
    '-hls_segment_filename', path.join(outputDir, 'segment-%d.ts'),
    path.join(outputDir, 'window.m3u8')
  );

  return args;
}

function trackEncode(
  child: ChildProcess,
  track: { imageId: number; quality: VideoStreamQuality; startIndex: number } | undefined,
  onFinish: (code: number | null, signal: NodeJS.Signals | null) => void
): void {
  const tracked: TrackedEncode | null = track ? { ...track, child } : null;
  if (tracked) {
    activeEncodes.add(tracked);
  }

  const cleanup = () => {
    if (tracked) {
      activeEncodes.delete(tracked);
    }
  };

  child.on('error', (error) => {
    cleanup();
    onFinish(1, null);
    void error;
  });
  child.on('close', (code, signal) => {
    cleanup();
    onFinish(code, signal);
  });
}

function rejectFfmpegFailure(
  reject: (reason?: unknown) => void,
  code: number | null,
  signal: NodeJS.Signals | null,
  stderrChunks: Buffer[]
): void {
  if (signal != null) {
    reject(new FfmpegAbortedError());
    return;
  }

  const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
  reject(new Error(stderr.length > 0 ? stderr.split('\n').slice(-3).join(' ') : `ffmpeg exited with code ${code}`));
}

function runFfmpegProcess(
  args: string[],
  track?: { imageId: number; quality: VideoStreamQuality; startIndex: number }
): Promise<void> {
  const work = new Promise<void>((resolve, reject) => {
    if (track) {
      abortSupersededEncodes(track);
    }
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    trackEncode(child, track, (code, signal) => {
      if (code === 0 && signal == null) {
        resolve();
        return;
      }

      rejectFfmpegFailure(reject, code, signal, stderrChunks);
    });
  });
  void work.catch(() => undefined);
  return work;
}

function runFfmpeg(
  args: string[],
  track?: { imageId: number; quality: VideoStreamQuality; startIndex: number }
): Promise<Buffer> {
  const work = new Promise<Buffer>((resolve, reject) => {
    if (track) {
      abortSupersededEncodes(track);
    }
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    trackEncode(child, track, (code, signal) => {
      if (code === 0 && signal == null && stdoutChunks.length > 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      rejectFfmpegFailure(reject, code, signal, stderrChunks);
    });
  });
  void work.catch(() => undefined);
  return work;
}

function getCacheGroupPath(imageId: number, quality: VideoStreamQuality): string {
  return path.join(appConfig.hlsCacheDir, String(imageId), quality);
}

function getCachePath(imageId: number, quality: VideoStreamQuality, index: number): string {
  return path.join(getCacheGroupPath(imageId, quality), `segment-${index}.ts`);
}

/** Removes every cached HLS segment for media that was permanently deleted. */
export async function invalidateVideoStreamCache(imageIds: readonly number[]): Promise<void> {
  const uniqueIds = [...new Set(imageIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  if (uniqueIds.length === 0) return;

  for (const imageId of uniqueIds) {
    invalidatedImageIds.add(imageId);
  }

  await Promise.all(
    uniqueIds.map(async (imageId) => {
      try {
        await fs.rm(path.join(appConfig.hlsCacheDir, String(imageId)), { recursive: true, force: true });
      } catch (error) {
        log.info(`HLS cache invalidation skipped | image ${imageId} | ${error instanceof Error ? error.message : String(error)}`);
      }
    })
  );
}

async function readCachedSegment(cachePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(cachePath);
  } catch {
    return null;
  }
}

async function writeCachedSegment(cachePath: string, payload: Buffer): Promise<void> {
  try {
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    const temporaryPath = `${cachePath}.${process.pid}.part`;
    await fs.writeFile(temporaryPath, payload);
    await fs.rename(temporaryPath, cachePath);
  } catch (error) {
    log.info(`HLS segment cache write skipped | ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function encodeSegmentWindow(input: TranscodeSegmentInput, count: number): Promise<void> {
  const windowCount = Math.max(1, Math.min(HLS_SEEK_WINDOW_SEGMENTS, count));
  const windowKey = `${input.imageId}:${input.quality}:${input.index}:${windowCount}`;
  const existing = inflightWindows.get(windowKey);
  if (existing) {
    await existing;
    return;
  }

  const work = (async () => {
    const cacheGroupPath = getCacheGroupPath(input.imageId, input.quality);
    const missing: number[] = [];
    for (let offset = 0; offset < windowCount; offset += 1) {
      const index = input.index + offset;
      const cached = await readCachedSegment(getCachePath(input.imageId, input.quality, index));
      if (!cached) {
        missing.push(index);
      }
    }

    if (missing.length === 0) {
      return;
    }

    // A single hole is cheaper as the existing one-segment encode. Returning here
    // lets getSegmentWindow fall through without taking another limiter slot.
    if (missing.length === 1) {
      return;
    }

    const hardware = await getHardwareState();
    const target = resolveTargetDimensions(input.width, input.height, input.quality);
    const startSeconds = input.index * HLS_SEGMENT_SECONDS;
    const durationSeconds = Array.from({ length: windowCount }, (_, offset) =>
      getSegmentDuration(input.durationMs, input.index + offset)
    ).reduce((total, value) => total + value, 0);
    const outputDir = path.join(cacheGroupPath, `.window-${input.index}-${process.pid}`);

    await fs.mkdir(outputDir, { recursive: true });

    // Backfill encodes stay off the tracked-encode registry: a foreground seek aborts
    // superseded encodes in that registry, and background filler must never take a
    // foreground encode down with it.
    const track = input.backfill ? undefined : { imageId: input.imageId, quality: input.quality, startIndex: input.index };
    let encodeFinished = false;

    const harvestReadySegments = async (forceTail: boolean) => {
      if (invalidatedImageIds.has(input.imageId)) {
        return;
      }

      for (let offset = 0; offset < windowCount; offset += 1) {
        const index = input.index + offset;
        const destination = getCachePath(input.imageId, input.quality, index);
        if (await readCachedSegment(destination)) {
          continue;
        }

        const produced = path.join(outputDir, `segment-${index}.ts`);
        const isLast = offset === windowCount - 1;
        const nextExists = isLast ? false : await fileExists(path.join(outputDir, `segment-${index + 1}.ts`));
        if (!forceTail && !nextExists && !(isLast && encodeFinished)) {
          continue;
        }
        if (!(forceTail || nextExists || encodeFinished) && !await fileExists(produced)) {
          continue;
        }

        try {
          await fs.copyFile(produced, destination);
        } catch {
          // ffmpeg may still be writing this file, or a short tail omitted it.
        }
      }
    };

    try {
      const runWindow = async (mode: HardwareState) => {
        const encode = runFfmpegProcess(buildFfmpegWindowArgs({
          sourcePath: input.sourcePath,
          startSeconds,
          durationSeconds,
          startIndex: input.index,
          target,
          quality: input.quality,
          hardware: mode,
          outputDir
        }), track);

        while (true) {
          const pending = await Promise.race([
            whenSettled(encode),
            delay(120).then(() => 'tick' as const)
          ]);
          await harvestReadySegments(false);
          if (pending === 'done') {
            break;
          }
        }

        await encode;
      };

      try {
        await runWindow(hardware);
      } catch (error) {
        if (isAbortError(error) || hardware.mode === 'none') {
          throw error;
        }

        log.info(
          `HLS window hardware encode failed, retrying on CPU | image ${input.imageId} | start ${input.index} | ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        await runWindow({ mode: 'none', device: null });
      }

      encodeFinished = true;
      await harvestReadySegments(true);
    } catch (error) {
      encodeFinished = true;
      await harvestReadySegments(true);
      throw error;
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  })();

  const tracked = work.finally(() => {
    if (inflightWindows.get(windowKey) === tracked) {
      inflightWindows.delete(windowKey);
    }
  });
  inflightWindows.set(windowKey, tracked);
  await tracked;
}

export async function getSegmentWindow(input: TranscodeSegmentInput, count = HLS_SEEK_WINDOW_SEGMENTS): Promise<Buffer> {
  const cacheGroupPath = getCacheGroupPath(input.imageId, input.quality);
  const releaseCacheGroup = acquireHlsCacheGroup(cacheGroupPath);

  try {
    await touchHlsCacheGroup(cacheGroupPath);
    const cached = await readCachedSegment(getCachePath(input.imageId, input.quality, input.index));
    if (cached) {
      return cached;
    }

    const covering = findCoveringWindow(input.imageId, input.quality, input.index);
    const windowWork = covering ?? segmentLimit(() => encodeSegmentWindow(input, count));

    while (true) {
      const ready = await readCachedSegment(getCachePath(input.imageId, input.quality, input.index));
      if (ready) {
        return ready;
      }

      const pending = await Promise.race([
        whenSettled(windowWork),
        delay(80).then(() => 'tick' as const)
      ]);
      if (pending === 'done') {
        break;
      }
    }

    await windowWork;

    const warmed = await readCachedSegment(getCachePath(input.imageId, input.quality, input.index));
    if (warmed) {
      return warmed;
    }

    return getSegment(input);
  } finally {
    releaseCacheGroup();
  }
}

export interface TranscodeSegmentInput {
  imageId: number;
  sourcePath: string;
  durationMs: number | null;
  width: number;
  height: number;
  quality: VideoStreamQuality;
  index: number;
  /**
   * Session backfill work. Backfill encodes are never registered as active encodes:
   * they must not abort a foreground seek, and a foreground seek must not wait on them.
   */
  backfill?: boolean;
}

export async function getSegment(input: TranscodeSegmentInput): Promise<Buffer> {
  const cacheGroupPath = getCacheGroupPath(input.imageId, input.quality);
  const releaseCacheGroup = acquireHlsCacheGroup(cacheGroupPath);

  try {
    await touchHlsCacheGroup(cacheGroupPath);
    const cachePath = getCachePath(input.imageId, input.quality, input.index);
    const cached = await readCachedSegment(cachePath);
    if (cached) {
      return cached;
    }

    const dedupeKey = cachePath;
    const existing = inflightSegments.get(dedupeKey);
    if (existing) {
      return existing;
    }

    const work = segmentLimit(async () => {
      const raced = await readCachedSegment(cachePath);
      if (raced) {
        return raced;
      }

      const hardware = await getHardwareState();
      const target = resolveTargetDimensions(input.width, input.height, input.quality);
      const startSeconds = input.index * HLS_SEGMENT_SECONDS;
      const durationSeconds = getSegmentDuration(input.durationMs, input.index);
      const args = buildFfmpegArgs({
        sourcePath: input.sourcePath,
        startSeconds,
        durationSeconds,
        target,
        quality: input.quality,
        hardware
      });

      const track = input.backfill ? undefined : { imageId: input.imageId, quality: input.quality, startIndex: input.index };
      let payload: Buffer;
      try {
        payload = await runFfmpeg(args, track);
      } catch (error) {
        if (isAbortError(error) || hardware.mode === 'none') {
          throw error;
        }

        // A driver-level failure on one clip should not take playback down, so the
        // CPU encoder covers the gap for that segment.
        log.info(
          `HLS segment hardware encode failed, retrying on CPU | image ${input.imageId} | segment ${input.index} | ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        payload = await runFfmpeg(
          buildFfmpegArgs({
            sourcePath: input.sourcePath,
            startSeconds,
            durationSeconds,
            target,
            quality: input.quality,
            hardware: { mode: 'none', device: null }
          }),
          track
        );
      }

      // A segment may still finish transcoding after its source was deleted. Never put
      // that stale result back into the cache after invalidation removed its directory.
      if (!invalidatedImageIds.has(input.imageId)) {
        await writeCachedSegment(cachePath, payload);
      }
      return payload;
    });

    const tracked = work.finally(() => {
      if (inflightSegments.get(dedupeKey) === tracked) {
        inflightSegments.delete(dedupeKey);
      }
    });
    inflightSegments.set(dedupeKey, tracked);
    return await tracked;
  } finally {
    releaseCacheGroup();
  }
}

const codecCache = new Map<string, string | null>();

/** Cached so repeated segment requests for one clip probe the file only once. */
export async function getSourceVideoCodec(sourcePath: string): Promise<string | null> {
  const cached = codecCache.get(sourcePath);
  if (cached !== undefined) {
    return cached;
  }

  let codec: string | null = null;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name',
      '-of', 'default=nw=1:nk=1',
      sourcePath
    ]);
    const trimmed = stdout.trim();
    codec = trimmed.length > 0 ? trimmed : null;
  } catch {
    codec = null;
  }

  codecCache.set(sourcePath, codec);
  return codec;
}

/** Probe duration on demand for legacy rows whose scan could not read it. */
export async function getSourceVideoDurationMs(sourcePath: string): Promise<number | null> {
  if (durationCache.has(sourcePath)) {
    return durationCache.get(sourcePath) ?? null;
  }

  let durationMs: number | null = null;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,duration',
      '-of', 'json',
      sourcePath
    ]);
    const payload = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; duration?: string }>;
    };
    const formatDuration = Number.parseFloat(payload.format?.duration ?? '');
    const videoDuration = Number.parseFloat(
      payload.streams?.find((stream) => stream.codec_type === 'video')?.duration ?? ''
    );
    const seconds = Number.isFinite(formatDuration) && formatDuration > 0
      ? formatDuration
      : Number.isFinite(videoDuration) && videoDuration > 0
        ? videoDuration
        : null;
    durationMs = seconds === null ? null : Math.round(seconds * 1000);
  } catch {
    durationMs = null;
  }

  durationCache.set(sourcePath, durationMs);
  return durationMs;
}

export function isStreamQuality(value: string): value is VideoStreamQuality {
  return (STREAM_QUALITIES as string[]).includes(value);
}

// ── Session backfill ──────────────────────────────────────────────────────────
//
// Once a viewer is actually playing a clip (the segment route below), the remaining
// segments are produced one window at a time while the transcoder is idle. A seek
// then almost always lands on a cached segment instead of a cold encode. Only one
// session backfills at a time: starting a different video or quality replaces the
// previous job via the generation guard, and foreground work always pre-empts it.

/** 600 segments × 2s ≈ backfill covers the first 20 minutes of a clip; longer seeks stay on demand. */
const BACKFILL_MAX_SEGMENTS = 600;
const BACKFILL_IDLE_RETRY_MS = 400;
const BACKFILL_STEP_MS = 60;

let backfillSession: { key: string; generation: number } | null = null;
let backfillGeneration = 0;

function isTranscoderIdle(): boolean {
  return segmentLimit.activeCount === 0 && segmentLimit.pendingCount === 0;
}

async function runStreamBackfill(
  input: Omit<TranscodeSegmentInput, 'index'>,
  fromIndex: number,
  segmentCount: number,
  generation: number
): Promise<void> {
  const limit = Math.min(segmentCount, fromIndex + BACKFILL_MAX_SEGMENTS);
  let index = fromIndex;

  while (index < limit) {
    if (backfillGeneration !== generation || invalidatedImageIds.has(input.imageId)) {
      return;
    }

    // Foreground playback and seeks own the transcoder. Backfill only fills while
    // nothing else is queued, so it never delays the segment the viewer is waiting on.
    if (!isTranscoderIdle()) {
      await delay(BACKFILL_IDLE_RETRY_MS);
      continue;
    }

    try {
      await getSegmentWindow(
        { ...input, index, backfill: true },
        Math.min(HLS_SEEK_WINDOW_SEGMENTS, limit - index)
      );
      index += HLS_SEEK_WINDOW_SEGMENTS;
    } catch {
      // A failed window must not wedge the session: the player's own retry covers it.
      return;
    }

    await delay(BACKFILL_STEP_MS);
  }
}

/** Starts (or continues) the low-priority backfill for the clip a viewer is playing. */
export function scheduleStreamBackfill(
  input: Omit<TranscodeSegmentInput, 'index'>,
  fromIndex: number
): Promise<void> {
  const segmentCount = getSegmentCount(input.durationMs);
  if (segmentCount === 0 || fromIndex >= segmentCount) {
    return Promise.resolve();
  }

  const key = `${input.imageId}:${input.quality}`;
  if (backfillSession?.key === key) {
    return Promise.resolve();
  }

  const generation = ++backfillGeneration;
  backfillSession = { key, generation };

  const work = runStreamBackfill(input, fromIndex, segmentCount, generation)
    .catch(() => {
      // Backfill is opportunistic: its failure is never user visible.
    })
    .finally(() => {
      if (backfillSession?.generation === generation) {
        backfillSession = null;
      }
    });
  // The route treats this as fire-and-forget; returning the promise only exists so
  // tests can await completion deterministically.
  return work;
}
