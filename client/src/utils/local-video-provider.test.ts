import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaContext, Src } from 'vidstack';

import { RequestError, requestJson } from '../api/http';
import { LocalVideoDelivery, ReelVideoPreparation, VIDEO_SETTLE_MS, type LocalVideoOptions } from './local-video-provider';

vi.mock('../api/http', async importOriginal => ({
  ...await importOriginal<typeof import('../api/http')>(), requestJson: vi.fn()
}));

const metadata = { duration: 90, width: 3840, height: 2160, bitrate: 30_000_000, original: null };
const empty = { length: 0, start: () => 0, end: () => 0 };
const engines: LocalVideoDelivery[] = [];

function fixture(active = true, options: LocalVideoOptions = {}) {
  const video = document.createElement('video');
  const element = document.createElement('div');
  element.append(video);
  document.body.append(element);
  let fullscreen = false;
  let paused = true;
  let ended = false;
  let original = false;
  Object.defineProperties(video, {
    readyState: { configurable: true, value: 2 },
    paused: { configurable: true, get: () => paused },
    ended: { configurable: true, get: () => ended },
    seekable: { configurable: true, get: () => ({ length: 1, start: () => 0, end: () => 24 }) }
  });
  const play = vi.spyOn(video, 'play').mockImplementation(async () => { paused = false; });
  vi.spyOn(video, 'pause').mockImplementation(() => { paused = true; });
  const notify = vi.fn();
  const ready = vi.fn(async () => undefined);
  const ctx = {
    player: { el: element }, notify, delegate: { ready },
    $state: { fullscreen: () => fullscreen }
  } as unknown as MediaContext;
  const load = vi.fn(async (_source: Src<string>, _signal: AbortSignal, _startPosition: number) => undefined);
  const unload = vi.fn();
  const delivery = new LocalVideoDelivery(video, ctx, {
    active: () => active, autoplay: () => true, original: () => original, settleMs: 0, ...options
  }, load, unload);
  engines.push(delivery);
  return { video, load, notify, ready, play, delivery,
    setFullscreen(value: boolean) { fullscreen = value; },
    setEnded(value: boolean) { ended = value; },
    setActive(value: boolean) { active = value; },
    setOriginal(value: boolean) { original = value; }
  };
}

