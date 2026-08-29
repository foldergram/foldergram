import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchImage, trashImage } from '../api/gallery';
import { useAuthStore } from '../stores/auth';
import { useReelsStore } from '../stores/reels';
import type { FeedItem, FolderSummary, ImageDetail } from '../types/api';
import ReelInfoSidebar from './ReelInfoSidebar.vue';

vi.mock('../api/gallery', () => ({
  fetchImage: vi.fn(),
  trashImage: vi.fn(),
  deleteImage: vi.fn()
}));

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 7,
    folderSlug: 'animal-planet',
    folderName: 'Animal Planet',
    folderPath: 'animals/big-cats',
    folderBreadcrumb: 'Animals / Big Cats',
    filename: `snow-leopard-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 21_000,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.mp4`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id,
    caption: null
  };
}

function createFolder(): FolderSummary {
  return {
    id: 7,
    slug: 'animal-planet',
    name: 'Animal Planet',
    description: 'Wildlife clips from the archive.',
    folderPath: 'animals/big-cats',
    breadcrumb: 'Animals / Big Cats',
    imageCount: 0,
    videoCount: 3,
    latestImageMtimeMs: null,
    avatarImageId: null,
    avatarUrl: null
  };
}

function createImageDetail(id: number): ImageDetail {
  return {
    ...createFeedItem(id),
    caption: 'Snow leopard sprint',
    folderAvatarImageId: null,
    relativePath: `animals/big-cats/snow-leopard-${id}.mp4`,
    mimeType: 'video/mp4',
    fileSize: 24 * 1024 * 1024,
    exif: null,
    originalUrl: `/api/originals/${id}`,
    playbackStrategy: 'preview',
    nextImageId: null,
    previousImageId: null
  };
}

function revokeDeletePermission() {
  const authStore = useAuthStore();
  authStore.capabilities = {
    canManageLibrary: false,
    canDeleteMedia: false,
    canAccessSettings: false,
    canUseSharedLikes: true,
    canUseLocalFavorites: false,
    canUseSharedCollections: true,
    canUseLocalCollections: false
  };
}

describe('ReelInfoSidebar', () => {
  const fetchImageMock = vi.mocked(fetchImage);
  const trashImageMock = vi.mocked(trashImage);

  beforeEach(() => {
    setActivePinia(createPinia());
    fetchImageMock.mockReset();
    trashImageMock.mockReset();
  });

  it('hides the trash action from viewers who cannot delete media', async () => {
    revokeDeletePermission();
    fetchImageMock.mockResolvedValue(createImageDetail(31));

    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: createFeedItem(31),
        folder: createFolder(),
        open: true
      },
      global: {
        stubs: {
          Avatar: { template: '<div data-test="avatar" />' },
          RouterLink: { template: '<a><slot /></a>' }
        }
      }
    });

    await flushPromises();

    expect(wrapper.find('.reels-info-sidebar__delete').exists()).toBe(false);
  });

  it('trashes the reel and closes the panel once the confirmation is accepted', async () => {
    fetchImageMock.mockResolvedValue(createImageDetail(32));
    trashImageMock.mockResolvedValue({ id: 32, folderSlug: 'animal-planet' });

    const reelsStore = useReelsStore();
    reelsStore.$patch({
      items: [createFeedItem(32), createFeedItem(33)],
      activeReelId: 32
    });

    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: createFeedItem(32),
        folder: createFolder(),
        open: true
      },
      global: {
        stubs: {
          Avatar: { template: '<div data-test="avatar" />' },
          RouterLink: { template: '<a><slot /></a>' }
        }
      }
    });

    await flushPromises();
    await wrapper.get('.reels-info-sidebar__delete').trigger('click');
    await flushPromises();

    const confirmButtons = wrapper.findAll('button').filter((button) => button.text() === 'Delete');
    expect(confirmButtons).toHaveLength(1);

    await confirmButtons[0]!.trigger('click');
    await flushPromises();

    expect(trashImageMock).toHaveBeenCalledWith(32);
    expect(reelsStore.items.map((item) => item.id)).toEqual([33]);
    expect(reelsStore.activeReelId).toBe(33);
    expect(wrapper.emitted('close')).toBeTruthy();
  });

  it('loads reel details only when the sidebar is open', async () => {
    fetchImageMock.mockResolvedValue(createImageDetail(11));

    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: createFeedItem(11),
        folder: createFolder(),
        open: false
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    await flushPromises();
    expect(fetchImageMock).not.toHaveBeenCalled();

    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(fetchImageMock).toHaveBeenCalledWith(11, 'video');
    expect(wrapper.text()).toContain('MP4');
    expect(wrapper.text()).toContain('24.00 MB');
    expect(wrapper.text()).toContain('animals/big-cats');
    expect(wrapper.text()).toContain('video/mp4');
  });

  it('reuses cached details when reopening the same reel', async () => {
    fetchImageMock.mockResolvedValue(createImageDetail(14));

    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: createFeedItem(14),
        folder: createFolder(),
        open: true
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    await flushPromises();
    expect(fetchImageMock).toHaveBeenCalledTimes(1);

    await wrapper.setProps({ open: false });
    await flushPromises();
    await wrapper.setProps({ open: true });
    await flushPromises();

    expect(fetchImageMock).toHaveBeenCalledTimes(1);
  });

  it('applies the right-side anchor styling when requested', async () => {
    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: createFeedItem(18),
        folder: createFolder(),
        open: false,
        anchor: 'right'
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    await flushPromises();

    expect(wrapper.get('.reels-info-sidebar').classes()).toContain('reels-info-sidebar--anchor-right');
  });

  it('falls back to the filename when a cleared caption should override cached detail text', async () => {
    fetchImageMock.mockResolvedValue(createImageDetail(21));

    const wrapper = mount(ReelInfoSidebar, {
      props: {
        item: {
          ...createFeedItem(21),
          caption: 'Snow leopard sprint'
        },
        folder: createFolder(),
        open: true
      },
      global: {
        stubs: {
          Avatar: {
            template: '<div data-test="avatar" />'
          },
          RouterLink: {
            template: '<a><slot /></a>'
          }
        }
      }
    });

    await flushPromises();
    expect(wrapper.text()).toContain('Snow leopard sprint');

    await wrapper.setProps({
      item: {
        ...createFeedItem(21),
        caption: null
      }
    });
    await flushPromises();

    expect(wrapper.text()).toContain('snow leopard 21');
    expect(wrapper.text()).not.toContain('Snow leopard sprint');
  });
});
