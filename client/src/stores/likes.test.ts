import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, i18n } from '../locales';
import type { FeedItem } from '../types/api';
import { useLikesStore } from './likes';

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 1,
    folderSlug: 'animal-planet',
    folderName: 'Animal Planet',
    folderPath: 'animal-planet',
    folderBreadcrumb: null,
    filename: `post-${id}.jpg`,
    width: 1080,
    height: 1350,
    mediaType: 'image',
    durationMs: null,
    isAnimated: false,
    thumbnailUrl: `/thumbs/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_777_000_000_000 + id,
    takenAt: 1_777_000_000_000 + id
  };
}

describe('useLikesStore localization', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    i18n.global.locale.value = DEFAULT_LOCALE;
  });

  it('reacts to locale changes for shared and local saved-item labels', () => {
    const store = useLikesStore();

    store.syncFromItems([createFeedItem(1)], 'shared');

    expect(store.collectionLabel).toBe('Likes');
    expect(store.collectionSectionLabel).toBe('Liked posts');

    i18n.global.locale.value = 'zh';

    expect(store.collectionLabel).toBe('赞过');
    expect(store.collectionSectionLabel).toBe('已赞帖子');
    expect(store.toggleAriaLabel(false)).toBe('点赞帖子');

    store.syncFromItems([createFeedItem(2)], 'local');

    expect(store.collectionLabel).toBe('收藏');
    expect(store.collectionSectionLabel).toBe('收藏帖子');
    expect(store.toggleAriaLabel(true)).toBe('取消收藏帖子');
  });

  it('filters liked items by folder while preserving order', () => {
    const store = useLikesStore();
    const first = createFeedItem(1);
    const second = { ...createFeedItem(2), folderSlug: 'other-folder', folderId: 2 };
    const third = createFeedItem(3);

    store.syncFromItems([first, second, third], 'shared');

    expect(store.itemsForFolder('animal-planet').map(item => item.id)).toEqual([1, 3]);

    store.items = store.items.filter(item => item.id !== 1);
    expect(store.itemsForFolder('animal-planet').map(item => item.id)).toEqual([3]);
  });
});
