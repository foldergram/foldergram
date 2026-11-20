import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setImmediate, setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';

import type { LocalVideoMetadata } from '../types/models.js';
import { selectDecodableVideoAudio } from './derivative-service.js';

const execFileAsync = promisify(execFile);
export const HLS_WINDOW_SECONDS = 24;
export const HLS_OPENING_SECONDS = 3;
export const HLS_MANIFEST = 'stream.m3u8';
export const HLS_SEGMENT = /^segment-\d{3}\.ts$/;
const SEGMENT_SECONDS = HLS_OPENING_SECONDS;
const MAX_COPY_SEGMENT_SECONDS = 4;
const MAX_MANIFEST_BYTES = 16_384;
const inputFormats = 'mov,matroska,webm,m4v,h264,avi,mpegts';
let encoderCapabilities: Promise<{ decoders: Set<string>; h264: boolean; aac: boolean; hdr: boolean }> | undefined;

export async function supportsHlsEncoding(metadata: LocalVideoMetadata, codec: string): Promise<boolean> {
  if (!metadata.container?.split(',').some(format => inputFormats.split(',').includes(format))) return false;
  encoderCapabilities ??= Promise.all(['-decoders', '-encoders', '-filters'].map(flag =>
    execFileAsync('ffmpeg', ['-hide_banner', flag], { timeout: 6000, maxBuffer: 512 * 1024 })
  )).then(([decoders, encoders, filters]) => ({
    decoders: new Set(decoders.stdout.split('\n').flatMap(line => {
      const found = /^\s*V[.A-Z]{5}\s+(\S+)\s+(.*)$/.exec(line);
      return found ? [/\(codec (\S+)\)/.exec(found[2])?.[1] ?? found[1]] : [];
    })),
    h264: /\blibx264\b/.test(encoders.stdout),
    aac: /\baac\s/.test(encoders.stdout),
    hdr: /\bzscale\b/.test(filters.stdout) && /\btonemap\b/.test(filters.stdout)
  })).catch(error => {
    encoderCapabilities = undefined;
    throw error;
  });
  const support = await encoderCapabilities;
  const transfer = metadata.video?.colorTransfer;
  return support.h264 && (!metadata.audio.length || support.aac) && support.decoders.has(codec) &&
    ((transfer !== 'smpte2084' && transfer !== 'arib-std-b67') || support.hdr);
}
export type HlsProfile = 'standard' | 'low';
export const hlsWindowReservation = { standard: 13 * 1024 * 1024, low: 4 * 1024 * 1024 };

export class HlsDeliveryError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

interface EncodeOptions {
  sourcePath: string;
  outputDirectory: string;
  metadata: LocalVideoMetadata;
  offsetSeconds: number;
  durationSeconds: number;
  profile: HlsProfile;
  copyVideo: boolean;
  signal: AbortSignal;
  onFile: (name: string, size: number) => void;
}

function videoFilters(metadata: LocalVideoMetadata, profile: HlsProfile): string {
  const [longEdge, shortEdge] = profile === 'low' ? [640, 360] : [1280, 720];
  const transfer = metadata.video?.colorTransfer;
  const filters = transfer === 'smpte2084' || transfer === 'arib-std-b67'
    ? ['zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709',
        'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv']
    : [];
  filters.push(
    "scale=w='max(2,trunc(iw*sar*min(1,min(" + longEdge + "/max(iw*sar,ih)," +
      shortEdge + "/min(iw*sar,ih)))/2)*2)':h='max(2,trunc(ih*min(1,min(" +
      longEdge + "/max(iw*sar,ih)," + shortEdge + "/min(iw*sar,ih)))/2)*2)'",
    'setsar=1',
    'format=yuv420p'
  );
  return filters.join(',');
}

export async function validateHlsInput(sourcePath: string, metadata: LocalVideoMetadata): Promise<void> {
  const videoIndex = metadata.video?.index;
  if (videoIndex == null) throw new HlsDeliveryError(422, 'No playable video track was found.');
  const signal = AbortSignal.timeout(12_000);
  const audioIndex = await selectDecodableVideoAudio(metadata.audio);
  const seconds = (metadata.durationMs ?? 0) / 1000;
  const positions = seconds > 6 ? [0, seconds / 2, seconds - 2] : [0];
  const sampleSeconds = positions.length === 1 ? 6 : 2;

  for (const position of positions) {
    const { stdout } = await execFileAsync('ffmpeg', [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-xerror', '-filter_threads', '1',
      '-protocol_whitelist', 'file', '-format_whitelist', inputFormats,
      '-ss', String(position), '-threads', '2', '-err_detect', 'explode', '-i', sourcePath,
      '-t', String(sampleSeconds), '-map', '0:' + videoIndex, ...(audioIndex === null ? ['-an'] : ['-map', '0:' + audioIndex]),
      '-vf', videoFilters(metadata, 'low'), '-stats_period', '1', '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'
    ], { signal, killSignal: 'SIGKILL', maxBuffer: 32 * 1024 });
    if (!/^frame=\s*[1-9]\d*$/m.test(stdout)) {
      throw new HlsDeliveryError(422, 'The original did not decode a video frame.');
    }
  }
}

