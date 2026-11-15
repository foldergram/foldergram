import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as api from '../api/gallery';
import { DEFAULT_LOCALE, i18n } from '../locales';
import type { FeedItem } from '../types/api';
import { useAuthStore } from './auth';
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

describe('likes initialization before mutations', () => {
  const storageKey = 'foldergram-local-favorites';
  const savedIds = () => (JSON.parse(window.localStorage.getItem(storageKey)!) as FeedItem[]).map(item => item.id);
  function useLocalFavorites() {
    const auth = useAuthStore();
    auth.$patch({ likesMode: 'local', capabilities: { canUseSharedLikes: false, canUseLocalFavorites: true } });
    window.localStorage.setItem(storageKey, JSON.stringify([createFeedItem(1), createFeedItem(2)]));
    return useLikesStore();
  }

  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('preserves existing browser favorites when liking another post after invalidation', async () => {
    const likes = useLocalFavorites();
    await likes.initialize();
    likes.resetForRebuild();
    await likes.toggleLike(createFeedItem(3));
    expect(savedIds()).toEqual([3, 1, 2]);
    expect(likes.likedIds).toEqual([3, 1, 2]);
  });

  it('loads existing favorites before deciding whether a heart click adds or removes a favorite', async () => {
    const likes = useLocalFavorites();
    likes.resetForRebuild();
    await likes.toggleLike(createFeedItem(2));
    expect(savedIds()).toEqual([1]);
    expect(likes.isLiked(2)).toBe(false);
  });

  it('waits for an existing shared-likes load before concurrent mutations', async () => {
    let resolve!: (payload: Awaited<ReturnType<typeof api.fetchLikes>>) => void;
    const fetch = vi.spyOn(api, 'fetchLikes').mockReturnValue(new Promise(r => { resolve = r; }));
    const like = vi.spyOn(api, 'likeImage').mockResolvedValue({ id: 3, liked: true, ok: true });
    const unlike = vi.spyOn(api, 'unlikeImage').mockResolvedValue({ id: 1, liked: false, ok: true });
    const likes = useLikesStore();
    const load = likes.initialize();
    const remove = likes.toggleLike(createFeedItem(1));
    const add = likes.toggleLike(createFeedItem(3));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(like).not.toHaveBeenCalled();
    expect(unlike).not.toHaveBeenCalled();
    resolve({ items: [createFeedItem(1), createFeedItem(2)] });
    await Promise.all([load, remove, add]);
    expect(unlike).toHaveBeenCalledWith(1);
    expect(like).toHaveBeenCalledWith(3);
    expect(likes.likedIds).toEqual([3, 2]);
  });

  it('does not mutate shared likes when initialization fails', async () => {
    vi.spyOn(api, 'fetchLikes').mockRejectedValue(new Error('Unable to load likes.'));
    const like = vi.spyOn(api, 'likeImage');
    const likes = useLikesStore();
    await likes.toggleLike(createFeedItem(3));
    expect(like).not.toHaveBeenCalled();
    expect(likes.likedIds).toEqual([]);
    expect(likes.error).toBe('Unable to load likes.');
  });

  it.each(['removeImage', 'removeFolderItems', 'updateImageCaption'] as const)('loads browser favorites before %s writes local storage', action => {
    const likes = useLocalFavorites();
    likes.resetForRebuild();
    if (action === 'removeImage') likes.removeImage(1);
    else if (action === 'removeFolderItems') likes.removeFolderItems('other-folder');
    else likes.updateImageCaption(1, 'Updated caption');
    expect(savedIds()).toEqual(action === 'removeImage' ? [2] : [1, 2]);
    if (action === 'updateImageCaption') expect(likes.items[0].caption).toBe('Updated caption');
  });

  it('discards a shared-likes response after switching to browser favorites', async () => {
    let resolve!: (payload: Awaited<ReturnType<typeof api.fetchLikes>>) => void;
    vi.spyOn(api, 'fetchLikes').mockReturnValue(new Promise(r => { resolve = r; }));
    const likes = useLikesStore();
    const oldLoad = likes.initialize();
    useLocalFavorites();
    likes.resetForRebuild();
    await likes.toggleLike(createFeedItem(3));
    resolve({ items: [createFeedItem(99)] });
    await oldLoad;
    expect(likes.mode).toBe('local');
    expect(likes.likedIds).toEqual([3, 1, 2]);
    expect(savedIds()).toEqual([3, 1, 2]);
  });
});
