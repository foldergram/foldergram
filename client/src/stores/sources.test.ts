import { createPinia, setActivePinia } from 'pinia';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from '../api/http';
import { useAppStore } from './app';
import { useAuthStore } from './auth';
import { useFeedStore } from './feed';
import { useLikesStore } from './likes';
import type { FeedItem } from '../types/api';
import { useFoldersStore } from './folders';
import { useLibraryDirectoryStore } from './folder-directory';
import { useSourcesStore, type SourceStatus } from './sources';

vi.mock('../api/http', () => ({ requestJson: vi.fn() }));
const request = vi.mocked(requestJson);
const source = (overrides: Partial<SourceStatus> = {}): SourceStatus => ({
  id: 1, name: 'Family photos', enabled: 1, status: 'syncing', generation: 1,
  updated_at: '2026-11-14T00:00:00Z', available: true, syncing: true, ...overrides
});

describe('application source tracking', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
    request.mockReset();
    window.localStorage.clear();
    vi.spyOn(useAppStore(), 'fetchStats').mockResolvedValue();
    vi.spyOn(useFoldersStore(), 'fetchFolders').mockResolvedValue();
  });
  afterEach(() => {
    useSourcesStore().stop();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('refreshes cached browsing after a background sync with unchanged counts and no Settings mounted', async () => {
    request.mockResolvedValue({ items: [source()] });
    const sources = useSourcesStore();
    sources.start();
    await flushPromises();
    const feed = useFeedStore();
    feed.initialized = true;
    const directory = useLibraryDirectoryStore();
    directory.initialized = true;
    directory.total = 5;

    request.mockResolvedValue({ items: [source({ generation: 2, status: 'ready', syncing: false })] });
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();

    expect(sources.contentRevision).toBe(1);
    expect(feed.initialized).toBe(false);
    expect(directory.initialized).toBe(false);
    expect(useFoldersStore().fetchFolders).toHaveBeenCalledWith(true);
    expect(useAppStore().fetchStats).toHaveBeenCalledWith({ background: true });
  });

  it('keeps local and other sources usable through an outage, then recovers through Retry', async () => {
    const sources = useSourcesStore();
    request.mockResolvedValue({ items: [source({ available: false }), source({ id: 2 })] });
    await sources.refresh();
    expect(sources.unavailable.map(s => s.id)).toEqual([1]);
    expect(sources.canBrowse(1)).toBe(false);
    expect(sources.canBrowse(null)).toBe(true);
    expect(sources.canBrowse(2)).toBe(true);
    request.mockResolvedValue({ items: [source(), source({ id: 2 })] });
    await sources.refresh(true);
    expect(request).toHaveBeenLastCalledWith('/api/sources/status?retry=1');
    expect(sources.canBrowse(1)).toBe(true);
    expect(sources.contentRevision).toBe(0);
  });

  it('identifies an outage without feed pagination only when no usable local or remote source remains', async () => {
    const sources = useSourcesStore();
    expect(sources.allContentUnavailable).toBe(false);
    request.mockResolvedValue({ hasLocalPosts: false, items: [source({ available: false })] });
    await sources.refresh();
    expect(sources.allContentUnavailable).toBe(true);
    request.mockResolvedValue({ hasLocalPosts: true, items: [source({ available: false })] });
    await sources.refresh();
    expect(sources.allContentUnavailable).toBe(false);
    request.mockResolvedValue({ hasLocalPosts: false, items: [source({ available: false }), source({ id: 2 })] });
    await sources.refresh();
    expect(sources.allContentUnavailable).toBe(false);
  });

  it('runs a fresh Retry after an in-flight poll returns an older outage result', async () => {
    const sources = useSourcesStore();
    sources.$patch({ initialized: true, hasLocalPosts: false, items: [source({ available: false })] });
    let resolvePoll!: (payload: { hasLocalPosts: boolean; items: SourceStatus[] }) => void;
    request.mockReturnValueOnce(new Promise(resolve => { resolvePoll = resolve; }));
    request.mockResolvedValueOnce({ hasLocalPosts: false, items: [source()] });
    const poll = sources.refresh();
    const retry = sources.refresh(true);
    expect(request).toHaveBeenCalledTimes(1);
    resolvePoll({ hasLocalPosts: false, items: [source({ available: false })] });
    await Promise.all([poll, retry]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('/api/sources/status?retry=1');
    expect(sources.canBrowse(1)).toBe(true);
    expect(sources.allContentUnavailable).toBe(false);
  });

  it('reloads browser favorites after background synchronization before the next heart click', async () => {
    const auth = useAuthStore();
    auth.$patch({ likesMode: 'local', capabilities: { canUseSharedLikes: false, canUseLocalFavorites: true } });
    const item = (id: number): FeedItem => ({
      id, folderId: 1, folderSlug: 'local', folderName: 'Local', folderPath: 'local', folderBreadcrumb: null,
      filename: `${id}.jpg`, width: 800, height: 600, mediaType: 'image', durationMs: null,
      thumbnailUrl: `/thumbnails/${id}.webp`, previewUrl: `/previews/${id}.webp`, sortTimestamp: id, takenAt: id
    });
    window.localStorage.setItem('foldergram-local-favorites', JSON.stringify([item(1), item(2)]));
    const likes = useLikesStore();
    await likes.initialize();
    const sources = useSourcesStore();
    request.mockResolvedValue({ items: [source()] });
    sources.start();
    await flushPromises();
    request.mockResolvedValue({ items: [source({ generation: 2, status: 'ready', syncing: false })] });
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();

    expect(likes.initialized).toBe(true);
    expect(likes.likedIds).toEqual([1, 2]);
    await likes.toggleLike(item(3));
    expect(likes.likedIds).toEqual([3, 1, 2]);
    const stored = JSON.parse(window.localStorage.getItem('foldergram-local-favorites')!) as FeedItem[];
    expect(stored.map(item => item.id)).toEqual([3, 1, 2]);
  });

  it('deduplicates polling and discards a pending response after access is lost', async () => {
    let resolve!: (payload: { items: SourceStatus[] }) => void;
    request.mockReturnValue(new Promise(r => { resolve = r; }));
    const sources = useSourcesStore();
    sources.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(request).toHaveBeenCalledTimes(1);
    const retry = sources.refresh(true);
    sources.stop();
    resolve({ items: [source()] });
    await retry;
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(1);
    expect(sources.items).toEqual([]);
    expect(sources.initialized).toBe(false);
  });
});
