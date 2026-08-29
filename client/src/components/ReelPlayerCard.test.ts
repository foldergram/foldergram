import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useAppStore } from '../stores/app';
import { useImmersiveVideoStore } from '../stores/immersive-video';
import type { FeedItem, FolderSummary } from '../types/api';
import ReelPlayerCard from './ReelPlayerCard.vue';

vi.mock('vidstack/bundle', () => ({}));

let nextPlayFailures = 0;

class FakeMediaPlayerElement extends HTMLElement {
  muted = true;
  paused = true;
  playCallCount = 0;
  pauseCallCount = 0;
  src: unknown = null;

  async play() {
    this.playCallCount += 1;

    if (nextPlayFailures > 0) {
      nextPlayFailures -= 1;
      this.paused = true;
      throw new Error('Autoplay blocked');
    }

    this.paused = false;
  }

  async pause() {
    this.pauseCallCount += 1;
    this.paused = true;
  }
}

class FakeMediaProviderElement extends HTMLElement {}
class FakeMediaPosterElement extends HTMLElement {}
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

if (!customElements.get('media-time-slider')) {
  customElements.define('media-time-slider', FakeMediaTimeSliderElement);
}

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 77,
    folderSlug: 'animal-planet',
    folderName: 'Animal Planet',
    folderPath: 'animal-planet',
    folderBreadcrumb: null,
    filename: `reel-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 21_000,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.mp4`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createFolder(): FolderSummary {
  return {
    id: 77,
    slug: 'animal-planet',
    name: 'Animal Planet',
    description: 'Wildlife clips',
    folderPath: 'animal-planet',
    breadcrumb: null,
    imageCount: 0,
    videoCount: 3,
    latestImageMtimeMs: null,
    avatarImageId: null,
    avatarUrl: null
  };
}

function getPlayerElement(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
}

const globalStubs = {
  Avatar: {
    template: '<div data-test="avatar" />'
  },
  RouterLink: {
    props: ['to'],
    template: '<a data-test="folder-link"><slot /></a>'
  }
};

