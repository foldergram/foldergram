import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useAuthStore } from '../stores/auth';
import { useLikesStore } from '../stores/likes';
import type { FeedItem } from '../types/api';
import ImmersiveLikeButton from './ImmersiveLikeButton.vue';

const item: FeedItem = {
  id: 91,
  folderId: 7,
  folderSlug: 'clips',
  folderName: 'Clips',
  folderPath: 'clips',
  folderBreadcrumb: null,
  filename: 'clip.mp4',
  width: 1080,
  height: 1920,
  mediaType: 'video',
  durationMs: 12_000,
  thumbnailUrl: '/thumbs/91.webp',
  previewUrl: '/previews/91.mp4',
  sortTimestamp: 1,
  takenAt: null
};

describe('ImmersiveLikeButton', () => {
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

  it('toggles the same heart state used by the feed and reels', async () => {
    const likesStore = useLikesStore();
    const wrapper = mount(ImmersiveLikeButton, { props: { item } });

    await wrapper.get('button').trigger('click');
    await flushPromises();

    expect(likesStore.isLiked(item.id)).toBe(true);
    expect(wrapper.get('button').classes()).toContain('immersive-like-button--liked');
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('true');
  });
});
