import { performance } from 'node:perf_hooks';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory, createRouter } from 'vue-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../api/gallery';
import { useAppStore } from '../stores/app';
import { useLibraryDirectoryStore } from '../stores/folder-directory';
import type { AppStatus, FolderSummary } from '../types/api';
import LibraryView from './LibraryView.vue';
import ExploreView from './ExploreView.vue';

function folder(id: number): FolderSummary {
  return { id, slug: `album-${id}`, name: `Album ${id}`, description: null, folderPath: `archive/${id}`, breadcrumb: 'archive',
    imageCount: 2, videoCount: 0, latestImageMtimeMs: id, avatarImageId: null, avatarUrl: null };
}
const result = (ids: number[], total = 90, page = 1) => ({ items: ids.map(folder), page, limit: 50, total, hasMore: page * 50 < total });

async function render(view: typeof LibraryView | typeof ExploreView, path = '/library') {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { name: 'library', path: '/library', component: LibraryView },
    { name: 'explore', path: '/explore', component: ExploreView },
    { name: 'folder', path: '/folders/:slug', component: { template: '<div />' } }
  ] });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(view, { global: { plugins: [router], stubs: {
    InfiniteLoader: { props: ['loading', 'hasMore'], emits: ['load-more'], template: '<button v-if="hasMore" data-test="more" @click="$emit(\'load-more\')">More</button>' },
    Avatar: true, ExploreGrid: true
  } } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.spyOn(api, 'fetchFolderDirectory').mockResolvedValue(result([1]));
  vi.spyOn(api, 'fetchFeed').mockResolvedValue({ items: [], page: 1, limit: 30, total: 0, hasMore: false, mode: 'random' });
  vi.spyOn(api, 'fetchFeedSearch').mockResolvedValue({ items: [], page: 1, limit: 24, total: 0, hasMore: false });
  useAppStore().stats = { folders: 90, indexedImages: 180, storage: { available: true }, preferences: {} } as AppStatus;
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('folder directory views', () => {
  it('renders whole-library totals, loads further Library pages, and applies server search and sorting', async () => {
    const wrapper = await render(LibraryView);
    expect(wrapper.text()).toContain('90');
    expect(wrapper.text()).toContain('180');
    vi.mocked(api.fetchFolderDirectory).mockResolvedValueOnce(result([70], 90, 2));
    await wrapper.get('[data-test="more"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Album 70');
    vi.useFakeTimers();
    vi.mocked(api.fetchFolderDirectory).mockResolvedValueOnce(result([80], 1));
    await wrapper.get('#library-search').setValue('Album 80');
    await wrapper.get('select').setValue('name-desc');
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(api.fetchFolderDirectory).toHaveBeenLastCalledWith({ page: 1, limit: 50, q: 'Album 80', sort: 'name-desc' });
    expect(wrapper.text()).toContain('Album 80');
    expect(wrapper.text()).not.toContain('Album 70');
    expect(useLibraryDirectoryStore().unfilteredTotal).toBe(90);
    wrapper.unmount();
  });

  it('keeps search and sorting usable after a failed query', async () => {
    const wrapper = await render(LibraryView);
    vi.mocked(api.fetchFolderDirectory).mockRejectedValueOnce(new Error('temporary failure'));
    await useLibraryDirectoryStore().search('bad query');
    await flushPromises();
    expect(wrapper.text()).toContain('temporary failure');
    expect(wrapper.get('#library-search').exists()).toBe(true);
    expect(wrapper.get('select').exists()).toBe(true);
    vi.useFakeTimers();
    vi.mocked(api.fetchFolderDirectory).mockResolvedValueOnce(result([80], 1));
    await wrapper.get('#library-search').setValue('Album 80');
    await wrapper.get('select').setValue('name-desc');
    await vi.advanceTimersByTimeAsync(200);
    await flushPromises();
    expect(api.fetchFolderDirectory).toHaveBeenLastCalledWith({ page: 1, limit: 50, q: 'Album 80', sort: 'name-desc' });
    expect(wrapper.text()).toContain('Album 80');
    expect(wrapper.text()).not.toContain('temporary failure');
    wrapper.unmount();
  });

  it('uses server-backed Explore folder search beyond the recommendation page and loads more matches', async () => {
    vi.mocked(api.fetchFolderDirectory).mockImplementation(async (query) => query?.q ? result([80]) : result([1]));
    const wrapper = await render(ExploreView, '/explore?q=Album&tab=folders');
    expect(wrapper.text()).toContain('Album 80');
    vi.mocked(api.fetchFolderDirectory).mockResolvedValueOnce(result([90], 90, 2));
    await wrapper.get('[data-test="more"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Album 90');
    expect(useLibraryDirectoryStore().initialized).toBe(false);
    wrapper.unmount();
  });
});

describe.skipIf(process.env.FOLDER_DIRECTORY_BENCHMARK !== '1')('Library mount benchmark (jsdom)', () => {
  it.each([1500, 5000, 10000])('mounts the first page for %i total folders', async (total) => {
    vi.mocked(api.fetchFolderDirectory).mockResolvedValue(result(Array.from({ length: 50 }, (_, index) => index + 1), total));
    const start = performance.now();
    const wrapper = await render(LibraryView);
    console.info('[folder-directory-mount]', { total, renderedRows: wrapper.findAll('a').length, mountMs: +(performance.now() - start).toFixed(2) });
    expect(wrapper.findAll('a')).toHaveLength(50);
    wrapper.unmount();
  });
});
