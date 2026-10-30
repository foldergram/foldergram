import { defineStore } from 'pinia';

import {
  fetchSharedFolderAccess,
  fetchSharedFolderImages,
  fetchSharedImage,
  fetchSharedPost,
  unlockSharedFolderLink,
  unlockSharedFolderPassword
} from '../api/gallery';
import { i18n } from '../locales';
import type {
  FolderShareAccessState,
  SharedFeedItem,
  SharedFolderSummary,
  SharedImageDetail
} from '../types/api';

interface ShareState {
  access: FolderShareAccessState | null;
  folder: SharedFolderSummary | null;
  images: SharedFeedItem[];
  image: SharedImageDetail | null;
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  unlocking: boolean;
  error: string | null;
  unlockError: string | null;
}

let shareLoadToken = 0;

export const useShareStore = defineStore('share', {
  state: (): ShareState => ({
    access: null,
    folder: null,
    images: [],
    image: null,
    page: 1,
    limit: 24,
    hasMore: true,
    loading: false,
    unlocking: false,
    error: null,
    unlockError: null
  }),
  actions: {
    reset() {
      shareLoadToken += 1;
      this.access = null;
      this.folder = null;
      this.images = [];
      this.image = null;
      this.page = 1;
      this.hasMore = true;
      this.loading = false;
      this.unlocking = false;
      this.error = null;
      this.unlockError = null;
    },

    async loadAccess(slug: string) {
      this.access = await fetchSharedFolderAccess(slug);
      return this.access;
    },

    async unlockLink(slug: string, token: string) {
      this.unlocking = true;
      this.unlockError = null;

      try {
        await unlockSharedFolderLink(slug, token);
        await this.loadAccess(slug);
      } catch (error) {
        this.unlockError = error instanceof Error ? error.message : i18n.global.t('errors.unlockFolderShare');
        throw error;
      } finally {
        this.unlocking = false;
      }
    },

    async unlockPassword(slug: string, password: string) {
      this.unlocking = true;
      this.unlockError = null;

      try {
        await unlockSharedFolderPassword(slug, password);
        await this.loadAccess(slug);
      } catch (error) {
        this.unlockError = error instanceof Error ? error.message : i18n.global.t('errors.unlockFolderShare');
        throw error;
      } finally {
        this.unlocking = false;
      }
    },

    async loadFolder(slug: string, reset = true) {
      const requestToken = ++shareLoadToken;

      if (reset) {
        this.folder = null;
        this.images = [];
        this.page = 1;
        this.hasMore = true;
      }

      this.loading = true;
      this.error = null;

      try {
        const payload = await fetchSharedFolderImages(slug, this.page, this.limit);
        if (requestToken !== shareLoadToken) {
          return;
        }

        this.folder = payload.folder;
        this.images.push(...payload.items);
        this.page += 1;
        this.hasMore = payload.hasMore;
      } catch (error) {
        if (requestToken !== shareLoadToken) {
          return;
        }

        this.error = error instanceof Error ? error.message : i18n.global.t('share.errorDescription');
      } finally {
        if (requestToken === shareLoadToken) {
          this.loading = false;
        }
      }
    },

    async loadImage(id: number, mediaType?: 'image' | 'video', options: { legacyImageAlias?: boolean } = {}) {
      const requestToken = ++shareLoadToken;
      this.loading = true;
      this.error = null;

      try {
        const image = options.legacyImageAlias
          ? await fetchSharedImage(id, mediaType)
          : await fetchSharedPost(id, mediaType);
        if (requestToken !== shareLoadToken) {
          return;
        }

        this.image = image;
      } catch (error) {
        if (requestToken !== shareLoadToken) {
          return;
        }

        this.image = null;
        this.error = error instanceof Error ? error.message : i18n.global.t('errors.loadSharedPost');
      } finally {
        if (requestToken === shareLoadToken) {
          this.loading = false;
        }
      }
    }
  }
});
