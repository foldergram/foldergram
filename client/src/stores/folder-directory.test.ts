import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/gallery';
import type { FolderSummary } from '../types/api';
import { useFoldersStore } from './folders';
import { useFolderSearchStore, useLibraryDirectoryStore } from './folder-directory';

function folder(id: number): FolderSummary {
  return { id, slug: `album-${id}`, name: `Album ${id}`, description: null, folderPath: `archive/${id}`,
    breadcrumb: 'archive', imageCount: 2, videoCount: 0, latestImageMtimeMs: id, avatarImageId: id, avatarUrl: `/thumbnails/${id}` };
}
const page = (ids: number[], total = 140, page = 1) => ({ items: ids.map(folder), total, page, limit: 50, hasMore: page * 50 < total });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

beforeEach(() => { setActivePinia(createPinia()); vi.restoreAllMocks(); });

describe('folder directory stores', () => {
  it('bounds bootstrap requests and keeps its total separate from the recommendation array', async () => {
    const fetch = vi.spyOn(api, 'fetchFolderDirectory').mockResolvedValue(page([1, 2], 140));
    const legacy = vi.spyOn(api, 'fetchFolders');
    const folders = useFoldersStore();
    await folders.fetchFolders();
    expect(fetch).toHaveBeenCalledWith({ page: 1, limit: 24, sort: 'recent-desc' });
    expect(legacy).not.toHaveBeenCalled();
    expect(folders.items).toHaveLength(2);
    expect(folders.total).toBe(140);
    expect(useLibraryDirectoryStore().initialized).toBe(false);
    await folders.fetchFolders();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('loads further Library pages and searches the complete directory independently from Explore', async () => {
    const fetch = vi.spyOn(api, 'fetchFolderDirectory').mockResolvedValueOnce(page([1, 2]))
      .mockResolvedValueOnce(page([3, 4], 140, 2)).mockResolvedValueOnce(page([130], 1));
    const library = useLibraryDirectoryStore();
    await library.activate();
    await library.load();
    expect(library.items.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    await useFolderSearchStore().search('Album 130', 'name-asc');
    expect(fetch).toHaveBeenLastCalledWith({ page: 1, limit: 50, q: 'Album 130', sort: 'name-asc' });
    expect(useFolderSearchStore().items[0].id).toBe(130);
    expect(library.page).toBe(2);
    expect(library.query).toBe('');
  });

  it('discards stale search and reset responses', async () => {
    const old = deferred<ReturnType<typeof page>>();
    const reset = deferred<ReturnType<typeof page>>();
    vi.spyOn(api, 'fetchFolderDirectory').mockReturnValueOnce(old.promise).mockResolvedValueOnce(page([130], 1))
      .mockReturnValueOnce(reset.promise);
    const store = useFolderSearchStore();
    const pending = store.search('old');
    await store.search('new');
    old.resolve(page([1], 1));
    await pending;
    expect(store.items[0].id).toBe(130);
    const resetting = store.search('reset');
    store.reset();
    reset.resolve(page([3], 1));
    await resetting;
    expect(store.items).toEqual([]);
    expect(store.initialized).toBe(false);
  });

  it('refreshes visible pages after mutations while retaining the query, sort, and loaded range', async () => {
    const fetch = vi.spyOn(api, 'fetchFolderDirectory').mockImplementation(async (query) => page([1, 2], 140, query?.page));
    const library = useLibraryDirectoryStore();
    await library.search('Album', 'images-desc');
    await library.load();
    fetch.mockImplementation(async (query) => page([3, 4], 140, query?.page));
    vi.spyOn(api, 'updateFolderProfile').mockResolvedValue({ ...folder(1), name: 'Renamed' });
    await useFoldersStore().updateFolderProfile('album-1', 'Renamed', null);
    expect(library.stale).toBe(true);
    await library.activate();
    expect(library.query).toBe('Album');
    expect(library.sort).toBe('images-desc');
    expect(library.page).toBe(2);
    expect(fetch.mock.calls.slice(-2).map(([query]) => query?.page)).toEqual([1, 2]);
    expect(library.items.map((item) => item.id)).toEqual([3, 4]);
  });

  it('keeps the loaded range intact when a later page of a refresh fails', async () => {
    const fetch = vi.spyOn(api, 'fetchFolderDirectory').mockResolvedValueOnce(page([1, 2]))
      .mockResolvedValueOnce(page([3, 4], 140, 2));
    const store = useLibraryDirectoryStore();
    await store.activate();
    await store.load();
    fetch.mockResolvedValueOnce(page([9])).mockRejectedValueOnce(new Error('offline'));
    await store.load(true);
    expect(store.items.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(store.page).toBe(2);
    expect(store.total).toBe(140);
    expect(store.error).toBe('offline');
  });

  it('refreshes the changed cover by slug without reloading recommendations or folder images', async () => {
    const list = vi.spyOn(api, 'fetchFolderDirectory');
    const images = vi.spyOn(api, 'fetchFolderImages');
    vi.spyOn(api, 'setFolderCover').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'fetchFolder').mockResolvedValue({ ...folder(90), avatarUrl: '/new-cover' });
    const folders = useFoldersStore();
    folders.currentFolder = folder(90);
    await folders.setFolderCover('album-90', 99);
    expect(folders.currentFolder?.avatarUrl).toBe('/new-cover');
    expect(list).not.toHaveBeenCalled();
    expect(images).not.toHaveBeenCalled();
    expect(await folders.ensureSummary('album-90')).toMatchObject({ avatarUrl: '/new-cover' });
  });

  it('does not restore protected summaries after access is reset during bootstrap', async () => {
    const delayed = deferred<ReturnType<typeof page>>();
    vi.spyOn(api, 'fetchFolderDirectory').mockReturnValue(delayed.promise);
    const store = useFoldersStore();
    const pending = store.fetchFolders();
    store.resetForRebuild();
    delayed.resolve(page([1], 1));
    await pending;
    expect(store.items).toEqual([]);
    expect(store.total).toBe(0);
  });
  it.each(['currentFolder', 'cache'])('recognizes final-post removal outside recommendations using %s', (source) => {
    const folders = useFoldersStore();
    const lastPostFolder = { ...folder(90), imageCount: 1, videoCount: 1 };
    folders.items = [folder(1)];
    folders.total = 140;
    if (source === 'currentFolder') folders.currentFolder = lastPostFolder;
    else folders.summaryBySlug[lastPostFolder.slug] = lastPostFolder;

    expect(folders.removeImage(90, lastPostFolder.slug, 'video')).toBe(true);
    expect(folders.total).toBe(139);
    expect(folders.items.map((item) => item.id)).toEqual([1]);
    expect(folders.getSummary(lastPostFolder.slug)).toBeNull();
  });

  it('updates individually cached counts across successive deletions', () => {
    const folders = useFoldersStore();
    folders.summaryBySlug['album-90'] = folder(90);
    expect(folders.removeImage(90, 'album-90')).toBe(false);
    expect(folders.getSummary('album-90')?.imageCount).toBe(1);
    expect(folders.removeImage(91, 'album-90')).toBe(true);
    expect(folders.getSummary('album-90')).toBeNull();
  });

  it.each(['constructor', 'toString', '__proto__'])('fetches and caches the slug %s as an own property', async (slug) => {
    const fetch = vi.spyOn(api, 'fetchFolder').mockResolvedValue({ ...folder(90), slug });
    const folders = useFoldersStore();
    expect(folders.getSummary(slug)).toBeNull();
    expect(Object.getPrototypeOf(folders.summaryBySlug)).toBeNull();
    expect(await folders.ensureSummary(slug)).toMatchObject({ slug, id: 90 });
    expect(await folders.ensureSummary(slug)).toMatchObject({ slug, id: 90 });
    expect(fetch).toHaveBeenCalledExactlyOnceWith(slug);
    expect(Object.hasOwn(folders.summaryBySlug, slug)).toBe(true);
    folders.resetForRebuild();
    expect(Object.getPrototypeOf(folders.summaryBySlug)).toBeNull();
  });

  it('shares pending summary requests and discards their cache writes after a protected reset', async () => {
    const pending = deferred<FolderSummary>();
    const fetch = vi.spyOn(api, 'fetchFolder').mockReturnValueOnce(pending.promise).mockResolvedValueOnce(folder(2));
    const folders = useFoldersStore();
    const first = folders.ensureSummary('album-1');
    const second = folders.ensureSummary('album-1');
    expect(fetch).toHaveBeenCalledTimes(1);
    folders.resetForRebuild();
    pending.resolve(folder(1));
    await Promise.all([first, second]);
    expect(folders.getSummary('album-1')).toBeNull();
    await folders.ensureSummary('album-2');
    expect(folders.getSummary('album-2')?.id).toBe(2);
  });

  it.each(['directory-first', 'summary-first'])('retains initial folder lookups with %s bootstrap completion', async (order) => {
    const directory = deferred<ReturnType<typeof page>>();
    const summary = deferred<FolderSummary>();
    vi.spyOn(api, 'fetchFolderDirectory').mockReturnValue(directory.promise);
    const fetch = vi.spyOn(api, 'fetchFolder').mockReturnValue(summary.promise);
    const folders = useFoldersStore();
    const bootstrap = folders.fetchFolders();
    const lookup = folders.ensureSummary('album-90');

    if (order === 'directory-first') {
      directory.resolve(page([1], 140));
      await bootstrap;
      summary.resolve(folder(90));
      await lookup;
    } else {
      summary.resolve(folder(90));
      await lookup;
      directory.resolve(page([1], 140));
      await bootstrap;
    }

    expect(folders.getSummary('album-90')).toMatchObject({ slug: 'album-90', avatarUrl: '/thumbnails/90' });
    expect(fetch).toHaveBeenCalledExactlyOnceWith('album-90');
    expect(folders.items.map((item) => item.id)).toEqual([1]);
    expect(folders.total).toBe(140);
  });

  it('restarts pending folder lookups on a forced refresh and ignores their old results', async () => {
    const old = deferred<FolderSummary>();
    const fresh = deferred<FolderSummary>();
    vi.spyOn(api, 'fetchFolderDirectory').mockResolvedValue(page([1], 140));
    const fetch = vi.spyOn(api, 'fetchFolder').mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const folders = useFoldersStore();
    const lookup = folders.ensureSummary('album-90');
    await folders.fetchFolders(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const restarted = folders.ensureSummary('album-90', true);
    old.resolve(folder(90));
    await lookup;
    expect(folders.getSummary('album-90')).toBeNull();
    fresh.resolve({ ...folder(90), avatarUrl: '/new-cover' });
    await restarted;
    expect(folders.getSummary('album-90')?.avatarUrl).toBe('/new-cover');
  });

  it('refreshes an open folder summary after a scan even when it is already cached', async () => {
    vi.spyOn(api, 'fetchFolderDirectory').mockResolvedValue(page([1], 140));
    vi.spyOn(api, 'fetchFolder').mockResolvedValue({ ...folder(90), imageCount: 3 });
    const folders = useFoldersStore();
    folders.currentFolder = folder(90);
    await folders.fetchFolders(true);
    await folders.ensureSummary('album-90', true);
    expect(folders.currentFolder?.imageCount).toBe(3);
  });

  it('synchronizes whole-library totals during a filtered refresh after a scan', async () => {
    let total = 140;
    vi.spyOn(api, 'fetchFolderDirectory').mockImplementation(async (query) =>
      query?.q ? page([90], 1) : page([1], total)
    );
    const library = useLibraryDirectoryStore();
    await library.activate();
    await library.search('Album 90', 'name-desc');
    total = 139;
    await useFoldersStore().fetchFolders(true);
    expect(library.unfilteredTotal).toBe(139);
    expect(library.query).toBe('Album 90');
    expect(library.sort).toBe('name-desc');
  });

  it('invalidates a filtered directory total when its final post is deleted', async () => {
    vi.spyOn(api, 'fetchFolderDirectory').mockResolvedValue(page([90], 1));
    const folders = useFoldersStore();
    folders.total = 140;
    folders.currentFolder = { ...folder(90), imageCount: 1 };
    const library = useLibraryDirectoryStore();
    library.unfilteredTotal = 140;
    await library.search('Album 90');
    expect(folders.removeImage(90, 'album-90')).toBe(true);
    expect(library.unfilteredTotal).toBeNull();
    expect(folders.total).toBe(139);
    expect(library.query).toBe('Album 90');
  });

});
