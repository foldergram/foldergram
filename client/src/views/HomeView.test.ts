import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { DEFAULT_LOCALE, i18n } from '../locales';
import { useAppStore } from '../stores/app';
import { useFeedStore } from '../stores/feed';
import { useMomentsStore } from '../stores/moments';
import { useSourcesStore } from '../stores/sources';
import type { AppStatus, ScanProgress } from '../types/api';
import HomeView from './HomeView.vue';

const routerLinkStub = defineComponent({
  name: 'RouterLink',
  props: {
    to: {
      type: [String, Object],
      default: null
    }
  },
  template: '<a><slot /></a>'
});

function createScanProgress(overrides: Partial<ScanProgress> = {}): ScanProgress {
  return {
    isScanning: true,
    scanReason: 'startup',
    phase: 'discovery',
    startedAt: '2026-04-03T12:00:00.000Z',
    runId: 1,
    migrationTotalRows: 0,
    processedMigrationRows: 0,
    migratedDerivativeFiles: 0,
    missingDerivativeFiles: 0,
    repairedDerivativeFiles: 0,
    backfilledAssetKeys: 0,
    discoveredFolders: 3,
    processedFolders: 1,
    discoveredImages: 12,
    processedImages: 4,
    queuedDerivativeJobs: 0,
    processedDerivativeJobs: 0,
    generatedThumbnails: 0,
    generatedPreviews: 0,
    currentOperation: 'discovering_media',
    currentFile: null,
    currentPhaseMessage: 'Discovering folders and media...',
    currentFolder: null,
    lastCompletedScan: null,
    ...overrides
  };
}

function createAppStatus(scanOverrides: Partial<ScanProgress> = {}): AppStatus {
  return {
    folders: 0,
    indexedImages: 0,
    indexedVideos: 0,
    scan: createScanProgress(scanOverrides),
    storage: {
      available: true,
      reason: null
    },
    libraryIndex: {
      rebuildRequired: false,
      reason: null,
      ignoredRootMediaCount: 0
    },
    preferences: {
      defaultHomeFeedMode: 'random',
      defaultReelsFeedMode: 'recommended',
      treatStoriesAsFolders: false
    },
    storiesMigration: {
      hasLegacyStoriesCandidates: false,
      decisionPending: false
    }
  };
}

function createMomentCapsule(id: string, title: string) {
  return {
    id,
    title,
    subtitle: `${title} capsule`,
    dateContext: 'Latest Apr 9, 2026',
    imageCount: 1,
    coverImage: {
      id: Number(id.replace(/\D/g, '')) || 1,
      folderId: 10,
      folderSlug: 'weekend-trip',
      folderName: 'Weekend Trip',
      folderPath: 'weekend-trip',
      folderBreadcrumb: null,
      filename: `${id}.jpg`,
      width: 1080,
      height: 1080,
      mediaType: 'image' as const,
      durationMs: null,
      thumbnailUrl: `/thumbs/${id}.webp`,
      previewUrl: `/previews/${id}.webp`,
      sortTimestamp: 1_777_000_000_000,
      takenAt: 1_777_000_000_000
    }
  };
}

function mountHomeView() {
  return mount(HomeView, {
    global: {
      stubs: {
        RouterLink: routerLinkStub,
        Avatar: true,
        EmptyState: true,
        ErrorState: true,
        FeedList: true,
        InfiniteLoader: true,
        StoriesModal: true
      }
    }
  });
}

