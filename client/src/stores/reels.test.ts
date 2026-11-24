import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as galleryApi from '../api/gallery';
import type { AppStatus, FeedItem } from '../types/api';
import { useAppStore } from './app';
import { useReelsStore } from './reels';

function createAppStatus(defaultReelsFeedMode: AppStatus['preferences']['defaultReelsFeedMode'] = 'random'): AppStatus {
  return {
    folders: 2,
    indexedImages: 12,
    indexedVideos: 4,
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
      defaultReelsFeedMode
    }
  };
}

function createFeedItem(id: number): FeedItem {
  return {
    id,
    folderId: 1,
    folderSlug: 'reels-alpha',
    folderName: 'Reels Alpha',
    folderPath: 'reels/alpha',
    folderBreadcrumb: null,
    filename: `reel-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 18_000,
    thumbnailUrl: `/thumbnails/${id}.webp`,
    previewUrl: `/previews/${id}.webp`,
    sortTimestamp: 1_778_400_000_000 + id,
    takenAt: 1_778_400_000_000 + id
  };
}

describe('reels store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
  });

  it('uses the configured random default and passes a session seed to the reels API', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus('random')
    });

    const fetchReelsSpy = vi.spyOn(galleryApi, 'fetchReels').mockResolvedValue({
      mode: 'random',
      items: [createFeedItem(11)],
      page: 1,
      limit: 6,
      total: 1,
      hasMore: false
    });

    const reelsStore = useReelsStore();
    await reelsStore.loadInitial();

    expect(reelsStore.mode).toBe('random');
    expect(fetchReelsSpy).toHaveBeenCalledWith(1, 6, 'random', expect.any(Number), { cursor: null });
    expect(reelsStore.seed).toEqual(expect.any(Number));
    expect(reelsStore.items.map((item) => item.id)).toEqual([11]);
  });

  it('uses the configured app-wide reels default automatically', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus('recent')
    });

    const fetchReelsSpy = vi.spyOn(galleryApi, 'fetchReels').mockResolvedValue({
      mode: 'recent',
      items: [createFeedItem(7)],
      page: 1,
      limit: 6,
      total: 1,
      hasMore: false
    });

    const reelsStore = useReelsStore();
    await reelsStore.loadInitial();

    expect(reelsStore.mode).toBe('recent');
    expect(fetchReelsSpy).toHaveBeenCalledWith(1, 6, 'recent', undefined, { cursor: null });
    expect(reelsStore.items.map((item) => item.id)).toEqual([7]);
  });

  it('reloads initialized reels when the cached queue was not loaded with the active mode', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus('random')
    });

    const fetchReelsSpy = vi.spyOn(galleryApi, 'fetchReels').mockResolvedValue({
      mode: 'random',
      items: [createFeedItem(21)],
      page: 1,
      limit: 6,
      total: 1,
      hasMore: false
    });

    const reelsStore = useReelsStore();
    reelsStore.$patch({
      mode: 'random',
      loadedMode: null,
      items: [createFeedItem(5)],
      page: 2,
      hasMore: true,
      initialized: true,
      seed: null
    });

    await reelsStore.loadInitial();

    expect(fetchReelsSpy).toHaveBeenCalledWith(1, 6, 'random', expect.any(Number), { cursor: null });
    expect(reelsStore.items.map((item) => item.id)).toEqual([21]);
    expect(reelsStore.loadedMode).toBe('random');
  });

  it('sends the opaque cursor for subsequent pages and clears it when the queue ends', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus('recent')
    });

    const fetchReelsSpy = vi
      .spyOn(galleryApi, 'fetchReels')
      .mockResolvedValueOnce({
        mode: 'recent',
        items: [createFeedItem(31)],
        page: 1,
        limit: 6,
        total: 2,
        hasMore: true,
        nextCursor: 'cursor-page-2'
      })
      .mockResolvedValueOnce({
        mode: 'recent',
        items: [createFeedItem(32)],
        page: 2,
        limit: 6,
        total: 2,
        hasMore: false,
        nextCursor: null
      });

    const reelsStore = useReelsStore();
    await reelsStore.loadInitial();
    await reelsStore.loadMore();

    expect(fetchReelsSpy).toHaveBeenNthCalledWith(1, 1, 6, 'recent', undefined, { cursor: null });
    expect(fetchReelsSpy).toHaveBeenNthCalledWith(2, 2, 6, 'recent', undefined, { cursor: 'cursor-page-2' });
    expect(reelsStore.items.map((item) => item.id)).toEqual([31, 32]);
    expect(reelsStore.cursor).toBeNull();
    expect(reelsStore.hasMore).toBe(false);
  });

  it('opens a deep-linked Reel that is outside the current page without duplicating its post', async () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({ initialized: true, items: [createFeedItem(11), createFeedItem(12)], activeReelId: 11 });
    const fetchImageSpy = vi.spyOn(galleryApi, 'fetchImage').mockResolvedValue({
      ...createFeedItem(99),
      id: 99
    } as Awaited<ReturnType<typeof galleryApi.fetchImage>>);

    await reelsStore.openReel(99);
    expect(fetchImageSpy).toHaveBeenCalledWith(99, 'video');
    expect(reelsStore.items.map((item) => item.id)).toEqual([99, 11, 12]);
    expect(reelsStore.activeReelId).toBe(99);

    await reelsStore.openReel(99);
    expect(fetchImageSpy).toHaveBeenCalledTimes(1);
    expect(reelsStore.items.map((item) => item.id)).toEqual([99, 11, 12]);
  });

  it('never lets an older deep-link request override a newer Reel', async () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({ initialized: true, items: [createFeedItem(11)], activeReelId: 11, error: 'Stale error' });

    let resolveOld: ((item: Awaited<ReturnType<typeof galleryApi.fetchImage>>) => void) | undefined;
    const oldRequest = new Promise<Awaited<ReturnType<typeof galleryApi.fetchImage>>>(resolve => { resolveOld = resolve; });
    const fetchImageSpy = vi.spyOn(galleryApi, 'fetchImage').mockImplementation(id => id === 99
      ? oldRequest
      : Promise.resolve(createFeedItem(100) as Awaited<ReturnType<typeof galleryApi.fetchImage>>));

    const oldOpen = reelsStore.openReel(99);
    const newOpen = reelsStore.openReel(100);
    expect(await newOpen).toBe(true);
    expect(reelsStore.activeReelId).toBe(100);
    expect(reelsStore.error).toBeNull();

    resolveOld?.(createFeedItem(99) as Awaited<ReturnType<typeof galleryApi.fetchImage>>);
    expect(await oldOpen).toBe(false);
    expect(reelsStore.items.map(item => item.id)).toEqual([100, 11]);
    expect(reelsStore.activeReelId).toBe(100);
    expect(fetchImageSpy).toHaveBeenCalledTimes(2);
  });

  it('cancels an outstanding deep link when a new route is invalid', async () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({ initialized: true, items: [createFeedItem(11)], activeReelId: 11 });
    let resolvePending: ((item: Awaited<ReturnType<typeof galleryApi.fetchImage>>) => void) | undefined;
    vi.spyOn(galleryApi, 'fetchImage').mockImplementation(() => new Promise(resolve => { resolvePending = resolve; }));
    const pending = reelsStore.openReel(99);
    reelsStore.invalidatePendingOpenReel();
    resolvePending?.(createFeedItem(99) as Awaited<ReturnType<typeof galleryApi.fetchImage>>);
    expect(await pending).toBe(false);
    expect(reelsStore.activeReelId).toBe(11);
  });

  it('rejects invalid and non-video deep links', async () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({ initialized: true, items: [createFeedItem(11)] });
    await expect(reelsStore.openReel(-1)).rejects.toThrow('Invalid Reel ID');
    vi.spyOn(galleryApi, 'fetchImage').mockResolvedValue({
      ...createFeedItem(88),
      mediaType: 'image'
    } as Awaited<ReturnType<typeof galleryApi.fetchImage>>);
    await expect(reelsStore.openReel(88)).rejects.toThrow('not a Reel');
    expect(reelsStore.items.map((item) => item.id)).toEqual([11]);
  });

  it('continues random pagination when the opening Reel reappears on page two, including duplicate-only pages', async () => {
    useAppStore().$patch({ stats: createAppStatus('random') });
    const pages = [
      [1, 2, 3, 4, 5, 6],
      [7, 8, 9, 10, 11, 12],
      [8, 9, 10, 11, 12, 7],
      [13, 14, 15, 16, 17, 18],
      [19, 20, 21, 22, 23, 24]
    ];
    const fetchSpy = vi.spyOn(galleryApi, 'fetchReels').mockImplementation(async (page, limit, mode, seed, options) => ({
      mode,
      items: (pages[page - 1] ?? []).map(createFeedItem),
      page,
      limit,
      total: 1000,
      hasMore: page < pages.length,
      nextCursor: page < pages.length ? `cursor-${page + 1}` : null
    }));
    vi.spyOn(galleryApi, 'fetchImage').mockResolvedValue(createFeedItem(8) as Awaited<ReturnType<typeof galleryApi.fetchImage>>);

    const store = useReelsStore();
    await store.openReel(8);
    expect(store.items.map(item => item.id)).toEqual([8, 1, 2, 3, 4, 5, 6]);
    const stableSeed = store.seed;
    await store.loadMore();
    expect(store.items.map(item => item.id)).toEqual([8, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12]);
    await store.loadMore(); // page three is entirely duplicate IDs; must fetch page four
    expect(store.items.map(item => item.id)).toEqual([8, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    await store.loadMore();
    expect(store.items).toHaveLength(24);
    expect(new Set(store.items.map(item => item.id)).size).toBe(24);
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    expect(fetchSpy.mock.calls.every(call => call[1] === 6 && call[3] === stableSeed)).toBe(true);
    expect(store.hasMore).toBe(false);
  });

  it('pages through every Reel in a 1,000-video random library without an artificial page or window limit', async () => {
    useAppStore().$patch({ stats: createAppStatus('random') });
    const fetchSpy = vi.spyOn(galleryApi, 'fetchReels').mockImplementation(async (page, limit, mode, seed) => {
      const start = (page - 1) * limit + 1;
      const ids = Array.from({ length: Math.max(0, Math.min(limit, 1001 - start)) }, (_, index) => start + index);
      return {
        mode, page, limit, total: 1000, items: ids.map(createFeedItem),
        hasMore: start + ids.length <= 1000,
        nextCursor: start + ids.length <= 1000 ? `random-${page + 1}` : null
      };
    });
    vi.spyOn(galleryApi, 'fetchImage').mockResolvedValue(
      createFeedItem(8) as Awaited<ReturnType<typeof galleryApi.fetchImage>>
    );
    const store = useReelsStore();
    await store.openReel(8);
    while (store.hasMore && fetchSpy.mock.calls.length < 200) await store.loadMore();

    const ids = store.items.map(item => item.id);
    expect(ids).toHaveLength(1000);
    expect(new Set(ids).size).toBe(1000);
    expect(ids.filter(id => id === 8)).toEqual([8]);
    expect(store.hasMore).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(167);
    expect(fetchSpy.mock.calls.every(call => call[1] === 6 && call[3] === store.seed)).toBe(true);
  });

  it('ends a recommended queue on the final bounded page, without rolling over', async () => {
    useAppStore().$patch({ stats: createAppStatus('recommended') });
    const fetchSpy = vi.spyOn(galleryApi, 'fetchReels').mockImplementation(async (page, limit, mode, seed) => ({
      mode,
      page,
      limit,
      total: 10,
      items: (page === 1 ? [1, 2, 3, 4, 5, 6] : [5, 6, 7, 8, 9, 10]).map(createFeedItem),
      hasMore: page === 1,
      nextCursor: page === 1 ? 'recommended-2' : null
    }));
    const store = useReelsStore();
    await store.loadInitial();
    const stableSeed = store.seed;
    await store.loadMore();
    await store.prefetchIfNeeded(store.items.length - 1);
    expect(store.items.map(item => item.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(store.hasMore).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls.map(call => call[3])).toEqual([stableSeed, stableSeed]);
  });

  it('isolates Home sessions, restores old queues, and rejects late requests after a rapid reopen', async () => {
    useAppStore().$patch({ stats: createAppStatus('random') });
    const oldPage = Promise.withResolvers<Awaited<ReturnType<typeof galleryApi.fetchReels>>>();
    const fetchSpy = vi.spyOn(galleryApi, 'fetchReels')
      .mockResolvedValueOnce({ mode: 'random', items: [createFeedItem(1), createFeedItem(2)], page: 1, limit: 6, total: 1000, hasMore: true, nextCursor: 'A-2' })
      .mockImplementationOnce(() => oldPage.promise)
      .mockResolvedValueOnce({ mode: 'random', items: [createFeedItem(24), createFeedItem(26)], page: 1, limit: 6, total: 1000, hasMore: false, nextCursor: null });
    vi.spyOn(galleryApi, 'fetchImage').mockImplementation(async id =>
      createFeedItem(id) as Awaited<ReturnType<typeof galleryApi.fetchImage>>);
    const store = useReelsStore();
    store.activateSession('home-A');
    await store.openReel(8);
    const seedA = store.seed;
    store.setActiveReel(2);
    const lateLoad = store.loadMore();
    store.pauseSession();
    store.activateSession('home-B');
    await store.openReel(25);
    const seedB = store.seed;
    expect(seedB).not.toBe(seedA);
    expect(store.items.map(item => item.id)).toEqual([25, 24, 26]);
    oldPage.resolve({ mode: 'random', items: [createFeedItem(8), createFeedItem(9)], page: 2, limit: 6, total: 1000, hasMore: false, nextCursor: null });
    await lateLoad;
    expect(store.items.map(item => item.id)).toEqual([25, 24, 26]);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    store.pauseSession();
    store.activateSession('home-A');
    expect(store.items.map(item => item.id)).toEqual([8, 1, 2]);
    expect(store.activeReelId).toBe(2);
    expect(store.seed).toBe(seedA);
    store.activateSession('home-B');
    expect(store.items.map(item => item.id)).toEqual([25, 24, 26]);
    expect(store.seed).toBe(seedB);
  });

  it('resets pagination and ignores a stale response after the mode changes', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus('random')
    });

    let resolveStaleRequest: ((payload: Awaited<ReturnType<typeof galleryApi.fetchReels>>) => void) | null = null;
    const staleRequest = new Promise<Awaited<ReturnType<typeof galleryApi.fetchReels>>>((resolve) => {
      resolveStaleRequest = resolve;
    });

    const fetchReelsSpy = vi
      .spyOn(galleryApi, 'fetchReels')
      .mockImplementationOnce(() => staleRequest)
      .mockResolvedValueOnce({
        mode: 'recent',
        items: [createFeedItem(41)],
        page: 1,
        limit: 6,
        total: 1,
        hasMore: false,
        nextCursor: null
      });

    const reelsStore = useReelsStore();
    const staleLoad = reelsStore.loadInitial();

    appStore.stats!.preferences.defaultReelsFeedMode = 'recent';
    const freshLoad = reelsStore.loadInitial();

    resolveStaleRequest?.({
      mode: 'random',
      items: [createFeedItem(40)],
      page: 1,
      limit: 6,
      total: 1,
      hasMore: false,
      nextCursor: null
    });

    await Promise.all([staleLoad, freshLoad]);

    expect(fetchReelsSpy).toHaveBeenCalledTimes(2);
    expect(reelsStore.mode).toBe('recent');
    expect(reelsStore.items.map((item) => item.id)).toEqual([41]);
    expect(reelsStore.cursor).toBeNull();
    expect(reelsStore.hasMore).toBe(false);
  });
});
