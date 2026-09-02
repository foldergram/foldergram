import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useImmersiveVideoStore } from '../stores/immersive-video';
import type { FeedItem } from '../types/api';
import FolderGrid from './FolderGrid.vue';

vi.mock('vue-router', async () => {
  const actual = await vi.importActual<typeof import('vue-router')>('vue-router');

  return {
    ...actual,
    useRoute: () => ({ fullPath: '/likes/posts', query: {} })
  };
});

function createVideoItem(id: number): FeedItem {
  return {
    id,
    folderId: 4,
    folderSlug: 'clips',
    folderName: 'Clips',
    folderPath: 'clips',
    folderBreadcrumb: null,
    filename: `clip-${id}.mp4`,
    width: 720,
    height: 1280,
    mediaType: 'video',
    durationMs: 8_000,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    streamUrl: `/api/videos/${id}/hls/master.m3u8`,
    sortTimestamp: id,
    takenAt: null
  };
}

function mountGrid(item: FeedItem, navigate: () => void, sharedSlug: string | null = null) {
  return mount(FolderGrid, {
    props: { items: [item], sharedSlug },
    global: {
      stubs: {
        ResilientImage: { template: '<img />' },
        RouterLink: {
          props: { custom: { type: Boolean, default: false }, to: { type: null, default: null } },
          template: '<span><slot href="#" :navigate="navigate" /></span>',
          setup: () => ({ navigate })
        }
      }
    }
  });
}

describe('FolderGrid', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens a tapped video in the immersive player instead of the post route', async () => {
    const videoStore = useImmersiveVideoStore();
    const navigate = vi.fn();
    const wrapper = mountGrid(createVideoItem(52), navigate);

    await wrapper.get('a').trigger('click', { button: 0 });

    expect(videoStore.isOpen).toBe(true);
    expect(videoStore.target?.id).toBe(52);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps shared-folder tiles on their own route', async () => {
    const videoStore = useImmersiveVideoStore();
    const navigate = vi.fn();
    // A guest has no access to the library-wide media routes the immersive layer uses.
    const wrapper = mountGrid(createVideoItem(53), navigate, 'guest-token');

    await wrapper.get('a').trigger('click', { button: 0 });

    expect(videoStore.isOpen).toBe(false);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
