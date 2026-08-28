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
export function useBundledHlsLibrary(player: MediaPlayerElement | null): () => void {
  if (!player) {
    return () => {};
  }

  const handleProviderChange = (event: Event) => {
    const provider = (event as CustomEvent<any>).detail;
    if (!provider || provider.type !== 'hls') {
      return;
    }

    provider.library = loadBundledHls;
    provider.config = {
      ...provider.config,
      // Segments are produced on demand, so a generous timeout avoids aborting a
      // request the NAS is still transcoding.
      fragLoadingTimeOut: 60_000,
      manifestLoadingTimeOut: 30_000,
      maxBufferLength: 20,
      maxMaxBufferLength: 40,
      backBufferLength: 30,
      startLevel: -1,
      lowLatencyMode: false
    };
  };

  player.addEventListener('provider-change', handleProviderChange);
  return () => player.removeEventListener('provider-change', handleProviderChange);
}
