import type { PlayerSrc } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';

import { getOriginalMediaUrl } from './original-media';
import { requestJson } from '../api/http';

export type VideoPlaybackQuality = 'auto' | 'original' | '1080p' | '720p' | '480p';
export type VideoPlaybackMode = 'direct' | 'transcode';

export const VIDEO_PLAYBACK_MODES: VideoPlaybackMode[] = ['direct', 'transcode'];

export function isVideoPlaybackMode(value: unknown): value is VideoPlaybackMode {
  return typeof value === 'string' && (VIDEO_PLAYBACK_MODES as string[]).includes(value);
}

export const VIDEO_PLAYBACK_QUALITIES: VideoPlaybackQuality[] = ['auto', 'original', '1080p', '720p', '480p'];

export const HLS_MIME_TYPE = 'application/x-mpegurl';

/** Cold start and seek warm-up cover this many 2-second segments (8s). */
export const HLS_WARM_SEGMENTS = 4;

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
  fileSize?: number;
  durationMs?: number | null;
}

export interface ResolveVideoSourceOptions {
  hostname?: string;
  /** Force the HLS master even on a LAN host, used when original Range is too slow. */
  preferStream?: boolean;
  /**
   * Library delivery mode. `direct` always Range-plays the original on auto.
   * `transcode` always starts on the HLS master on auto. Fixed 480p/720p/1080p
   * stay HLS either way; `original` stays the untouched file.
   */
  playbackMode?: VideoPlaybackMode;
}

const DIRECT_PLAY_CONTAINER_RE = /\.(mp4|m4v|mov)$/i;
const PRIVATE_IPV4_RE = /^(10\.|192\.168\.|169\.254\.)/;
const PRIVATE_IPV4_172_RE = /^172\.(1[6-9]|2\d|3[0-1])\./;

let cachedHevcSupport: boolean | undefined;

/** Test-only: drop the memo so a stubbed `canPlayType` is re-read. */
export function resetDirectPlayCapabilityCache(): void {
  cachedHevcSupport = undefined;
}

export function isDirectPlayContainer(filename?: string | null): boolean {
  return typeof filename === 'string' && DIRECT_PLAY_CONTAINER_RE.test(filename);
}

function stripHostnameBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

/**
 * Loopback, RFC1918, link-local, and .local names. The NAS is usually opened at
 * 192.168.x.x. Public hostnames and Tailscale/CGNAT (100.64/10) are WAN.
 */
export function isLanPlaybackHost(hostname: string): boolean {
  const host = stripHostnameBrackets(hostname.trim().toLowerCase());
  if (!host) {
    return false;
  }

  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local')) {
    return true;
  }

  if (PRIVATE_IPV4_RE.test(host) || PRIVATE_IPV4_172_RE.test(host)) {
    return true;
  }

  return host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd');
}

function currentPlaybackHostname(): string {
  if (typeof window === 'undefined') {
    return 'localhost';
  }

  return window.location.hostname;
}

