import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import pLimit from 'p-limit';

import { appConfig } from '../config/env.js';
import type { VideoPlaybackQuality } from '../types/models.js';
import { log } from './log-service.js';

const execFileAsync = promisify(execFile);

// Segment length drives both start-up latency and seek granularity. Four seconds
// keeps the first segment fast to produce while staying inside the range every
// HLS client tolerates.
export const HLS_SEGMENT_SECONDS = 4;

const AUDIO_ARGS = ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'];
const SEGMENT_CONCURRENCY = Math.max(1, Math.min(3, appConfig.scanDerivativeConcurrency));
const segmentLimit = pLimit(SEGMENT_CONCURRENCY);
const inflightSegments = new Map<string, Promise<Buffer>>();

// Jasper Lake (N5105) exposes fixed-function decoders for these codecs only.
// Anything else (AV1 in particular) has to be decoded on the CPU even though the
// encode half can still run on the GPU.
const VAAPI_DECODABLE_CODECS = new Set(['h264', 'hevc', 'vp9', 'vp8', 'mpeg2video', 'vc1', 'mjpeg']);

export type VideoStreamQuality = Exclude<VideoPlaybackQuality, 'auto' | 'original'>;

export const STREAM_QUALITIES: VideoStreamQuality[] = ['1080p', '720p'];

interface QualityProfile {
  shortEdge: number;
  bandwidth: number;
}

const QUALITY_PROFILES: Record<VideoStreamQuality, QualityProfile> = {
  '1080p': { shortEdge: 1080, bandwidth: 4_500_000 },
  '720p': { shortEdge: 720, bandwidth: 2_200_000 }
};

interface HardwareState {
  mode: 'vaapi' | 'none';
  device: string | null;
}

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

export function buildMasterPlaylist(
  imageId: number,
  width: number,
  height: number,
  qualities: VideoStreamQuality[]
): string {
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];

  for (const quality of qualities) {
    const dimensions = resolveTargetDimensions(width, height, quality);
    lines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${QUALITY_PROFILES[quality].bandwidth},RESOLUTION=${dimensions.width}x${dimensions.height}`
    );
    lines.push(`/api/videos/${imageId}/hls/${quality}/index.m3u8`);
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
  return offered.length > 0 ? offered : ['720p'];
}

function buildFfmpegArgs(options: {
  sourcePath: string;
  sourceCodec: string | null;
  startSeconds: number;
  durationSeconds: number;
  target: { width: number; height: number };
  hardware: HardwareState;
}): string[] {
  const { sourcePath, sourceCodec, startSeconds, durationSeconds, target, hardware } = options;
  const canDecodeOnGpu =
    hardware.mode === 'vaapi' && sourceCodec !== null && VAAPI_DECODABLE_CODECS.has(sourceCodec);
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
    args.push('-vf', filter, '-c:v', 'h264_vaapi', '-qp', '23');
  } else {
    args.push(
      '-vf', `scale=${target.width}:${target.height}:flags=fast_bilinear`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'
    );
  }

  args.push(...AUDIO_ARGS);
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
  sourceCodec: string | null;
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
      sourceCodec: input.sourceCodec,
      startSeconds,
      durationSeconds,
      target,
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
          sourceCodec: input.sourceCodec,
          startSeconds,
          durationSeconds,
          target,
          hardware: { mode: 'none', device: null }
        })
      );
    }

    await writeCachedSegment(cachePath, payload);
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

export function isStreamQuality(value: string): value is VideoStreamQuality {
  return (STREAM_QUALITIES as string[]).includes(value);
}
