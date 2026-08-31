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
  /** A generated faststart MP4 that supports efficient HTTP Range seeking. */
  previewFileUrl?: string | null;
}

export interface ResolvedVideoSource {
  src: string;
  type: typeof HLS_MIME_TYPE | 'video/mp4';
  isStream: boolean;
}

function toDirectSource(url: string): ResolvedVideoSource {
  return { src: url, type: 'video/mp4', isStream: false };
}

/**
 * Picks what the player should actually load.
 *
 * The browser always receives the original file. If its codec is supported, the
 * browser can use the device decoder. We intentionally never select HLS here:
 * starting an HLS stream would make the NAS transcode while the user is watching.
 */
export function resolveVideoSource(
  media: VideoPlaybackMedia,
  _quality: VideoPlaybackQuality
): ResolvedVideoSource {
  const originalUrl = media.originalUrl ?? getOriginalMediaUrl(media.id);
  return toDirectSource(originalUrl);
}

/**
 * A direct-play failure is surfaced to the user. Falling back to HLS here would
 * silently restart the NAS ffmpeg path that direct-only playback disables.
 */
export function resolveVideoFallbackSource(
  _media: VideoPlaybackMedia,
  _failed: ResolvedVideoSource
): ResolvedVideoSource | null {
  return null;
}

export function toPlayerSrc(source: ResolvedVideoSource): PlayerSrc {
  return {
    src: source.src,
    type: source.type
  };
}

export function warmVideoStream(
  _media: VideoPlaybackMedia,
  _quality: VideoPlaybackQuality,
  _options: { fromSeconds?: number; segments?: number; source?: ResolvedVideoSource | null } = {}
): void {
  // All current playback surfaces retain this call site, but direct original-file
  // playback has no NAS warm-up endpoint.
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
