import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { reactive } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCALE, i18n } from '../locales';
import type { FeedItem, RailCapsule, RailViewerStoreContract } from '../types/api';
import { useAppStore } from '../stores/app';
import StoriesModal from './StoriesModal.vue';

function createImageItem(id: number): FeedItem {
  return {
    id,
    folderId: 91,
    folderSlug: 'animal-planet',
    folderName: 'Animal Planet',
    folderPath: 'animal-planet',
    folderBreadcrumb: null,
    filename: `story-${id}.jpg`,
    width: 1080,
    height: 1920,
    mediaType: 'image',
    durationMs: null,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createVideoItem(id: number): FeedItem {
  return {
    id,
    folderId: 91,
    folderSlug: 'animal-planet',
    folderName: 'Animal Planet',
    folderPath: 'animal-planet',
    folderBreadcrumb: null,
    filename: `story-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 12_000,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.mp4`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createCapsule(id: string, title: string, item: FeedItem, latestActivityTimestamp?: number | null): RailCapsule {
  return {
    id,
    title,
    subtitle: 'Recent story set',
    dateContext: 'Latest Mar 28, 2026',
    imageCount: 1,
    coverImage: item,
    ...(latestActivityTimestamp !== undefined ? { latestActivityTimestamp } : {})
  };
}

function createStore(capsules: RailCapsule[], imagesByCapsuleId: Record<string, FeedItem[]>) {
  return reactive<RailViewerStoreContract>({
    currentCapsule: null,
    currentImages: [],
    currentHasMore: false,
    async loadCapsule(id: string) {
      const capsule = capsules.find((entry) => entry.id === id) ?? null;
      if (!capsule) {
        return;
      }

      this.currentCapsule = capsule;
      this.currentImages = imagesByCapsuleId[id] ?? [];
      this.currentHasMore = false;
    }
  });
}

function readSegmentScaleX(wrapper: ReturnType<typeof mount>) {
  const style = wrapper.get('.story-stage__progress-fill').attributes('style') ?? '';
  const match = /scaleX\(([^)]+)\)/.exec(style);
  return match ? Number(match[1]) : Number.NaN;
}

function getActiveStage(wrapper: ReturnType<typeof mount>) {
  return wrapper.get('article.story-stage');
}

function getActiveStageTitle(wrapper: ReturnType<typeof mount>) {
  return getActiveStage(wrapper).get('.story-stage__header-main strong').text();
}

function mockVideoPlaybackState(video: HTMLVideoElement, options: { duration: number; currentTime?: number }) {
  let currentTime = options.currentTime ?? 0;
  let duration = options.duration;

  Object.defineProperty(video, 'currentTime', {
    configurable: true,
    get: () => currentTime,
    set: (value: number) => {
      currentTime = value;
    }
  });

  Object.defineProperty(video, 'duration', {
    configurable: true,
    get: () => duration
  });

  return {
    setCurrentTime(value: number) {
      currentTime = value;
    },
    setDuration(value: number) {
      duration = value;
    }
  };
}

function mockStoryAnimationFrames(stepMs: number) {
  let autoplayNow = 0;

  vi.spyOn(performance, 'now').mockImplementation(() => autoplayNow);
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) =>
    window.setTimeout(() => {
      autoplayNow += stepMs;
      callback(autoplayNow);
    }, 0)
  );
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((handle: number) => {
    window.clearTimeout(handle);
  });
}

describe('StoriesModal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setActivePinia(createPinia());
    i18n.global.locale.value = DEFAULT_LOCALE;
    const appStore = useAppStore();
    appStore.$patch({
      videoMuted: true,
      stats: null
    });

    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  it('renders an actual video element for video story items in the shared rail viewer', async () => {
    const videoItem = createVideoItem(401);
    const capsule = createCapsule('home-stories', 'Home Stories', videoItem);
    const store = createStore([capsule], {
      [capsule.id]: [videoItem]
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [capsule],
        initialId: capsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();

    const video = wrapper.get('video.story-stage__video');
    expect(video.attributes('src')).toBe(videoItem.previewUrl);
    expect(video.attributes('poster')).toBe(videoItem.thumbnailUrl);
    expect(wrapper.find('img[data-test="resilient-image"]').exists()).toBe(false);
    expect((video.element as HTMLVideoElement).muted).toBe(true);

    useAppStore().setVideoMuted(false);
    await flushPromises();
    expect((video.element as HTMLVideoElement).muted).toBe(false);

    useAppStore().setVideoMuted(true);
    await flushPromises();
    expect((video.element as HTMLVideoElement).muted).toBe(true);
    wrapper.unmount();
  });

  it('renders a download-original control and updates it when the active capsule changes', async () => {
    const firstItem = createVideoItem(451);
    const secondItem = createVideoItem(452);
    const firstCapsule = createCapsule('capsule-download-one', 'Download One', firstItem);
    const secondCapsule = createCapsule('capsule-download-two', 'Download Two', secondItem);
    const store = createStore([firstCapsule, secondCapsule], {
      [firstCapsule.id]: [firstItem],
      [secondCapsule.id]: [secondItem]
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [firstCapsule, secondCapsule],
        initialId: firstCapsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();

    expect(wrapper.get('a[aria-label="Download original file"]').attributes('href')).toBe('/api/originals/451?download=1');

    await wrapper.get('.story-stage__pager--right').trigger('click');
    await flushPromises();

    expect(wrapper.get('a[aria-label="Download original file"]').attributes('href')).toBe('/api/originals/452?download=1');
  });

  it('keeps the next arrow enabled on the last item when another capsule exists and advances into it', async () => {
    const firstItem = createVideoItem(501);
    const secondItem = createVideoItem(502);
    const firstCapsule = createCapsule('capsule-one', 'First Stories', firstItem);
    const secondCapsule = createCapsule('capsule-two', 'Second Stories', secondItem);
    const store = createStore([firstCapsule, secondCapsule], {
      [firstCapsule.id]: [firstItem],
      [secondCapsule.id]: [secondItem]
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [firstCapsule, secondCapsule],
        initialId: firstCapsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();

    const nextButton = wrapper.get('.story-stage__pager--right');
    expect(nextButton.attributes('disabled')).toBeUndefined();

    await nextButton.trigger('click');
    await flushPromises();

    expect(getActiveStageTitle(wrapper)).toBe('Second Stories');
    expect(getActiveStage(wrapper).get('video.story-stage__video').attributes('src')).toBe(secondItem.previewUrl);
  });

  it('autoplay advances image stories into the next capsule when the current capsule finishes', async () => {
    vi.useFakeTimers();
    mockStoryAnimationFrames(5_000);

    const firstItem = createImageItem(601);
    const secondItem = createImageItem(602);
    const firstCapsule = createCapsule('capsule-autoplay-one', 'Autoplay One', firstItem);
    const secondCapsule = createCapsule('capsule-autoplay-two', 'Autoplay Two', secondItem);
    const store = createStore([firstCapsule, secondCapsule], {
      [firstCapsule.id]: [firstItem],
      [secondCapsule.id]: [secondItem]
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [firstCapsule, secondCapsule],
        initialId: firstCapsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();
    await vi.runAllTimersAsync();
    await flushPromises();

    expect(getActiveStageTitle(wrapper)).toBe('Autoplay Two');
    expect(getActiveStage(wrapper).find('video.story-stage__video').exists()).toBe(false);
    expect(getActiveStage(wrapper).find('img[data-test="resilient-image"]').exists()).toBe(true);

    vi.useRealTimers();
  });

  it('uses the active video duration for story progress and waits for ended before advancing', async () => {
    vi.useFakeTimers();

    const firstItem = createVideoItem(611);
    const secondItem = createVideoItem(612);
    const firstCapsule = createCapsule('capsule-video-one', 'Video One', firstItem);
    const secondCapsule = createCapsule('capsule-video-two', 'Video Two', secondItem);
    const store = createStore([firstCapsule, secondCapsule], {
      [firstCapsule.id]: [firstItem],
      [secondCapsule.id]: [secondItem]
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [firstCapsule, secondCapsule],
        initialId: firstCapsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();

    const video = wrapper.get('video.story-stage__video').element as HTMLVideoElement;
    const playback = mockVideoPlaybackState(video, {
      duration: 12,
      currentTime: 0
    });

    video.dispatchEvent(new Event('loadedmetadata'));
    await flushPromises();

    playback.setCurrentTime(6);
    video.dispatchEvent(new Event('timeupdate'));
    await flushPromises();

    expect(readSegmentScaleX(wrapper)).toBeCloseTo(0.5, 3);

    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();

    expect(getActiveStageTitle(wrapper)).toBe('Video One');

    video.dispatchEvent(new Event('ended'));
    await flushPromises();

    expect(getActiveStageTitle(wrapper)).toBe('Video Two');

    vi.useRealTimers();
  });

  it('freezes and resumes image-story progress when playback is paused and resumed', async () => {
    vi.useFakeTimers();
    mockStoryAnimationFrames(1_000);

    const imageItem = createImageItem(621);
    const capsule = createCapsule('capsule-pause', 'Pause Stories', imageItem);
    const store = createStore([capsule], {
      [capsule.id]: [imageItem]
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [capsule],
        initialId: capsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();
    await vi.runOnlyPendingTimersAsync();
    await flushPromises();

    await vi.runOnlyPendingTimersAsync();
    await flushPromises();

    const progressBeforePause = readSegmentScaleX(wrapper);
    expect(progressBeforePause).toBeGreaterThan(0);

    await wrapper.get('button[aria-label="Pause playback"]').trigger('click');
    await flushPromises();

    await vi.advanceTimersByTimeAsync(5_000);
    await flushPromises();

    expect(readSegmentScaleX(wrapper)).toBeCloseTo(progressBeforePause, 3);

    await wrapper.get('button[aria-label="Resume playback"]').trigger('click');
    await flushPromises();

    await vi.runOnlyPendingTimersAsync();
    await flushPromises();

    expect(readSegmentScaleX(wrapper)).toBeGreaterThan(progressBeforePause);

    vi.useRealTimers();
  });

  it('shows capsule load errors in the viewer and retries the active capsule', async () => {
    const videoItem = createVideoItem(701);
    const capsule = createCapsule('capsule-error', 'Error Stories', videoItem);
    const loadCapsule = vi.fn();
    let shouldFail = true;
    const store = reactive<RailViewerStoreContract>({
      currentCapsule: null,
      currentImages: [],
      currentHasMore: false,
      currentError: null,
      async loadCapsule(id: string) {
        loadCapsule(id);
        this.currentCapsule = capsule;
        this.currentImages = [videoItem];
        this.currentHasMore = false;
        this.currentError = shouldFail ? 'Unable to load this story capsule' : null;
        shouldFail = false;
      }
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [capsule],
        initialId: capsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();

    expect(wrapper.text()).toContain('Unable to load this story capsule');

    await wrapper.get('button.story-stage__error-button').trigger('click');
    await flushPromises();

    expect(loadCapsule).toHaveBeenCalledTimes(2);
    expect(loadCapsule).toHaveBeenLastCalledWith(capsule.id);
    expect(wrapper.text()).not.toContain('Unable to load this story capsule');
  });

  it('localizes story meta and footer dates with the active app locale', async () => {
    i18n.global.locale.value = 'zh';

    const imageItem = createImageItem(801);
    const latestActivityTimestamp = new Date('2026-03-28T12:00:00.000Z').getTime();
    const capsule = createCapsule('capsule-localized-meta', 'Tigers', imageItem, latestActivityTimestamp);
    const store = createStore([capsule], {
      [capsule.id]: [imageItem]
    });

    const wrapper = mount(StoriesModal, {
      props: {
        items: [capsule],
        initialId: capsule.id,
        railSingularLabel: 'Story',
        store
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          ResilientImage: {
            template: '<img data-test="resilient-image" />'
          }
        }
      }
    });

    await flushPromises();

    const expectedStoryDate = new Intl.DateTimeFormat('zh', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(latestActivityTimestamp));
    const expectedFooterDate = new Intl.DateTimeFormat('zh', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(new Date(imageItem.takenAt ?? imageItem.sortTimestamp));

    expect(wrapper.text()).toContain(`1 项 · 最新 ${expectedStoryDate}`);
    expect(wrapper.text()).toContain(expectedFooterDate);
    expect(wrapper.text()).not.toContain('1 items · Latest');
  });
});
