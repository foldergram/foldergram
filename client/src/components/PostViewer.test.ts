import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FeedItem, ImageDetail } from '../types/api';
import { useAppStore } from '../stores/app';
import { useFoldersStore } from '../stores/folders';
import { useImmersiveVideoStore } from '../stores/immersive-video';
import { useLikesStore } from '../stores/likes';
import PostViewer from './PostViewer.vue';

const mockRouterPush = vi.fn();
const mockRouterResolve = vi.fn();

vi.mock('vidstack/bundle', () => ({}));
vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => ({
      query: {}
    }),
    useRouter: () => ({
      push: mockRouterPush,
      resolve: mockRouterResolve
    })
  };
});

class FakeMediaPlayerElement extends HTMLElement {
  muted = true;
  paused = true;
  playCallCount = 0;
  pauseCallCount = 0;
  currentTime = 0;
  duration = 0;

  async play() {
    this.playCallCount += 1;
    this.paused = false;
    this.dispatchEvent(new Event('play'));
  }

  async pause() {
    this.pauseCallCount += 1;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
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

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 7,
    folderSlug: 'animal-planet',
    folderName: 'AnimalPlanet',
    folderPath: 'animal-planet',
    folderBreadcrumb: null,
    filename: `post-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    isAnimated: false,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createImageDetail(id: number, options: { previousImageId: number | null; nextImageId: number | null }): ImageDetail {
  const item = createFeedItem(id);

  return {
    ...item,
    folderAvatarImageId: null,
    relativePath: `${item.folderSlug}/${item.filename}`,
    mimeType: 'image/jpeg',
    fileSize: 123_456,
    exif: null,
    originalUrl: `/api/originals/${id}`,
    playbackStrategy: null,
    previousImageId: options.previousImageId,
    nextImageId: options.nextImageId
  };
}

function createVideoDetail(id: number): ImageDetail {
  return {
    id,
    folderId: 7,
    folderSlug: 'animal-planet',
    folderName: 'AnimalPlanet',
    folderPath: 'animal-planet',
    folderBreadcrumb: null,
    filename: `clip-${id}.mp4`,
    width: 1920,
    height: 1080,
    mediaType: 'video',
    durationMs: 9_000,
    isAnimated: false,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.mp4`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id,
    folderAvatarImageId: null,
    relativePath: `animal-planet/clip-${id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: 987_654,
    exif: null,
    originalUrl: `/api/originals/${id}`,
    playbackStrategy: 'preview',
    previousImageId: null,
    nextImageId: null
  };
}

/**
 * A clip the browser cannot decode directly, so the default source is the HLS
 * stream and the HD control can offer the untouched file as an upgrade.
 */
function createHdVideoDetail(id: number): ImageDetail {
  return {
    ...createVideoDetail(id),
    playbackStrategy: 'preview',
    streamUrl: `/api/videos/${id}/hls/master.m3u8`
  };
}

const globalStubs = {
  Avatar: {
    template: '<div data-test="avatar" />'
  },
  ResilientImage: {
    template: '<img data-test="resilient-image" />'
  },
  RouterLink: {
    inheritAttrs: false,
    props: ['to'],
    template: '<a v-bind="$attrs" :data-to="JSON.stringify(to)"><slot /></a>'
  }
};

describe('PostViewer', () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    setActivePinia(createPinia());
    mockRouterPush.mockReset();
    mockRouterResolve.mockReset();
    mockRouterResolve.mockImplementation((path: string) => ({
      name: path === '/likes/posts' ? 'likes' : 'folder'
    }));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('uses likes-page neighbors instead of folder neighbors when opened from likes', () => {
    const appStore = useAppStore();
    const likesStore = useLikesStore();

    appStore.setImageModalBackground('/likes/posts');
    likesStore.syncFromItems([createFeedItem(11), createFeedItem(12), createFeedItem(13)], 'shared');

    const wrapper = mount(PostViewer, {
      props: {
        image: createImageDetail(12, {
          previousImageId: null,
          nextImageId: 99
        }),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    expect(wrapper.get('a[aria-label="Previous post"]').attributes('data-to')).toContain('"id":"11"');
    expect(wrapper.get('a[aria-label="Next post"]').attributes('data-to')).toContain('"id":"13"');
    expect(wrapper.text()).toContain('Folder Path');
    expect(wrapper.text()).toContain('animal-planet/post-12.jpg');
  });

  it('shows the cover action for videos and uses the current item id when setting cover', async () => {
    const foldersStore = useFoldersStore();
    const setFolderCoverSpy = vi.spyOn(foldersStore, 'setFolderCover').mockResolvedValue();

    const wrapper = mount(PostViewer, {
      props: {
        image: createVideoDetail(21),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    const coverButton = wrapper.get('button[aria-label="Set as folder cover"]');
    expect(coverButton.attributes('title')).toBe('Set as folder cover');

    await coverButton.trigger('click');

    expect(setFolderCoverSpy).toHaveBeenCalledWith('animal-planet', 21);
  });

  it('renders a download-original control beside the open-original action', () => {
    const wrapper = mount(PostViewer, {
      props: {
        image: createImageDetail(18, {
          previousImageId: null,
          nextImageId: null
        }),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    const downloadLink = wrapper.get('a[aria-label="Download original file"]');
    const originalLink = wrapper.get('a[aria-label="Open original file"]');

    expect(downloadLink.attributes('href')).toBe('/api/originals/18?download=1');
    expect(downloadLink.attributes('title')).toBe('Download original file');
    expect(originalLink.attributes('href')).toBe('/api/originals/18');
    expect(originalLink.attributes('title')).toBe('Open original file');
  });

  it('opens the immersive layer from stage clicks and pauses the inline player', async () => {
    const wrapper = mount(PostViewer, {
      props: {
        image: createVideoDetail(22),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const immersiveVideoStore = useImmersiveVideoStore();
    const player = wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
    expect(player.playCallCount).toBeGreaterThanOrEqual(1);
    expect(player.paused).toBe(false);
    expect(wrapper.find('.viewer__pause-indicator').exists()).toBe(false);

    player.currentTime = 6.5;
    await wrapper.get('.viewer__media-shell--video').trigger('click');
    await flushPromises();

    expect(immersiveVideoStore.isOpen).toBe(true);
    expect(immersiveVideoStore.target?.id).toBe(22);
    expect(immersiveVideoStore.startTime).toBe(6.5);
    expect(player.paused).toBe(true);

    immersiveVideoStore.close({ id: 22, currentTime: 11, paused: false });
    await flushPromises();

    expect(player.currentTime).toBe(11);
    expect(player.playCallCount).toBeGreaterThanOrEqual(2);
    expect(player.paused).toBe(false);
  });

  it('renders the bottom progress UI and keeps slider clicks from toggling viewer playback', async () => {
    const wrapper = mount(PostViewer, {
      props: {
        image: createVideoDetail(24),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
    expect(wrapper.find('media-time-slider').exists()).toBe(true);
    expect(wrapper.get('.video-progress-footer__time').text()).toBe('0:00 / 0:09');

    await wrapper.get('media-time-slider').trigger('click');
    await flushPromises();

    expect(player.pauseCallCount).toBe(0);

    player.dispatchEvent(new CustomEvent('time-update', {
      detail: {
        currentTime: 8,
        played: { length: 0, start: () => 0, end: () => 0 }
      }
    }));
    await flushPromises();

    expect(wrapper.get('.video-progress-footer__time').text()).toBe('0:08 / 0:09');

    player.dispatchEvent(new Event('ended'));
    await flushPromises();

    expect(wrapper.get('.video-progress-footer__time').text()).toBe('0:09 / 0:09');
  });

  it('preserves the playback position when switching between the stream and the HD original', async () => {
    const wrapper = mount(PostViewer, {
      props: {
        image: createHdVideoDetail(25),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    await flushPromises();

    const player = wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
    player.currentTime = 4.25;
    player.paused = false;

    await wrapper.get('button[aria-label="Switch to HD original"]').trigger('click');
    await flushPromises();

    player.dispatchEvent(new Event('loaded-metadata'));
    await flushPromises();

    expect(player.currentTime).toBe(4.25);
    expect(player.playCallCount).toBeGreaterThanOrEqual(2);
  });

  it('shows the paused indicator when autoplay is blocked on load', async () => {
    const wrapper = mount(PostViewer, {
      props: {
        image: createVideoDetail(23),
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    const player = wrapper.get('media-player').element as unknown as FakeMediaPlayerElement;
    player.play = vi.fn(async () => {
      player.playCallCount += 1;
      player.paused = true;
      throw new Error('Autoplay blocked');
    });

    await flushPromises();

    expect(player.playCallCount).toBeGreaterThanOrEqual(1);
    expect(player.paused).toBe(true);
    expect(wrapper.find('.viewer__pause-indicator').exists()).toBe(true);
  });

  it('shows an inline caption edit button in the summary instead of the footer actions', () => {
    const wrapper = mount(PostViewer, {
      props: {
        image: {
          ...createImageDetail(26, {
            previousImageId: null,
            nextImageId: null
          }),
          caption: 'Custom field note'
        },
        isModal: true
      },
      global: {
        stubs: globalStubs
      }
    });

    expect(wrapper.get('.viewer__sidebar-summary button[aria-label="Edit caption"]').exists()).toBe(true);
    expect(wrapper.find('.viewer__sidebar-actions button[aria-label="Edit caption"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Custom field note');
  });

  it('does not navigate to another image when arrow keys are pressed inside the caption editor', async () => {
    const wrapper = mount(PostViewer, {
      props: {
        image: {
          ...createImageDetail(27, {
            previousImageId: 26,
            nextImageId: 28
          }),
          caption: 'Night market notes'
        },
        isModal: true
      },
      attachTo: document.body,
      global: {
        stubs: globalStubs
      }
    });

    await wrapper.get('.viewer__sidebar-summary button[aria-label="Edit caption"]').trigger('click');
    await flushPromises();

    const textarea = document.getElementById('post-caption');
    expect(textarea).not.toBeNull();

    textarea!.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true
    }));
    await flushPromises();

    expect(mockRouterPush).not.toHaveBeenCalled();
  });
});
