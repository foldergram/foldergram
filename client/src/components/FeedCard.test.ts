import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MediaStorage } from 'vidstack';

import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import type { FeedItem } from '../types/api';
import FeedCard from './FeedCard.vue';
import FeedList from './FeedList.vue';
import CarouselMediaStage from './CarouselMediaStage.vue';
import ReelPlayerCard from './ReelPlayerCard.vue';

vi.mock('vidstack/bundle', () => ({}));
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => ({
      fullPath: '/',
      query: {}
    })
  };
});

class FakeMediaPlayerElement extends HTMLElement {
  storage: MediaStorage | null = null;
  muted = true;
  volume = 1;
  paused = true;
  playCallCount = 0;
  pauseCallCount = 0;
  currentTime = 0;
  duration = 0;

  async restoreProviderSettings() {
    // Vidstack restores settings after notifying can-play listeners.
    this.dispatchEvent(new Event('can-play'));
    await flushPromises();
    this.muted = (await this.storage?.getMuted()) ?? false;
    this.dispatchEvent(new CustomEvent('volume-change', { detail: { muted: this.muted, volume: 1 } }));
  }

  async play() {
    this.playCallCount += 1;
    this.paused = false;
  }

  async pause() {
    this.pauseCallCount += 1;
    this.paused = true;
  }
}

class FakeMediaProviderElement extends HTMLElement {}
class FakeMediaPosterElement extends HTMLElement {}
class FakeMediaControlsElement extends HTMLElement {}
class FakeMediaControlsGroupElement extends HTMLElement {}
class FakeMediaPlayButtonElement extends HTMLElement {}
class FakeMediaMuteButtonElement extends HTMLElement {}
class FakeMediaFullscreenButtonElement extends HTMLElement {}
class FakeMediaTimeSliderElement extends HTMLElement {}

if (!customElements.get('media-player')) {
  customElements.define('media-player', FakeMediaPlayerElement);
}

if (!customElements.get('media-provider')) {
  customElements.define('media-provider', FakeMediaProviderElement);
}

if (!customElements.get('media-poster')) {
  customElements.define('media-poster', FakeMediaPosterElement);
}

if (!customElements.get('media-controls')) {
  customElements.define('media-controls', FakeMediaControlsElement);
}

if (!customElements.get('media-controls-group')) {
  customElements.define('media-controls-group', FakeMediaControlsGroupElement);
}

if (!customElements.get('media-play-button')) {
  customElements.define('media-play-button', FakeMediaPlayButtonElement);
}

if (!customElements.get('media-mute-button')) {
  customElements.define('media-mute-button', FakeMediaMuteButtonElement);
}

if (!customElements.get('media-fullscreen-button')) {
  customElements.define('media-fullscreen-button', FakeMediaFullscreenButtonElement);
}

if (!customElements.get('media-time-slider')) {
  customElements.define('media-time-slider', FakeMediaTimeSliderElement);
}

