import { defineComponent, h, reactive } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import type { AppStatus, FeedItem, FolderSummary } from '../types/api';
import { useAppStore } from '../stores/app';
import { useFoldersStore } from '../stores/folders';
import { useReelsStore } from '../stores/reels';
import ReelsView from './ReelsView.vue';

const routeMocks = vi.hoisted(() => ({
  route: { params: {} as Record<string, string>, query: {} as Record<string, string> },
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn()
}));

vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  RouterLink: (await import('@vue/test-utils')).RouterLinkStub,
  useRoute: () => routeMocks.route,
  useRouter: () => ({ push: routeMocks.push, replace: routeMocks.replace, back: routeMocks.back })
}));

const deckControls = vi.hoisted(() => ({
  goToPrevious: vi.fn(),
  goToNext: vi.fn(),
  navigateByWheel: vi.fn(),
  scrollToReel: vi.fn()
}));

vi.mock('../components/ReelDeck.vue', async () => {
  const { defineComponent, h } = await import('vue');

  return {
    default: defineComponent({
      name: 'ReelDeck',
      props: {
        items: {
          type: Array,
          required: true
        },
        folders: {
          type: Array,
          required: true
        },
        activeReelId: {
          type: Number,
          default: null
        },
        loading: {
          type: Boolean,
          default: false
        }
      },
      emits: ['active-change', 'prefetch'],
      setup(props, { emit, expose, slots }) {
        expose({
          goToPrevious: deckControls.goToPrevious,
          goToNext: deckControls.goToNext,
          navigateByWheel: deckControls.navigateByWheel,
          scrollToReel: deckControls.scrollToReel
        });

        const activeItem = () =>
          (props.items.find((item) => item.id === props.activeReelId) as FeedItem | undefined) ?? (props.items[0] as FeedItem | undefined);

        return () =>
          h('div', { 'data-test': 'reel-deck' }, [
            slots['mobile-action-rail']?.({
              item: activeItem(),
              folder: null
            }),
            h(
              'button',
              {
                'data-test': 'emit-active-change',
                onClick: () => emit('active-change', (props.items[1] as FeedItem | undefined)?.id ?? null)
              },
              'emit active change'
            ),
            h(
              'button',
              {
                'data-test': 'emit-prefetch',
                onClick: () => emit('prefetch', 1)
              },
              'emit prefetch'
            )
          ]);
      }
    })
  };
});

vi.mock('../components/ReelActionRail.vue', async () => {
  const { defineComponent } = await import('vue');

  return {
    default: defineComponent({
      name: 'ReelActionRail',
      props: {
        item: {
          type: Object,
          required: true
        },
        infoOpen: {
          type: Boolean,
          default: false
        }
      },
      emits: ['toggle-info'],
      template:
        '<div data-test="action-rail" :data-open="infoOpen ? \'true\' : \'false\'">{{ item.id }}<button data-test="toggle-info" @click="$emit(\'toggle-info\')">toggle</button><slot name="info-panel" /></div>'
    })
  };
});

vi.mock('../components/ReelInfoSidebar.vue', async () => {
  const { defineComponent } = await import('vue');

  return {
    default: defineComponent({
      name: 'ReelInfoSidebar',
      props: {
        item: {
          type: Object,
          required: true
        },
        folder: {
          type: Object,
          default: null
        },
        open: {
          type: Boolean,
          default: false
        },
        anchor: {
          type: String,
          default: 'left'
        }
      },
      emits: ['close'],
      template:
        '<aside data-test="info-sidebar" :data-anchor="anchor">{{ item.id }}<button data-test="close-info" @click="$emit(\'close\')">close</button></aside>'
    })
  };
});

function createAppStatus(): AppStatus {
  return {
    folders: 2,
    indexedImages: 0,
    indexedVideos: 2,
    scan: {
      isScanning: false,
      scanReason: null,
      phase: 'idle',
      startedAt: null,
      runId: null,
      migrationTotalRows: 0,
      processedMigrationRows: 0,
      migratedDerivativeFiles: 0,
      missingDerivativeFiles: 0,
      discoveredFolders: 0,
      processedFolders: 0,
      discoveredImages: 0,
      processedImages: 0,
      queuedDerivativeJobs: 0,
      processedDerivativeJobs: 0,
      generatedThumbnails: 0,
      generatedPreviews: 0,
      currentFolder: null,
      lastCompletedScan: null
    },
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
      defaultReelsFeedMode: 'random'
    }
  };
}

