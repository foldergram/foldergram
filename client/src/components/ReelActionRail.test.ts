import { defineComponent, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useAuthStore } from '../stores/auth';
import { useLikesStore } from '../stores/likes';
import type { FeedItem } from '../types/api';
import ReelActionRail from './ReelActionRail.vue';

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

describe('ReelActionRail', () => {
  beforeEach(() => {
    setActivePinia(createPinia());

    const authStore = useAuthStore();
    authStore.$patch({
      likesMode: 'local',
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: false,
        canUseLocalFavorites: true,
        canUseSharedCollections: false,
        canUseLocalCollections: true
      }
    });

    window.localStorage.clear();
  });

  it('does not bubble like clicks to a parent container', async () => {
    const likesStore = useLikesStore();
    const item = createFeedItem(15);

    const TestHost = defineComponent({
      components: {
        ReelActionRail
      },
      setup() {
        const parentClicks = ref(0);
        return {
          item,
          parentClicks
        };
      },
      template: `
        <div data-test="parent" @click="parentClicks += 1">
          <ReelActionRail :item="item" />
          <output data-test="parent-count">{{ parentClicks }}</output>
        </div>
      `
    });

    const wrapper = mount(TestHost, {
      global: {
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a data-test="folder-link"><slot /></a>'
          }
        }
      }
    });

    await wrapper.get('button[aria-label="Like post"]').trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-test="parent-count"]').text()).toBe('0');
    expect(likesStore.isLiked(item.id)).toBe(true);
  });

  it('renders Bookmark below Like and Download between Details and Folder', () => {
    const item = createFeedItem(22);

    const wrapper = mount(ReelActionRail, {
      props: {
        item
      },
      global: {
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a data-test="folder-link"><slot /></a>'
          }
        }
      }
    });

    const controls = wrapper.findAll('.reel-action-rail > *');

    expect(controls).toHaveLength(5);
    expect(controls[0]?.attributes('aria-label')).toBe('Like post');
    expect(controls[1]?.find('button[aria-label="Save post"]').exists()).toBe(true);
    expect(controls[2]?.find('button[aria-label="Show reel details"]').exists()).toBe(true);

    const downloadLink = controls[3];

    expect(downloadLink?.attributes('aria-label')).toBe('Download original file');
    expect(downloadLink?.attributes('href')).toBe('/api/originals/22?download=1');
    expect(downloadLink?.attributes('title')).toBe('Download original file');
    expect(controls[4]?.attributes('data-test')).toBe('folder-link');
  });
});
