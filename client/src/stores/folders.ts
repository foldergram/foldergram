import { defineStore } from 'pinia';

import {
  createFolderShareLink,
  fetchFolderImages,
  fetchFolderShareLinks,
  fetchFolderDirectory,
  fetchFolder,
  removeFolderSharePassword,
  revokeFolderShareLink,
  setFolderCover,
  setFolderSharePassword,
  updateFolderProfile
} from '../api/gallery';
import { i18n } from '../locales';
import type {
  CreateFolderShareLinkInput,
  FeedItem,
  FolderShareLink,
  FolderSharePasswordStatus,
  FolderSummary
} from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

import { useLibraryDirectoryStore, useFolderSearchStore } from './folder-directory';

type FolderMediaFilter = 'all' | 'video';

interface FoldersState {
  items: FolderSummary[];
  total: number;
  summaryBySlug: Record<string, FolderSummary>;
  summaryRequests: Map<string, Promise<FolderSummary>>;
  listGeneration: number;
  listInitialized: boolean;
  loadingList: boolean;
  pendingListRefresh: boolean;
  listError: string | null;
  currentFolder: FolderSummary | null;
  currentImages: FeedItem[];
  currentFilter: FolderMediaFilter;
  currentPage: number;
  currentLimit: number;
  currentHasMore: boolean;
  loadingFolder: boolean;
  folderError: string | null;
  shareLinks: FolderShareLink[];
  sharePassword: FolderSharePasswordStatus;
  sharePublicFolderUrl: string | null;
  sharePublicAccess: boolean;
  loadingShare: boolean;
  shareError: string | null;
  lastCreatedShareUrl: string | null;
}

