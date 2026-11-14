import { defineStore } from 'pinia';

import { fetchLikes, likeImage, unlikeImage } from '../api/gallery';
import { i18n } from '../locales';
import type { FeedItem, LikesMode } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';
import { useAuthStore } from './auth';

interface LikesState {
  mode: LikesMode;
  items: FeedItem[];
  likedIds: number[];
  pendingIds: number[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  generation: number;
  initialization: Promise<void> | null;
}

const LOCAL_FAVORITES_STORAGE_KEY = 'foldergram-local-favorites';

function isFeedItem(value: unknown): value is FeedItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<FeedItem>;
  return (
    typeof item.id === 'number' &&
    typeof item.folderId === 'number' &&
    typeof item.folderSlug === 'string' &&
    typeof item.folderName === 'string' &&
    typeof item.folderPath === 'string' &&
    (item.folderBreadcrumb === null || item.folderBreadcrumb === undefined || typeof item.folderBreadcrumb === 'string') &&
    typeof item.filename === 'string' &&
    typeof item.width === 'number' &&
    typeof item.height === 'number' &&
    (item.mediaType === 'image' || item.mediaType === 'video') &&
    (item.durationMs === null || item.durationMs === undefined || typeof item.durationMs === 'number') &&
    (item.isAnimated === null || item.isAnimated === undefined || typeof item.isAnimated === 'boolean') &&
    typeof item.thumbnailUrl === 'string' &&
    typeof item.previewUrl === 'string' &&
    typeof item.sortTimestamp === 'number' &&
    (item.takenAt === null || item.takenAt === undefined || typeof item.takenAt === 'number') &&
    (item.isSaved === undefined || typeof item.isSaved === 'boolean')
  );
}

function readLocalFavorites(): FeedItem[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const rawValue = window.localStorage.getItem(LOCAL_FAVORITES_STORAGE_KEY);
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seenIds = new Set<number>();
    return parsed.filter((entry): entry is FeedItem => {
      if (!isFeedItem(entry) || seenIds.has(entry.id)) {
        return false;
      }

      seenIds.add(entry.id);
      return true;
    }).map((item) => ({
      ...item,
      isSaved: item.isSaved ?? false
    }));
  } catch {
    return [];
  }
}

function writeLocalFavorites(items: FeedItem[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LOCAL_FAVORITES_STORAGE_KEY, JSON.stringify(items));
}

