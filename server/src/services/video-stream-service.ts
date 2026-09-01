import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import pLimit from 'p-limit';

import { appConfig } from '../config/env.js';
import type { VideoPlaybackQuality } from '../types/models.js';
import { log } from './log-service.js';

const execFileAsync = promisify(execFile);

// Segment length drives both start-up latency and seek granularity. Segments here are
// transcoded on demand, so the first one is on the critical path for every start and
// every seek: two seconds halves that work, at the cost of more requests overall,
// which a LAN NAS can absorb. Every HLS client tolerates this target duration.
export const HLS_SEGMENT_SECONDS = 2;

// Shorter segments mean more, cheaper ffmpeg invocations, so one more in flight keeps
// the prefetch queue draining without starving playback of CPU.
const SEGMENT_CONCURRENCY = Math.max(1, Math.min(4, appConfig.scanDerivativeConcurrency));
const segmentLimit = pLimit(SEGMENT_CONCURRENCY);
const inflightSegments = new Map<string, Promise<Buffer>>();
const invalidatedImageIds = new Set<number>();

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
      '-c:v', 'libx264', '-preset', 'veryfast',
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

function runFfmpeg(args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0 && stdoutChunks.length > 0) {
        resolve(Buffer.concat(stdoutChunks));
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
      reject(new Error(stderr.length > 0 ? stderr.split('\n').slice(-3).join(' ') : `ffmpeg exited with code ${code}`));
    });
  });
}

function getCachePath(imageId: number, quality: VideoStreamQuality, index: number): string {
  return path.join(appConfig.hlsCacheDir, String(imageId), quality, `segment-${index}.ts`);
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

export interface TranscodeSegmentInput {
  imageId: number;
  sourcePath: string;
  durationMs: number | null;
  width: number;
  height: number;
  quality: VideoStreamQuality;
  index: number;
}

export async function getSegment(input: TranscodeSegmentInput): Promise<Buffer> {
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

    let payload: Buffer;
    try {
      payload = await runFfmpeg(args);
    } catch (error) {
      if (hardware.mode === 'none') {
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
        })
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
  return tracked;
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