function createFeedItem(id: number, folderSlug: string, folderName: string): FeedItem {
  return {
    id,
    folderId: id,
    folderSlug,
    folderName,
    folderPath: folderSlug,
    folderBreadcrumb: null,
    filename: `reel-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 18_000,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.mp4`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

function createFolder(id: number, slug: string, name: string): FolderSummary {
  return {
    id,
    slug,
    name,
    description: `${name} description`,
    folderPath: slug,
    breadcrumb: null,
    imageCount: 0,
    videoCount: 1,
    latestImageMtimeMs: null,
    avatarImageId: null,
    avatarUrl: null
  };
}

describe('ReelsView', () => {
  beforeEach(() => {
    const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!.get!;
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      if (this.matches('.reels-view__metadata-gutter, .reels-view__details-gutter')) {
        return 280;
      }
      return clientWidth.call(this);
    });
    setActivePinia(createPinia());
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 720
    });
    routeMocks.route = reactive({
      params: {} as Record<string, string>,
      query: {} as Record<string, string>
    });
    routeMocks.push.mockReset();
    routeMocks.replace.mockReset();
    routeMocks.back.mockReset();
    deckControls.goToPrevious.mockReset();
    deckControls.goToNext.mockReset();
    deckControls.navigateByWheel.mockReset();
    deckControls.scrollToReel.mockReset();

    const appStore = useAppStore();
    const foldersStore = useFoldersStore();
    const reelsStore = useReelsStore();

    appStore.$patch({
      stats: createAppStatus()
    });

    foldersStore.$patch({
      items: [createFolder(1, 'alpha', 'Alpha'), createFolder(2, 'beta', 'Beta')]
    });

    reelsStore.$patch({
      items: [createFeedItem(101, 'alpha', 'Alpha'), createFeedItem(202, 'beta', 'Beta')],
      initialized: true,
      loading: false,
      error: null,
      activeReelId: 101,
      hasMore: true
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a directly linked Reel as a standalone page without a Close button', async () => {
    routeMocks.route.params = { id: '202' };
    const reelsStore = useReelsStore();
    const openSpy = vi.spyOn(reelsStore, 'openReel').mockImplementation(async (id) => {
      reelsStore.setActiveReel(id);
      return true;
    });

    const wrapper = mount(ReelsView);
    await flushPromises();

    expect(openSpy).toHaveBeenCalledWith(202);
    expect(deckControls.scrollToReel).toHaveBeenCalledWith(202);
    expect(wrapper.get('.reels-view__action-rail--desktop').text()).toContain('202');

    expect(wrapper.find('.reels-view__close').exists()).toBe(false);
    expect(routeMocks.push).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('shows the minimal Close button only for a Home-backed Reel overlay', async () => {
    routeMocks.route.params = { id: '101' };
    routeMocks.route.query = { from: 'home' };
    useAppStore().setReelModalBackground('/');
    const wrapper = mount(ReelsView);
    await flushPromises();

    const close = wrapper.get('.reels-view__close');
    expect(close.find('svg').exists()).toBe(true);
    await close.trigger('click');
    expect(routeMocks.replace).toHaveBeenCalledWith('/');
    wrapper.unmount();
  });

  it('recovers from an invalid deep link without remounting the viewer', async () => {
    routeMocks.route.params = { id: 'invalid' };
    const reelsStore = useReelsStore();
    const wrapper = mount(ReelsView);
    await flushPromises();

    expect(reelsStore.error).toBe('Invalid Reel ID');
    expect(wrapper.find('.reels-view__message-card').exists()).toBe(true);

    routeMocks.route.params = { id: '202' };
    await flushPromises();
    expect(reelsStore.error).toBeNull();
    expect(reelsStore.activeReelId).toBe(202);
    expect(wrapper.find('.reels-view__message-card').exists()).toBe(false);
    expect(deckControls.scrollToReel).toHaveBeenCalledWith(202);
    wrapper.unmount();
  });

  it('ignores a failed older Reel URL after a successful newer navigation', async () => {
    routeMocks.route.params = { id: '101' };
    const reelsStore = useReelsStore();
    const wrapper = mount(ReelsView);
    await flushPromises();

    let rejectOlder: ((error: Error) => void) | undefined;
    vi.spyOn(reelsStore, 'openReel').mockImplementation((id) => id === 999
      ? new Promise<boolean>((_resolve, reject) => { rejectOlder = reject; })
      : Promise.resolve(true));

    routeMocks.route.params = { id: '999' };
    await flushPromises();
    routeMocks.route.params = { id: '202' };
    await flushPromises();
    rejectOlder?.(new Error('Old video failed'));
    await flushPromises();

    expect(reelsStore.error).toBeNull();
    expect(wrapper.find('.reels-view__message-card').exists()).toBe(false);
    expect(deckControls.scrollToReel).toHaveBeenCalledWith(202);
    wrapper.unmount();
  });

  it('restores scroll URL updates when returning to /reels during a pending deep link', async () => {
    routeMocks.route.params = { id: '101' };
    const reelsStore = useReelsStore();
    const wrapper = mount(ReelsView);
    await flushPromises();

    let resolvePending: ((applied: boolean) => void) | undefined;
    vi.spyOn(reelsStore, 'openReel').mockImplementation(id => id === 99
      ? new Promise<boolean>(resolve => { resolvePending = resolve; })
      : Promise.resolve(true));
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);

    routeMocks.route.params = { id: '99' };
    await flushPromises();
    routeMocks.route.params = {};
    await flushPromises();

    routeMocks.replace.mockClear();
    await wrapper.get('[data-test="emit-active-change"]').trigger('click');
    expect(reelsStore.activeReelId).toBe(202);
    expect(routeMocks.replace).toHaveBeenCalledWith({
      name: 'reels', params: { id: '202' }, query: {}
    });

    resolvePending?.(false);
    await flushPromises();
    expect(reelsStore.activeReelId).toBe(202);
    wrapper.unmount();
  });

  it('updates the deep-link URL when the active Reel changes', async () => {
    routeMocks.route.params = { id: '101' };
    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'openReel').mockResolvedValue(true);
    const wrapper = mount(ReelsView);
    await flushPromises();

    await wrapper.get('[data-test="emit-active-change"]').trigger('click');
    expect(routeMocks.replace).toHaveBeenCalledWith({
      name: 'reels', params: { id: '202' }, query: {}
    });
  });

  it('canonicalizes the Reels feed URL and updates it on navigation', async () => {
    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);
    const wrapper = mount(ReelsView);
    await flushPromises();

    expect(routeMocks.replace).toHaveBeenCalledWith({
      name: 'reels', params: { id: '101' }, query: {}
    });
    routeMocks.replace.mockClear();
    await wrapper.get('[data-test="emit-active-change"]').trigger('click');
    expect(routeMocks.replace).toHaveBeenCalledWith({
      name: 'reels', params: { id: '202' }, query: {}
    });
  });

  it('loads the route view and shows the right rail for the active reel', async () => {
    const reelsStore = useReelsStore();
    const loadInitialSpy = vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);

    const wrapper = mount(ReelsView);
    await flushPromises();

    expect(loadInitialSpy).toHaveBeenCalledTimes(1);
    expect(wrapper.find('[data-test="reel-deck"]').exists()).toBe(true);
    expect(wrapper.get('.reels-view__metadata-title').text()).toBe('Alpha');
    expect(wrapper.get('.reels-view__source-label').text()).toBe('reel-101.mp4');
    expect(wrapper.get('.reels-view__action-rail--desktop').text()).toContain('101');
    expect(wrapper.get('.reels-view__action-rail--desktop').attributes('data-open')).toBe('false');
    expect(wrapper.find('.reels-view__action-rail--mobile').exists()).toBe(false);
    expect(wrapper.find('[data-test="info-shell"]').exists()).toBe(false);
  });

  it('updates the active reel and action rail when the deck emits an active change', async () => {
    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);

    const wrapper = mount(ReelsView);
    await flushPromises();

    await wrapper.get('[data-test="emit-active-change"]').trigger('click');
    await flushPromises();

    expect(reelsStore.activeReelId).toBe(202);
    expect(wrapper.get('.reels-view__metadata-title').text()).toBe('Beta');
    expect(wrapper.get('.reels-view__source-label').text()).toBe('reel-202.mp4');
    expect(wrapper.get('.reels-view__action-rail--desktop').text()).toContain('202');
  });

  it('toggles the info sidebar from the action rail and can close it again', async () => {
    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);

    const wrapper = mount(ReelsView);
    await flushPromises();

    await wrapper.get('.reels-view__action-rail--desktop [data-test="toggle-info"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('.reels-view__action-rail--desktop').attributes('data-open')).toBe('true');
    expect(wrapper.find('[data-test="info-shell"]').exists()).toBe(true);
    expect(wrapper.get('[data-test="info-sidebar"]').text()).toContain('101');
    expect(wrapper.get('[data-test="info-sidebar"]').attributes('data-anchor')).toBe('left');
    expect(wrapper.find('button[aria-label="Next reel"]').exists()).toBe(true);

    await wrapper.get('[data-test="close-info"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('.reels-view__action-rail--desktop').attributes('data-open')).toBe('false');
    expect(wrapper.find('[data-test="info-shell"]').exists()).toBe(false);
  });

  it('opens desktop reel details back over the reel in portrait-style desktop viewports', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 920
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 1280
    });

    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);

    const wrapper = mount(ReelsView);
    await flushPromises();

    await wrapper.get('.reels-view__action-rail--desktop [data-test="toggle-info"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="info-sidebar"]').attributes('data-anchor')).toBe('right');
  });

  it('renders the action rail inside the active reel on mobile viewports', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390
    });

    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);

    const wrapper = mount(ReelsView);
    await flushPromises();

    expect(wrapper.find('.reels-view__action-rail--desktop').exists()).toBe(false);
    expect(wrapper.find('.reels-view__metadata').exists()).toBe(false);
    expect(wrapper.get('.reels-view__action-rail--mobile').text()).toContain('101');

    await wrapper.get('.reels-view__action-rail--mobile [data-test="toggle-info"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('.reels-view__action-rail--mobile').attributes('data-open')).toBe('true');
    expect(wrapper.find('[data-test="info-shell"]').exists()).toBe(true);
  });

  it('delegates deck prefetch and fixed navigation controls', async () => {
    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);
    const prefetchSpy = vi.spyOn(reelsStore, 'prefetchIfNeeded').mockResolvedValue(undefined);

    const wrapper = mount(ReelsView);
    await flushPromises();

    expect(wrapper.get('button[aria-label="Previous reel"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-test="emit-prefetch"]').trigger('click');
    await flushPromises();

    expect(prefetchSpy).toHaveBeenCalledWith(1);

    await wrapper.get('button[aria-label="Next reel"]').trigger('click');
    expect(deckControls.goToNext).toHaveBeenCalledTimes(1);

    reelsStore.setActiveReel(202);
    await flushPromises();

    await wrapper.get('button[aria-label="Previous reel"]').trigger('click');
    expect(deckControls.goToPrevious).toHaveBeenCalledTimes(1);
  });

  it('forwards mouse-wheel scrolling from outside the sidebar into the reel deck only', async () => {
    const reelsStore = useReelsStore();
    vi.spyOn(reelsStore, 'loadInitial').mockResolvedValue(undefined);

    const wrapper = mount(ReelsView, {
      attachTo: document.body
    });
    await flushPromises();

    document.body.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 180,
        bubbles: true,
        cancelable: true
      })
    );

    expect(deckControls.navigateByWheel).toHaveBeenCalledWith(180);

    const sidebar = document.createElement('aside');
    sidebar.className = 'sidebar';
    document.body.appendChild(sidebar);

    sidebar.dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: 220,
        bubbles: true,
        cancelable: true
      })
    );

    expect(deckControls.navigateByWheel).toHaveBeenCalledTimes(1);

    sidebar.remove();
    wrapper.unmount();
  });
});