async function canCopyWindow(options: EncodeOptions, videoIndex: number, signal: AbortSignal): Promise<boolean> {
  if (!options.copyVideo) return false;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', inputFormats,
      '-select_streams', String(videoIndex), '-read_intervals', '%+' + options.durationSeconds,
      '-show_entries', 'packet=pts_time,flags', '-of', 'csv=p=0', options.sourcePath
    ], { signal, timeout: 5000, maxBuffer: 256 * 1024 });
    const packets = stdout.trim().split(/\r?\n/).map(line => line.split(','));
    const first = Number(packets[0]?.[0]);
    if (!packets[0]?.[1]?.includes('K') || !Number.isFinite(first) || Math.abs(first) > 0.25) return false;
    let boundary = first;
    let target = first + SEGMENT_SECONDS;
    for (const [pts, flags] of packets.slice(1)) {
      if (!flags?.includes('K')) continue;
      const time = Number(pts);
      if (!Number.isFinite(time) || time < boundary) return false;
      if (time < target) continue;
      if (time - boundary > MAX_COPY_SEGMENT_SECONDS) return false;
      boundary = time;
      target += SEGMENT_SECONDS;
    }
    return options.durationSeconds + first - boundary <= MAX_COPY_SEGMENT_SECONDS;
  } catch {
    return false;
  }
}