/** Outside the LAN, auto should start on HLS rather than the original file. */
export function prefersConstrainedVideoPlayback(hostname = currentPlaybackHostname()): boolean {
  return !isLanPlaybackHost(hostname);
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

const DIRECT_PLAY_HEAD_BYTES = 64 * 1024;
const DIRECT_PLAY_TAIL_BYTES = 256 * 1024;
/** A 3 Mbps WAN cannot carry typical phone HEVC originals in real time. */
export const DIRECT_PLAY_WAN_MAX_MBPS = 3;

export function estimateOriginalBitrateMbps(
  fileSize?: number | null,
  durationMs?: number | null
): number | null {
  if (!Number.isFinite(fileSize) || !Number.isFinite(durationMs) || !fileSize || !durationMs || durationMs <= 0) {
    return null;
  }

  return (fileSize * 8) / (durationMs / 1000) / 1_000_000;
}

export function isOriginalTooHeavyForConstrainedLink(
  media: Pick<VideoPlaybackMedia, 'fileSize' | 'durationMs'>,
  hostname = currentPlaybackHostname()
): boolean {
  if (!prefersConstrainedVideoPlayback(hostname)) {
    return false;
  }

  const mbps = estimateOriginalBitrateMbps(media.fileSize, media.durationMs);
  return mbps !== null && mbps > DIRECT_PLAY_WAN_MAX_MBPS;
}

function warmDirectOriginal(url: string, fileSize?: number): void {
  const headers = { Range: `bytes=0-${DIRECT_PLAY_HEAD_BYTES - 1}` };
  void fetch(url, { headers, cache: 'force-cache' }).catch(() => {});

  if (!Number.isFinite(fileSize) || !fileSize || fileSize <= DIRECT_PLAY_HEAD_BYTES + DIRECT_PLAY_TAIL_BYTES) {
    return;
  }

  const tailStart = Math.max(DIRECT_PLAY_HEAD_BYTES, fileSize - DIRECT_PLAY_TAIL_BYTES);
  void fetch(url, {
    headers: { Range: `bytes=${tailStart}-${fileSize - 1}` },
    cache: 'force-cache'
  }).catch(() => {});
}

export interface ResolvedVideoSource {
  src: string;
  type: typeof HLS_MIME_TYPE | 'video/mp4';
  isStream: boolean;
}

/** The small subset of a media player needed to commit a final seek. */
export interface SeekableMediaPlayer {
  currentTime: number;
  paused?: boolean;
  pause?: () => void;
  play?: () => void | Promise<unknown>;
  querySelector?: (selectors: string) => Element | null;
  shadowRoot?: ShadowRoot | null;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

function getSeekableNativeVideo(player: SeekableMediaPlayer): HTMLVideoElement | null {
  const direct = player.querySelector?.('video');
  if (direct instanceof HTMLVideoElement) {
    return direct;
  }

  const nested = player.shadowRoot?.querySelector('video');
  return nested instanceof HTMLVideoElement ? nested : null;
}

function assignSeekTarget(player: SeekableMediaPlayer, seconds: number): void {
  const target = Math.max(0, seconds);
  const video = getSeekableNativeVideo(player);
  if (video && typeof video.fastSeek === 'function') {
    try {
      video.fastSeek(target);
      return;
    } catch {
      // MSE-backed playback (the HLS path) can refuse `fastSeek`; fall through to the
      // exact assignment so a transcode seek is never silently dropped.
    }
  }

  player.currentTime = target;
}

const seekWaitGenerations = new WeakMap<object, number>();

function nextSeekWaitGeneration(player: SeekableMediaPlayer): number {
  const next = (seekWaitGenerations.get(player) ?? 0) + 1;
  seekWaitGenerations.set(player, next);
  return next;
}

function currentSeekWaitGeneration(player: SeekableMediaPlayer): number {
  return seekWaitGenerations.get(player) ?? 0;
}

/**
 * Runs `callback` on a later task so it never shares a tick with the pause+assign
 * pair below. A Direct Play seek lands synchronously, and resuming inside that same
 * task races Vidstack's still-pending pause request — the clip then stays parked on
 * a frame, which is exactly the "seek leaves it paused" report.
 */
function scheduleAfterCurrentTask(callback: () => void): void {
  // A microtask still counts as the pointerup user gesture on iOS. rAF / setTimeout
  // do not, so Direct Play play() would be rejected and the clip would stay paused.
  queueMicrotask(callback);
}

/**
 * Sets a final scrub target and waits briefly for the provider to acknowledge it.
 *
 * During a full-surface scrub we preview several seeks in rapid succession. Starting
 * playback immediately after the last assignment can resume the old decoded segment
 * on a direct file or HLS fragment, so the caller awaits this before calling `play()`.
 *
 * `resumePlayback` states the intent explicitly for surfaces that already froze the
 * player themselves (a scrub pauses Direct Play so mid-drag Range requests never
 * start). Without it the state at entry decides, which would always read "paused".
 */
export function seekMediaPlayerAndWait(
  player: SeekableMediaPlayer,
  targetSeconds: number,
  options: { toleranceSeconds?: number; timeoutMs?: number; resumePlayback?: boolean } = {}
): Promise<void> {
  const toleranceSeconds = options.toleranceSeconds ?? 1.5;
  const timeoutMs = options.timeoutMs ?? 2_000;
  const wasPlaying = options.resumePlayback ?? player.paused === false;
  const seekGeneration = nextSeekWaitGeneration(player);

  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const video = getSeekableNativeVideo(player);

    const isOnTarget = () => {
      const playerTime = player.currentTime;
      const videoTime = video?.currentTime;
      return Math.abs(playerTime - targetSeconds) <= toleranceSeconds
        || (typeof videoTime === 'number' && Math.abs(videoTime - targetSeconds) <= toleranceSeconds);
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout !== null) clearTimeout(timeout);
      player.removeEventListener('seeked', onSettled);
      player.removeEventListener('time-update', onSettled);
      video?.removeEventListener('seeked', onSettled);
      video?.removeEventListener('timeupdate', onSettled);
      // The same event that confirms the seek may arrive synchronously from a custom
      // media element. Queue completion so the caller can publish its pending target
      // before the promise settles, avoiding a stale "seek in progress" marker.
      if (wasPlaying && seekGeneration === currentSeekWaitGeneration(player)) {
        scheduleAfterCurrentTask(() => {
          // A newer seek owns the surface by now, so its own commit resumes playback.
          if (seekGeneration === currentSeekWaitGeneration(player)) {
            void player.play?.();
          }
        });
      }
      queueMicrotask(resolve);
    };

    const onSettled = () => {
      if (isOnTarget()) {
        finish();
      }
    };

    player.addEventListener('seeked', onSettled);
    player.addEventListener('time-update', onSettled);
    video?.addEventListener('seeked', onSettled);
    video?.addEventListener('timeupdate', onSettled);
    timeout = setTimeout(finish, timeoutMs);

    try {
      // Pause first so the browser aborts the previous Range download instead of
      // letting a 20-50 Mbps original keep filling behind the new seek.
      player.pause?.();
      assignSeekTarget(player, targetSeconds);
      scheduleAfterCurrentTask(onSettled);
    } catch {
      finish();
    }
  });
}

