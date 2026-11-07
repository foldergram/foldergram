import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { computed, defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, RouterView, useRoute, useRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useFolderStoriesStore } from '../stores/folder-stories';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import type { FeedItem, FolderSummary, LikesMode } from '../types/api';
import FolderView from './FolderView.vue';

vi.mock('../api/gallery', async importOriginal => ({
  ...await importOriginal<typeof import('../api/gallery')>(),
  likeImage: vi.fn().mockResolvedValue({}),
  unlikeImage: vi.fn().mockResolvedValue({})
}));

function createFeedItem(id: number, folderSlug = 'animal-planet'): FeedItem {
  return {
    id,
    folderId: folderSlug === 'animal-planet' ? 1 : 2,
    folderSlug,
    folderName: folderSlug,
    folderPath: folderSlug,
    folderBreadcrumb: null,
    filename: `post-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    isAnimated: false,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: id,
    takenAt: id
  };
}

const folder: FolderSummary = {
  id: 1,
  slug: 'animal-planet',
  name: 'Animal Planet',
  description: null,
  folderPath: 'animal-planet',
  breadcrumb: null,
  imageCount: 4,
  videoCount: 0,
  latestImageMtimeMs: 123,
  avatarImageId: null,
  avatarUrl: null
};

// Keep the folder mounted behind post routes, as App.vue does for the modal.
const modalBackgroundHarness = defineComponent({
  setup() {
    const route = useRoute();
    const router = useRouter();
    const appStore = useAppStore();
    const displayRoute = computed(() => route.name === 'image' && appStore.imageModalBackgroundPath
      ? router.resolve(appStore.imageModalBackgroundPath)
      : route);

    return () => h(RouterView, { route: displayRoute.value });
  }
});

async function mountFolder(items: FeedItem[], path = '/f/animal-planet?tab=likes&keep=1', mode: LikesMode = 'shared') {
  const pinia = createPinia();
  setActivePinia(pinia);
  useAuthStore().$patch({ likesMode: mode });
  const likesStore = useLikesStore();
  likesStore.syncFromItems(items, mode);
  likesStore.initialized = true;
  const foldersStore = useFoldersStore();
  vi.spyOn(foldersStore, 'loadFolder').mockImplementation(async () => {
    foldersStore.currentFolder = folder;
    foldersStore.currentImages = [createFeedItem(11), createFeedItem(12), createFeedItem(13), createFeedItem(99)];
    foldersStore.currentHasMore = false;
  });
  vi.spyOn(useFolderStoriesStore(), 'fetchStories').mockResolvedValue();
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/f/:slug', name: 'folder', component: FolderView, props: true },
      { path: '/post/:id', name: 'image', component: defineComponent({ render: () => h('div') }) }
    ]
  });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(modalBackgroundHarness, {
    global: {
      plugins: [pinia, router],
      stubs: {
        FolderHeader: true,
        StoriesModal: true,
        Avatar: true,
        InfiniteLoader: true,
        FolderGrid: {
          props: ['items'],
          template: '<div data-test="folder-grid">{{ items.map(item => item.id).join(",") }}</div>'
        }
      }
    }
  });
  await flushPromises();

  return { wrapper, router, likesStore };
}

describe('FolderView Likes tab', () => {
  enableAutoUnmount(afterEach);
  beforeEach(() => vi.restoreAllMocks());

  it('shows only likes for the current folder and keeps Likes selected after closing a post', async () => {
    const { wrapper, router } = await mountFolder([
      createFeedItem(11), createFeedItem(100, 'other-folder'), createFeedItem(13)
    ]);
    expect(wrapper.get('[data-test="folder-grid"]').text()).toBe('11,13');

    const backgroundPath = router.currentRoute.value.fullPath;
    useAppStore().setImageModalBackground(backgroundPath);
    await router.push({ name: 'image', params: { id: '11' }, query: router.currentRoute.value.query });
    await flushPromises();
    await router.replace(backgroundPath);
    await flushPromises();

    expect(router.currentRoute.value.query.tab).toBe('likes');
    expect(wrapper.get('button[aria-label="Likes"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-test="folder-grid"]').text()).toBe('11,13');
  });

  it.each<LikesMode>(['shared', 'local'])('returns to Posts after the final %s like is removed in the modal', async mode => {
    const { wrapper, router, likesStore } = await mountFolder([
      createFeedItem(11), createFeedItem(100, 'other-folder')
    ], undefined, mode);
    const backgroundPath = router.currentRoute.value.fullPath;
    useAppStore().setImageModalBackground(backgroundPath);
    await router.push({ name: 'image', params: { id: '11' }, query: router.currentRoute.value.query });
    await flushPromises();

    await likesStore.toggleLike(createFeedItem(11));
    await flushPromises();

    expect(router.currentRoute.value.name).toBe('image');
    expect(wrapper.find('button[aria-label="Likes"], button[aria-label="Favorites"]').exists()).toBe(false);
    expect(likesStore.items.map(item => item.id)).toEqual([100]);

    await router.replace(backgroundPath);
    await flushPromises();

    expect(router.currentRoute.value.query).toEqual({ keep: '1' });
    expect(wrapper.get('button[aria-label="Posts"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-test="folder-grid"]').text()).toBe('11,12,13,99');
  });

  it('shows Likes for the first liked post and hides it when the last is unliked on the folder route', async () => {
    const { wrapper, router, likesStore } = await mountFolder([createFeedItem(100, 'other-folder')], '/f/animal-planet');
    expect(wrapper.find('button[aria-label="Likes"]').exists()).toBe(false);

    await likesStore.toggleLike(createFeedItem(11));
    await flushPromises();
    await wrapper.get('button[aria-label="Likes"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-test="folder-grid"]').text()).toBe('11');

    await likesStore.toggleLike(createFeedItem(11));
    await flushPromises();

    expect(wrapper.find('button[aria-label="Likes"]').exists()).toBe(false);
    expect(router.currentRoute.value.query.tab).toBeUndefined();
    expect(wrapper.get('button[aria-label="Posts"]').attributes('aria-pressed')).toBe('true');
  });
});
