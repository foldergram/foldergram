import { defineComponent } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../api/gallery';
import { useFoldersStore } from '../stores/folders';
import { useAppStore } from '../stores/app';
import type { AppStatus, FolderSummary, ImageDetail } from '../types/api';
import { useViewerStore } from '../stores/viewer';
import PostView from './PostView.vue';

const { routerReplace } = vi.hoisted(() => ({ routerReplace: vi.fn() }));

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => ({
      query: {}
    }),
    useRouter: () => ({
      replace: routerReplace
    })
  };
});

vi.mock('../components/PostViewer.vue', async () => {
  const { defineComponent } = await import('vue');

  return {
    default: defineComponent({
      name: 'PostViewer',
      props: {
        folder: Object,
        image: {
          type: Object,
          required: true
        }
      },
      template: '<div data-test="post-viewer">{{ image.id }}</div>'
    })
  };
});

vi.mock('../components/ErrorState.vue', async () => {
  const { defineComponent } = await import('vue');

  return {
    default: defineComponent({
      name: 'ErrorState',
      props: {
        title: String,
        message: String
      },
      template: '<div data-test="error-state">{{ title }} {{ message }}</div>'
    })
  };
});

vi.mock('../components/ConfirmDialog.vue', async () => {
  const { defineComponent } = await import('vue');

  return {
    default: defineComponent({
      name: 'ConfirmDialog',
      template: '<div data-test="confirm-dialog"><slot /><slot name="details" /></div>'
    })
  };
});

