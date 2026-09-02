import type { PlayerSrc } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';

import { getOriginalMediaUrl } from './original-media';
import { requestJson } from '../api/http';

export type VideoPlaybackQuality = 'auto' | 'original' | '1080p' | '720p' | '480p';

export const VIDEO_PLAYBACK_QUALITIES: VideoPlaybackQuality[] = ['auto', 'original', '1080p', '720p', '480p'];

export const HLS_MIME_TYPE = 'application/x-mpegurl';

export function isVideoPlaybackQuality(value: unknown): value is VideoPlaybackQuality {
  return typeof value === 'string' && (VIDEO_PLAYBACK_QUALITIES as string[]).includes(value);
}

export interface VideoPlaybackMedia {
  id: number;
  filename?: string;
  playbackStrategy?: 'preview' | 'original' | null;
  streamUrl?: string | null;
  originalUrl?: string;
  previewUrl?: string;
  /** Legacy pre-rendered MP4. It is not used for managed video playback. */
  previewFileUrl?: string | null;
}

const DIRECT_PLAY_CONTAINER_RE = /\.(mp4|m4v|mov)$/i;

let cachedHevcSupport: boolean | undefined;

/** Test-only: drop the memo so a stubbed `canPlayType` is re-read. */
export function resetDirectPlayCapabilityCache(): void {
  cachedHevcSupport = undefined;
}

export function isDirectPlayContainer(filename?: string | null): boolean {
  return typeof filename === 'string' && DIRECT_PLAY_CONTAINER_RE.test(filename);
}

/**
 * iOS Safari and recent Chromium report HEVC as playable. The scanner still marks
 * those files `preview` because it only trusts h264, which is what sent them down
 * the live-transcode path and made the first card sit at 0:00.
 */
export function canDirectPlayHevc(): boolean {
  if (cachedHevcSupport !== undefined) {
    return cachedHevcSupport;
  }

  cachedHevcSupport = probeHevcSupport();
  return cachedHevcSupport;
}

function probeHevcSupport(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }

  try {
    const video = document.createElement('video');
    return ['video/mp4; codecs="hvc1"', 'video/mp4; codecs="hev1"'].some((type) => {
      const result = video.canPlayType(type);
      return result === 'probably' || result === 'maybe';
    });
  } catch {
    return false;
  }
}

function shouldDirectPlayOnAuto(media: VideoPlaybackMedia): boolean {
  if (media.playbackStrategy === 'original') {
    return true;
  }

  // Preview-strategy MP4/MOV is almost always HEVC in this library. When the
  // device can decode it, skip ffmpeg; the existing error fallback still has HLS.
  return isDirectPlayContainer(media.filename) && canDirectPlayHevc();
}

export interface ResolvedVideoSource {
  src: string;
  type: typeof HLS_MIME_TYPE | 'video/mp4';
  isStream: boolean;
}

/** The small subset of a media player needed to commit a final seek. */
export interface SeekableMediaPlayer {
  currentTime: number;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

/**
 * Sets a final scrub target and waits briefly for the provider to acknowledge it.
 *
 * During a full-surface scrub we preview several seeks in rapid succession. Starting
 * playback immediately after the last assignment can resume the old decoded segment
 * on a direct file or HLS fragment, so the caller awaits this before calling `play()`.
 */
export function seekMediaPlayerAndWait(
  player: SeekableMediaPlayer,
  targetSeconds: number,
  options: { toleranceSeconds?: number; timeoutMs?: number } = {}
): Promise<void> {
  const toleranceSeconds = options.toleranceSeconds ?? 1.5;
  const timeoutMs = options.timeoutMs ?? 750;

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      player.removeEventListener('seeked', onSettled);
      player.removeEventListener('time-update', onSettled);
      resolve();
    };

    const onSettled = () => {
      if (Math.abs(player.currentTime - targetSeconds) <= toleranceSeconds) {
        finish();
      }
    };

    player.addEventListener('seeked', onSettled);
    player.addEventListener('time-update', onSettled);
    timeout = setTimeout(finish, timeoutMs);

    try {
      player.currentTime = targetSeconds;
    } catch {
      finish();
    }
  });
}

function toDirectSource(url: string): ResolvedVideoSource {
  return { src: url, type: 'video/mp4', isStream: false };
}

/**
 * Picks what the player should actually load.
 *
 * On `auto`, a post the scanner marked `original` plays straight from the file: the
 * device decoder handles it, `/api/originals/:id` answers Range requests with 206, and
 * nothing on the NAS has to run ffmpeg to produce a frame. That is what makes start-up
 * and seeking immediate instead of waiting on a transcode.
 *
 * Preview-strategy MP4/MOV is also direct-played when the device reports HEVC
 * support. Those files were only marked `preview` because the scanner trusts
 * h264; on iPhone they decode natively, and live HLS is what made them sit at 0:00.
 *
 * Everything else still streams HLS, and a fixed rendition is always HLS so the quality
 * picker stays a real WAN escape hatch for high-bitrate originals.
 */
