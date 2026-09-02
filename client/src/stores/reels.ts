import { defineStore } from 'pinia';

import { fetchReels } from '../api/gallery';
import type { FeedItem, ReelsFeedMode } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';
import { resolveReelsAffinitySnapshot, type ReelsAffinitySnapshot } from '../utils/reels';
import { useAppStore } from './app';

interface ReelsState {
  mode: ReelsFeedMode;
  loadedMode: ReelsFeedMode | null;
  items: FeedItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  seed: number | null;
  affinitySnapshot: ReelsAffinitySnapshot | null;
  activeReelId: number | null;
}

function createReelsSeed(): number {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    return cryptoObject.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 2_147_483_647);
  }

  return Math.floor(Math.random() * 2_147_483_647);
}

export const useReelsStore = defineStore('reels', {
  state: (): ReelsState => ({
    mode: 'random',
    loadedMode: null,
    items: [],
    page: 1,
    limit: 6,
    hasMore: true,
    loading: false,
    error: null,
    initialized: false,
    seed: null,
    affinitySnapshot: null,
    activeReelId: null
  }),
  getters: {
    activeItem: (state) => state.items.find((item) => item.id === state.activeReelId) ?? state.items[0] ?? null
  },
  actions: {
    syncModeWithDefault(force = false) {
      const appStore = useAppStore();
      const nextMode = appStore.defaultReelsFeedMode;
      const modeChanged = this.mode !== nextMode;

      this.mode = nextMode;

      if (modeChanged) {
        this.seed = null;
      }

      this.affinitySnapshot = this.mode === 'recommended' && !force && !modeChanged ? this.affinitySnapshot : null;
      return modeChanged;
    },

    ensureSeed() {
      if (this.seed !== null) {
        return this.seed;
      }

      this.seed = createReelsSeed();
      return this.seed;
    },

    setActiveReel(id: number | null) {
      this.activeReelId = id;
    },

    reset() {
      this.mode = 'random';
      this.loadedMode = null;
      this.items = [];
      this.page = 1;
      this.hasMore = true;
      this.loading = false;
      this.error = null;
      this.initialized = false;
      this.seed = null;
      this.affinitySnapshot = null;
      this.activeReelId = null;
    },

    async loadInitial(force = false) {
      if (this.loading) {
        return;
      }

      const modeChanged = this.syncModeWithDefault(force);
      const queueRequiresSeed = this.mode !== 'recent';
      const queueMatchesMode = this.loadedMode === this.mode && (!queueRequiresSeed || this.seed !== null);

      if (this.initialized && !force && !modeChanged && queueMatchesMode) {
        return;
      }

      this.items = [];
      this.loadedMode = null;
      this.page = 1;
      this.hasMore = true;
      this.error = null;
      this.initialized = false;
      this.activeReelId = null;
      await this.loadMore();
    },

    async loadMore() {
      if (this.loading || !this.hasMore) {
        return;
      }

      const appStore = useAppStore();
      if (this.mode === 'recommended') {
        this.affinitySnapshot = resolveReelsAffinitySnapshot(
          this.affinitySnapshot,
          appStore.lastOpenedFolderSlug,
          appStore.recentOpenedFolderSlugs
        );
      } else {
        this.affinitySnapshot = null;
      }

      this.loading = true;
      this.error = null;

      try {
        const payload = await fetchReels(
          this.page,
          this.limit,
          this.mode,
          this.mode === 'recent' ? undefined : this.ensureSeed(),
          this.mode === 'recommended'
            ? {
                lastFolder: this.affinitySnapshot?.lastFolder ?? null,
                recentFolders: this.affinitySnapshot?.recentFolders ?? []
              }
            : {}
        );

        this.items.push(...payload.items);
        this.loadedMode = payload.mode ?? this.mode;
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;

        if (this.activeReelId === null && this.items.length > 0) {
          this.activeReelId = this.items[0]?.id ?? null;
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to load reels';
      } finally {
        this.loading = false;
      }
    },

    async prefetchIfNeeded(activeIndex: number) {
      if (activeIndex < 0 || !this.hasMore || this.loading) {
        return;
      }

      if (activeIndex >= this.items.length - 3) {
        await this.loadMore();
      }
    },

    removeImage(id: number) {
      const wasActive = this.activeReelId === id;
      const removedIndex = this.items.findIndex((item) => item.id === id);
      this.items = this.items.filter((item) => item.id !== id);

      if (!wasActive) {
        return;
      }

      // Keeping the position rather than the id is what lets the deck slide onto
      // the next clip instead of jumping back to the top of the queue.
      const nextIndex = Math.min(Math.max(removedIndex, 0), this.items.length - 1);
      this.activeReelId = nextIndex >= 0 ? this.items[nextIndex]?.id ?? null : null;
    },

    updateImageCaption(id: number, caption: string | null) {
      this.items = updateCaptionInItems(this.items, id, caption);
    }
  }
});
