import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/http', () => ({
  requestJson: vi.fn(() => Promise.resolve({ warming: 2 }))
}));

import {
  canDirectPlayHevc,
  resetDirectPlayCapabilityCache,
  resolveVideoFallbackSource,
  resolveVideoSource,
  seekMediaPlayerAndWait,
  useBundledHlsLibrary,
  warmVideoStream
} from './video-playback';

interface FakeProvider {
  type: string;
  library?: unknown;
  config: Record<string, unknown>;
}

/**
 * `useBundledHlsLibrary` only needs `addEventListener`/`removeEventListener`, so a
 * plain element stands in for the vidstack player here.
 */
function createHost() {
  const host = document.createElement('div');

  function attachProvider(type = 'hls'): FakeProvider {
    const provider: FakeProvider = { type, config: { maxBufferLength: 1 } };
    host.dispatchEvent(new CustomEvent('provider-change', { detail: provider }));
    return provider;
  }

  return { host, attachProvider };
}

describe('useBundledHlsLibrary', () => {
  it('hands a handover position to hls.js so the first fragment is the one being watched', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => 42.5 });

    const provider = attachProvider();

    expect(provider.config.startPosition).toBe(42.5);
    // The tuning that was already there must survive.
    expect(provider.config.maxBufferLength).toBe(30);
    expect(typeof provider.library).toBe('function');
  });

  it('leaves hls.js on its own default when there is no handover', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => 0 });

    expect(attachProvider().config.startPosition).toBe(-1);
  });

  it('ignores a position that is not a finite number', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => Number.NaN });

    expect(attachProvider().config.startPosition).toBe(-1);
  });

  it('reads the position per provider attach, so a resumed clip does not rewind later', () => {
    const { host, attachProvider } = createHost();
    let position = 12;
    useBundledHlsLibrary(host as never, { getStartPosition: () => position });

    expect(attachProvider().config.startPosition).toBe(12);

    // The owner clears the handover once it has been honoured.
    position = 0;
    expect(attachProvider().config.startPosition).toBe(-1);
  });

  it('leaves non-HLS providers untouched', () => {
    const { host, attachProvider } = createHost();
    useBundledHlsLibrary(host as never, { getStartPosition: () => 30 });

    const provider = attachProvider('video');

    expect(provider.config.startPosition).toBeUndefined();
    expect(provider.library).toBeUndefined();
  });

  it('stops configuring providers once disposed', () => {
    const { host, attachProvider } = createHost();
    const dispose = useBundledHlsLibrary(host as never, { getStartPosition: () => 8 });

    dispose();

    expect(attachProvider().config.startPosition).toBeUndefined();
  });
});

describe('seekMediaPlayerAndWait', () => {
  it('waits for the provider to acknowledge the final seek target', async () => {
    const player = document.createElement('div') as HTMLDivElement & { currentTime: number };
    player.currentTime = 300;

    const committing = seekMediaPlayerAndWait(player, 312, { timeoutMs: 1_000 });
    expect(player.currentTime).toBe(312);

    player.dispatchEvent(new Event('seeked'));
    await expect(committing).resolves.toBeUndefined();
  });
});

describe('resolveVideoSource', () => {
  beforeEach(() => {
    resetDirectPlayCapabilityCache();
    vi.restoreAllMocks();
  });

  const media = {
    id: 501,
    filename: 'clip.mp4',
    playbackStrategy: 'preview' as const,
    previewFileUrl: '/previews/ab/clip.mp4',
    streamUrl: '/api/videos/501/hls/master.m3u8',
    originalUrl: '/api/originals/501'
  };

  function stubHevcSupport(supported: boolean) {
    resetDirectPlayCapabilityCache();
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation((type: string) => {
      if (!supported) return '';
      return type.includes('hvc1') || type.includes('hev1') ? 'probably' : '';
    });
  }

  const directMedia = { ...media, playbackStrategy: 'original' as const };

  it('plays a direct-playable post straight from the original file on auto', () => {
    expect(resolveVideoSource(directMedia, 'auto')).toEqual({
      src: '/api/originals/501',
      type: 'video/mp4',
      isStream: false
    });
  });

  it('still honours a hand-picked rendition for a direct-playable post', () => {
    expect(resolveVideoSource(directMedia, '480p')).toEqual({
      src: '/api/videos/501/hls/480p/index.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('falls back to HLS when a direct original refuses to decode', () => {
    expect(resolveVideoFallbackSource(directMedia, resolveVideoSource(directMedia, 'auto'))).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('never warms a transcode for a direct-playable post', async () => {
    const { requestJson } = await import('../api/http');
    (requestJson as unknown as { mockClear: () => void }).mockClear();

    warmVideoStream(directMedia, 'auto', { fromSeconds: 30 });

    expect(requestJson).not.toHaveBeenCalled();
  });

  it('uses the adaptive HLS playlist by default instead of a legacy preview MP4', () => {
    stubHevcSupport(false);
    expect(resolveVideoSource(media, 'auto')).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('direct-plays a preview-strategy MP4 when the device can decode HEVC', () => {
    stubHevcSupport(true);
    expect(canDirectPlayHevc()).toBe(true);
    expect(resolveVideoSource(media, 'auto')).toEqual({
      src: '/api/originals/501',
      type: 'video/mp4',
      isStream: false
    });
  });

  it('keeps HLS for a preview-strategy MP4 when the device cannot decode HEVC', () => {
    stubHevcSupport(false);
    expect(resolveVideoSource(media, 'auto').isStream).toBe(true);
  });

  it('does not direct-play a preview-strategy webm even when HEVC is available', () => {
    stubHevcSupport(true);
    expect(resolveVideoSource({ ...media, filename: 'clip.webm' }, 'auto')).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('uses the selected fixed HLS rendition when requested', () => {
    expect(resolveVideoSource(media, '480p')).toEqual({
      src: '/api/videos/501/hls/480p/index.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('falls back to adaptive HLS when original playback fails', () => {
    expect(resolveVideoFallbackSource(media, resolveVideoSource(media, 'original'))).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('warms the 480p entry rendition before playback', async () => {
    const { requestJson } = await import('../api/http');

    warmVideoStream(media, 'auto', { fromSeconds: 12, segments: 4 });

    expect(requestJson).toHaveBeenCalledWith(
      '/api/videos/501/hls/480p/warm?from=12&segments=4',
      { method: 'POST' }
    );
  });

  it('falls back to the original when no preview or stream is advertised', () => {
    const originalOnly = { id: 7, originalUrl: '/api/originals/7' };
    expect(resolveVideoSource(originalOnly, 'auto')).toEqual({
      src: '/api/originals/7',
      type: 'video/mp4',
      isStream: false
    });
  });

  it('keeps the adaptive HLS path when a preview file has not been generated yet', () => {
    stubHevcSupport(false);
    expect(resolveVideoSource({
      id: 8,
      playbackStrategy: 'preview',
      streamUrl: '/api/videos/8/hls/master.m3u8',
      originalUrl: '/api/originals/8'
    }, 'auto')).toEqual({
      src: '/api/videos/8/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });
});