function createImageDetail(id: number): ImageDetail {
  return {
    id,
    folderId: 7,
    folderSlug: 'peopleplanet',
    folderName: 'PeoplePlanet',
    folderPath: 'PeoplePlanet',
    folderBreadcrumb: null,
    filename: `image-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    isAnimated: false,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id,
    folderAvatarImageId: null,
    relativePath: `PeoplePlanet/image-${id}.jpg`,
    mimeType: 'image/jpeg',
    fileSize: 123_456,
    exif: null,
    originalUrl: `/api/originals/${id}`,
    playbackStrategy: null,
    previousImageId: null,
    nextImageId: null
  };
}

describe('PostView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    routerReplace.mockReset();
    setActivePinia(createPinia());
  });

  it('does not render the previously loaded post while a new modal image is loading', async () => {
    const viewerStore = useViewerStore();
    viewerStore.$patch({
      image: createImageDetail(1),
      loading: false,
      deleting: false,
      error: null
    });

    let resolveLoad: (() => void) | null = null;
    vi.spyOn(viewerStore, 'loadImage').mockImplementation(async (id: number) => {
      viewerStore.loading = true;
      viewerStore.error = null;

      await new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });

      viewerStore.image = createImageDetail(id);
      viewerStore.loading = false;
    });

    const wrapper = mount(PostView, {
      props: {
        id: '2',
        modal: true
      },
      global: {
        stubs: {
          Transition: false
        }
      }
    });

    expect(wrapper.find('[data-test="post-viewer"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('Loading post...');

    resolveLoad?.();
    await flushPromises();

    expect(wrapper.get('[data-test="post-viewer"]').text()).toBe('2');
    wrapper.unmount();
  });
  it.each(['currentFolder', 'cache', 'server'])('resolves the post folder outside recommendations from %s', async (source) => {
    const summary: FolderSummary = { id: 7, slug: 'peopleplanet', name: 'PeoplePlanet', description: null,
      folderPath: 'PeoplePlanet', breadcrumb: null, imageCount: 1, videoCount: 0,
      latestImageMtimeMs: 1, avatarImageId: 90, avatarUrl: '/thumbnails/90.webp' };
    const folders = useFoldersStore();
    if (source === 'currentFolder') folders.currentFolder = summary;
    if (source === 'cache') folders.summaryBySlug[summary.slug] = summary;
    const fetch = vi.spyOn(api, 'fetchFolder').mockResolvedValue(summary);
    const viewer = useViewerStore();
    vi.spyOn(viewer, 'loadImage').mockImplementation(async (id) => { viewer.image = createImageDetail(id); });
    const wrapper = mount(PostView, { props: { id: '90' } });
    await flushPromises();
    expect(wrapper.findComponent({ name: 'PostViewer' }).props('folder')).toMatchObject({ slug: summary.slug, avatarUrl: summary.avatarUrl });
    expect(fetch).toHaveBeenCalledTimes(source === 'server' ? 1 : 0);
    wrapper.unmount();
  });

  it('shows the folder avatar when recommendations finish before the viewer folder lookup', async () => {
    const summary: FolderSummary = { id: 7, slug: 'peopleplanet', name: 'PeoplePlanet', description: null,
      folderPath: 'PeoplePlanet', breadcrumb: null, imageCount: 1, videoCount: 0,
      latestImageMtimeMs: 1, avatarImageId: 90, avatarUrl: '/thumbnails/90.webp' };
    let resolveDirectory!: (value: { items: FolderSummary[]; page: number; limit: number; total: number; hasMore: boolean }) => void;
    let resolveSummary!: (folder: FolderSummary) => void;
    vi.spyOn(api, 'fetchFolderDirectory').mockReturnValue(new Promise((resolve) => { resolveDirectory = resolve; }));
    vi.spyOn(api, 'fetchFolder').mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));
    const folders = useFoldersStore();
    const bootstrap = folders.fetchFolders();
    const viewer = useViewerStore();
    vi.spyOn(viewer, 'loadImage').mockImplementation(async (id) => { viewer.image = createImageDetail(id); });
    const wrapper = mount(PostView, { props: { id: '90' } });
    try {
      await flushPromises();
      expect(api.fetchFolder).toHaveBeenCalledWith(summary.slug);
      resolveDirectory({ items: [], page: 1, limit: 24, total: 140, hasMore: true });
      await bootstrap;
      resolveSummary(summary);
      await flushPromises();
      expect(wrapper.findComponent({ name: 'PostViewer' }).props('folder')).toMatchObject({
        slug: summary.slug, avatarUrl: summary.avatarUrl
      });
    } finally {
      wrapper.unmount();
    }
  });

  it('returns a standalone viewer to Library after deleting the last post outside recommendations', async () => {
    const folders = useFoldersStore();
    folders.total = 140;
    const summary: FolderSummary = { id: 7, slug: 'peopleplanet', name: 'PeoplePlanet', description: null,
      folderPath: 'PeoplePlanet', breadcrumb: null, imageCount: 1, videoCount: 0,
      latestImageMtimeMs: 1, avatarImageId: 90, avatarUrl: '/thumbnails/90.webp' };
    let resolveSummary!: (folder: FolderSummary) => void;
    vi.spyOn(api, 'fetchFolder').mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));
    vi.spyOn(api, 'trashImage').mockResolvedValue({ ok: true, id: 90, folderSlug: 'peopleplanet' });
    const viewer = useViewerStore();
    vi.spyOn(viewer, 'loadImage').mockImplementation(async (id) => { viewer.image = createImageDetail(id); });
    useAppStore().stats = { folders: 140, indexedImages: 140, indexedVideos: 0 } as AppStatus;
    const wrapper = mount(PostView, { props: { id: '90' } });
    await flushPromises();
    wrapper.findComponent({ name: 'PostViewer' }).vm.$emit('delete');
    await flushPromises();
    wrapper.findComponent({ name: 'ConfirmDialog' }).vm.$emit('confirm');
    await flushPromises();
    expect(api.trashImage).not.toHaveBeenCalled();
    expect(viewer.deleting).toBe(true);
    expect(api.fetchFolder).toHaveBeenCalledTimes(1);
    resolveSummary(summary);
    await flushPromises();
    expect(api.trashImage).toHaveBeenCalledWith(90);
    expect(routerReplace).toHaveBeenCalledWith({ name: 'library' });
    expect(folders.total).toBe(139);
    expect(useAppStore().stats?.folders).toBe(139);
    wrapper.unmount();
  });

});
