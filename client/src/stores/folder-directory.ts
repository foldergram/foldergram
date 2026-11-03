import { defineStore } from 'pinia';
import { fetchFolderDirectory } from '../api/gallery';
import { i18n } from '../locales';
import type { FolderDirectoryPayload, FolderDirectorySort, FolderSummary } from '../types/api';

// Library and Explore own independent query, pagination, and request generations.
function directoryStore(id: string) {
  return defineStore(id, {
    state: () => ({
      items: [] as FolderSummary[],
      query: '',
      sort: 'recent-desc' as FolderDirectorySort,
      page: 0,
      limit: 50,
      total: 0,
      unfilteredTotal: null as number | null,
      hasMore: false,
      loading: false,
      error: null as string | null,
      initialized: false,
      stale: false,
      active: false,
      generation: 0
    }),
    actions: {
      reset() {
        const generation = this.generation + 1;
        this.$reset();
        this.generation = generation;
      },
      async search(query: string, sort?: FolderDirectorySort) {
        sort ??= this.sort;
        const normalized = query.trim().replace(/\s+/g, ' ');
        if ((this.initialized || this.loading) && normalized === this.query && sort === this.sort && !this.stale) return;
        this.query = normalized;
        this.sort = sort;
        this.items = [];
        this.page = 0;
        this.total = 0;
        await this.load(true);
      },
      async load(refresh = false) {
        if (!refresh && (this.loading || !this.hasMore)) return;
        const generation = refresh ? ++this.generation : this.generation;
        const pages = refresh ? Math.max(1, this.page) : 1;
        const startPage = refresh ? 1 : this.page + 1;
        this.loading = true;
        this.error = null;
        this.stale = false;
        try {
          const items = refresh ? [] : this.items.slice();
          let lastPayload: FolderDirectoryPayload | undefined;
          for (let page = startPage; page < startPage + pages; page++) {
            const payload = await fetchFolderDirectory({ page, limit: this.limit, q: this.query, sort: this.sort });
            if (generation !== this.generation) return;
            const ids = new Set(items.map((item) => item.id));
            items.push(...payload.items.filter((item) => !ids.has(item.id)));
            lastPayload = payload;
            if (!payload.hasMore) break;
          }
          this.items = items;
          if (lastPayload) {
            this.total = lastPayload.total;
            if (!this.query) this.unfilteredTotal = lastPayload.total;
            this.hasMore = lastPayload.hasMore;
            this.page = lastPayload.page;
          }
          this.initialized = true;
        } catch (error) {
          if (generation === this.generation) {
            this.error = error instanceof Error ? error.message : i18n.global.t('libraryPage.errors.load');
            this.stale = true;
          }
        } finally {
          if (generation === this.generation) {
            this.loading = false;
            if (this.stale && this.active && !this.error) void this.load(true);
          }
        }
      },
      invalidate(unfilteredTotal?: number) {
        this.unfilteredTotal = unfilteredTotal ?? null;
        this.stale = true;
        if (this.active && this.initialized) void this.load(true);
      },
      replaceSummary(summary: FolderSummary) {
        this.items = this.items.map((item) => item.slug === summary.slug ? summary : item);
        this.invalidate();
      },
      removeSummary(slug: string) {
        this.items = this.items.filter((item) => item.slug !== slug);
        this.invalidate();
      },
      async activate() {
        this.active = true;
        if (!this.initialized || this.stale) await this.load(true);
      }
    }
  });
}

export const useLibraryDirectoryStore = directoryStore('library-directory');
export const useFolderSearchStore = directoryStore('folder-search');
