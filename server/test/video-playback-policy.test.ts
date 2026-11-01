import { describe, expect, it } from 'vitest';

import {
  DIRECT_VIDEO_PLAYBACK_MAX_BYTES,
  DIRECT_VIDEO_PLAYBACK_MAX_DISPLAY_WIDTH,
  isDirectPlayableVideoEligible,
  resolveVideoPlaybackSource,
  shouldGenerateVideoPreview
} from '../src/utils/video-playback-policy.js';

function candidate(overrides: Partial<Parameters<typeof isDirectPlayableVideoEligible>[0]> = {}) {
  return {
    mediaType: 'video' as const,
    extension: '.mp4',
    fileSize: 1024,
    width: 1080,
    height: 1920,
    playbackStrategy: 'original' as const,
    ...overrides
  };
}

describe('direct video playback policy', () => {
  it('accepts compatible MP4 videos at the inclusive size and width boundaries', () => {
    expect(isDirectPlayableVideoEligible(candidate({
      fileSize: DIRECT_VIDEO_PLAYBACK_MAX_BYTES,
      width: DIRECT_VIDEO_PLAYBACK_MAX_DISPLAY_WIDTH
    }))).toBe(true);
    expect(resolveVideoPlaybackSource(candidate({
      fileSize: DIRECT_VIDEO_PLAYBACK_MAX_BYTES,
      width: DIRECT_VIDEO_PLAYBACK_MAX_DISPLAY_WIDTH
    }))).toBe('original');
  });

  it('rejects videos above either direct-playback budget', () => {
    expect(isDirectPlayableVideoEligible(candidate({
      fileSize: DIRECT_VIDEO_PLAYBACK_MAX_BYTES + 1
    }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({
      width: DIRECT_VIDEO_PLAYBACK_MAX_DISPLAY_WIDTH + 1
    }))).toBe(false);
  });

  it('conservatively uses previews for unknown or incomplete metadata', () => {
    expect(isDirectPlayableVideoEligible(candidate({ fileSize: null }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ fileSize: 0 }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ width: null }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ width: 0 }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ width: Number.NaN }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ playbackStrategy: null }))).toBe(false);
  });

  it('requires MP4 with compatibility metadata before selecting originals', () => {
    expect(isDirectPlayableVideoEligible(candidate({ extension: '.mov' }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ extension: '.webm' }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ playbackStrategy: 'preview' }))).toBe(false);
    expect(isDirectPlayableVideoEligible(candidate({ mediaType: 'image' }))).toBe(false);
  });

  it('never selects originals for shared delivery and reports whether a preview is required', () => {
    expect(resolveVideoPlaybackSource(candidate(), 'share')).toBe('preview');
    expect(shouldGenerateVideoPreview(candidate())).toBe(false);
    expect(shouldGenerateVideoPreview(candidate(), 'share')).toBe(true);
    expect(shouldGenerateVideoPreview(candidate({ fileSize: DIRECT_VIDEO_PLAYBACK_MAX_BYTES + 1 }))).toBe(true);
    expect(shouldGenerateVideoPreview(candidate({ mediaType: 'image', playbackStrategy: 'preview' }))).toBe(true);
  });
});
