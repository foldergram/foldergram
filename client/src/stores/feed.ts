import { defineStore } from 'pinia';

import { fetchFeed } from '../api/gallery';
import type { FeedItem, FeedMode } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

interface FeedState {
  mode: FeedMode;
  loadedMode: FeedMode | null;
  items: FeedItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  randomSeed: number | null;
  reloadRequested: boolean;
  /**
   * Post ids already shown in this session. Pull-to-refresh sends them so the next
   * batch is genuinely new content instead of a reshuffle of the same rows.
   */
  seenIds: number[];
  refreshing: boolean;
}

/**
 * Server-side cap. Sending more than this would grow the SQL `NOT IN (...)` without
 * bound, and past that point rotating the seed already reshuffles enough.
 */
const MAX_EXCLUDED_IDS = 500;

function createRandomSeed(): number {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    return cryptoObject.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 2_147_483_647);
  }

  return Math.floor(Math.random() * 2_147_483_647);
}

export const useFeedStore = defineStore('feed', {
  state: (): FeedState => ({
    mode: 'random',
    loadedMode: null,
    items: [],
    page: 1,
    limit: 18,
    hasMore: true,
    loading: false,
    error: null,
    initialized: false,
    randomSeed: null,
    reloadRequested: false,
    seenIds: [],
    refreshing: false
  }),
  getters: {
    /** Newest ids first, so the cap keeps what the viewer saw most recently. */
    excludedIds: (state): number[] => state.seenIds.slice(-MAX_EXCLUDED_IDS)
  },
  actions: {
    initializeMode(mode: FeedMode = 'random') {
      this.mode = mode;

      if (mode !== 'random') {
        this.randomSeed = null;
      }
    },

    ensureRandomSeed() {
      if (this.randomSeed !== null) {
        return this.randomSeed;
      }

      this.randomSeed = createRandomSeed();
      return this.randomSeed;
    },

    async setMode(mode: FeedMode) {
      if (this.mode === mode && this.initialized && mode !== 'random') {
        return;
      }

      this.mode = mode;
      this.randomSeed = mode === 'random' ? createRandomSeed() : null;
      this.seenIds = [];
      await this.loadInitial(true);
    },

    rememberSeenIds(items: FeedItem[]) {
      if (items.length === 0) {
        return;
      }

      const known = new Set(this.seenIds);
      const additions = items.map((item) => item.id).filter((id) => !known.has(id));
      if (additions.length === 0) {
        return;
      }

      this.seenIds = [...this.seenIds, ...additions].slice(-MAX_EXCLUDED_IDS * 2);
    },

    /**
     * Pull-to-refresh. Rotates the shuffle seed and asks the server to skip everything
     * already shown, so the top of the feed is new rather than reordered.
     */
    async refreshWithNewSeed() {
      if (this.refreshing || this.loading) {
        return;
      }

      this.refreshing = true;

      try {
        if (this.mode === 'random') {
          this.randomSeed = createRandomSeed();
        }

        await this.loadInitial(true);

        // A library smaller than the exclusion list would come back empty, which reads
        // as breakage. Dropping the memory and retrying gives the viewer content again.
        if (this.items.length === 0 && this.seenIds.length > 0) {
          this.seenIds = [];
          await this.loadInitial(true);
        }
      } finally {
        this.refreshing = false;
      }
    },

    removeImage(id: number) {
      this.items = this.items.filter((item) => item.id !== id);
    },

    removeFolderItems(folderSlug: string) {
      this.items = this.items.filter((item) => item.folderSlug !== folderSlug);
    },

    updateImageCaption(id: number, caption: string | null) {
      this.items = updateCaptionInItems(this.items, id, caption);
    },

    resetForRebuild() {
      this.loadedMode = null;
      this.items = [];
      this.seenIds = [];
      this.page = 1;
      this.hasMore = true;
      this.loading = false;
      this.error = null;
      this.initialized = false;
      this.reloadRequested = false;
    },

    async loadInitial(force = false) {
      const queueRequiresSeed = this.mode === 'random';
      const queueMatchesMode = this.loadedMode === this.mode && (!queueRequiresSeed || this.randomSeed !== null);

      if (this.loading) {
        if (force || !queueMatchesMode) {
          this.reloadRequested = true;
        }
        return;
      }

      if (this.initialized && !force && queueMatchesMode) {
        return;
      }

      this.items = [];
      this.loadedMode = null;
      this.page = 1;
      this.hasMore = true;
      this.initialized = false;
      this.reloadRequested = false;
      await this.loadMore();
    },

    async loadMore() {
      if (this.loading || !this.hasMore) {
        return;
      }

      this.loading = true;
      this.error = null;
      const requestMode = this.mode;
      const requestPage = this.page;
      const requestSeed = requestMode === 'random' ? this.ensureRandomSeed() : undefined;
      // Only the refreshed first page excludes: later pages already paginate past them,
      // and excluding there would shift the offsets under the query.
      const requestExcludedIds = this.refreshing && requestPage === 1 ? this.excludedIds : undefined;

      try {
        const payload = await fetchFeed(requestPage, this.limit, requestMode, requestSeed, requestExcludedIds);

        const modeChanged = this.mode !== requestMode;
        const seedChanged = requestMode === 'random' && this.randomSeed !== requestSeed;
        const pageChanged = this.page !== requestPage;

        if (modeChanged || seedChanged || pageChanged) {
          return;
        }

        this.items.push(...payload.items);
        this.rememberSeenIds(payload.items);
        this.loadedMode = payload.mode ?? requestMode;
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to load feed';
      } finally {
        this.loading = false;

        if (this.reloadRequested) {
          this.reloadRequested = false;
          await this.loadInitial(true);
        }
      }
    }
  }
});
