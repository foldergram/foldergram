import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { i18n } from '../locales';
import { useAppStore } from '../stores/app';
import VideoMediaPlayer from './VideoMediaPlayer.vue';

describe('VideoMediaPlayer', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('renders media player with VideoProgressFooter and swipe-ignore tags', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        poster: '/test-poster.webp',
        alt: 'test video'
      },
      global: {
        plugins: [i18n]
      }
    });

    expect(wrapper.find('media-player').exists()).toBe(true);
    expect(wrapper.find('media-provider').exists()).toBe(true);
    expect(wrapper.find('media-poster').exists()).toBe(true);
    expect(wrapper.find('.video-progress-footer').exists()).toBe(true);
    expect(wrapper.find('.video-progress-footer').attributes('data-swipe-ignore')).toBe('true');
  });

  it('uses a coordinate-aware progress slider for an immersive rotated stage', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        progressOrientation: 'rotated'
      },
      global: {
        plugins: [i18n]
      }
    });

    expect(wrapper.find('[role="slider"]').exists()).toBe(true);
    expect(wrapper.find('media-time-slider').exists()).toBe(false);
  });

  it('lets an immersive host capture vertical touch gestures without browser cancellation', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        captureTouchGestures: true
      },
      global: {
        plugins: [i18n]
      }
    });

    expect(wrapper.classes()).toContain('video-media-player--capture-touch-gestures');
  });

  it('keeps immersive surface scrubbing anchored to the playback point', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        holdToSeek: true,
        gestureOrientation: 'normal'
      },
      global: {
        plugins: [i18n]
      }
    });

    const player = wrapper.find('media-player').element as any;
    let currentTime = 10;
    Object.defineProperty(player, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(player, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value) => { currentTime = value; }
    });
    player.play = vi.fn().mockResolvedValue(undefined);
    player.dispatchEvent(new Event('time-update'));
    await flushPromises();

    const surface = wrapper.element;
    const pointer = (clientX: number) => ({
      clientX,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
      currentTarget: surface,
      target: surface
    }) as unknown as PointerEvent;

    (wrapper.vm as any).handleHoldPointerdown(pointer(40));
    (wrapper.vm as any).handleHoldPointermove(pointer(170));

    await vi.waitFor(() => expect(currentTime).toBeCloseTo(25.6, 5));
    expect((wrapper.vm as any).holdSpeed.scrubSeconds.value).toBeCloseTo(25.6, 5);
    expect(wrapper.get('.video-media-player__hold-indicator').text()).toContain('0:25 / 1:40');

    (wrapper.vm as any).handleHoldPointerup(pointer(170));
    expect(currentTime).toBeCloseTo(25.6, 5);
  });

  it('starts the next scrub from the committed timeline when the provider clock lags', async () => {
    vi.useFakeTimers();

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        holdToSeek: true,
        gestureOrientation: 'normal'
      },
      global: {
        plugins: [i18n]
      }
    });

    const player = wrapper.find('media-player').element as any;
    Object.defineProperty(player, 'duration', { configurable: true, value: 100 });
    Object.defineProperty(player, 'currentTime', {
      configurable: true,
      get: () => 10,
      set: () => {
        // Simulate a direct/HLS provider that reports its old clock during seek.
      }
    });
    player.play = vi.fn().mockResolvedValue(undefined);
    player.dispatchEvent(new Event('time-update'));
    await flushPromises();

    const surface = wrapper.element;
    const pointer = (clientX: number) => ({
      clientX,
      clientY: 200,
      isPrimary: true,
      pointerId: 1,
      currentTarget: surface,
      target: surface
    }) as unknown as PointerEvent;

    (wrapper.vm as any).handleHoldPointerdown(pointer(40));
    (wrapper.vm as any).handleHoldPointermove(pointer(170));
    (wrapper.vm as any).handleHoldPointerup(pointer(170));
    await vi.advanceTimersByTimeAsync(750);

    (wrapper.vm as any).handleHoldPointerdown(pointer(40));
    (wrapper.vm as any).handleHoldPointermove(pointer(140));

    expect((wrapper.vm as any).holdSpeed.scrubSeconds.value).toBeCloseTo(37.6, 5);
    vi.useRealTimers();
  });

  it('treats a double tap as one playback toggle instead of toggling twice', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-31T12:00:00Z'));

    const wrapper = mount(VideoMediaPlayer, {
      props: { src: '/test-video.mp4' },
      global: { plugins: [i18n] }
    });

    const player = wrapper.find('media-player').element as any;
    let paused = false;
    Object.defineProperty(player, 'paused', { configurable: true, get: () => paused });
    player.pause = vi.fn(() => { paused = true; });
    player.play = vi.fn(async () => { paused = false; });

    await wrapper.trigger('click');
    expect(player.pause).not.toHaveBeenCalled();
    vi.advanceTimersByTime(120);
    await wrapper.trigger('click');

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.play).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('forwards autoplay to the media player', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: true
      },
      global: {
        plugins: [i18n]
      }
    });

    expect((wrapper.find('media-player').element as any).autoPlay).toBe(true);
  });

  it('retries blocked audible autoplay while muted', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: false
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    playerEl.play = vi.fn().mockResolvedValue(undefined);
    playerEl.dispatchEvent(new CustomEvent('auto-play-fail'));
    await vi.waitFor(() => expect(playerEl.play).toHaveBeenCalled());

    expect(playerEl.muted).toBe(true);
    expect(wrapper.emitted('autoplay-muted')).toHaveLength(1);
  });

  it('keeps the stored mute preference untouched when audible autoplay is refused', async () => {
    const appStore = useAppStore();
    appStore.videoMuted = false;

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: false
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    playerEl.play = vi.fn().mockResolvedValue(undefined);
    playerEl.dispatchEvent(new CustomEvent('auto-play-fail'));
    await vi.waitFor(() => expect(playerEl.play).toHaveBeenCalled());

    // The browser's refusal is local to this element; the feed-wide preference stays audible.
    expect(appStore.videoMuted).toBe(false);
    expect((wrapper.vm as any).audioBlocked).toBe(true);
    expect(wrapper.find('button[data-test="mute-toggle"] span').classes()).toContain(
      'i-fluent-speaker-2-16-regular'
    );
  });

  it('does not let an autoplay block consume the global mute button tap', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: false
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    playerEl.play = vi.fn().mockResolvedValue(undefined);
    playerEl.dispatchEvent(new CustomEvent('auto-play-fail'));
    await vi.waitFor(() => expect((wrapper.vm as any).audioBlocked).toBe(true));

    await wrapper.find('button[data-test="mute-toggle"]').trigger('click');

    expect(wrapper.emitted('toggle-mute')).toHaveLength(1);
  });

  it('keeps every mounted player audible after sound is explicitly enabled', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(false);
    const mountPlayer = () =>
      mount(VideoMediaPlayer, {
        props: {
          src: '/test-video.mp4',
          autoplay: true,
          muted: false
        },
        global: {
          plugins: [i18n]
        }
      });

    const first = mountPlayer();
    const second = mountPlayer();
    const firstPlayer = first.find('media-player').element as any;
    const secondPlayer = second.find('media-player').element as any;
    firstPlayer.play = vi.fn().mockResolvedValue(undefined);
    secondPlayer.play = vi.fn().mockResolvedValue(undefined);
    firstPlayer.dispatchEvent(new CustomEvent('auto-play-fail'));
    secondPlayer.dispatchEvent(new CustomEvent('auto-play-fail'));
    await flushPromises();

    expect(appStore.videoMuted).toBe(false);
    expect((first.vm as any).audioBlocked).toBe(false);
    expect((second.vm as any).audioBlocked).toBe(false);
    expect(firstPlayer.muted).toBe(false);
    expect(secondPlayer.muted).toBe(false);
  });

  it('restores saved sound after the viewer is opened from a muted-autoplay fallback', async () => {
    const appStore = useAppStore();
    window.localStorage.setItem('foldergram-video-muted', 'false');
    appStore.initializeVideoMuted();

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: false,
        surfaceMode: 'immersive'
      },
      global: { plugins: [i18n] }
    });
    const player = wrapper.find('media-player').element as any;
    player.play = vi.fn().mockResolvedValue(undefined);

    player.dispatchEvent(new CustomEvent('auto-play-fail'));
    await vi.waitFor(() => expect(appStore.videoEffectivelyMuted).toBe(true));

    await wrapper.trigger('click');

    expect(appStore.videoMuted).toBe(false);
    expect(appStore.videoEffectivelyMuted).toBe(false);
    expect(player.muted).toBe(false);

    player.dispatchEvent(new CustomEvent('auto-play-fail'));
    await flushPromises();
    expect(player.muted).toBe(false);
  });

  it('writes the global sound state to the native video after a provider remount', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(false);

    const wrapper = mount(VideoMediaPlayer, {
      props: { src: '/test-video.mp4', muted: false },
      global: { plugins: [i18n] }
    });
    const player = wrapper.find('media-player').element as any;
    const nativeVideo = document.createElement('video');
    nativeVideo.muted = true;
    player.append(nativeVideo);

    player.dispatchEvent(new Event('can-play'));
    await flushPromises();

    expect(nativeVideo.muted).toBe(false);
  });

  it('does not expose a transcoding quality switch in direct-only mode', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        media: {
          id: 5,
          originalUrl: '/api/originals/5',
          streamUrl: '/api/videos/5/hls/master.m3u8'
        }
      },
      global: {
        plugins: [i18n]
      }
    });

    expect(wrapper.find('button[data-test="hd-toggle"]').exists()).toBe(false);
  });

  it('ignores an HLS handover source and keeps the direct original URL', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        media: {
          id: 5,
          // Direct play is only chosen for a post the scanner cleared for it.
          playbackStrategy: 'original',
          originalUrl: '/api/originals/5',
          streamUrl: '/api/videos/5/hls/master.m3u8'
        },
        sourceOverride: {
          src: '/api/videos/5/hls/master.m3u8',
          type: 'application/x-mpegurl',
          isStream: true
        }
      },
      global: {
        plugins: [i18n]
      }
    });

    expect((wrapper.vm as any).playerElement.src).toEqual({
      src: '/api/originals/5',
      type: 'video/mp4'
    });
  });

  it('reports a mute tap to the owner instead of flipping the element itself', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        muted: true
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    expect(playerEl.muted).toBe(true);

    await wrapper.find('button[data-test="mute-toggle"]').trigger('click');

    // The owning store decides; the element must not have un-muted on its own,
    // otherwise vidstack's state becomes the source of truth and the persisted
    // preference gets overwritten a few cards later.
    expect(wrapper.emitted('toggle-mute')).toHaveLength(1);
    expect(playerEl.muted).toBe(true);

    await wrapper.setProps({ muted: false });
    expect(playerEl.muted).toBe(false);
  });

  it('pushes the element back onto the owner value when vidstack un-mutes itself', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        muted: true
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    // This is what vidstack does when a provider attaches or the source changes.
    playerEl.muted = false;
    playerEl.dispatchEvent(new Event('volume-change'));

    expect(playerEl.muted).toBe(true);
  });

  it('applies a handover start time on can-play when loaded-metadata could not seek', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        startTime: 10
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    // An HLS provider reports no duration and refuses the seek at this point,
    // which is what used to restart the clip from zero.
    let seekable = false;
    let currentTime = 0;
    Object.defineProperty(playerEl, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        if (seekable) {
          currentTime = value;
        }
      }
    });

    playerEl.dispatchEvent(new Event('loaded-metadata'));
    expect(playerEl.currentTime).toBe(0);

    seekable = true;
    playerEl.dispatchEvent(new Event('can-play'));
    expect(playerEl.currentTime).toBe(10);

    // Idempotent: a second can-play must not drag the viewer back to the handover
    // position after they have watched on.
    currentTime = 25;
    playerEl.dispatchEvent(new Event('can-play'));
    expect(playerEl.currentTime).toBe(25);
  });

  it('holds the thumbnail until a handover has actually been positioned', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/handover-video.mp4',
        poster: '/handover-poster.webp',
        startTime: 30
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    let seekable = false;
    let currentTime = 0;
    Object.defineProperty(playerEl, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        if (seekable) currentTime = value;
      }
    });

    // A frame is decoded but it is the head of the clip, not where the viewer was.
    playerEl.dispatchEvent(new Event('can-play'));
    await flushPromises();
    expect(wrapper.find('.video-media-player__first-frame').exists()).toBe(true);

    seekable = true;
    playerEl.dispatchEvent(new Event('can-play'));
    await flushPromises();
    // Seeking to the handover point is still not a painted frame. The overlay
    // stays until the clock actually moves or a native video reports pixels.
    expect(wrapper.find('.video-media-player__first-frame').exists()).toBe(true);

    currentTime = 30.2;
    playerEl.dispatchEvent(new Event('time-update'));
    await flushPromises();
    expect(wrapper.find('.video-media-player__first-frame').exists()).toBe(false);
  });

  it('falls back to HLS when autoplay never paints a frame', async () => {
    vi.useFakeTimers();

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/api/originals/9',
        autoplay: true,
        muted: true,
        media: {
          id: 9,
          filename: 'clip.mp4',
          playbackStrategy: 'preview',
          streamUrl: '/api/videos/9/hls/master.m3u8',
          originalUrl: '/api/originals/9'
        }
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    Object.defineProperty(playerEl, 'currentTime', { configurable: true, get: () => 0 });
    Object.defineProperty(playerEl, 'paused', { configurable: true, get: () => true });
    playerEl.play = vi.fn().mockResolvedValue(undefined);

    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();

    expect((wrapper.vm as any).playerElement.src).toEqual({
      src: '/api/videos/9/hls/master.m3u8',
      type: 'application/x-mpegurl'
    });

    vi.useRealTimers();
  });

  it('keeps nudging a handover that decoded a frame but never advanced', async () => {
    vi.useFakeTimers();

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/handover-video.mp4',
        autoplay: true,
        muted: true,
        startTime: 20
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    // hls.js honoured `startPosition`, so the clock already reads the handover point.
    // That is not progress, and the old `currentTime > 0.05` test mistook it for
    // playback and left the retry loop standing down over a frozen frame.
    Object.defineProperty(playerEl, 'currentTime', { configurable: true, get: () => 20 });
    Object.defineProperty(playerEl, 'paused', { configurable: true, get: () => true });
    playerEl.play = vi.fn().mockResolvedValue(undefined);

    playerEl.dispatchEvent(new Event('can-play'));
    await flushPromises();
    expect(playerEl.play).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    await flushPromises();
    expect(playerEl.play.mock.calls.length).toBeGreaterThan(1);

    vi.useRealTimers();
  });

  it('stands down once a handover advances past its start position', async () => {
    vi.useFakeTimers();

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/handover-video.mp4',
        autoplay: true,
        muted: true,
        startTime: 20
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    let currentTime = 20;
    let paused = true;
    Object.defineProperty(playerEl, 'currentTime', { configurable: true, get: () => currentTime });
    Object.defineProperty(playerEl, 'paused', { configurable: true, get: () => paused });
    playerEl.play = vi.fn().mockImplementation(() => {
      paused = false;
      return Promise.resolve(undefined);
    });

    playerEl.dispatchEvent(new Event('can-play'));
    await flushPromises();

    currentTime = 21;
    playerEl.dispatchEvent(new Event('time-update'));
    const callsAfterProgress = playerEl.play.mock.calls.length;

    await vi.advanceTimersByTimeAsync(2_000);
    await flushPromises();
    expect(playerEl.play.mock.calls.length).toBe(callsAfterProgress);

    vi.useRealTimers();
  });

  it('starts playback after applying a non-zero handover position', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/handover-video.mp4',
        autoplay: true,
        muted: true,
        startTime: 5
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    let currentTime = 0;
    Object.defineProperty(playerEl, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      }
    });
    Object.defineProperty(playerEl, 'paused', { configurable: true, get: () => true });
    playerEl.play = vi.fn().mockResolvedValue(undefined);

    playerEl.dispatchEvent(new Event('can-play'));

    expect(currentTime).toBe(5);
    expect(playerEl.play).toHaveBeenCalledTimes(1);
  });

  it('retries a stream that can play but refuses to start', async () => {
    vi.useFakeTimers();

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: true
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    let currentTime = 0;
    Object.defineProperty(playerEl, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      }
    });
    Object.defineProperty(playerEl, 'paused', { configurable: true, get: () => true });
    playerEl.play = vi.fn().mockResolvedValue(undefined);

    playerEl.dispatchEvent(new Event('can-play'));
    expect(playerEl.play).not.toHaveBeenCalled();

    // A segment the NAS has not finished transcoding yet: the first attempt resolves
    // without moving the clock, so the loop keeps nudging on a backoff.
    await vi.advanceTimersByTimeAsync(200);
    expect(playerEl.play).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(playerEl.play).toHaveBeenCalledTimes(2);

    // Once frames arrive the loop stands down.
    currentTime = 1.4;
    playerEl.dispatchEvent(new Event('time-update'));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(playerEl.play).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('nudges a stalled stream that never reached its first frame', async () => {
    vi.useFakeTimers();

    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4',
        autoplay: true,
        muted: true
      },
      global: {
        plugins: [i18n]
      }
    });

    const playerEl = wrapper.find('media-player').element as any;
    Object.defineProperty(playerEl, 'currentTime', { configurable: true, get: () => 0 });
    Object.defineProperty(playerEl, 'paused', { configurable: true, get: () => true });
    playerEl.play = vi.fn().mockResolvedValue(undefined);

    playerEl.dispatchEvent(new Event('waiting'));
    await vi.advanceTimersByTimeAsync(200);

    expect(playerEl.play).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('stops keyboard event propagation for arrow keys on controls', async () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4'
      },
      global: {
        plugins: [i18n]
      }
    });

    const muteBtn = wrapper.find('button[data-test="mute-toggle"]');
    const keyEvent = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true });
    const stopPropagationSpy = vi.spyOn(keyEvent, 'stopPropagation');

    muteBtn.element.dispatchEvent(keyEvent);
    expect(stopPropagationSpy).toHaveBeenCalled();
  });

  it('pauses player on unmount', () => {
    const wrapper = mount(VideoMediaPlayer, {
      props: {
        src: '/test-video.mp4'
      },
      global: {
        plugins: [i18n]
      }
    });

    const mockPlayer = { pause: vi.fn(), removeEventListener: vi.fn() };
    (wrapper.vm as any).playerElement = mockPlayer;

    wrapper.unmount();
    expect(mockPlayer.pause).toHaveBeenCalled();
  });
});
