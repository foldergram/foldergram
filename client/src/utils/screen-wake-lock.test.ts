import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  hasPlayingPlaybackVideo,
  shouldHoldScreenWakeLock,
  startScreenWakeLock
} from './screen-wake-lock';

interface FakeSentinel {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: 'release', listener: () => void) => void;
}

function createVideo(options: { paused?: boolean; ended?: boolean; className?: string } = {}) {
  const video = document.createElement('video');
  let paused = options.paused ?? true;
  let ended = options.ended ?? false;

  Object.defineProperty(video, 'paused', {
    configurable: true,
    get: () => paused
  });
  Object.defineProperty(video, 'ended', {
    configurable: true,
    get: () => ended
  });

  if (options.className) {
    video.className = options.className;
  }

  document.body.appendChild(video);

  return {
    element: video,
    setPaused(next: boolean) {
      paused = next;
    },
    setEnded(next: boolean) {
      ended = next;
    }
  };
}

function mockWakeLock() {
  const sentinels: FakeSentinel[] = [];
  const request = vi.fn(async () => {
    const listeners = new Set<() => void>();
    const sentinel: FakeSentinel = {
      released: false,
      release: vi.fn(async () => {
        sentinel.released = true;
        listeners.forEach((listener) => listener());
      }),
      addEventListener: (_type: 'release', listener: () => void) => {
        listeners.add(listener);
      }
    };
    sentinels.push(sentinel);
    return sentinel;
  });

  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request }
  });

  return { request, sentinels };
}

describe('shouldHoldScreenWakeLock', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('holds the lock only while a real playback video is playing in the foreground', () => {
    const playback = createVideo({ paused: false });
    expect(hasPlayingPlaybackVideo()).toBe(true);
    expect(shouldHoldScreenWakeLock('visible')).toBe(true);
    expect(shouldHoldScreenWakeLock('hidden')).toBe(false);

    playback.setPaused(true);
    expect(shouldHoldScreenWakeLock('visible')).toBe(false);
  });

  it('ignores the first-frame probe video that never actually plays', () => {
    createVideo({ paused: false, className: 'video-first-frame__probe' });
    expect(hasPlayingPlaybackVideo()).toBe(false);
    expect(shouldHoldScreenWakeLock('visible')).toBe(false);
  });

  it('releases once the clip has ended', () => {
    createVideo({ paused: false, ended: true });
    expect(shouldHoldScreenWakeLock('visible')).toBe(false);
  });

  it('sees a Vidstack player whose native video lives in a shadow root', () => {
    const player = document.createElement('media-player') as HTMLElement & { paused: boolean };
    player.paused = false;
    const shadow = player.attachShadow({ mode: 'open' });
    const video = document.createElement('video');
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
    shadow.appendChild(video);
    document.body.appendChild(player);

    expect(document.querySelectorAll('video')).toHaveLength(0);
    expect(hasPlayingPlaybackVideo()).toBe(true);
    expect(shouldHoldScreenWakeLock('visible')).toBe(true);
  });

  it('treats media-player.paused as the source of truth when the shadow video is hidden', () => {
    const player = document.createElement('media-player') as HTMLElement & { paused: boolean };
    player.paused = false;
    document.body.appendChild(player);

    expect(hasPlayingPlaybackVideo()).toBe(true);
    player.paused = true;
    expect(hasPlayingPlaybackVideo()).toBe(false);
  });
});

describe('startScreenWakeLock', () => {
  let controller: ReturnType<typeof startScreenWakeLock> = null;
  let visibility: DocumentVisibilityState = 'visible';

  afterEach(() => {
    controller?.stop();
    controller = null;
    document.body.replaceChildren();
    visibility = 'visible';
    vi.unstubAllGlobals();
  });

  function stubVisibility() {
    vi.stubGlobal('document', document);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility
    });
  }

  it('requests a screen lock when a video starts and releases it on pause', async () => {
    stubVisibility();
    const { request, sentinels } = mockWakeLock();
    const video = createVideo({ paused: true });
    controller = startScreenWakeLock();

    expect(request).not.toHaveBeenCalled();

    video.setPaused(false);
    video.element.dispatchEvent(new Event('play', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith('screen');
    expect(sentinels[0]?.released).toBe(false);

    video.setPaused(true);
    video.element.dispatchEvent(new Event('pause', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(sentinels[0]?.released).toBe(true);
  });

  it('does not request a lock for the poster probe video', async () => {
    stubVisibility();
    const { request } = mockWakeLock();
    const probe = createVideo({ paused: false, className: 'video-first-frame__probe' });
    controller = startScreenWakeLock();

    probe.element.dispatchEvent(new Event('play', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(request).not.toHaveBeenCalled();
  });

  it('re-requests after the page becomes visible again if the video is still playing', async () => {
    stubVisibility();
    const { request, sentinels } = mockWakeLock();
    const video = createVideo({ paused: false });
    controller = startScreenWakeLock();
    video.element.dispatchEvent(new Event('playing', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(1);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();

    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels[1]?.released).toBe(false);
  });

  it('retries on a user tap when the first request is rejected without activation', async () => {
    stubVisibility();
    const { request, sentinels } = mockWakeLock();
    request.mockRejectedValueOnce(new Error('NotAllowedError'));
    const video = createVideo({ paused: false });
    controller = startScreenWakeLock();

    video.element.dispatchEvent(new Event('play', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(sentinels).toHaveLength(0);

    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledTimes(2);
    expect(sentinels[0]?.released).toBe(false);
  });

  it('requests a lock when a media-player reports play from its host', async () => {
    stubVisibility();
    const { request } = mockWakeLock();
    controller = startScreenWakeLock();

    const player = document.createElement('media-player') as HTMLElement & { paused: boolean };
    player.paused = true;
    const shadow = player.attachShadow({ mode: 'open' });
    const video = document.createElement('video');
    let paused = true;
    Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
    Object.defineProperty(video, 'ended', { configurable: true, get: () => false });
    shadow.appendChild(video);
    document.body.appendChild(player);
    await Promise.resolve();
    await Promise.resolve();
    expect(request).not.toHaveBeenCalled();

    paused = false;
    player.paused = false;
    player.dispatchEvent(new Event('play', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledWith('screen');
  });
});