describe('HomeView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    useSourcesStore().initialized = true;
    i18n.global.locale.value = DEFAULT_LOCALE;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280
    });
  });

  it('shows an Immich connection error with Retry without replacing the local feed', async () => {
    useAppStore().stats = createAppStatus({ isScanning: false });
    vi.spyOn(useFeedStore(), 'loadInitial').mockResolvedValue();
    vi.spyOn(useMomentsStore(), 'fetchMoments').mockResolvedValue();
    const sources = useSourcesStore();
    const feed = useFeedStore();
    feed.$patch({ initialized: true, hasMore: false, items: [createMomentCapsule('local-1', 'Local').coverImage] });
    sources.hasLocalPosts = true;
    sources.items = [{ id: 1, name: 'Family photos', enabled: 1, status: 'ready', generation: 1, updated_at: '', available: false, syncing: false }];
    const wrapper = mountHomeView();
    await flushPromises();
    expect(wrapper.text()).toContain('Immich is unavailable');
    expect(wrapper.text()).toContain('Family photos');
    expect(wrapper.findAll('button').some(button => button.text() === 'Retry')).toBe(true);
    sources.items[0]!.available = true;
    await flushPromises();
    expect(wrapper.text()).not.toContain('Immich is unavailable');
    wrapper.unmount();
  });

  it.each([false, true])('shows a known outage immediately while feed loading is %s, without pagination', async loading => {
    useAppStore().stats = { ...createAppStatus({ isScanning: false }), folders: 15, indexedImages: 237 };
    const feed = useFeedStore();
    feed.loading = loading;
    const initial = vi.spyOn(feed, 'loadInitial').mockResolvedValue();
    const more = vi.spyOn(feed, 'loadMore').mockResolvedValue();
    vi.spyOn(useMomentsStore(), 'fetchMoments').mockResolvedValue();
    const sources = useSourcesStore();
    sources.$patch({ hasLocalPosts: false, items: [{ id: 1, name: 'Immich', enabled: 1, status: 'ready', generation: 1, updated_at: '', available: false, syncing: false }] });
    const wrapper = mountHomeView();
    await flushPromises();
    expect(wrapper.text()).toContain('Immich is unavailable');
    expect(wrapper.find('.home-layout__header').exists()).toBe(false);
    expect(wrapper.find('feed-list-stub').exists()).toBe(false);
    expect(wrapper.find('infinite-loader-stub').exists()).toBe(false);
    expect(initial).not.toHaveBeenCalled();
    expect(more).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('switches unknown availability from skeletons directly to the centered outage before feed completion', async () => {
    useAppStore().stats = { ...createAppStatus({ isScanning: false }), folders: 15, indexedImages: 237 };
    const feed = useFeedStore();
    feed.loading = true;
    vi.spyOn(feed, 'loadInitial').mockResolvedValue();
    vi.spyOn(useMomentsStore(), 'fetchMoments').mockResolvedValue();
    const sources = useSourcesStore();
    sources.initialized = false;
    const wrapper = mountHomeView();
    await flushPromises();
    expect(wrapper.text()).not.toContain('Immich is unavailable');
    expect(wrapper.find('[data-test="home-feed-skeleton"]').exists()).toBe(true);
    expect(wrapper.find('infinite-loader-stub').exists()).toBe(false);

    sources.$patch({ initialized: true, hasLocalPosts: false, items: [{ id: 1, name: 'Immich', enabled: 1, status: 'ready', generation: 1, updated_at: '', available: false, syncing: false }] });
    await flushPromises();
    expect(feed.loading).toBe(true);
    expect(wrapper.text()).toContain('Immich is unavailable');
    expect(wrapper.find('feed-list-stub').exists()).toBe(false);
    expect(wrapper.find('infinite-loader-stub').exists()).toBe(false);
    feed.$patch({ loading: false, initialized: true, hasMore: true });
    await flushPromises();
    expect(wrapper.find('feed-list-stub').exists()).toBe(false);
    wrapper.unmount();
  });

  it('loads the feed after Retry restores a source whose initial load was skipped', async () => {
    useAppStore().stats = { ...createAppStatus({ isScanning: false }), folders: 15, indexedImages: 237 };
    const feed = useFeedStore();
    const initial = vi.spyOn(feed, 'loadInitial').mockImplementation(async () => {
      feed.$patch({ initialized: true, hasMore: false, items: [{ ...createMomentCapsule('remote-1', 'Remote').coverImage, sourceId: 1 }] });
    });
    vi.spyOn(useMomentsStore(), 'fetchMoments').mockResolvedValue();
    const sources = useSourcesStore();
    sources.$patch({ hasLocalPosts: false, items: [{ id: 1, name: 'Immich', enabled: 1, status: 'ready', generation: 1, updated_at: '', available: false, syncing: false }] });
    vi.spyOn(sources, 'refresh').mockImplementation(async () => { sources.items[0]!.available = true; });
    const wrapper = mountHomeView();
    await flushPromises();
    expect(initial).not.toHaveBeenCalled();
    await wrapper.get('button').trigger('click');
    await flushPromises();
    expect(sources.refresh).toHaveBeenCalledWith(true);
    expect(initial).toHaveBeenCalledWith(true);
    expect(wrapper.find('[data-test="source-unavailable"]').exists()).toBe(false);
    expect(wrapper.find('feed-list-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('keeps skeletons alone while finding local posts beyond an offline-source page', async () => {
    useAppStore().stats = { ...createAppStatus({ isScanning: false }), folders: 2, indexedImages: 2 };
    const feed = useFeedStore();
    feed.$patch({ initialized: true, hasMore: true, items: [{ ...createMomentCapsule('remote-1', 'Remote').coverImage, sourceId: 1 }] });
    vi.spyOn(feed, 'loadInitial').mockResolvedValue();
    const more = vi.spyOn(feed, 'loadMore').mockImplementation(async () => { feed.loading = true; });
    vi.spyOn(useMomentsStore(), 'fetchMoments').mockResolvedValue();
    const sources = useSourcesStore();
    sources.$patch({ hasLocalPosts: true, items: [{ id: 1, name: 'Immich', enabled: 1, status: 'ready', generation: 1, updated_at: '', available: false, syncing: false }] });
    const wrapper = mountHomeView();
    await flushPromises();
    expect(more).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).not.toContain('Immich is unavailable');
    expect(wrapper.find('[data-test="home-feed-skeleton"]').exists()).toBe(true);
    expect(wrapper.find('infinite-loader-stub').exists()).toBe(false);
    feed.$patch({ loading: false, hasMore: false, items: [...feed.items, createMomentCapsule('local-2', 'Local').coverImage] });
    await flushPromises();
    expect(wrapper.text()).toContain('Immich is unavailable');
    expect(wrapper.find('[data-test="home-feed-skeleton"]').exists()).toBe(false);
    expect(wrapper.find('.home-layout__header').exists()).toBe(true);
    wrapper.unmount();
  });

  it('replaces an unavailable remote-only feed without showing empty-library or caught-up states', async () => {
    useAppStore().stats = { ...createAppStatus({ isScanning: false }), folders: 1, indexedImages: 1 };
    const feed = useFeedStore();
    feed.$patch({ initialized: true, hasMore: false, items: [{ ...createMomentCapsule('remote-1', 'Remote').coverImage, sourceId: 1 }] });
    vi.spyOn(feed, 'loadInitial').mockResolvedValue();
    vi.spyOn(useMomentsStore(), 'fetchMoments').mockResolvedValue();
    const sources = useSourcesStore();
    sources.items = [{ id: 1, name: 'Immich', enabled: 1, status: 'ready', generation: 1, updated_at: '', available: false, syncing: false }];
    const wrapper = mountHomeView();
    await flushPromises();
    expect(wrapper.text()).toContain('Reconnecting automatically');
    expect(wrapper.find('.home-layout__header').exists()).toBe(false);
    expect(wrapper.find('infinite-loader-stub').exists()).toBe(false);
    expect(wrapper.find('empty-state-stub').exists()).toBe(false);
    sources.items[0]!.available = true;
    await flushPromises();
    expect(wrapper.find('.home-layout__header').exists()).toBe(true);
    expect(wrapper.find('infinite-loader-stub').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows an explicit startup scan phase badge and updates it with the current phase', async () => {
    const appStore = useAppStore();
    const feedStore = useFeedStore();
    const momentsStore = useMomentsStore();

    appStore.$patch({
      stats: createAppStatus()
    });

    vi.spyOn(feedStore, 'loadInitial').mockResolvedValue();
    vi.spyOn(momentsStore, 'fetchMoments').mockResolvedValue();

    const wrapper = mountHomeView();

    await flushPromises();

    expect(wrapper.get('[data-test="initial-scan-phase"]').text()).toBe('Discovery');

    appStore.$patch({
      stats: createAppStatus({
        phase: 'derivatives',
        queuedDerivativeJobs: 12,
        processedDerivativeJobs: 5,
        currentOperation: 'generating_thumbnail_and_preview',
        currentPhaseMessage: 'Generating thumbnails and previews for queued changes.'
      })
    });

    await flushPromises();

    expect(wrapper.get('[data-test="initial-scan-phase"]').text()).toBe('Derivatives');
  });

  it('renders the home stories rail with a dedicated horizontal scroll track', async () => {
    const appStore = useAppStore();
    const feedStore = useFeedStore();
    const momentsStore = useMomentsStore();

    appStore.$patch({
      stats: createAppStatus({
        isScanning: false
      })
    });
    feedStore.$patch({
      initialized: true,
      loading: false,
      items: []
    });
    momentsStore.$patch({
      items: [
        createMomentCapsule('moment-1', 'One'),
        createMomentCapsule('moment-2', 'Two'),
        createMomentCapsule('moment-3', 'Three'),
        createMomentCapsule('moment-4', 'Four')
      ]
    });

    vi.spyOn(feedStore, 'loadInitial').mockResolvedValue();
    vi.spyOn(momentsStore, 'fetchMoments').mockResolvedValue();

    const wrapper = mountHomeView();

    await flushPromises();

    expect(wrapper.get('.stories-bar.story-rail').attributes('aria-label')).toBe('Moments');
    expect(wrapper.get('.story-rail__track').classes()).not.toContain('justify-center');
    expect(wrapper.findAll('.story-rail__item')).toHaveLength(4);
  });

  it('localizes static highlight capsule titles on the home rail', async () => {
    const appStore = useAppStore();
    const feedStore = useFeedStore();
    const momentsStore = useMomentsStore();

    i18n.global.locale.value = 'zh';

    appStore.$patch({
      stats: createAppStatus({
        isScanning: false
      })
    });
    feedStore.$patch({
      initialized: true,
      loading: false,
      items: []
    });
    momentsStore.$patch({
      railKind: 'highlights',
      items: [
        createMomentCapsule('highlight-recent-batches', 'Recent Batches')
      ]
    });

    vi.spyOn(feedStore, 'loadInitial').mockResolvedValue();
    vi.spyOn(momentsStore, 'fetchMoments').mockResolvedValue();

    const wrapper = mountHomeView();

    await flushPromises();

    expect(wrapper.text()).toContain('近期批次');
  });
});