function createVideoItem(id: number): FeedItem {
  return {
    id,
    folderId: 15,
    folderSlug: 'phone-clips',
    folderName: 'Phone Clips',
    folderPath: 'phone-clips',
    folderBreadcrumb: null,
    filename: `clip-${id}.mp4`,
    width: 1920,
    height: 1080,
    mediaType: 'video',
    durationMs: 31_000,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.mp4`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createImageItem(id: number): FeedItem {
  return {
    id,
    folderId: 15,
    folderSlug: 'phone-clips',
    folderName: 'Phone Clips',
    folderPath: 'phone-clips',
    folderBreadcrumb: null,
    filename: `photo-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

const globalStubs = {
  Avatar: {
    template: '<div data-test="avatar" />'
  },
  ConfirmDialog: {
    template: '<div data-test="confirm-dialog" />'
  },
  ResilientImage: {
    template: '<img data-test="resilient-image" />'
  },
  RouterLink: {
    props: ['custom', 'to'],
    template: `
      <template v-if="custom">
        <span class="router-link-stub" :data-to="typeof to === 'string' ? to : JSON.stringify(to)">
          <slot href="#" :navigate="() => {}" />
        </span>
      </template>
      <a v-else v-bind="$attrs" :data-to="typeof to === 'string' ? to : JSON.stringify(to)"><slot /></a>
    `
  }
};

describe('FeedCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
  });

  it('keeps the saved mute preference through provider initialization and a page reload', async () => {
    window.localStorage.setItem('foldergram-video-muted', 'true');
    useAppStore().initializeVideoMuted();

    for (const id of [901, 902]) {
      const wrapper = mount(FeedCard, {
        props: { item: createVideoItem(id), avatarUrl: null, context: 'home', isActiveVideo: true },
        global: { stubs: globalStubs }
      });
      await flushPromises();
      const player = wrapper.get('media-player').element as FakeMediaPlayerElement;
      await player.restoreProviderSettings();

      expect(player.muted).toBe(true);
      expect(useAppStore().videoMuted).toBe(true);
      expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');
      wrapper.unmount();

      setActivePinia(createPinia());
      useAppStore().initializeVideoMuted();
    }
  });

  it('applies sound requests to already mounted videos when they finish loading', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(false);
    const mountVideo = (id: number, active: boolean) => mount(FeedCard, {
      props: { item: createVideoItem(id), avatarUrl: null, context: 'home', isActiveVideo: active },
      global: { stubs: globalStubs }
    });
    const first = mountVideo(903, true);
    const next = mountVideo(904, false);
    await flushPromises();

    first.get('media-mute-button').element.dispatchEvent(new Event('media-mute-request', { bubbles: true }));
    await flushPromises();
    expect(appStore.videoMuted).toBe(true);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');

    const nextPlayer = next.get('media-player').element as FakeMediaPlayerElement;
    await next.setProps({ isActiveVideo: true });
    await nextPlayer.restoreProviderSettings();
    expect(nextPlayer.muted).toBe(true);

    nextPlayer.volume = 0;
    next.get('media-mute-button').element.dispatchEvent(new Event('media-unmute-request', { bubbles: true }));
    await flushPromises();
    await nextPlayer.restoreProviderSettings();
    expect(nextPlayer.muted).toBe(false);
    expect(nextPlayer.volume).toBeGreaterThan(0);
    expect(appStore.videoMuted).toBe(false);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('false');
    first.unmount();
    next.unmount();
  });

  it('does not save delayed provider volume events as the user preference', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(true);
    const wrapper = mount(FeedCard, {
      props: { item: createVideoItem(905), avatarUrl: null, context: 'home', isActiveVideo: true },
      global: { stubs: globalStubs }
    });
    await flushPromises();
    const player = wrapper.get('media-player').element as FakeMediaPlayerElement;
    await player.restoreProviderSettings();
    await new Promise(requestAnimationFrame);
    player.muted = false;
    player.dispatchEvent(new CustomEvent('volume-change', { detail: { muted: false, volume: 1 } }));
    await flushPromises();

    expect(appStore.videoMuted).toBe(true);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');
    wrapper.unmount();
  });

  it('keeps sound enabled when the browser blocks audible autoplay', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(false);
    const wrapper = mount(FeedCard, {
      props: { item: createVideoItem(906), avatarUrl: null, context: 'home', isActiveVideo: false },
      global: { stubs: globalStubs }
    });
    await flushPromises();
    const player = wrapper.get('media-player').element as FakeMediaPlayerElement;
    const play = vi.spyOn(player, 'play').mockRejectedValue(new Error('Autoplay blocked'));
    await wrapper.setProps({ isActiveVideo: true });
    await flushPromises();

    expect(player.muted).toBe(false);
    expect(appStore.videoMuted).toBe(false);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('false');
    expect(play).toHaveBeenCalledTimes(1);
    expect(wrapper.find('.feed-card__pause-indicator').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shares a single sound preference between feed, reel, and carousel players', async () => {
    const appStore = useAppStore();
    appStore.setVideoMuted(false);
    const item = createVideoItem(907);
    const wrapper = mount({
      components: { FeedCard, ReelPlayerCard, CarouselMediaStage },
      setup: () => ({
        item,
        mediaItems: [{ ...item, imageId: item.id, position: 1, originalUrl: `/api/originals/${item.id}` }]
      }),
      template: `
        <FeedCard :item="item" :avatar-url="null" context="home" :is-active-video="true" />
        <ReelPlayerCard :item="item" :folder="null" :active="false" />
        <CarouselMediaStage :items="mediaItems" />
      `
    }, {
      global: { stubs: globalStubs }
    });
    await flushPromises();
    const feed = wrapper.getComponent(FeedCard);
    const reel = wrapper.getComponent(ReelPlayerCard);
    const carousel = wrapper.getComponent(CarouselMediaStage);
    const players = [feed, reel, carousel].map(wrapper => wrapper.get('media-player').element as FakeMediaPlayerElement);

    await feed.get('media-player').trigger('media-mute-request');
    expect(players.map(player => player.muted)).toEqual([true, true, true]);

    await reel.get('.reel-player-card__sound-button').trigger('click');
    expect(players.map(player => player.muted)).toEqual([false, false, false]);

    await carousel.get('media-player').trigger('media-mute-request');
    expect(players.map(player => player.muted)).toEqual([true, true, true]);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('true');
    wrapper.unmount();
  });

  it('updates the home video aspect ratio from the loaded video element when metadata disagrees with indexed dimensions', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        item: createVideoItem(804),
        avatarUrl: null,
        context: 'home',
        isActiveVideo: false
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
    const container = player.parentElement as HTMLElement;

    expect(container.style.aspectRatio).toBe('1920 / 1080');

    const video = document.createElement('video');
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      value: 1080
    });
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      value: 1920
    });
    player.appendChild(video);
    player.dispatchEvent(new Event('loaded-metadata'));

    await flushPromises();

    expect(container.style.aspectRatio).toBe('1080 / 1920');
  });

  it('toggles playback from home-feed video clicks and shows the paused indicator', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        item: createVideoItem(805),
        avatarUrl: null,
        context: 'home',
        isActiveVideo: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
    expect(player.playCallCount).toBeGreaterThanOrEqual(1);
    expect(player.paused).toBe(false);
    expect(wrapper.find('.feed-card__pause-indicator').exists()).toBe(false);

    await wrapper.get('.feed-card__video-shell').trigger('click');
    await flushPromises();

    expect(player.pauseCallCount).toBe(1);
    expect(player.paused).toBe(true);
    expect(wrapper.find('.feed-card__pause-indicator').exists()).toBe(true);

    await wrapper.get('.feed-card__video-shell').trigger('click');
    await flushPromises();

    expect(player.playCallCount).toBeGreaterThanOrEqual(2);
    expect(player.paused).toBe(false);
    expect(wrapper.find('.feed-card__pause-indicator').exists()).toBe(false);
  });

  it.each([-1000, 1000])('pauses an audible video scrolled out of view at %ipx after leaving fullscreen', async (offscreenTop) => {
    const observers: FeedVideoObserver[] = [];
    class FeedVideoObserver {
      target: Element | null = null;
      constructor(private callback: IntersectionObserverCallback) {
        observers.push(this);
      }
      observe(target: Element) { this.target = target; }
      disconnect() { this.target = null; }
      unobserve() { this.target = null; }
      report(ratio: number, top = 0) {
        if (!this.target) throw new Error('Video visibility observer is disconnected');
        this.callback([{
          target: this.target,
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
          boundingClientRect: { top, height: 400 }
        } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
    }
    vi.stubGlobal('IntersectionObserver', FeedVideoObserver);
    const appStore = useAppStore();
    appStore.setVideoMuted(false);
    const wrapper = mount(FeedList, {
      props: { items: [createVideoItem(8052), createVideoItem(8053)], context: 'home' },
      global: { stubs: globalStubs }
    });
    await flushPromises();

    const [player, nextPlayer] = wrapper.findAll('media-player').map(node => node.element as FakeMediaPlayerElement);
    const nextObserver = observers.find(entry => entry.target === nextPlayer.parentElement)!;
    let observer = observers.find(entry => entry.target === player.parentElement)!;
    observer.report(0.9);
    await flushPromises();
    expect(player.paused).toBe(false);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      const changeFullscreen = async (fullscreen: boolean) => {
        // Vidstack's DOMEvent extends Event, not CustomEvent, and its attribute can lag behind detail.
        const event = new Event('fullscreen-change');
        Object.defineProperty(event, 'detail', { value: fullscreen });
        player.dispatchEvent(event);
        player.toggleAttribute('data-fullscreen', fullscreen);
        await flushPromises();
      };
      await changeFullscreen(true);
      expect(observer.target).toBeNull();
      expect(player.paused).toBe(false);

      await changeFullscreen(false);
      observer = observers.at(-1)!;
      expect(observer.target).toBe(player.parentElement);
      observer.report(0.9);
      await flushPromises();

      observer.report(0, offscreenTop);
      nextObserver.report(0.9);
      await flushPromises();
      expect(player.paused).toBe(true);
      expect(nextPlayer.paused).toBe(false);
      expect(player.muted).toBe(false);
      expect(appStore.videoMuted).toBe(false);

      nextObserver.report(0, -offscreenTop);
      observer.report(0.9);
      await flushPromises();
      expect(player.paused).toBe(false);
      expect(nextPlayer.paused).toBe(true);
    }
    wrapper.unmount();
  });

  it('renders the bottom progress UI and keeps slider clicks from pausing the home video', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        item: createVideoItem(8051),
        avatarUrl: null,
        context: 'home',
        isActiveVideo: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
    expect(wrapper.find('media-time-slider').exists()).toBe(true);
    expect(wrapper.get('.video-progress-footer__time').text()).toBe('0:00 / 0:31');

    await wrapper.get('media-time-slider').trigger('click');
    await flushPromises();

    expect(player.pauseCallCount).toBe(0);

    player.dispatchEvent(new CustomEvent('time-update', {
      detail: {
        currentTime: 30,
        played: { length: 0, start: () => 0, end: () => 0 }
      }
    }));
    await flushPromises();

    expect(wrapper.get('.video-progress-footer__time').text()).toBe('0:30 / 0:31');

    player.dispatchEvent(new Event('ended'));
    await flushPromises();

    expect(wrapper.get('.video-progress-footer__time').text()).toBe('0:31 / 0:31');
  });

  it('renders a story ring on the home avatar and emits an in-place story open event', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        item: createVideoItem(806),
        avatarUrl: null,
        hasAvatarStory: true,
        context: 'home',
        isActiveVideo: false
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const avatarButton = wrapper.get('button[aria-label="Open Phone Clips stories"]');
    expect(avatarButton.exists()).toBe(true);
    expect(avatarButton.attributes('title')).toBe('Open Phone Clips stories');

    await avatarButton.trigger('click');

    expect(wrapper.emitted('openFolderStory')).toEqual([['phone-clips']]);
  });

  it('exposes native tooltip titles on the feed card icon controls', async () => {
    const wrapper = mount(FeedCard, {
      props: {
        item: createImageItem(807),
        avatarUrl: null,
        context: 'home',
        isActiveVideo: false
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    expect(wrapper.get('button[aria-label="More options"]').attributes('title')).toBe('More options');
    expect(wrapper.get('button[aria-label="Like post"]').attributes('title')).toBe('Like post');
    expect(wrapper.get('a[aria-label="Open post"]').attributes('title')).toBe('Open post');
    const postRouteLink = wrapper
      .findAll('a[data-to]')
      .find((candidate) => candidate.attributes('data-to')?.includes('"name":"image"'));

    expect(postRouteLink?.attributes('data-to')).toContain('"name":"image"');
    expect(postRouteLink?.attributes('data-to')).toContain('"id":"807"');
    expect(wrapper.get('a[aria-label="Open folder"]').attributes('title')).toBe('Open folder');

    const downloadLink = wrapper.get('a[aria-label="Download original file"]');

    expect(downloadLink.attributes('href')).toBe('/api/originals/807?download=1');
    expect(downloadLink.attributes('title')).toBe('Download original file');

    const originalLink = wrapper.get('a[aria-label="Open original file"]');

    expect(originalLink.attributes('href')).toBe('/api/originals/807');
    expect(originalLink.attributes('title')).toBe('Open original file');
  });

  it('falls back to a readable filename when the caption is not customized', () => {
    const wrapper = mount(FeedCard, {
      props: {
        item: {
          ...createImageItem(808),
          filename: 'road_trip-shot.jpg',
          caption: null
        },
        avatarUrl: null
      },
      global: {
        stubs: globalStubs
      }
    });

    expect(wrapper.text()).toContain('road trip shot');
  });

  it('renders a custom caption when present', () => {
    const wrapper = mount(FeedCard, {
      props: {
        item: {
          ...createImageItem(809),
          caption: 'Sunrise over the bay'
        },
        avatarUrl: null
      },
      global: {
        stubs: globalStubs
      }
    });

    expect(wrapper.text()).toContain('Sunrise over the bay');
    expect(wrapper.text()).not.toContain('photo 809');
  });

  it('shows the edit-caption menu action only for library managers', async () => {
    const authStore = useAuthStore();
    const wrapper = mount(FeedCard, {
      props: {
        item: createImageItem(810),
        avatarUrl: null
      },
      global: {
        stubs: globalStubs
      }
    });

    await wrapper.get('button[aria-label="More options"]').trigger('click');
    expect(wrapper.text()).toContain('Edit caption');

    authStore.capabilities = {
      canManageLibrary: false,
      canDeleteMedia: false,
      canAccessSettings: false,
      canUseSharedLikes: true,
      canUseLocalFavorites: false,
      canUseSharedCollections: true,
      canUseLocalCollections: false
    };

    const restrictedWrapper = mount(FeedCard, {
      props: {
        item: createImageItem(811),
        avatarUrl: null
      },
      global: {
        stubs: globalStubs
      }
    });

    await restrictedWrapper.get('button[aria-label="More options"]').trigger('click');
    expect(restrictedWrapper.text()).not.toContain('Edit caption');
  });
});