export async function encodeHlsWindow(options: EncodeOptions): Promise<void> {
  const videoIndex = options.metadata.video?.index;
  if (videoIndex == null) throw new HlsDeliveryError(422, 'No playable video track was found.');
  let audioIndex: number | null;
  try {
    audioIndex = await selectDecodableVideoAudio(options.metadata.audio);
  } catch {
    throw new HlsDeliveryError(422, 'No audio track has an available FFmpeg decoder.');
  }
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(90_000)]);
  signal.throwIfAborted();

  // FFmpeg sends each completed segment and each playlist revision to this
  // private receiver. Count bytes before writing, including the temporary
  // playlist that will replace the previous version.
  const token = '/' + randomUUID() + '/';
  const outputSizes = new Map<string, number>();
  let outputBytes = 0;
  let uploads = Promise.resolve();
  let acceptedUploads = 0;
  let uploadError: unknown;
  let publishEnd!: () => void;
  const finalManifest = new Promise<void>(resolve => { publishEnd = resolve; });
  const receiver = createServer({ maxHeaderSize: 8192, requestTimeout: 15_000 }, (request, response) => {
    const name = request.url?.startsWith(token) ? request.url.slice(token.length) : '';
    if (request.method !== 'PUT' || (name !== HLS_MANIFEST && !HLS_SEGMENT.test(name))) {
      response.writeHead(404).end();
      return;
    }
    if (++acceptedUploads > 32) {
      response.writeHead(429).end();
      return;
    }

    const finalPath = path.join(options.outputDirectory, name);
    const temporary = finalPath + '.' + acceptedUploads + '.part';
    let size = 0;
    const chunks: Buffer[] = [];
    const budget = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        if (outputBytes + chunk.length > hlsWindowReservation[options.profile] ||
            (name === HLS_MANIFEST && size + chunk.length > MAX_MANIFEST_BYTES)) {
          callback(new HlsDeliveryError(507, 'The conversion exceeded its cache reservation.'));
          return;
        }
        outputBytes += chunk.length;
        size += chunk.length;
        chunks.push(chunk);
        callback();
      }
    });

    // Drain into the window's byte reservation before touching disk. An FFmpeg PUT can
    // close as soon as its last chunk is sent, even if filesystem writes lag behind.
    const previous = uploads;
    const received = pipeline(request, budget, { signal }).then(() => undefined, (error: unknown) => error);
    uploads = (async () => {
      const [receiveError] = await Promise.all([received, previous]);
      try {
        if (receiveError) throw receiveError;
        if (uploadError || (name !== HLS_MANIFEST && outputSizes.has(name))) throw new Error('Unexpected duplicate output');
        if (size === 0) throw new Error('Empty HLS output');
        let isFinal = false;
        if (name === HLS_MANIFEST) {
          const body = Buffer.concat(chunks, size).toString('utf8');
          const segments = body.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
          if (!body.startsWith('#EXTM3U') || !segments.length ||
              segments.some(segment => !HLS_SEGMENT.test(segment) || !outputSizes.has(segment))) {
            throw new Error('Incomplete HLS playlist');
          }
          isFinal = body.includes('#EXT-X-ENDLIST');
        }
        await fs.writeFile(temporary, chunks, { flag: 'wx', mode: 0o600, signal });
        await fs.rename(temporary, finalPath);
        outputBytes -= outputSizes.get(name) ?? 0;
        outputSizes.set(name, size);
        options.onFile(name, size);
        if (!response.destroyed) response.writeHead(204).end();
        if (isFinal) publishEnd();
      } catch (error) {
        uploadError ??= error;
        await fs.rm(temporary, { force: true }).then(() => { outputBytes -= size; }, () => undefined);
        if (!response.destroyed) response.writeHead(500).end();
      }
    })();
  });
  receiver.maxConnections = 32;
  receiver.keepAliveTimeout = 90_000;

  let encoderError: unknown;
  try {
    await new Promise<void>((resolve, reject) => {
      receiver.once('error', reject);
      receiver.listen(0, '127.0.0.1', resolve);
    });
    const target = 'http://127.0.0.1:' + (receiver.address() as AddressInfo).port + token;
    const maxRate = options.profile === 'low' ? '800k' : '3200k';
    // Copy only when keyframes can bound segment duration throughout this window.
    const copyVideo = await canCopyWindow(options, videoIndex, signal);
    const encoding = copyVideo ? ['-c:v', 'copy'] : [
      '-vf', videoFilters(options.metadata, options.profile),
      '-c:v', 'libx264', '-threads:v', '2', '-preset', 'veryfast', '-crf', '24',
      '-maxrate', maxRate, '-bufsize', maxRate, '-force_key_frames', 'expr:gte(t,n_forced*' + SEGMENT_SECONDS + ')'
    ];
    const selectedAudio = options.metadata.audio.find(track => track.index === audioIndex);
    const audioEncoding = audioIndex === null ? [] : copyVideo && selectedAudio?.codec === 'aac' && (selectedAudio.channels ?? 0) <= 2
      ? ['-c:a', 'copy']
      : ['-c:a', 'aac', '-ac', '2', '-b:a', options.profile === 'low' ? '96k' : '128k'];
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-nostdin', '-loglevel', 'error', '-filter_threads', '1',
      '-protocol_whitelist', 'file', '-format_whitelist', inputFormats,
      '-ss', String(options.offsetSeconds), '-threads', '2', '-i', options.sourcePath,
      '-t', String(options.durationSeconds),
      '-map', '0:' + videoIndex, ...(audioIndex === null ? ['-an'] : ['-map', '0:' + audioIndex]),
      ...encoding, ...audioEncoding,
      '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'event',
      '-hls_flags', 'independent_segments', '-hls_segment_filename', target + 'segment-%03d.ts',
      '-http_persistent', '1', '-method', 'PUT', target + HLS_MANIFEST
    ], { signal, maxBuffer: 256 * 1024 });
  } catch (error) {
    encoderError = error;
  } finally {
    // The child can exit while the final PUT is still draining from the loopback socket.
    if (!encoderError && !uploadError) {
      await Promise.race([finalManifest, setTimeout(1500, undefined, { signal, ref: false })]).catch(() => undefined);
    }
    let processed: Promise<void>;
    do {
      processed = uploads;
      await processed;
      await setImmediate();
    } while (processed !== uploads);
    receiver.closeAllConnections();
    await new Promise<void>(resolve => receiver.close(() => resolve()));
  }
  if (uploadError instanceof HlsDeliveryError) throw uploadError;
  if (['ENOSPC', 'EDQUOT'].includes((uploadError as NodeJS.ErrnoException | undefined)?.code ?? '')) {
    throw new HlsDeliveryError(507, 'HLS storage is full. Free space or retry at a lower quality.');
  }
  if (uploadError || encoderError || !outputSizes.has(HLS_MANIFEST)) {
    throw new HlsDeliveryError(422, 'This video could not be converted for playback.');
  }
  const manifest = await fs.readFile(path.join(options.outputDirectory, HLS_MANIFEST), 'utf8');
  if (!manifest.includes('#EXT-X-ENDLIST')) throw new HlsDeliveryError(422, 'The converted video is incomplete.');
}