function toDirectSource(url: string): ResolvedVideoSource {
  return { src: url, type: 'video/mp4', isStream: false };
}

function toHlsMasterSource(streamUrl: string): ResolvedVideoSource {
  return { src: streamUrl, type: HLS_MIME_TYPE, isStream: true };
}

function toHlsRenditionSource(
  streamUrl: string,
  quality: Exclude<VideoPlaybackQuality, 'auto' | 'original'>
): ResolvedVideoSource {
  return {
    src: streamUrl.replace('/master.m3u8', `/${quality}/index.m3u8`),
    type: HLS_MIME_TYPE,
    isStream: true
  };
}

/**
 * Picks what the player should actually load.
 *
 * On `auto` inside the LAN, a post the scanner marked `original` plays straight from
 * the file: the device decoder handles it, `/api/originals/:id` answers Range requests
 * with 206, and nothing on the NAS has to run ffmpeg. That is what makes LAN start-up
 * and seeking immediate.
 *
 * Preview-strategy MP4/MOV is also direct-played on the LAN when the device reports
 * HEVC support. Those files were only marked `preview` because the scanner trusts
 * h264; on iPhone they decode natively.
 *
 * Delivery mode decides what `auto` means. Direct Play always Range-plays the original
 * file. Transcode always loads the HLS master so the first frame is 480p and hls.js can
 * climb 720p then 1080p on the same source. A slow original Range can still request the
 * master via `preferStream` without changing the saved quality.
 *
 * A fixed rendition is always HLS so the quality picker stays a real escape hatch.
 */