describe('ReelPlayerCard', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    nextPlayFailures = 0;
    const appStore = useAppStore();
    appStore.$patch({
      videoMuted: true
    });
    window.localStorage.clear();
  });

  it('shows the overlay only for the active reel', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(1),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();
    expect(wrapper.get('.reel-player-card__overlay').classes()).toContain('reel-player-card__overlay--visible');

    await wrapper.setProps({
      active: false
    });
    await flushPromises();

    expect(wrapper.get('.reel-player-card__overlay').classes()).not.toContain('reel-player-card__overlay--visible');
  });

  it('renders mobile action content inside the overlay controls', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(8),
        folder: createFolder(),
        active: true
      },
      slots: {
        'mobile-action-rail': '<div data-test="mobile-action-rail">actions</div>'
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    expect(wrapper.find('.reel-player-card__mobile-actions [data-test="mobile-action-rail"]').exists()).toBe(true);
  });

  it('shows a short folder path plus filename in the overlay copy', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: {
          ...createFeedItem(9),
          folderPath: 'OnePlus5T/Videos',
          filename: 'filename.mp4'
        },
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    expect(wrapper.get('.reel-player-card__folder-description').text()).toBe('Videos/filename.mp4');
  });

  it('pauses in place instead of opening the immersive layer when the reel surface is tapped', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(2),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const immersiveVideoStore = useImmersiveVideoStore();
    const player = getPlayerElement(wrapper);
    expect(wrapper.get('media-player').attributes('load')).toBe('eager');
    expect(player.playCallCount).toBeGreaterThanOrEqual(1);
    expect(player.paused).toBe(false);
    expect(wrapper.find('.reel-player-card__pause-indicator').exists()).toBe(false);

    await wrapper.get('.reel-player-card__surface').trigger('click');
    await flushPromises();

    // The deck already fills the screen, so there is nothing to escalate to.
    expect(immersiveVideoStore.isOpen).toBe(false);
    expect(player.paused).toBe(true);
    expect(wrapper.find('.reel-player-card__pause-indicator').exists()).toBe(true);

    await wrapper.get('.reel-player-card__surface').trigger('click');
    await flushPromises();

    expect(player.paused).toBe(false);
    expect(wrapper.find('.reel-player-card__pause-indicator').exists()).toBe(false);
  });

  it('offers a landscape toggle on the active reel', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(31),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const rotateButton = wrapper
      .findAll('.reel-player-card__playback-button')
      .find((button) => button.attributes('aria-label') === 'Rotate to landscape');

    expect(rotateButton).toBeDefined();
    expect(rotateButton?.attributes('aria-pressed')).toBe('false');
  });

  it('toggles playback from the dedicated play button', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(22),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = getPlayerElement(wrapper);
    expect(player.paused).toBe(false);

    await wrapper.get('.reel-player-card__playback-button').trigger('click');
    await flushPromises();

    expect(player.pauseCallCount).toBe(1);
    expect(player.paused).toBe(true);
    expect(wrapper.find('.reel-player-card__pause-indicator').exists()).toBe(true);

    await wrapper.get('.reel-player-card__playback-button').trigger('click');
    await flushPromises();

    expect(player.paused).toBe(false);
    expect(wrapper.find('.reel-player-card__pause-indicator').exists()).toBe(false);
  });

  it('keeps seek-bar interaction from toggling reel playback', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(12),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = getPlayerElement(wrapper);
    expect(player.pauseCallCount).toBe(0);

    await wrapper.get('.reel-player-card__seekbar-track').trigger('click');
    await flushPromises();

    expect(player.pauseCallCount).toBe(0);
    expect(player.paused).toBe(false);
    expect(wrapper.find('.reel-player-card__pause-indicator').exists()).toBe(false);
  });

  it('persists the mute preference for the current reel and later reels', async () => {
    const appStore = useAppStore();
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(3),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    await wrapper.get('.reel-player-card__sound-button').trigger('click');
    await flushPromises();

    const firstPlayer = getPlayerElement(wrapper);
    expect(appStore.videoMuted).toBe(false);
    expect(firstPlayer.muted).toBe(false);
    expect(wrapper.get('.reel-player-card__sound-button').attributes('aria-label')).toBe('Mute sound');

    wrapper.unmount();

    const nextWrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(4),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const secondPlayer = getPlayerElement(nextWrapper);
    expect(appStore.videoMuted).toBe(false);
    expect(secondPlayer.muted).toBe(false);
    expect(nextWrapper.get('.reel-player-card__sound-button').attributes('aria-label')).toBe('Mute sound');
  });

  it('falls back to the original video when preview autoplay keeps failing', async () => {
    vi.useFakeTimers();
    nextPlayFailures = 4;

    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(7),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    await vi.advanceTimersByTimeAsync(1_000);
    await flushPromises();

    const player = getPlayerElement(wrapper);
    expect((player.src as { src?: string } | null)?.src).toBe('/api/originals/7');
    expect(player.playCallCount).toBeGreaterThan(1);

    vi.useRealTimers();
  });

  it('falls back to visible loading when the reel is inactive', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(6),
        folder: createFolder(),
        active: false
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    expect(wrapper.get('media-player').attributes('load')).toBe('visible');
  });

  it('makes the folder overlay clickable without toggling playback', async () => {
    const wrapper = mount(ReelPlayerCard, {
      props: {
        item: createFeedItem(5),
        folder: createFolder(),
        active: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = getPlayerElement(wrapper);
    expect(player.pauseCallCount).toBe(0);
    expect(wrapper.find('[data-test="folder-link"]').exists()).toBe(true);

    await wrapper.get('[data-test="folder-link"]').trigger('click');
    await flushPromises();

    expect(player.pauseCallCount).toBe(0);
    expect(wrapper.find('.reel-player-card__pause-indicator').exists()).toBe(false);
  });
});