function mockRequests() {
  const release = vi.fn(async () => new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', release);
  vi.mocked(requestJson).mockImplementation(async (url, options) => {
    if (!String(url).endsWith('/sessions')) return metadata;
    const { at, profile } = JSON.parse(String(options?.body));
    return { url: `/window/${at}/stream.m3u8`, releaseUrl: `/window/${at}/release`,
      offset: Math.floor(at), window: Math.min(24, 90 - at), duration: 90, profile };
  });
  return release;
}

async function start(delivery: LocalVideoDelivery) {
  await delivery.loadSource({ src: '/api/videos/1/playback', type: 'video/object' });
  await delivery.ready({ duration: 24, seekable: empty, buffered: empty });
}

afterEach(() => {
  for (const delivery of engines.splice(0)) delivery.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(requestJson).mockReset();
  document.body.replaceChildren();
});

describe('Vidstack local video delivery', () => {
  const source = { src: '/api/videos/1/playback', type: 'video/object' };
  const idle = { pending: false, hasFrame: false, failed: false };

  it('cancels a passing card, waits for the settled card, and starts immediately on explicit play', async () => {
    vi.useFakeTimers();
    mockRequests();
    const f = fixture(true, { settleMs: VIDEO_SETTLE_MS });
    f.delivery.setup();
    await f.delivery.loadSource(source);
    await vi.advanceTimersByTimeAsync(VIDEO_SETTLE_MS - 1);
    expect(requestJson).not.toHaveBeenCalled();
    f.setActive(false);
    f.delivery.syncAvailability();
    await vi.advanceTimersByTimeAsync(VIDEO_SETTLE_MS);
    expect(requestJson).not.toHaveBeenCalled();

    f.setActive(true);
    f.delivery.syncAvailability();
    await f.delivery.play();
    expect(f.load).toHaveBeenCalledTimes(1);
    const [, signal] = f.load.mock.calls[0];
    f.setActive(false);
    f.delivery.syncAvailability();
    expect(signal.aborted).toBe(true);
    f.setActive(true);
    f.delivery.syncAvailability();
    await vi.advanceTimersByTimeAsync(VIDEO_SETTLE_MS);
    expect(f.load).toHaveBeenCalledTimes(2);
  });

  it('negotiates a Reel during settling and only opens a session if it stays active', async () => {
    vi.useFakeTimers();
    mockRequests();
    const f = fixture(true, { settleMs: VIDEO_SETTLE_MS, reelPreparation: new ReelVideoPreparation() });
    f.delivery.setup();
    await f.delivery.loadSource(source);
    expect(requestJson).toHaveBeenCalledWith(source.src, expect.anything());
    const signal = vi.mocked(requestJson).mock.calls[0][1]?.signal;
    await vi.advanceTimersByTimeAsync(VIDEO_SETTLE_MS - 1);
    expect(requestJson).toHaveBeenCalledTimes(1);
    f.setActive(false);
    f.delivery.syncAvailability();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(VIDEO_SETTLE_MS);
    expect(f.load).not.toHaveBeenCalled();

    f.setActive(true);
    f.delivery.syncAvailability();
    await vi.advanceTimersByTimeAsync(VIDEO_SETTLE_MS);
    expect(vi.mocked(requestJson).mock.calls.map(([url]) => url)).toEqual([
      source.src, source.src, source.src + '/sessions'
    ]);
    expect(f.load).toHaveBeenCalledTimes(1);
  });

  it('leaves a manual feed carousel idle until its Play command', async () => {
    vi.useFakeTimers();
    mockRequests();
    const { delivery, load, video } = fixture(true, { autoplay: () => false, loadOnPlay: true });
    delivery.setup();
    await delivery.loadSource(source);
    await vi.advanceTimersByTimeAsync(VIDEO_SETTLE_MS * 2);
    expect(requestJson).not.toHaveBeenCalled();
    const playButton = document.createElement('media-play-button');
    video.parentElement!.append(playButton);
    playButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('starts fullscreen immediately during an existing settle delay', async () => {
    vi.useFakeTimers();
    mockRequests();
    const f = fixture(true, { settleMs: VIDEO_SETTLE_MS });
    f.delivery.setup();
    await f.delivery.loadSource(source);
    expect(requestJson).not.toHaveBeenCalled();
    f.setFullscreen(true);
    f.video.parentElement!.dispatchEvent(new Event('fullscreen-change'));
    await vi.advanceTimersByTimeAsync(0);
    expect(f.load).toHaveBeenCalledTimes(1);
  });

  it('shows terminal failure and retries from standard while keeping the cover until a frame', async () => {
    mockRequests();
    const requests = vi.mocked(requestJson).getMockImplementation()!;
    const profiles: string[] = [];
    vi.mocked(requestJson).mockImplementation(async (url, options) => {
      if (String(url).endsWith('/sessions')) {
        profiles.push(JSON.parse(String(options?.body)).profile);
        if (profiles.length <= 2) throw new RequestError('Could not encode', 422);
      }
      return requests(url, options);
    });
    const onStateChange = vi.fn();
    const { delivery, video } = fixture(true, { onStateChange });
    let frame!: VideoFrameRequestCallback;
    video.requestVideoFrameCallback = vi.fn(callback => { frame = callback; return 1; });
    await delivery.loadSource(source);
    await vi.waitFor(() => expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, failed: true }));
    expect(profiles).toEqual(['standard', 'low']);
    await delivery.play();
    await delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    expect(profiles).toEqual(['standard', 'low', 'standard']);
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, pending: true });
    frame(0, {} as VideoFrameCallbackMetadata);
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, hasFrame: true });
  });

  it('warms at most one next video as soon as the current one renders and aborts on seek', async () => {
    mockRequests();
    const requests = vi.mocked(requestJson).getMockImplementation()!;
    const candidate = '/api/videos/2/playback';
    let warmSignal: AbortSignal | null | undefined;
    vi.mocked(requestJson).mockImplementation((url, options) => {
      if (url !== candidate + '/sessions') return requests(url, options);
      warmSignal = options?.signal;
      return new Promise((_, reject) => warmSignal?.addEventListener('abort', () => reject(warmSignal?.reason)));
    });
    const { delivery, video } = fixture(true, { next: () => candidate });
    let frame!: VideoFrameRequestCallback;
    video.requestVideoFrameCallback = vi.fn(callback => { frame = callback; return 1; });
    await start(delivery);
    delivery.notify('time-change', 0.1);
    expect(requestJson).not.toHaveBeenCalledWith(candidate, expect.anything());
    frame(0, {} as VideoFrameCallbackMetadata);
    delivery.notify('time-change', 0.2);
    await vi.waitFor(() => expect(warmSignal).toBeDefined());
    delivery.notify('time-change', 2);
    expect(vi.mocked(requestJson).mock.calls.filter(([url]) => url === candidate + '/sessions')).toHaveLength(1);
    expect(requestJson).toHaveBeenCalledWith(candidate + '/sessions', expect.objectContaining({
      body: JSON.stringify({ at: 0, warmup: true })
    }));
    delivery.seek(37);
    expect(warmSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(requestJson).toHaveBeenCalledWith(source.src + '/sessions', expect.objectContaining({
      body: JSON.stringify({ at: 37, profile: 'standard' })
    })));
  });

  it('keeps the cover through a paint when frame callbacks are unavailable and cancels it on suspension', async () => {
    vi.useFakeTimers();
    mockRequests();
    const onStateChange = vi.fn();
    const f = fixture(true, { onStateChange });
    Object.defineProperty(f.video, 'requestVideoFrameCallback', { value: undefined });
    f.delivery.setup();
    await start(f.delivery);
    await vi.advanceTimersByTimeAsync(16);
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, pending: true });
    await vi.advanceTimersByTimeAsync(16);
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, hasFrame: true });

    f.setActive(false);
    f.delivery.syncAvailability();
    f.setActive(true);
    f.delivery.syncAvailability();
    await vi.advanceTimersByTimeAsync(0);
    await f.delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    f.setActive(false);
    f.delivery.syncAvailability();
    await vi.advanceTimersByTimeAsync(32);
    expect(onStateChange).toHaveBeenLastCalledWith(idle);
  });

  it('waits for spare encoder capacity before warming the next Reel', async () => {
    vi.useFakeTimers();
    mockRequests();
    const requests = vi.mocked(requestJson).getMockImplementation()!;
    const candidate = '/api/videos/2/playback';
    let available = false;
    vi.mocked(requestJson).mockImplementation((url, options) => url === candidate
      ? Promise.resolve({ ...metadata, warmupAvailable: available }) : requests(url, options));
    const { delivery, video } = fixture(true, { next: () => candidate });
    let frame!: VideoFrameRequestCallback;
    video.requestVideoFrameCallback = vi.fn(callback => { frame = callback; return 1; });
    await start(delivery);
    frame(0, {} as VideoFrameCallbackMetadata);
    delivery.notify('time-change', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(requestJson).toHaveBeenCalledWith(candidate, expect.anything());
    expect(vi.mocked(requestJson).mock.calls.filter(([url]) => url === candidate + '/sessions')).toHaveLength(0);
    available = true;
    delivery.notify('time-change', 1.5);
    await vi.advanceTimersByTimeAsync(1000);
    delivery.notify('time-change', 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(requestJson).mock.calls.filter(([url]) => url === candidate + '/sessions')).toHaveLength(1);
    delivery.notify('time-change', 3);
    await vi.advanceTimersByTimeAsync(2000);
    delivery.notify('time-change', 4);
    expect(vi.mocked(requestJson).mock.calls.filter(([url]) => url === candidate + '/sessions')).toHaveLength(1);
  });

  it('publishes a full-video timeline and maps seeks and progress across HLS windows', async () => {
    mockRequests();
    const { delivery, ready, notify, load } = fixture();
    await start(delivery);
    const info = ready.mock.calls[0][0];
    expect(info.duration).toBe(90);
    expect(info.seekable.start(0)).toBe(0);
    expect(info.seekable.end(0)).toBe(90);
    delivery.seek(35.75);
    await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith(
      { src: '/window/35.75/stream.m3u8', type: 'application/vnd.apple.mpegurl' }, expect.any(AbortSignal), 0.75));
    await delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    delivery.notify('time-change', 4);
    expect(notify).toHaveBeenCalledWith('time-change', 39, undefined);
  });

  it('permits an inactive fullscreen video and suspends it again after exit', async () => {
    const released = mockRequests();
    const f = fixture(false);
    await f.delivery.loadSource({ src: '/api/videos/1/playback', type: 'video/object' });
    expect(requestJson).not.toHaveBeenCalled();
    f.setFullscreen(true);
    f.delivery.syncAvailability();
    await vi.waitFor(() => expect(f.load).toHaveBeenCalled());
    await f.delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    await f.delivery.play();
    expect(f.video.paused).toBe(false);
    f.setFullscreen(false);
    f.delivery.syncAvailability();
    expect(f.video.paused).toBe(true);
    expect(released).toHaveBeenCalledWith('/window/0/release', expect.objectContaining({ method: 'POST' }));
  });

  it('preserves native pause intent across a seek and subsequent ready notifications', async () => {
    mockRequests();
    const { delivery, video, play, load } = fixture();
    await start(delivery);
    video.pause();
    delivery.notify('pause');
    play.mockClear();
    delivery.seek(40);
    await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith(
      { src: '/window/40/stream.m3u8', type: 'application/vnd.apple.mpegurl' }, expect.any(AbortSignal), 0));
    await delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    expect(play).not.toHaveBeenCalled();
    await delivery.play();
    expect(play).toHaveBeenCalled();
  });

  it('reuses the previous window when returning to a watched Reel', async () => {
    mockRequests();
    const f = fixture();
    f.delivery.setup();
    await start(f.delivery);
    f.delivery.notify('time-change', 2);
    f.setActive(false);
    f.delivery.syncAvailability();
    vi.mocked(requestJson).mockClear();
    f.setActive(true);
    f.delivery.syncAvailability();
    await vi.waitFor(() => expect(requestJson).toHaveBeenCalledWith('/api/videos/1/playback/sessions',
      expect.objectContaining({ body: JSON.stringify({ at: 0, profile: 'standard' }) })));
    await f.delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    expect(f.load).toHaveBeenLastCalledWith(
      { src: '/window/0/stream.m3u8', type: 'application/vnd.apple.mpegurl' }, expect.any(AbortSignal), 2);
    expect(f.video.currentTime).toBe(2);
    expect(f.video.paused).toBe(false);
  });

  it('resumes beyond a retained opening at the watched position', async () => {
    mockRequests();
    const f = fixture();
    f.delivery.setup();
    await start(f.delivery);
    f.delivery.notify('time-change', 5);
    f.setActive(false);
    f.delivery.syncAvailability();
    const requests = vi.mocked(requestJson).getMockImplementation()!;
    vi.mocked(requestJson).mockImplementation(async (url, options) => {
      const response = await requests(url, options);
      return String(url).endsWith('/sessions') && JSON.parse(String(options?.body)).at === 0
        ? { ...response, window: 3 } : response;
    });
    vi.mocked(requestJson).mockClear();
    f.setActive(true);
    f.delivery.syncAvailability();
    await vi.waitFor(() => expect(f.load).toHaveBeenLastCalledWith(
      { src: '/window/5/stream.m3u8', type: 'application/vnd.apple.mpegurl' }, expect.any(AbortSignal), 0));
    expect(vi.mocked(requestJson).mock.calls.map(([, options]) => JSON.parse(String(options?.body)).at)).toEqual([0, 5]);
    await f.delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    expect(f.video.currentTime).toBe(0);
    expect(f.video.paused).toBe(false);
  });

  it('prefetches the next window, hides its intermediate end, and releases both leases on teardown', async () => {
    const released = mockRequests();
    const { delivery, load, notify, setEnded } = fixture();
    await start(delivery);
    delivery.notify('time-change', 19);
    await vi.waitFor(() => expect(requestJson).toHaveBeenCalledWith('/api/videos/1/playback/sessions',
      expect.objectContaining({ body: JSON.stringify({ at: 24, profile: 'standard' }) })));
    setEnded(true);
    delivery.notify('pause');
    delivery.notify('end');
    await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith(
      { src: '/window/24/stream.m3u8', type: 'application/vnd.apple.mpegurl' }, expect.any(AbortSignal), 0));
    expect(notify).not.toHaveBeenCalledWith('end', undefined, undefined);
    expect(vi.mocked(requestJson).mock.calls.filter(([url, options]) => String(url).endsWith('/sessions') &&
      JSON.parse(String(options?.body)).at === 24)).toHaveLength(1);
    delivery.destroy();
    expect(released).toHaveBeenCalledWith('/window/0/release', expect.anything());
    expect(released).toHaveBeenCalledWith('/window/24/release', expect.anything());
  });

  it('prepares the continuation as soon as a cached opening window starts playing', async () => {
    mockRequests();
    const requests = vi.mocked(requestJson).getMockImplementation()!;
    vi.mocked(requestJson).mockImplementation(async (url, options) => {
      const response = await requests(url, options);
      return String(url).endsWith('/sessions') && JSON.parse(String(options?.body)).at === 0
        ? { ...response, window: 3 } : response;
    });
    const onStateChange = vi.fn();
    const { delivery, load, setEnded, video } = fixture(true, { onStateChange });
    let frame!: VideoFrameRequestCallback;
    video.requestVideoFrameCallback = vi.fn(callback => { frame = callback; return 1; });
    await start(delivery);
    frame(0, {} as VideoFrameCallbackMetadata);
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, hasFrame: true });
    delivery.notify('time-change', 0.1);
    expect(requestJson).toHaveBeenCalledWith(source.src + '/sessions', expect.objectContaining({
      body: JSON.stringify({ at: 3, profile: 'standard' })
    }));
    setEnded(true);
    delivery.notify('end');
    await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith(
      { src: '/window/3/stream.m3u8', type: 'application/vnd.apple.mpegurl' }, expect.any(AbortSignal), 0));
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, pending: true });
    await delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, pending: true });
    frame(0, {} as VideoFrameCallbackMetadata);
    expect(onStateChange).toHaveBeenLastCalledWith({ ...idle, hasFrame: true });
    expect(vi.mocked(requestJson).mock.calls.filter(([url, options]) => String(url).endsWith('/sessions') &&
      JSON.parse(String(options?.body)).at === 3)).toHaveLength(1);
  });

  it('releases a prefetched window when the user pauses', async () => {
    const released = mockRequests();
    const { delivery, video } = fixture();
    await start(delivery);
    delivery.notify('time-change', 19);
    await vi.waitFor(() => expect(requestJson).toHaveBeenCalledTimes(3));
    video.pause();
    delivery.notify('pause');
    await vi.waitFor(() => expect(released).toHaveBeenCalledWith('/window/24/release', expect.anything()));
  });

  it('retries a failed standard conversion at low quality without losing the requested position', async () => {
    mockRequests();
    const { delivery, load } = fixture();
    load.mockRejectedValueOnce(new Error('conversion failed'));
    await delivery.loadSource({ src: '/api/videos/1/playback', type: 'video/object' });
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    const requests = vi.mocked(requestJson).mock.calls.filter(([url]) => String(url).endsWith('/sessions'));
    expect(requests.map(([, options]) => JSON.parse(String(options?.body)))).toEqual([
      { at: 0, profile: 'standard' }, { at: 0, profile: 'low' }
    ]);
  });

  it('releases its window on pagehide and resumes the intended playback on pageshow', async () => {
    const released = mockRequests();
    const { delivery, load, video } = fixture();
    delivery.setup();
    await start(delivery);
    window.dispatchEvent(new Event('pagehide'));
    expect(video.paused).toBe(true);
    expect(released).toHaveBeenCalledWith('/window/0/release', expect.anything());
    window.dispatchEvent(new Event('pageshow'));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    await delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    expect(video.paused).toBe(false);
  });

  it('keeps position, pause intent, and mute state when switching quality in either direction', async () => {
    mockRequests();
    vi.mocked(requestJson).mockResolvedValueOnce({ ...metadata, original: { url: '/original.mp4', type: 'video/mp4' } });
    const { delivery, video, play, load, notify, setOriginal } = fixture();
    vi.spyOn(video, 'canPlayType').mockReturnValue('probably');
    video.muted = true;
    await start(delivery);
    video.pause();
    delivery.notify('pause');
    delivery.notify('time-change', 8);
    play.mockClear();
    setOriginal(true);
    delivery.changeQuality();
    await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith(
      { src: '/original.mp4', type: 'video/mp4' }, expect.any(AbortSignal), 8));
    await delivery.ready({ duration: 90, seekable: empty, buffered: empty });
    expect(video.currentTime).toBe(8);
    expect(play).not.toHaveBeenCalled();
    setOriginal(false);
    delivery.changeQuality();
    await vi.waitFor(() => expect(load).toHaveBeenLastCalledWith(
      { src: '/window/8/stream.m3u8', type: 'application/vnd.apple.mpegurl' }, expect.any(AbortSignal), 0));
    await delivery.ready({ duration: 24, seekable: empty, buffered: empty });
    expect(notify).toHaveBeenLastCalledWith('seeked', 8, undefined);
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(true);
    expect(play).not.toHaveBeenCalled();
  });

  it('synchronizes provider and native pauses even when the video has only metadata', async () => {
    mockRequests();
    const { delivery, video, notify } = fixture();
    delivery.setup();
    await start(delivery);
    Object.defineProperty(video, 'readyState', { configurable: true, value: 1 });
    delivery.pause();
    expect(notify).toHaveBeenCalledWith('pause');
    await delivery.play();
    video.pause();
    const pause = new Event('pause');
    video.dispatchEvent(pause);
    expect(notify).toHaveBeenCalledWith('pause', undefined, pause);
  });

  it('bounds startup stalls through original, standard, and low fallback before reporting failure', async () => {
    vi.useFakeTimers();
    mockRequests();
    const requests = vi.mocked(requestJson).getMockImplementation()!;
    vi.mocked(requestJson).mockImplementation((url, options) => String(url).endsWith('/sessions')
      ? requests(url, options)
      : Promise.resolve({ ...metadata, width: 640, height: 360, bitrate: 200_000,
        original: { url: '/original.mp4', type: 'video/mp4' } }));
    const { delivery, video, load, notify } = fixture();
    vi.spyOn(video, 'canPlayType').mockReturnValue('probably');
    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    delivery.setup();
    await delivery.loadSource({ src: '/api/videos/1/playback', type: 'video/object' });
    expect(load).toHaveBeenLastCalledWith({ src: '/original.mp4', type: 'video/mp4' }, expect.any(AbortSignal), 0);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(requestJson).toHaveBeenLastCalledWith('/api/videos/1/playback/sessions',
      expect.objectContaining({ body: JSON.stringify({ at: 0, profile: 'standard' }) }));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(requestJson).toHaveBeenLastCalledWith('/api/videos/1/playback/sessions',
      expect.objectContaining({ body: JSON.stringify({ at: 0, profile: 'low' }) }));
    await vi.advanceTimersByTimeAsync(11_000);
    expect(notify).toHaveBeenCalledWith('error', expect.objectContaining({ code: 4 }));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