export const useLikesStore = defineStore('likes', {
  state: (): LikesState => ({
    mode: 'shared',
    items: [],
    likedIds: [],
    pendingIds: [],
    loading: false,
    error: null,
    initialized: false,
    generation: 0,
    initialization: null
  }),
  getters: {
    isLiked: (state) => (id: number) => state.likedIds.includes(id),
    isPending: (state) => (id: number) => state.pendingIds.includes(id),
    itemsForFolder: (state) => (slug: string) => state.items.filter(item => item.folderSlug === slug),
    collectionLabel: (state) => {
      void i18n.global.locale.value;
      return state.mode === 'local'
        ? i18n.global.t('likes.labels.localCollection')
        : i18n.global.t('likes.labels.sharedCollection');
    },
    collectionSectionLabel: (state) => {
      void i18n.global.locale.value;
      return state.mode === 'local'
        ? i18n.global.t('likes.labels.localSection')
        : i18n.global.t('likes.labels.sharedSection');
    },
    emptyTitle: (state) => {
      void i18n.global.locale.value;
      return state.mode === 'local'
        ? i18n.global.t('likes.states.localEmptyTitle')
        : i18n.global.t('likes.states.sharedEmptyTitle');
    },
    emptyDescription: (state) => {
      void i18n.global.locale.value;
      return state.mode === 'local'
        ? i18n.global.t('likes.states.localEmptyDescription')
        : i18n.global.t('likes.states.sharedEmptyDescription');
    },
    loadingLabel: (state) => {
      void i18n.global.locale.value;
      return state.mode === 'local'
        ? i18n.global.t('likes.states.localLoadingLabel')
        : i18n.global.t('likes.states.sharedLoadingLabel');
    },
    errorTitle: (state) => {
      void i18n.global.locale.value;
      return state.mode === 'local'
        ? i18n.global.t('likes.states.localErrorTitle')
        : i18n.global.t('likes.states.sharedErrorTitle');
    },
    toggleAriaLabel: (state) => (liked: boolean) =>
      state.mode === 'local'
        ? liked
          ? i18n.global.t('likes.actions.removeFavoriteFromPost')
          : i18n.global.t('likes.actions.favoritePost')
        : liked
          ? i18n.global.t('likes.actions.unlikePost')
          : i18n.global.t('likes.actions.likePost')
  },
  actions: {
    syncFromItems(items: FeedItem[], mode: LikesMode) {
      this.mode = mode;
      this.items = items;
      this.likedIds = items.map((item) => item.id);
    },

    resetForRebuild() {
      const authStore = useAuthStore();

      this.generation++;
      this.initialization = null;
      this.mode = authStore.likesMode;
      this.items = [];
      this.likedIds = [];
      this.pendingIds = [];
      this.loading = false;
      this.error = null;
      this.initialized = false;
    },

    async initialize(force = false) {
      const authStore = useAuthStore();
      if (!authStore.canUseSavedItems) {
        this.resetForRebuild();
        return;
      }

      const mode = authStore.likesMode;
      if (this.mode !== mode) this.resetForRebuild();
      if (this.initialization) return this.initialization;
      if (this.initialized && !force) {
        return;
      }

      this.loading = true;
      this.error = null;
      const generation = this.generation;

      const request = (async () => {
        try {
          if (mode === 'shared') {
            const payload = await fetchLikes();
            if (generation !== this.generation || mode !== authStore.likesMode || !authStore.canUseSavedItems) return;
            this.syncFromItems(payload.items, mode);
          } else {
            this.syncFromItems(readLocalFavorites(), mode);
          }

          this.initialized = true;
        } catch (error) {
          if (generation !== this.generation) return;
          this.error = error instanceof Error
            ? error.message
            : mode === 'local'
              ? i18n.global.t('likes.errors.loadLocal')
              : i18n.global.t('likes.errors.loadShared');
        } finally {
          if (generation === this.generation) this.loading = false;
        }
      })();

      this.initialization = request;
      try {
        await request;
      } finally {
        if (this.initialization === request) this.initialization = null;
      }
    },

    ensureLocalFavoritesLoaded() {
      if (useAuthStore().likesMode === 'local' && (!this.initialized || this.mode !== 'local')) {
        this.syncFromItems(readLocalFavorites(), 'local');
        this.initialized = true;
      }
    },

    async toggleLike(item: FeedItem) {
      const authStore = useAuthStore();
      if (!authStore.canUseSavedItems || this.pendingIds.includes(item.id)) {
        return;
      }

      await this.initialize();
      if (!authStore.canUseSavedItems || !this.initialized || this.mode !== authStore.likesMode || this.pendingIds.includes(item.id)) {
        return;
      }

      const mode = authStore.likesMode;
      const wasLiked = this.likedIds.includes(item.id);
      this.mode = mode;
      this.pendingIds.push(item.id);
      this.error = null;

      if (wasLiked) {
        this.likedIds = this.likedIds.filter((id) => id !== item.id);
        this.items = this.items.filter((entry) => entry.id !== item.id);
      } else {
        this.likedIds = [item.id, ...this.likedIds.filter((id) => id !== item.id)];
        this.items = [item, ...this.items.filter((entry) => entry.id !== item.id)];
      }

      try {
        if (mode === 'local') {
          writeLocalFavorites(this.items);
          this.initialized = true;
        } else if (wasLiked) {
          await unlikeImage(item.id);
        } else {
          await likeImage(item.id);
        }
      } catch (error) {
        if (wasLiked) {
          this.likedIds = [item.id, ...this.likedIds.filter((id) => id !== item.id)];
          this.items = [item, ...this.items.filter((entry) => entry.id !== item.id)];
        } else {
          this.likedIds = this.likedIds.filter((id) => id !== item.id);
          this.items = this.items.filter((entry) => entry.id !== item.id);
        }

        this.error = error instanceof Error
          ? error.message
          : mode === 'local'
            ? i18n.global.t('likes.errors.updateLocal')
            : i18n.global.t('likes.errors.updateShared');
      } finally {
        if (mode === 'local') {
          writeLocalFavorites(this.items);
        }

        this.pendingIds = this.pendingIds.filter((id) => id !== item.id);
      }
    },

    removeImage(id: number) {
      this.ensureLocalFavoritesLoaded();
      this.likedIds = this.likedIds.filter((entry) => entry !== id);
      this.items = this.items.filter((entry) => entry.id !== id);
      this.pendingIds = this.pendingIds.filter((entry) => entry !== id);

      if (this.mode === 'local') {
        writeLocalFavorites(this.items);
      }
    },

    removeFolderItems(folderSlug: string) {
      this.ensureLocalFavoritesLoaded();
      const removedIds = new Set(this.items.filter((item) => item.folderSlug === folderSlug).map((item) => item.id));
      this.items = this.items.filter((item) => item.folderSlug !== folderSlug);
      this.likedIds = this.likedIds.filter((id) => !removedIds.has(id));
      this.pendingIds = this.pendingIds.filter((id) => !removedIds.has(id));

      if (this.mode === 'local') {
        writeLocalFavorites(this.items);
      }
    },

    updateImageCaption(id: number, caption: string | null) {
      this.ensureLocalFavoritesLoaded();
      this.items = updateCaptionInItems(this.items, id, caption);

      if (this.mode === 'local') {
        writeLocalFavorites(this.items);
      }
    }
  }
});
