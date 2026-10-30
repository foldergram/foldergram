import { defineStore } from 'pinia';

import { fetchTrashImages } from '../api/gallery';
import { i18n } from '../locales';
import type { TrashItem } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

interface TrashState {
  items: TrashItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
}

export const useTrashStore = defineStore('trash', {
  state: (): TrashState => ({
    items: [],
    page: 1,
    limit: 24,
    hasMore: true,
    loading: false,
    error: null,
    initialized: false
  }),
  actions: {
    removeItems(ids: number[]) {
      if (ids.length === 0) {
        return;
      }

      const idSet = new Set(ids);
      this.items = this.items.filter((item) => !idSet.has(item.id));
    },

    reset() {
      this.items = [];
      this.page = 1;
      this.hasMore = true;
      this.loading = false;
      this.error = null;
      this.initialized = false;
    },

    async loadInitial(force = false) {
      if (this.loading) {
        return;
      }

      if (this.initialized && !force) {
        return;
      }

      const preserveExistingState = force && this.initialized;

      this.page = 1;
      this.hasMore = true;

      if (!preserveExistingState) {
        this.items = [];
        this.error = null;
        this.initialized = false;
      }

      this.loading = true;
      this.error = null;

      try {
        const payload = await fetchTrashImages(this.page, this.limit);
        this.items = payload.items;
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : i18n.global.t('trashPage.loadErrorTitle');
      } finally {
        this.loading = false;
      }
    },

    async loadMore() {
      if (this.loading || !this.hasMore) {
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const payload = await fetchTrashImages(this.page, this.limit);
        this.items.push(...payload.items);
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : i18n.global.t('trashPage.loadErrorTitle');
      } finally {
        this.loading = false;
      }
    },

    updateImageCaption(id: number, caption: string | null) {
      this.items = updateCaptionInItems(this.items, id, caption);
    }
  }
});
