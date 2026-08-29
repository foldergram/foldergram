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
    expect(fetchReelsSpy).toHaveBeenCalledWith(1, 6, 'random', expect.any(Number), {});
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
    expect(fetchReelsSpy).toHaveBeenCalledWith(1, 6, 'recent', undefined, {});
    expect(reelsStore.items.map((item) => item.id)).toEqual([7]);
  });

  it('advances to the clip in the removed position when the active reel is deleted', () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({
      items: [createFeedItem(1), createFeedItem(2), createFeedItem(3)],
      activeReelId: 2
    });

    reelsStore.removeImage(2);

    expect(reelsStore.items.map((item) => item.id)).toEqual([1, 3]);
    expect(reelsStore.activeReelId).toBe(3);
  });

  it('falls back to the last clip when the deleted reel was at the end of the queue', () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({
      items: [createFeedItem(1), createFeedItem(2)],
      activeReelId: 2
    });

    reelsStore.removeImage(2);

    expect(reelsStore.activeReelId).toBe(1);
  });

  it('keeps the active reel when another one is deleted', () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({
      items: [createFeedItem(1), createFeedItem(2)],
      activeReelId: 2
    });

    reelsStore.removeImage(1);

    expect(reelsStore.activeReelId).toBe(2);
  });

  it('clears the active reel when the queue empties', () => {
    const reelsStore = useReelsStore();
    reelsStore.$patch({
      items: [createFeedItem(1)],
      activeReelId: 1
    });

    reelsStore.removeImage(1);

    expect(reelsStore.items).toEqual([]);
    expect(reelsStore.activeReelId).toBeNull();
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

    expect(fetchReelsSpy).toHaveBeenCalledWith(1, 6, 'random', expect.any(Number), {});
    expect(reelsStore.items.map((item) => item.id)).toEqual([21]);
    expect(reelsStore.loadedMode).toBe('random');
  });
});
