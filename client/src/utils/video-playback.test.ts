import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api/http', () => ({
  requestJson: vi.fn(() => Promise.resolve({ warming: 2 }))
}));

import {
  canDirectPlayHevc,
  estimateOriginalBitrateMbps,
  isLanPlaybackHost,
  isOriginalTooHeavyForConstrainedLink,
  preferEntryHlsLevel,
  prefersConstrainedVideoPlayback,
  resetDirectPlayCapabilityCache,
  resolveVideoFallbackSource,
  resolveVideoSource,
  resumePlaybackAfterSeek,
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

describe('preferEntryHlsLevel', () => {
  it('drops the next HLS load back to the 480p rung', () => {
    const hls = { nextLoadLevel: 2, loadLevel: 2 };
    const player = { provider: { instance: hls } } as never;
    preferEntryHlsLevel(player);
    expect(hls.nextLoadLevel).toBe(0);
    expect(hls.loadLevel).toBe(0);
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

  it('uses native fastSeek when the video element exposes it', async () => {
    const video = document.createElement('video');
    const fastSeek = vi.fn((seconds: number) => {
      video.currentTime = seconds;
    });
    Object.defineProperty(video, 'fastSeek', {
      configurable: true,
      value: fastSeek
    });

    const player = document.createElement('div') as HTMLDivElement & {
      currentTime: number;
      paused: boolean;
      pause: () => void;
    };
    player.currentTime = 10;
    player.paused = false;
    player.pause = vi.fn(() => {
      player.paused = true;
    });
    player.append(video);

    const committing = seekMediaPlayerAndWait(player, 42, { timeoutMs: 1_000 });
    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(fastSeek).toHaveBeenCalledWith(42);
    expect(player.currentTime).toBe(10);

    player.dispatchEvent(new Event('seeked'));
    await expect(committing).resolves.toBeUndefined();
  });
  it('resumes a Direct Play seek on a later task, never in the pause tick', async () => {
    const video = document.createElement('video');
    Object.defineProperty(video, 'fastSeek', {
      configurable: true,
      value: (seconds: number) => {
        video.currentTime = seconds;
      }
    });

    const player = document.createElement('div') as HTMLDivElement & {
      currentTime: number;
      paused: boolean;
      pause: () => void;
      play: () => void;
    };
    player.currentTime = 10;
    player.paused = false;
    const play = vi.fn(() => {
      player.paused = false;
    });
    player.pause = vi.fn(() => {
      player.paused = true;
    });
    player.play = play;
    player.append(video);

    const committing = seekMediaPlayerAndWait(player, 42, { timeoutMs: 1_000 });

    // Direct Play reports the new position synchronously, so the old code resumed in
    // the same task as the pause and Vidstack dropped the play request: the clip stayed
    // parked on a frame after a progress-bar drag.
    expect(player.paused).toBe(true);
    expect(play).not.toHaveBeenCalled();

    await committing;
    // The resume is handed back on a later task; just let that task run.
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stays paused when the caller states the viewer had paused the clip', async () => {
    const player = document.createElement('div') as HTMLDivElement & {
      currentTime: number;
      paused: boolean;
      pause: () => void;
      play: () => void;
    };
    player.currentTime = 10;
    player.paused = false;
    const play = vi.fn();
    player.pause = vi.fn(() => {
      player.paused = true;
    });
    player.play = play;

    const committing = seekMediaPlayerAndWait(player, 42, { timeoutMs: 1_000, resumePlayback: false });
    player.dispatchEvent(new Event('seeked'));
    await committing;
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(play).not.toHaveBeenCalled();
  });

  it('resumes when the caller says the clip was playing even if the player is already paused', async () => {
    const player = document.createElement('div') as HTMLDivElement & {
      currentTime: number;
      paused: boolean;
      pause: () => void;
      play: () => void;
    };
    player.currentTime = 10;
    player.paused = true;
    const play = vi.fn(() => {
      player.paused = false;
    });
    player.pause = vi.fn();
    player.play = play;

    const committing = seekMediaPlayerAndWait(player, 42, { timeoutMs: 1_000, resumePlayback: true });
    player.dispatchEvent(new Event('seeked'));
    await committing;

    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe('resumePlaybackAfterSeek', () => {
  it('retries a rejected resume until playback actually advances', async () => {
    let playing = false;
    const play = vi.fn(() => {
      // The first attempt is refused (it landed outside the gesture); the second wins.
      if (play.mock.calls.length >= 2) {
        playing = true;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    });

    resumePlaybackAfterSeek(
      { play, hasResumed: () => playing, shouldContinue: () => true },
      { baseDelayMs: 1, maxDelayMs: 1 }
    );

    await vi.waitFor(() => {
      expect(playing).toBe(true);
    });
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('falls back to muted playback when an audible resume is refused', async () => {
    let muted = false;
    let playedMuted = false;
    const play = vi.fn(() => {
      if (muted) {
        playedMuted = true;
        return Promise.resolve(true);
      }
      return Promise.resolve(false);
    });
    const onAudibleRejected = vi.fn(() => {
      muted = true;
      return true;
    });

    resumePlaybackAfterSeek(
      { play, hasResumed: () => playedMuted, shouldContinue: () => true, onAudibleRejected },
      { baseDelayMs: 1, maxDelayMs: 1 }
    );

    await vi.waitFor(() => {
      expect(playedMuted).toBe(true);
    });
    expect(onAudibleRejected).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('escalates once after the retries are spent', async () => {
    const play = vi.fn(() => Promise.resolve(false));
    const onExhausted = vi.fn();

    resumePlaybackAfterSeek(
      { play, hasResumed: () => false, shouldContinue: () => true, onExhausted },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }
    );

    await vi.waitFor(() => {
      expect(onExhausted).toHaveBeenCalledTimes(1);
    });
    expect(play).toHaveBeenCalledTimes(3);
  });

  it('stops immediately once the surface says it should not continue', async () => {
    const play = vi.fn(() => Promise.resolve(false));
    const onExhausted = vi.fn();

    resumePlaybackAfterSeek(
      { play, hasResumed: () => false, shouldContinue: () => false, onExhausted },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(play).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });
});

describe('seekMediaPlayerAndWait timeout resume', () => {
  it('resumes on the timeout branch when the provider never reaches the target', async () => {
    const player = document.createElement('div') as HTMLDivElement & {
      currentTime: number;
      paused: boolean;
      pause: () => void;
      play: () => void;
    };
    // A cold on-demand seek can leave the clock parked and never fire `seeked`, so the
    // clock never reaches the target and only the timeout fallback fires `finish`. That
    // path must still resume playback rather than leaving the clip paused.
    Object.defineProperty(player, 'currentTime', {
      configurable: true,
      get: () => 10,
      set: () => {}
    });
    player.paused = false;
    const play = vi.fn(() => {
      player.paused = false;
    });
    player.pause = vi.fn(() => {
      player.paused = true;
    });
    player.play = play;

    const committing = seekMediaPlayerAndWait(player, 42, { timeoutMs: 20, resumePlayback: true });
    await committing;
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(play).toHaveBeenCalledTimes(1);
  });
});

describe('isLanPlaybackHost', () => {
  it('treats loopback, RFC1918 and .local names as LAN', () => {
    expect(isLanPlaybackHost('localhost')).toBe(true);
    expect(isLanPlaybackHost('127.0.0.1')).toBe(true);
    expect(isLanPlaybackHost('[::1]')).toBe(true);
    expect(isLanPlaybackHost('192.168.5.11')).toBe(true);
    expect(isLanPlaybackHost('10.0.0.8')).toBe(true);
    expect(isLanPlaybackHost('172.16.1.2')).toBe(true);
    expect(isLanPlaybackHost('nas.local')).toBe(true);
  });

  it('treats public hostnames and Tailscale as WAN', () => {
    expect(isLanPlaybackHost('gallery.example.com')).toBe(false);
    expect(isLanPlaybackHost('100.64.1.2')).toBe(false);
    expect(prefersConstrainedVideoPlayback('gallery.example.com')).toBe(true);
    expect(prefersConstrainedVideoPlayback('192.168.5.11')).toBe(false);
  });
});

describe('original bitrate helpers', () => {
  it('estimates megabits from size and duration', () => {
    expect(estimateOriginalBitrateMbps(1_000_000, 8_000)).toBeCloseTo(1, 5);
  });

  it('treats a 40 Mbps phone clip as too heavy for WAN Direct Play', () => {
    expect(isOriginalTooHeavyForConstrainedLink({
      fileSize: 40 * 1024 * 1024,
      durationMs: 8_000
    }, 'gallery.example.com')).toBe(true);
    expect(isOriginalTooHeavyForConstrainedLink({
      fileSize: 40 * 1024 * 1024,
      durationMs: 8_000
    }, '192.168.5.11')).toBe(false);
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

  it('loads the HLS master on auto in transcode mode even on the LAN', () => {
    expect(resolveVideoSource(directMedia, 'auto', { hostname: '192.168.5.11', playbackMode: 'transcode' })).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('plays a direct-playable post straight from the original file in Direct Play', () => {
    expect(resolveVideoSource(directMedia, 'auto', { hostname: '192.168.5.11', playbackMode: 'direct' })).toEqual({
      src: '/api/originals/501',
      type: 'video/mp4',
      isStream: false
    });
  });

  it('plays a direct-playable post straight from the original file on auto', () => {
    expect(resolveVideoSource(directMedia, 'auto', { playbackMode: 'direct' })).toEqual({
      src: '/api/originals/501',
      type: 'video/mp4',
      isStream: false
    });
  });

  it('loads the HLS master on auto outside the LAN', () => {
    expect(resolveVideoSource(directMedia, 'auto', { hostname: 'gallery.example.com' })).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('loads the HLS master on auto when original Range already proved too slow', () => {
    expect(resolveVideoSource(directMedia, 'auto', { hostname: '192.168.5.11', preferStream: true })).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('keeps Direct Play on the LAN even for a high-bitrate original', () => {
    expect(resolveVideoSource({
      ...directMedia,
      fileSize: 40 * 1024 * 1024,
      durationMs: 8_000
    }, 'auto', { hostname: '192.168.5.11', playbackMode: 'direct' })).toEqual({
      src: '/api/originals/501',
      type: 'video/mp4',
      isStream: false
    });
  });

  it('sends a high-bitrate original to HLS on a WAN Direct Play setting', () => {
    expect(resolveVideoSource({
      ...directMedia,
      fileSize: 40 * 1024 * 1024,
      durationMs: 8_000
    }, 'auto', { hostname: 'gallery.example.com', playbackMode: 'direct' })).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
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
    expect(resolveVideoFallbackSource(directMedia, resolveVideoSource(directMedia, 'auto', { playbackMode: 'direct' }))).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('never warms a transcode for a Direct Play original', async () => {
    const { requestJson } = await import('../api/http');
    (requestJson as unknown as { mockClear: () => void }).mockClear();

    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 206 })));
    vi.stubGlobal('fetch', fetchMock);

    warmVideoStream(directMedia, 'auto', { fromSeconds: 30, playbackMode: 'direct' });

    expect(requestJson).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('still warms the original head and tail on a Direct Play cold start', async () => {
    const { requestJson } = await import('../api/http');
    (requestJson as unknown as { mockClear: () => void }).mockClear();

    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 206 })));
    vi.stubGlobal('fetch', fetchMock);

    warmVideoStream(directMedia, 'auto', { fromSeconds: 0, playbackMode: 'direct' });

    expect(requestJson).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('/api/originals/501', {
      headers: { Range: 'bytes=0-65535' },
      cache: 'force-cache'
    });
    vi.unstubAllGlobals();
  });

  it('uses the adaptive HLS playlist by default instead of a legacy preview MP4', () => {
    stubHevcSupport(false);
    expect(resolveVideoSource(media, 'auto')).toEqual({
      src: '/api/videos/501/hls/master.m3u8',
      type: 'application/x-mpegurl',
      isStream: true
    });
  });

  it('direct-plays a preview-strategy MP4 when Direct Play and the device can decode HEVC', () => {
    stubHevcSupport(true);
    expect(canDirectPlayHevc()).toBe(true);
    expect(resolveVideoSource(media, 'auto', { playbackMode: 'direct' })).toEqual({
      src: '/api/originals/501',
      type: 'video/mp4',
      isStream: false
    });
  });

  it('keeps a HEVC preview on HLS outside the LAN', () => {
    stubHevcSupport(true);
    expect(resolveVideoSource(media, 'auto', { hostname: 'gallery.example.com' }).isStream).toBe(true);
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
