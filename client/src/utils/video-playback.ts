import type { PlayerSrc } from 'vidstack';
import type { MediaPlayerElement } from 'vidstack/elements';

import { getOriginalMediaUrl } from './original-media';

export type VideoPlaybackQuality = 'auto' | 'original' | '1080p' | '720p';

export const VIDEO_PLAYBACK_QUALITIES: VideoPlaybackQuality[] = ['auto', 'original', '1080p', '720p'];

export const HLS_MIME_TYPE = 'application/x-mpegurl';

export function isVideoPlaybackQuality(value: unknown): value is VideoPlaybackQuality {
  return typeof value === 'string' && (VIDEO_PLAYBACK_QUALITIES as string[]).includes(value);
}

export interface VideoPlaybackMedia {
  id: number;
  playbackStrategy?: 'preview' | 'original' | null;
  streamUrl?: string | null;
  originalUrl?: string;
  previewUrl?: string;
}

export interface ResolvedVideoSource {
  src: string;
  type: typeof HLS_MIME_TYPE | 'video/mp4';
  isStream: boolean;
}

function getStreamUrl(media: VideoPlaybackMedia): string | null {
  return media.streamUrl ?? null;
}

function getFixedQualityStreamUrl(media: VideoPlaybackMedia, quality: '1080p' | '720p'): string | null {
  const master = getStreamUrl(media);
  if (!master) {
    return null;
  }

  return master.replace(/\/master\.m3u8$/, `/${quality}/index.m3u8`);
}

function toDirectSource(url: string): ResolvedVideoSource {
  return { src: url, type: 'video/mp4', isStream: false };
}

function toStreamSource(url: string): ResolvedVideoSource {
  return { src: url, type: HLS_MIME_TYPE, isStream: true };
}

/**
 * Picks what the player should actually load.
 *
 * `auto` prefers the untouched file whenever the server flagged it as directly
 * decodable, because that costs the NAS nothing. A fixed quality always goes
 * through HLS so the requested resolution is honoured, falling back to the
 * original when the server offers no stream for that item.
 */
export function resolveVideoSource(
  media: VideoPlaybackMedia,
  quality: VideoPlaybackQuality
): ResolvedVideoSource {
  const originalUrl = media.originalUrl ?? getOriginalMediaUrl(media.id);

  if (quality === 'original') {
    return toDirectSource(originalUrl);
  }

  if (quality === '1080p' || quality === '720p') {
    const fixed = getFixedQualityStreamUrl(media, quality);
    return fixed ? toStreamSource(fixed) : toDirectSource(originalUrl);
  }

  if (media.playbackStrategy === 'original') {
    return toDirectSource(originalUrl);
  }

  const master = getStreamUrl(media);
  return master ? toStreamSource(master) : toDirectSource(originalUrl);
}

/**
 * Fallback order when the chosen source fails to play. Direct playback can fail
 * on codecs the browser does not support, and streaming can fail if ffmpeg
 * cannot handle the file, so each mode falls back to the other.
 */
export function resolveVideoFallbackSource(
  media: VideoPlaybackMedia,
  failed: ResolvedVideoSource
): ResolvedVideoSource | null {
  if (!failed.isStream) {
    const master = getStreamUrl(media);
    return master && master !== failed.src ? toStreamSource(master) : null;
  }

  const originalUrl = media.originalUrl ?? getOriginalMediaUrl(media.id);
  return originalUrl !== failed.src ? toDirectSource(originalUrl) : null;
}

export function toPlayerSrc(source: ResolvedVideoSource): PlayerSrc {
  return {
    src: source.src,
    type: source.type
  };
}

const warmedStreams = new Set<string>();

/**
 * Asks the NAS to transcode the first segments of a clip before the player needs
 * them. Only streamed sources benefit: a directly playable file is already served
 * straight from disk. Failures are ignored because this is pure optimisation.
 */
/** Mirrors HLS_SEGMENT_SECONDS on the server; only used to dedupe warm calls. */
const WARM_SEGMENT_SECONDS = 2;

export function warmVideoStream(
  media: VideoPlaybackMedia,
  quality: VideoPlaybackQuality,
  options: { fromSeconds?: number; segments?: number; source?: ResolvedVideoSource | null } = {}
): void {
  const source = options.source ?? resolveVideoSource(media, quality);
  if (!source.isStream) {
    return;
  }

  // The prefix is captured rather than assumed: a share link streams from
  // /api/share/post-links/<token>/videos/... and must warm through that same path.
  const match = /^(.*)\/(\d+)\/hls\/(?:([^/]+)\/index\.m3u8|master\.m3u8)$/.exec(source.src);
  if (!match) {
    return;
  }

  const basePath = match[1];
  const streamId = match[2];
  const streamQuality = match[3] ?? '720p';
  const fromSeconds = Math.max(0, options.fromSeconds ?? 0);
  // Segments are two seconds each, so three of them is the same amount of video the
  // old four-second default covered.
  const segments = options.segments ?? 3;
  // Keyed by segment index so resuming at 0:10 still warms segment 2 even though
  // the head of the same clip was warmed earlier.
  const segmentIndex = Math.floor(fromSeconds / WARM_SEGMENT_SECONDS);
  const key = `${basePath}:${streamId}:${streamQuality}:${segmentIndex}`;
  if (warmedStreams.has(key)) {
    return;
  }

  warmedStreams.add(key);
  const query = `segments=${segments}&from=${fromSeconds.toFixed(3)}`;
  void fetch(`${basePath}/${streamId}/hls/${streamQuality}/warm?${query}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-foldergram-intent': '1' }
  }).catch(() => {
    warmedStreams.delete(key);
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
      startLevel: -1,
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
