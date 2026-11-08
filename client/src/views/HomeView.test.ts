import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { DEFAULT_LOCALE, i18n } from '../locales';
import { useAppStore } from '../stores/app';
import { useFeedStore } from '../stores/feed';
import { useMomentsStore } from '../stores/moments';
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
    i18n.global.locale.value = DEFAULT_LOCALE;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280
    });
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