export const useFoldersStore = defineStore('folders', {
  state: (): FoldersState => ({
    items: [],
    total: 0,
    summaryBySlug: Object.create(null),
    summaryRequests: new Map(),
    listGeneration: 0,
    listInitialized: false,
    loadingList: false,
    pendingListRefresh: false,
    listError: null,
    currentFolder: null,
    currentImages: [],
    currentFilter: 'all',
    currentPage: 1,
    currentLimit: 24,
    currentHasMore: true,
    loadingFolder: false,
    folderError: null,
    shareLinks: [],
    sharePassword: {
      enabled: false,
      updatedAt: null
    },
    sharePublicFolderUrl: null,
    sharePublicAccess: false,
    loadingShare: false,
    shareError: null,
    lastCreatedShareUrl: null
  }),
  getters: {
    getSummary: (state) => (slug: string): FolderSummary | null => {
      if (state.currentFolder?.slug === slug) return state.currentFolder;
      // Read the key so Vue also tracks a missing summary being added later.
      const cached = state.summaryBySlug[slug];
      if (Object.hasOwn(state.summaryBySlug, slug)) return cached;
      return state.items.find((folder) => folder.slug === slug) ?? null;
    }
  },
  actions: {
    removeImage(imageId: number, folderSlug: string, mediaType: FeedItem['mediaType'] = 'image') {
      // Mutation callers ensure the summary before deleting; recommendations are
      // only one possible source of its previous post count.
      const folder = this.getSummary(folderSlug);
      const nextFolder = folder ? {
        ...folder,
        imageCount: Math.max(0, folder.imageCount - 1),
        videoCount: mediaType === 'video' ? Math.max(0, folder.videoCount - 1) : folder.videoCount
      } : null;
      const removedFolder = nextFolder?.imageCount === 0;

      this.items = this.items.flatMap((item) => {
        if (item.slug !== folderSlug) return [item];
        return removedFolder ? [] : [nextFolder ?? item];
      });
      if (nextFolder && !removedFolder) this.summaryBySlug[folderSlug] = nextFolder;
      else delete this.summaryBySlug[folderSlug];

      if (this.currentFolder?.slug === folderSlug) {
        if (this.currentFilter === 'all' || mediaType === 'video') {
          this.currentImages = this.currentImages.filter((item) => item.id !== imageId);
        }
        this.currentFolder = removedFolder ? null : nextFolder;
        if (removedFolder) {
          this.currentPage = 1;
          this.currentHasMore = false;
        }
      }

      if (removedFolder) this.total = Math.max(0, this.total - 1);
      useLibraryDirectoryStore().invalidate();
      useFolderSearchStore().invalidate();
      return removedFolder;
    },

    removeFolder(slug: string) {
      delete this.summaryBySlug[slug];
      useLibraryDirectoryStore().removeSummary(slug);
      useFolderSearchStore().removeSummary(slug);
      this.items = this.items.filter((folder) => folder.slug !== slug);

      if (this.currentFolder?.slug === slug) {
        this.currentFolder = null;
        this.currentImages = [];
        this.currentPage = 1;
        this.currentHasMore = false;
      }
    },

    updateImageCaption(id: number, caption: string | null) {
      this.currentImages = updateCaptionInItems(this.currentImages, id, caption);
    },

    resetForRebuild() {
      this.items = [];
      this.total = 0;
      this.summaryBySlug = Object.create(null);
      this.summaryRequests = new Map();
      this.listGeneration += 1;
      this.listInitialized = false;
      useLibraryDirectoryStore().reset();
      useFolderSearchStore().reset();
      this.loadingList = false;
      this.pendingListRefresh = false;
      this.listError = null;
      this.currentFolder = null;
      this.currentImages = [];
      this.currentFilter = 'all';
      this.currentPage = 1;
      this.currentHasMore = true;
      this.loadingFolder = false;
      this.folderError = null;
      this.shareLinks = [];
      this.sharePassword = {
        enabled: false,
        updatedAt: null
      };
      this.sharePublicFolderUrl = null;
      this.sharePublicAccess = false;
      this.loadingShare = false;
      this.shareError = null;
      this.lastCreatedShareUrl = null;
    },

    async fetchFolders(force = false) {
      if (this.loadingList) {
        this.pendingListRefresh = this.pendingListRefresh || force;
        return;
      }

      if (!force && this.listInitialized) {
        return;
      }

      const generation = this.listGeneration;
      this.loadingList = true;
      this.listError = null;

      try {
        const payload = await fetchFolderDirectory({ page: 1, limit: 24, sort: 'recent-desc' });
        if (generation !== this.listGeneration) return;
        this.items = payload.items;
        this.total = payload.total;
        this.listInitialized = true;
        // Initial recommendations share the existing summary cache and requests.
        // A forced refresh supersedes old lookups and restarts every affected slug.
        if (force) {
          const refreshSlugs = [...new Set([
            ...Object.keys(this.summaryBySlug),
            ...this.summaryRequests.keys(),
            ...(this.currentFolder ? [this.currentFolder.slug] : [])
          ])];
          this.summaryBySlug = Object.create(null);
          this.summaryRequests = new Map();
          for (const slug of refreshSlugs) void this.ensureSummary(slug, true).catch(() => {});
          useLibraryDirectoryStore().invalidate(payload.total);
          useFolderSearchStore().invalidate(payload.total);
        }
      } catch (error) {
        if (generation !== this.listGeneration) return;
        this.listError = error instanceof Error ? error.message : i18n.global.t('libraryPage.errors.load');
      } finally {
        if (generation === this.listGeneration) this.loadingList = false;
      }

      if (generation === this.listGeneration && this.pendingListRefresh) {
        this.pendingListRefresh = false;
        await this.fetchFolders(true);
      }
    },

    replaceSummary(summary: FolderSummary) {
      this.summaryBySlug[summary.slug] = summary;
      this.items = this.items.map((folder) => folder.slug === summary.slug ? summary : folder);
      if (this.currentFolder?.slug === summary.slug) this.currentFolder = summary;
      useLibraryDirectoryStore().replaceSummary(summary);
      useFolderSearchStore().replaceSummary(summary);
    },

    async ensureSummary(slug: string, refresh = false) {
      const cached = refresh ? null : this.getSummary(slug);
      if (cached) return cached;
      const requests = this.summaryRequests;
      const pending = requests.get(slug);
      if (pending) return pending;
      const generation = this.listGeneration;
      const request = fetchFolder(slug).then((summary) => {
        if (generation === this.listGeneration && requests === this.summaryRequests) {
          this.summaryBySlug[slug] = summary;
          if (this.currentFolder?.slug === slug) this.currentFolder = summary;
        }
        return summary;
      }).finally(() => requests.delete(slug));
      requests.set(slug, request);
      return request;
    },

    async loadFolder(slug: string, reset = true, mediaType?: FeedItem['mediaType']) {
      if (this.loadingFolder) {
        return;
      }

      const nextFilter: FolderMediaFilter = mediaType === 'video' ? 'video' : 'all';
      const filterChanged = this.currentFilter !== nextFilter;

      if (reset || filterChanged) {
        this.currentFolder = null;
        this.currentImages = [];
        this.currentFilter = nextFilter;
        this.currentPage = 1;
        this.currentHasMore = true;
      }

      this.loadingFolder = true;
      this.folderError = null;

      try {
        const payload = await fetchFolderImages(slug, this.currentPage, this.currentLimit, mediaType);
        this.currentFolder = payload.folder;
        this.currentImages.push(...payload.items);
        this.currentPage += 1;
        this.currentHasMore = payload.hasMore;
      } catch (error) {
        this.currentFolder = null;
        this.folderError = error instanceof Error ? error.message : i18n.global.t('errors.loadFolder');
      } finally {
        this.loadingFolder = false;
      }
    },

    async updateFolderProfile(slug: string, name: string, description: string | null) {
      const generation = this.listGeneration;
      const updated = await updateFolderProfile(slug, name, description);
      if (generation === this.listGeneration) this.replaceSummary(updated);
    },

    async setFolderCover(slug: string, imageId: number) {
      const generation = this.listGeneration;
      await setFolderCover(slug, imageId);
      const updated = await fetchFolder(slug);
      if (generation === this.listGeneration) this.replaceSummary(updated);
    },

    async loadShareLinks(slug: string) {
      this.loadingShare = true;
      this.shareError = null;
      this.lastCreatedShareUrl = null;

      try {
        const payload = await fetchFolderShareLinks(slug);
        this.shareLinks = payload.links;
        this.sharePassword = payload.password;
        this.sharePublicFolderUrl = payload.publicFolderUrl;
        this.sharePublicAccess = payload.publicAccess;
      } catch (error) {
        this.shareError = error instanceof Error ? error.message : i18n.global.t('errors.loadFolderSharing');
        throw error;
      } finally {
        this.loadingShare = false;
      }
    },

    async createShareLink(slug: string, input: CreateFolderShareLinkInput) {
      this.loadingShare = true;
      this.shareError = null;

      try {
        const payload = await createFolderShareLink(slug, input);
        this.shareLinks = [payload.link, ...this.shareLinks.filter((link) => link.id !== payload.link.id)];
        this.lastCreatedShareUrl = payload.shareUrl;
        return payload;
      } catch (error) {
        this.shareError = error instanceof Error ? error.message : i18n.global.t('folder.shareModal.errors.createLink');
        throw error;
      } finally {
        this.loadingShare = false;
      }
    },

    async revokeShareLink(slug: string, linkId: number) {
      this.loadingShare = true;
      this.shareError = null;

      try {
        const payload = await revokeFolderShareLink(slug, linkId);
        this.shareLinks = this.shareLinks.map((link) => (link.id === payload.link.id ? payload.link : link));
        if (this.lastCreatedShareUrl) {
          this.lastCreatedShareUrl = null;
        }
      } catch (error) {
        this.shareError = error instanceof Error ? error.message : i18n.global.t('folder.shareModal.errors.revokeLink');
        throw error;
      } finally {
        this.loadingShare = false;
      }
    },

    async setSharePassword(slug: string, password: string) {
      this.loadingShare = true;
      this.shareError = null;

      try {
        const payload = await setFolderSharePassword(slug, password);
        this.sharePassword = payload.password;
      } catch (error) {
        this.shareError = error instanceof Error ? error.message : i18n.global.t('folder.shareModal.errors.savePassword');
        throw error;
      } finally {
        this.loadingShare = false;
      }
    },

    async removeSharePassword(slug: string) {
      this.loadingShare = true;
      this.shareError = null;

      try {
        const payload = await removeFolderSharePassword(slug);
        this.sharePassword = payload.password;
      } catch (error) {
        this.shareError = error instanceof Error ? error.message : i18n.global.t('folder.shareModal.errors.removePassword');
        throw error;
      } finally {
        this.loadingShare = false;
      }
    }
  }
});