export function resolveVideoSource(
  media: VideoPlaybackMedia,
  quality: VideoPlaybackQuality,
  options: ResolveVideoSourceOptions = {}
): ResolvedVideoSource {
  const hostname = options.hostname ?? currentPlaybackHostname();
  const preferStream = options.preferStream === true;
  const playbackMode = options.playbackMode ?? 'transcode';
  const constrained = preferStream
    || playbackMode === 'transcode'
    || (playbackMode !== 'direct' && prefersConstrainedVideoPlayback(hostname))
    || isOriginalTooHeavyForConstrainedLink(media, hostname);
  const originalUrl = media.originalUrl ?? getOriginalMediaUrl(media.id);

  if (quality === 'original') {
    return toDirectSource(originalUrl);
  }

  if (quality === 'auto') {
    if (
      playbackMode === 'direct'
      && !preferStream
      && shouldDirectPlayOnAuto(media)
      && !isOriginalTooHeavyForConstrainedLink(media, hostname)
    ) {
      return toDirectSource(originalUrl);
    }

    if (!constrained && shouldDirectPlayOnAuto(media)) {
      return toDirectSource(originalUrl);
    }

    if (media.streamUrl) {
      return toHlsMasterSource(media.streamUrl);
    }

    return toDirectSource(originalUrl);
  }

  if (media.streamUrl) {
    return toHlsRenditionSource(media.streamUrl, quality);
  }

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
  options: {
    fromSeconds?: number;
    segments?: number;
    source?: ResolvedVideoSource | null;
    hostname?: string;
    preferStream?: boolean;
    playbackMode?: VideoPlaybackMode;
  } = {}
): void {
  const source = options.source ?? resolveVideoSource(media, quality, {
    hostname: options.hostname,
    preferStream: options.preferStream,
    playbackMode: options.playbackMode
  });

  if (!source.isStream) {
    // Head/tail priming is for cold start. Repeating it on a seek fights the
    // actual mid-file Range request for bandwidth.
    if ((options.fromSeconds ?? 0) <= 0) {
      warmDirectOriginal(source.src, media.fileSize);
    }
    return;
  }

  const warmUrl = source.src.endsWith('/master.m3u8')
    ? source.src.replace('/master.m3u8', '/480p/warm')
    : source.src.replace('/index.m3u8', '/warm');
  const parameters = new URLSearchParams({
    from: String(Math.max(0, options.fromSeconds ?? 0)),
    segments: String(Math.max(1, Math.min(HLS_WARM_SEGMENTS, options.segments ?? HLS_WARM_SEGMENTS)))
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
    const constrained = prefersConstrainedVideoPlayback();

    provider.library = loadBundledHls;
    provider.config = {
      ...provider.config,
      // -1 is the hls.js default and means "start at the beginning of the playlist".
      startPosition: Number.isFinite(startPosition) && startPosition > 0 ? startPosition : -1,
      // Segments are produced on demand, so a generous timeout avoids aborting a
      // request the NAS is still transcoding.
      fragLoadingTimeOut: 60_000,
      manifestLoadingTimeOut: 30_000,
      // LAN: buffer ahead of ffmpeg start-up. WAN: keep less 720p in flight so a
      // 3 Mbps pipe can refill after a seek instead of draining a huge buffer.
      maxBufferLength: constrained ? 20 : 30,
      maxMaxBufferLength: constrained ? 40 : 60,
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
      // Assume 480p until real samples arrive, otherwise ABR may jump to 1080p
      // before the first fragment has even finished.
      abrEwmaDefaultEstimate: constrained ? 800_000 : 5_000_000,
      // The bandwidth probe loads an extra fragment before playback, and every fragment
      // here costs the NAS an ffmpeg run. Skip it; startLevel 0 already picks 480p.
      testBandwidth: false,
      lowLatencyMode: false
    };
  };

  player.addEventListener('provider-change', handleProviderChange);
  return () => player.removeEventListener('provider-change', handleProviderChange);
}

/**
 * After a seek, drop HLS back to the 480p rung so the NAS encodes the cheap
 * window first. Higher rungs climb again once that buffer is moving.
 */
export function preferEntryHlsLevel(player: MediaPlayerElement | null): void {
  if (!player) {
    return;
  }

  const provider = (player as unknown as { provider?: { instance?: { nextLoadLevel?: number; loadLevel?: number } } }).provider;
  const hls = provider?.instance;
  if (!hls || typeof hls.nextLoadLevel !== 'number') {
    return;
  }

  hls.nextLoadLevel = 0;
  try {
    if (typeof hls.loadLevel === 'number') {
      hls.loadLevel = 0;
    }
  } catch {
    // Some hls.js builds only honour nextLoadLevel.
  }
}
