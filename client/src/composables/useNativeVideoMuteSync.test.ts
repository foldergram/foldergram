// The package's Node export is a no-op. Exercise its installed browser player.
import '../../node_modules/vidstack/dev/define/vidstack-player.js';

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { h, ref, watch } from 'vue';
import type { MediaPlayerElement } from 'vidstack/elements';

import { useAppStore } from '../stores/app';
import { applyVideoMutePreference, createVideoMuteStorage } from '../utils/video-mute';
import { useNativeVideoMuteSync } from './useNativeVideoMuteSync';

const mountedPlayers: MediaPlayerElement[] = [];

async function mountPlayer() {
  const appStore = useAppStore();
  const wrapper = mount({
    setup() {
      const player = ref<MediaPlayerElement | null>(null);
      const storage = createVideoMuteStorage(() => appStore.videoMuted);
      useNativeVideoMuteSync(player, () => appStore.videoMuted, muted => appStore.setVideoMuted(muted));
      watch([player, () => appStore.videoMuted], ([element, muted]) => {
        if (element) applyVideoMutePreference(element, muted);
      });
      return () => h('media-player', {
        ref: player,
        src: { src: '/test-video.mp4', type: 'video/mp4' },
        storage,
        load: 'eager',
        'poster-load': 'eager',
        'log-level': 'silent'
      }, [h('media-provider')]);
    }
  }, { attachTo: document.body });
  const player = wrapper.get('media-player').element as MediaPlayerElement;
  mountedPlayers.push(player);
  await vi.waitFor(() => expect(player.querySelector('video')).not.toBeNull());
  await vi.waitFor(() => expect(player.provider).not.toBeNull());
  await flushPromises();
  const video = player.querySelector('video')!;
  return { wrapper, player, video };
}

async function initializeVideo(player: MediaPlayerElement, video: HTMLVideoElement) {
  Object.defineProperty(video, 'readyState', { configurable: true, value: 4 });
  Object.defineProperty(video, 'duration', { configurable: true, value: 10 });
  video.dispatchEvent(new Event('loadstart'));
  video.dispatchEvent(new Event('loadedmetadata'));
  video.dispatchEvent(new Event('canplay'));
  await flushPromises();
  await vi.waitFor(() => expect(player.hasAttribute('data-can-play')).toBe(true));
  await new Promise(requestAnimationFrame);
}

describe('native video mute synchronization with Vidstack', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
    vi.stubGlobal('IntersectionObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
  });

  afterEach(() => {
    // Dispose providers while the jsdom media method stubs are still installed.
    for (const player of mountedPlayers.splice(0)) {
      if (player.$) player.destroy();
    }
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('persists native fullscreen mute and unmute changes across players and reloads', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(true);
    const first = await mountPlayer();
    await initializeVideo(first.player, first.video);
    expect(first.video.muted).toBe(true);

    const forwardedEvents: Event[] = [];
    first.player.addEventListener('volume-change', event => forwardedEvents.push(event));
    first.video.muted = false;
    first.video.dispatchEvent(new Event('volumechange'));
    await flushPromises();
    expect(forwardedEvents.length).toBeGreaterThan(0);
    expect(appStore.videoMuted).toBe(false);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('false');

    const second = await mountPlayer();
    await initializeVideo(second.player, second.video);
    expect(second.video.muted).toBe(false);
    second.video.muted = true;
    second.video.dispatchEvent(new Event('volumechange'));
    await flushPromises();
    expect(appStore.videoMuted).toBe(true);
    expect(first.video.muted).toBe(true);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');
    first.wrapper.unmount();
    second.wrapper.unmount();

    setActivePinia(createPinia());
    useAppStore().initializeVideoMuted();
    const reloaded = await mountPlayer();
    await initializeVideo(reloaded.player, reloaded.video);
    expect(reloaded.video.muted).toBe(true);
    reloaded.wrapper.unmount();
  });

  it('ignores native defaults before and during provider initialization', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(true);
    const { wrapper, player, video } = await mountPlayer();
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));
    expect(appStore.videoMuted).toBe(true);

    player.addEventListener('can-play', () => {
      video.muted = false;
      video.dispatchEvent(new Event('volumechange'));
      expect(appStore.videoMuted).toBe(true);
    }, { once: true });
    await initializeVideo(player, video);
    expect(video.muted).toBe(true);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');
    wrapper.unmount();
  });

  it('ignores stale notifications and programmatic synchronization', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(true);
    const { wrapper, player, video } = await mountPlayer();
    await initializeVideo(player, video);
    const trigger = new Event('volumechange');
    video.dispatchEvent(trigger);
    player.dispatchEvent(player.$.createEvent('volume-change', {
      detail: { muted: false, volume: 1 }, trigger
    }));
    expect(appStore.videoMuted).toBe(true);

    appStore.setVideoMuted(false);
    await flushPromises();
    expect(video.muted).toBe(false);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('false');

    const detachedEvent = player.$.createEvent('volume-change', {
      detail: { muted: false, volume: 1 }, trigger
    });
    wrapper.unmount();
    appStore.setVideoMuted(true);
    player.dispatchEvent(detachedEvent);
    expect(appStore.videoMuted).toBe(true);
  });

  it('guards source initialization again and accepts native changes on the new source', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(true);
    const { wrapper, player, video } = await mountPlayer();
    await initializeVideo(player, video);

    Object.defineProperty(video, 'readyState', { configurable: true, value: 0 });
    player.src = { src: '/next-video.mp4', type: 'video/mp4' };
    await flushPromises();
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));
    expect(appStore.videoMuted).toBe(true);

    await initializeVideo(player, video);
    expect(video.muted).toBe(true);
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));
    await flushPromises();
    expect(appStore.videoMuted).toBe(false);
    wrapper.unmount();
  });
});
