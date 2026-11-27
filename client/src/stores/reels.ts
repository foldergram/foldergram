import { defineStore } from 'pinia';

import { fetchImage, fetchReels } from '../api/gallery';
import { i18n } from '../locales';
import type { FeedItem, ReelsFeedMode } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';
import { resolveReelsAffinitySnapshot, type ReelsAffinitySnapshot } from '../utils/reels';
import { useAppStore } from './app';

interface ReelSessionSnapshot {
  mode: ReelsFeedMode;
  loadedMode: ReelsFeedMode | null;
  items: FeedItem[];
  page: number;
  cursor: string | null;
  hasMore: boolean;
  initialized: boolean;
  seed: number | null;
  affinitySnapshot: ReelsAffinitySnapshot | null;
  activeReelId: number | null;
}

const MAX_SAVED_REEL_SESSIONS = 5;
// A page can contain only IDs already in the queue (including the Home anchor).
// Look ahead a bounded number of pages, without spinning on a broken cursor.
const MAX_OVERLAP_PAGES_PER_LOAD = 16;

interface ReelsState {
  sessionKey: string;
  savedSessions: Record<string, ReelSessionSnapshot>;
  mode: ReelsFeedMode;
  loadedMode: ReelsFeedMode | null;
  items: FeedItem[];
  page: number;
  limit: number;
  cursor: string | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  seed: number | null;
  affinitySnapshot: ReelsAffinitySnapshot | null;
  activeReelId: number | null;
  requestId: number;
  openReelRequestId: number;
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
    sessionKey: 'standalone',
    savedSessions: {},
    mode: 'random',
    loadedMode: null,
    items: [],
    page: 1,
    limit: 6,
    cursor: null,
    hasMore: true,
    loading: false,
    error: null,
    initialized: false,
    seed: null,
    affinitySnapshot: null,
    activeReelId: null,
    requestId: 0,
    openReelRequestId: 0
  }),
  getters: {
    activeItem: (state) => state.items.find((item) => item.id === state.activeReelId) ?? state.items[0] ?? null,
    isInitialLoading: (state) => state.loading && !state.initialized,
    isLoadingMore: (state) => state.loading && state.initialized && state.items.length > 0
  },
  actions: {
    syncModeWithDefault(force = false) {
      const appStore = useAppStore();
      const nextMode = appStore.defaultReelsFeedMode;
      const modeChanged = this.mode !== nextMode;

      this.mode = nextMode;

      if (modeChanged) {
        this.seed = null;
        this.cursor = null;
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

    invalidatePendingOpenReel() {
      this.openReelRequestId += 1;
    },

    saveSession() {
      if (!this.initialized) return;
      // Retain bounded queues for Back/Forward, without retaining media elements.
      delete this.savedSessions[this.sessionKey];
      this.savedSessions[this.sessionKey] = {
        mode: this.mode,
        loadedMode: this.loadedMode,
        items: [...this.items],
        page: this.page,
        cursor: this.cursor,
        hasMore: this.hasMore,
        initialized: this.initialized,
        seed: this.seed,
        affinitySnapshot: this.affinitySnapshot,
        activeReelId: this.activeReelId
      };
      while (Object.keys(this.savedSessions).length > MAX_SAVED_REEL_SESSIONS) {
        delete this.savedSessions[Object.keys(this.savedSessions)[0]!];
      }
    },

    pauseSession() {
      // Reject delayed detail and page responses after unmount.
      this.requestId += 1;
      this.invalidatePendingOpenReel();
      this.loading = false;
      this.saveSession();
    },

    activateSession(key: string) {
      if (key === this.sessionKey) return;
      this.pauseSession();
      this.sessionKey = key;
      const saved = this.savedSessions[key];
      delete this.savedSessions[key];
      this.items = saved ? [...saved.items] : [];
      this.mode = saved?.mode ?? 'random';
      this.loadedMode = saved?.loadedMode ?? null;
      this.page = saved?.page ?? 1;
      this.cursor = saved?.cursor ?? null;
      this.hasMore = saved?.hasMore ?? true;
      this.initialized = saved?.initialized ?? false;
      this.seed = saved?.seed ?? null;
      this.affinitySnapshot = saved?.affinitySnapshot ?? null;
      this.activeReelId = saved?.activeReelId ?? null;
      this.loading = false;
      this.error = null;
    },

    reset() {
      this.sessionKey = 'standalone';
      this.savedSessions = {};
      this.mode = 'random';
      this.loadedMode = null;
      this.items = [];
      this.page = 1;
      this.cursor = null;
      this.hasMore = true;
      this.loading = false;
      this.error = null;
      this.initialized = false;
      this.seed = null;
      this.affinitySnapshot = null;
      this.activeReelId = null;
      this.requestId += 1;
      this.invalidatePendingOpenReel();
    },

    async loadInitial(force = false) {
      const modeChanged = this.syncModeWithDefault(force);
      const queueRequiresSeed = this.mode !== 'recent';
      const queueMatchesMode = this.loadedMode === this.mode && (!queueRequiresSeed || this.seed !== null);

      if (this.initialized && !force && !modeChanged && queueMatchesMode) {
        return;
      }

      this.requestId += 1;
      this.items = [];
      this.loadedMode = null;
      this.page = 1;
      this.cursor = null;
      this.hasMore = true;
      this.loading = false;
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

      const requestId = ++this.requestId;
      this.loading = true;
      this.error = null;

      try {
        let addedUnique = false;
        let checkedPages = 0;
        while (this.hasMore && !addedUnique && checkedPages < MAX_OVERLAP_PAGES_PER_LOAD) {
          checkedPages += 1;
          const previousCursor = this.cursor;
          const payload = await fetchReels(
            this.page,
            this.limit,
            this.mode,
            this.mode === 'recent' ? undefined : this.ensureSeed(),
            {
              ...(this.mode === 'recommended'
                ? {
                    lastFolder: this.affinitySnapshot?.lastFolder ?? null,
                    recentFolders: this.affinitySnapshot?.recentFolders ?? []
                  }
                : {}),
              cursor: this.cursor
            }
          );

          if (requestId !== this.requestId) return;

          const knownIds = new Set(this.items.map(item => item.id));
          const uniqueItems = payload.items.filter(item => {
            if (knownIds.has(item.id)) return false;
            knownIds.add(item.id);
            return true;
          });
          this.items.push(...uniqueItems);
          addedUnique = uniqueItems.length > 0;
          this.loadedMode = payload.mode ?? this.mode;
          this.cursor = payload.nextCursor ?? null;
          this.page = payload.page + 1;
          this.hasMore = payload.hasMore;
          this.initialized = true;

          // A server returning the same non-null cursor cannot advance.
          if (this.hasMore && previousCursor !== null && this.cursor === previousCursor) {
            this.hasMore = false;
            this.error = 'Reels pagination did not advance';
            break;
          }
        }

        if (this.activeReelId === null && this.items.length > 0) {
          this.activeReelId = this.items[0]?.id ?? null;
        }
      } catch (error) {
        if (requestId !== this.requestId) {
          return;
        }

        this.error = error instanceof Error ? error.message : i18n.global.t('reels.view.loadErrorTitle');
      } finally {
        if (requestId === this.requestId) {
          this.loading = false;
        }
      }
    },

    async openReel(id: number): Promise<boolean> {
      const openRequestId = ++this.openReelRequestId;
      this.error = null;
      if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error('Invalid Reel ID');
      }

      if (!this.initialized) {
        await this.loadInitial();
        if (openRequestId !== this.openReelRequestId) return false;
      }

      let item = this.items.find((reel) => reel.id === id);
      if (!item) {
        const detail = await fetchImage(id, 'video');
        // A completed older request must never replace a newer URL's active Reel.
        if (openRequestId !== this.openReelRequestId) return false;
        if (detail.mediaType !== 'video') {
          throw new Error('This post is not a Reel');
        }
        item = detail;
        // Keep the requested Reel in the current queue without changing its original identity.
        this.items = [item, ...this.items.filter((reel) => reel.id !== id)];
      }
      if (openRequestId !== this.openReelRequestId) return false;
      this.activeReelId = item.id;
      this.error = null;
      return true;
    },

    async prefetchIfNeeded(activeIndex: number) {
      if (activeIndex < 0 || !this.hasMore || this.loading) {
        return;
      }

      if (activeIndex >= this.items.length - 3) {
        await this.loadMore();
      }
    },

    updateImageCaption(id: number, caption: string | null) {
      this.items = updateCaptionInItems(this.items, id, caption);
    }
  }
});
