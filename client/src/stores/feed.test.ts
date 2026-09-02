import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as galleryApi from '../api/gallery';
import type { FeedItem } from '../types/api';
import { useFeedStore } from './feed';

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 1,
    folderSlug: 'alpha',
    folderName: 'Alpha',
    folderPath: 'albums/alpha',
    folderBreadcrumb: null,
    filename: `image-${id}.jpg`,
    width: 1200,
    height: 1500,
    mediaType: 'image',
    durationMs: null,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_778_400_000_000 + id,
    takenAt: 1_778_400_000_000 + id
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

describe('feed store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('loads the recent feed without a random seed', async () => {
    const fetchFeedSpy = vi.spyOn(galleryApi, 'fetchFeed').mockResolvedValue({
      mode: 'recent',
      items: [createFeedItem(7)],
      page: 1,
      limit: 18,
      total: 1,
      hasMore: false
    });

    const feedStore = useFeedStore();
    feedStore.initializeMode('recent');
    await feedStore.loadInitial();

    expect(feedStore.mode).toBe('recent');
    expect(fetchFeedSpy).toHaveBeenCalledWith(1, 18, 'recent', undefined, undefined);
    expect(feedStore.loadedMode).toBe('recent');
    expect(feedStore.items.map((item) => item.id)).toEqual([7]);
  });

  it('reloads initialized items when the active mode changed since the last fetch', async () => {
    const fetchFeedSpy = vi.spyOn(galleryApi, 'fetchFeed').mockResolvedValue({
      mode: 'recent',
      items: [createFeedItem(21)],
      page: 1,
      limit: 18,
      total: 1,
      hasMore: false
    });

    const feedStore = useFeedStore();
    feedStore.$patch({
      mode: 'random',
      loadedMode: 'random',
      items: [createFeedItem(5)],
      page: 2,
      hasMore: true,
      initialized: true,
      randomSeed: 12345
    });

    feedStore.initializeMode('recent');
    await feedStore.loadInitial();

    expect(fetchFeedSpy).toHaveBeenCalledWith(1, 18, 'recent', undefined, undefined);
    expect(feedStore.loadedMode).toBe('recent');
    expect(feedStore.items.map((item) => item.id)).toEqual([21]);
  });

  it('reloads with the updated mode when the mode changes during an in-flight request', async () => {
    const randomRequest = createDeferred<{
      mode: 'random';
      items: FeedItem[];
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    }>();
    const recentRequest = createDeferred<{
      mode: 'recent';
      items: FeedItem[];
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    }>();
    const fetchFeedSpy = vi.spyOn(galleryApi, 'fetchFeed').mockImplementation((_page, _limit, mode) => {
      if (mode === 'random') {
        return randomRequest.promise;
      }

      if (mode === 'recent') {
        return recentRequest.promise;
      }

      throw new Error(`Unexpected mode ${mode}`);
    });

    const feedStore = useFeedStore();
    const initialLoadPromise = feedStore.loadInitial();

    feedStore.initializeMode('recent');
    const pendingRecentLoadPromise = feedStore.loadInitial();

    expect(fetchFeedSpy).toHaveBeenCalledTimes(1);
    expect(fetchFeedSpy).toHaveBeenNthCalledWith(1, 1, 18, 'random', expect.any(Number), undefined);

    randomRequest.resolve({
      mode: 'random',
      items: [createFeedItem(5)],
      page: 1,
      limit: 18,
      total: 1,
      hasMore: false
    });

    await vi.waitFor(() => {
      expect(fetchFeedSpy).toHaveBeenCalledTimes(2);
    });

    expect(fetchFeedSpy).toHaveBeenNthCalledWith(2, 1, 18, 'recent', undefined, undefined);

    recentRequest.resolve({
      mode: 'recent',
      items: [createFeedItem(21)],
      page: 1,
      limit: 18,
      total: 1,
      hasMore: false
    });

    await Promise.all([initialLoadPromise, pendingRecentLoadPromise]);

    expect(feedStore.mode).toBe('recent');
    expect(feedStore.loadedMode).toBe('recent');
    expect(feedStore.items.map((item) => item.id)).toEqual([21]);
  });

  it('rotates the shuffle seed and excludes what was already seen on pull-to-refresh', async () => {
    const fetchFeedSpy = vi
      .spyOn(galleryApi, 'fetchFeed')
      .mockResolvedValueOnce({
        mode: 'random',
        items: [createFeedItem(1), createFeedItem(2)],
        page: 1,
        limit: 18,
        total: 2,
        hasMore: false
      })
      .mockResolvedValueOnce({
        mode: 'random',
        items: [createFeedItem(3)],
        page: 1,
        limit: 18,
        total: 1,
        hasMore: false
      });

    const feedStore = useFeedStore();
    feedStore.initializeMode('random');
    await feedStore.loadInitial();

    const firstSeed = fetchFeedSpy.mock.calls[0][3];
    expect(feedStore.seenIds).toEqual([1, 2]);

    await feedStore.refreshWithNewSeed();

    const secondCall = fetchFeedSpy.mock.calls[1];
    expect(secondCall[3]).not.toBe(firstSeed);
    expect(secondCall[4]).toEqual([1, 2]);
    expect(feedStore.items.map((item) => item.id)).toEqual([3]);
    expect(feedStore.seenIds).toEqual([1, 2, 3]);
    expect(feedStore.refreshing).toBe(false);
  });

  it('forgets what was seen and retries when excluding everything empties the feed', async () => {
    const fetchFeedSpy = vi
      .spyOn(galleryApi, 'fetchFeed')
      .mockResolvedValueOnce({
        mode: 'random',
        items: [createFeedItem(11)],
        page: 1,
        limit: 18,
        total: 1,
        hasMore: false
      })
      .mockResolvedValueOnce({
        mode: 'random',
        items: [],
        page: 1,
        limit: 18,
        total: 0,
        hasMore: false
      })
      .mockResolvedValueOnce({
        mode: 'random',
        items: [createFeedItem(11)],
        page: 1,
        limit: 18,
        total: 1,
        hasMore: false
      });

    const feedStore = useFeedStore();
    feedStore.initializeMode('random');
    await feedStore.loadInitial();
    await feedStore.refreshWithNewSeed();

    expect(fetchFeedSpy).toHaveBeenCalledTimes(3);
    expect(fetchFeedSpy.mock.calls[1][4]).toEqual([11]);
    expect(fetchFeedSpy.mock.calls[2][4]).toEqual([]);
    expect(feedStore.items.map((item) => item.id)).toEqual([11]);
  });

  it('clears the seen ids when the feed mode changes', async () => {
    vi.spyOn(galleryApi, 'fetchFeed').mockResolvedValue({
      mode: 'recent',
      items: [createFeedItem(31)],
      page: 1,
      limit: 18,
      total: 1,
      hasMore: false
    });

    const feedStore = useFeedStore();
    feedStore.initializeMode('random');
    feedStore.seenIds = [4, 5, 6];

    await feedStore.setMode('recent');

    expect(feedStore.seenIds).toEqual([31]);
  });
});