export function resolveVideoSource(
  media: VideoPlaybackMedia,
  quality: VideoPlaybackQuality
): ResolvedVideoSource {
  // LOCKED: auto = 直推原文件（含可硬解 HEVC 的 preview MP4/MOV）。不要改回默认 HLS。
  if (quality === 'auto' && shouldDirectPlayOnAuto(media)) {
    return toDirectSource(media.originalUrl ?? getOriginalMediaUrl(media.id));
  }

  if (quality !== 'original' && media.streamUrl) {
    return {
      src: quality === 'auto' ? media.streamUrl : media.streamUrl.replace('/master.m3u8', `/${quality}/index.m3u8`),
      type: HLS_MIME_TYPE,
      isStream: true
    };
  }

  const originalUrl = media.originalUrl ?? getOriginalMediaUrl(media.id);
  return toDirectSource(originalUrl);
}

/**
 * Original playback has an HLS fallback. This also recovers from old preview/original
 * files that the device cannot decode directly.
 */
export function resolveVideoFallbackSource(
  media: VideoPlaybackMedia,
  failed: ResolvedVideoSource
): ResolvedVideoSource | null {
  if (!failed.isStream && media.streamUrl) {
    return {
      src: media.streamUrl,
      type: HLS_MIME_TYPE,
      isStream: true
    };
  }

  return null;
}

export function toPlayerSrc(source: ResolvedVideoSource): PlayerSrc {
  return {
    src: source.src,
    type: source.type
  };
}

export function warmVideoStream(
  media: VideoPlaybackMedia,
  quality: VideoPlaybackQuality,
  options: { fromSeconds?: number; segments?: number; source?: ResolvedVideoSource | null } = {}
): void {
  const source = options.source ?? resolveVideoSource(media, quality);
  if (!source.isStream) return;

  const warmUrl = source.src.endsWith('/master.m3u8')
    ? source.src.replace('/master.m3u8', '/480p/warm')
    : source.src.replace('/index.m3u8', '/warm');
  const parameters = new URLSearchParams({
    from: String(Math.max(0, options.fromSeconds ?? 0)),
    segments: String(Math.max(1, Math.min(4, options.segments ?? 2)))
  });
  void requestJson(`${warmUrl}?${parameters.toString()}`, { method: 'POST' }).catch(() => {
    // Warm-up is optional; direct playback requests still surface real failures.
  });
}

let hlsModulePromise: Promise<{ default: unknown }> | null = null;

/**
 * Must stay an arrow function. Vidstack decides whether `library` is already a
 * constructor by checking for a `prototype`, and a plain function declaration has
 * one, so it would hand the loader itself to hls.js instead of awaiting it.
 */
const loadBundledHls = (): Promise<{ default: any }> => {
  if (!hlsModulePromise) {
    hlsModulePromise = import('hls.js');
  }

  return hlsModulePromise as Promise<{ default: any }>;
};

/**
 * Vidstack loads hls.js from a CDN by default, which never resolves on a LAN-only
 * NAS. Pointing the provider at the bundled copy keeps playback self-contained,
 * and the tuned config is what makes seeking land on demand instead of waiting
 * for the buffer to walk forward.
 */
export interface BundledHlsOptions {
  /**
   * Where playback should begin, in seconds. Returning `0` keeps hls.js on its own
   * default.
   *
   * A handover from an inline card resumes mid-file, and without this hls.js buffers
   * the head of the playlist first, fires `can-play`, and only then gets seeked by
   * `applyStartTime`. That flushes everything it just built and re-buffers at the real
   * position, which is exactly the stall the viewer sees after tapping a clip that was
   * already playing. Handing the position to hls.js up front makes the very first
   * fragment request land on the segment the viewer is actually watching.
   *
   * Read once per hls.js instance, so a later source swap on the same provider still
   * relies on `applyStartTime` as the fallback.
   */
  getStartPosition?: () => number;
}

export function useBundledHlsLibrary(
  player: MediaPlayerElement | null,
  options: BundledHlsOptions = {}
): () => void {
  if (!player) {
    return () => {};
  }

  const handleProviderChange = (event: Event) => {
    const provider = (event as CustomEvent<any>).detail;
    if (!provider || provider.type !== 'hls') {
      return;
    }

    const startPosition = options.getStartPosition?.() ?? 0;

    provider.library = loadBundledHls;
    provider.config = {
      ...provider.config,
      // -1 is the hls.js default and means "start at the beginning of the playlist".
      startPosition: Number.isFinite(startPosition) && startPosition > 0 ? startPosition : -1,
      // Segments are produced on demand, so a generous timeout avoids aborting a
      // request the NAS is still transcoding.
      fragLoadingTimeOut: 60_000,
      manifestLoadingTimeOut: 30_000,
      // Tuned for a LAN NAS that transcodes on demand: bandwidth is effectively free,
      // but producing a segment is not, so buffering further ahead is what absorbs the
      // ffmpeg start-up cost instead of turning it into a visible stall.
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 60,
      // Segments arrive as they finish transcoding, so gaps and short appends are
      // normal here; hls.js has to keep nudging over them rather than give up.
      maxBufferHole: 0.5,
      nudgeMaxRetry: 10,
      appendErrorMaxRetry: 5,
      startFragPrefetch: true,
      // Start at the smallest HLS rendition. This gives slow WAN clients a frame
      // quickly; hls.js can step up after it has measured sustainable throughput.
      startLevel: 0,
      // The bandwidth probe loads an extra fragment before playback, and every fragment
      // here costs the NAS an ffmpeg run. Bandwidth is not the constraint on a LAN, so
      // that probe is pure added latency on the very first frame.
      testBandwidth: false,
      lowLatencyMode: false
    };
  };

  player.addEventListener('provider-change', handleProviderChange);
  return () => player.removeEventListener('provider-change', handleProviderChange);
}
