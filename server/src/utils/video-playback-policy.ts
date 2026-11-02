import type { MediaType, PlaybackStrategy } from '../types/models.js';

export const DIRECT_VIDEO_PLAYBACK_MAX_BYTES = 24 * 1024 * 1024;
export const DIRECT_VIDEO_PLAYBACK_MAX_DISPLAY_WIDTH = 1500;
export const DIRECT_VIDEO_PLAYBACK_EXTENSION = '.mp4';

export type VideoPlaybackSource = 'original' | 'preview';
export type VideoDeliveryContext = 'normal' | 'share';

export interface VideoPlaybackCandidate {
  mediaType: MediaType;
  extension: string;
  fileSize: number | null | undefined;
  width: number | null | undefined;
  height?: number | null | undefined;
  playbackStrategy: PlaybackStrategy | null | undefined;
}

function hasPositiveFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function isDirectPlayableVideoEligible(candidate: VideoPlaybackCandidate): boolean {
  if (candidate.mediaType !== 'video') {
    return false;
  }

  if (candidate.extension.toLowerCase() !== DIRECT_VIDEO_PLAYBACK_EXTENSION) {
    return false;
  }

  if (candidate.playbackStrategy !== 'original') {
    return false;
  }

  if (!hasPositiveFiniteNumber(candidate.fileSize) || candidate.fileSize > DIRECT_VIDEO_PLAYBACK_MAX_BYTES) {
    return false;
  }

  if (!hasPositiveFiniteNumber(candidate.width) || candidate.width > DIRECT_VIDEO_PLAYBACK_MAX_DISPLAY_WIDTH) {
    return false;
  }

  return true;
}

export function resolveVideoPlaybackSource(
  candidate: VideoPlaybackCandidate,
  context: VideoDeliveryContext = 'normal'
): VideoPlaybackSource {
  if (context === 'share') {
    return 'preview';
  }

  return isDirectPlayableVideoEligible(candidate) ? 'original' : 'preview';
}

export function shouldGenerateVideoPreview(
  candidate: VideoPlaybackCandidate,
  context: VideoDeliveryContext = 'normal'
): boolean {
  return candidate.mediaType !== 'video' || resolveVideoPlaybackSource(candidate, context) === 'preview';
}
