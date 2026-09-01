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
  playbackStrategy?: 'preview' | 'original' | null;
  streamUrl?: string | null;
  originalUrl?: string;
  previewUrl?: string;
  /** Legacy pre-rendered MP4. It is not used for managed video playback. */
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
 * Managed playback always uses HLS unless the user explicitly asks for original.
 * Historical preview MP4s can be corrupt and their bitrate is not WAN-safe; HLS gives
 * us a 480p entry rendition that works on 2-3 Mbps connections and cached seeks.
 */
export function resolveVideoSource(
  media: VideoPlaybackMedia,
  quality: VideoPlaybackQuality
): ResolvedVideoSource {
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
