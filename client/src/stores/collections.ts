import { acceptHMRUpdate, defineStore } from 'pinia';

import {
  addImageToCollection,
  createCollection,
  deleteCollection as deleteCollectionRequest,
  fetchCollectionImages,
  fetchCollections,
  fetchImageCollections,
  removeImageFromCollection,
  saveImage,
  unsaveImage,
  updateCollection as updateCollectionRequest
} from '../api/gallery';
import { i18n } from '../locales';
import type {
  CollectionImagesPayload,
  CollectionMembership,
  CollectionSummary,
  FeedItem,
  ImageCollectionsPayload
} from '../types/api';
import { updateCaptionInItems } from '../utils/caption';
import { useAuthStore } from './auth';

type CollectionsMode = 'shared' | 'local';

interface LocalCollection {
  slug: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  items: FeedItem[];
}

interface LocalCollectionsPayload {
  collections: LocalCollection[];
}

interface CollectionsState {
  mode: CollectionsMode;
  items: CollectionSummary[];
  membershipByImageId: Record<number, ImageCollectionsPayload>;
  savedStateByImageId: Record<number, boolean>;
  bookmarkedStateByImageId: Record<number, boolean>;
  pendingImageIds: number[];
  pendingCollectionKeys: string[];
  loading: boolean;
  error: string | null;
  initialized: boolean;
  currentCollection: CollectionSummary | null;
  currentImages: FeedItem[];
  currentPage: number;
  currentLimit: number;
  currentHasMore: boolean;
  loadingCollection: boolean;
  collectionError: string | null;
}

const LOCAL_COLLECTIONS_STORAGE_KEY = 'foldergram-local-collections-v1';
const DEFAULT_COLLECTION_SLUG = 'saved';
const DEFAULT_COLLECTION_NAME = 'Saved';

function nowIso() {
  return new Date().toISOString();
}

function slugifyCollectionName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'collection';
}

function createUniqueSlug(name: string, existingSlugs: Set<string>): string {
  const base = slugifyCollectionName(name);
  if (!existingSlugs.has(base)) {
    return base;
  }

  let index = 2;
  while (existingSlugs.has(`${base}-${index}`)) {
    index += 1;
  }

  return `${base}-${index}`;
}

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
    (item.takenAt === null || item.takenAt === undefined || typeof item.takenAt === 'number')
  );
}

function normalizeFeedItem(item: FeedItem): FeedItem {
  return {
    ...item,
    folderBreadcrumb: item.folderBreadcrumb ?? null,
    durationMs: item.durationMs ?? null,
    isAnimated: item.isAnimated ?? false,
    takenAt: item.takenAt ?? null,
    isSaved: true
  };
}

function createDefaultLocalCollection(): LocalCollection {
  const timestamp = nowIso();
  return {
    slug: DEFAULT_COLLECTION_SLUG,
    name: DEFAULT_COLLECTION_NAME,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    items: []
  };
}

function readLocalCollections(): LocalCollection[] {
  if (typeof window === 'undefined') {
    return [createDefaultLocalCollection()];
  }

  const rawValue = window.localStorage.getItem(LOCAL_COLLECTIONS_STORAGE_KEY);
  if (!rawValue) {
    return [createDefaultLocalCollection()];
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<LocalCollectionsPayload>;
    if (!Array.isArray(parsed.collections)) {
      return [createDefaultLocalCollection()];
    }

    const seenSlugs = new Set<string>();
    const collections = parsed.collections.flatMap((collection): LocalCollection[] => {
      if (!collection || typeof collection !== 'object') {
        return [];
      }

      const slug = typeof collection.slug === 'string' && collection.slug.trim() ? collection.slug : null;
      const name = typeof collection.name === 'string' && collection.name.trim() ? collection.name : null;
      if (!slug || !name || seenSlugs.has(slug)) {
        return [];
      }

      seenSlugs.add(slug);
      const seenIds = new Set<number>();
      const items = Array.isArray(collection.items)
        ? collection.items.filter((entry): entry is FeedItem => {
            if (!isFeedItem(entry) || seenIds.has(entry.id)) {
              return false;
            }

            seenIds.add(entry.id);
            return true;
          }).map(normalizeFeedItem)
        : [];

      return [{
        slug,
        name,
        isDefault: collection.isDefault === true || slug === DEFAULT_COLLECTION_SLUG,
        createdAt: typeof collection.createdAt === 'string' ? collection.createdAt : nowIso(),
        updatedAt: typeof collection.updatedAt === 'string' ? collection.updatedAt : nowIso(),
        items
      }];
    });

    const defaultCollection = collections.find((collection) => collection.slug === DEFAULT_COLLECTION_SLUG);
    const normalizedDefault = defaultCollection
      ? { ...defaultCollection, name: DEFAULT_COLLECTION_NAME, isDefault: true }
      : createDefaultLocalCollection();
    const customCollections = collections
      .filter((collection) => collection.slug !== DEFAULT_COLLECTION_SLUG)
      .map((collection) => ({ ...collection, isDefault: false }));
    const seenDefaultItemIds = new Set(normalizedDefault.items.map((item) => item.id));
    const missingDefaultItems: FeedItem[] = [];
    for (const collection of customCollections) {
      for (const item of collection.items) {
        if (seenDefaultItemIds.has(item.id)) {
          continue;
        }

        seenDefaultItemIds.add(item.id);
        missingDefaultItems.push(item);
      }
    }

    return [
      missingDefaultItems.length > 0
        ? {
            ...normalizedDefault,
            updatedAt: nowIso(),
            items: [...missingDefaultItems, ...normalizedDefault.items]
          }
        : normalizedDefault,
      ...customCollections
    ];
  } catch {
    return [createDefaultLocalCollection()];
  }
}

function writeLocalCollections(collections: LocalCollection[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(LOCAL_COLLECTIONS_STORAGE_KEY, JSON.stringify({ collections }));
}

function toCollectionSummary(collection: LocalCollection): CollectionSummary {
  return {
    id: collection.slug === DEFAULT_COLLECTION_SLUG ? 1 : Math.abs(hashSlug(collection.slug)),
    slug: collection.slug,
    name: collection.name,
    isDefault: collection.isDefault,
    itemCount: collection.items.length,
    coverImage: collection.items[0] ?? null,
    previewImages: collection.items.slice(0, 4),
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt
  };
}

function hashSlug(slug: string): number {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = ((hash << 5) - hash + slug.charCodeAt(index)) | 0;
  }

  return hash;
}

function getCollectionMode(): CollectionsMode {
  const authStore = useAuthStore();
  return authStore.canUseSharedCollections ? 'shared' : 'local';
}

export const useCollectionsStore = defineStore('collections', {
  state: (): CollectionsState => ({
    mode: 'shared',
    items: [],
    membershipByImageId: {},
    savedStateByImageId: {},
    bookmarkedStateByImageId: {},
    pendingImageIds: [],
    pendingCollectionKeys: [],
    loading: false,
    error: null,
    initialized: false,
    currentCollection: null,
    currentImages: [],
    currentPage: 1,
    currentLimit: 24,
    currentHasMore: true,
    loadingCollection: false,
    collectionError: null
  }),
  getters: {
    hasCustomCollections: (state) => state.items.some((collection) => !collection.isDefault),
    defaultCollection: (state) => state.items.find((collection) => collection.isDefault) ?? null,
    isSaved: (state) => (id: number) => state.savedStateByImageId[id] === true,
    isBookmarked: (state) => (id: number) => {
      if (state.bookmarkedStateByImageId[id] !== undefined) {
        return state.bookmarkedStateByImageId[id] === true;
      }

      const membership = state.membershipByImageId[id];
      if (membership) {
        return membership.isSaved === true;
      }

      return state.savedStateByImageId[id] === true;
    },
    isPending: (state) => (id: number) => state.pendingImageIds.includes(id),
    isCollectionPending: (state) => (slug: string, id: number) => state.pendingCollectionKeys.includes(`${slug}:${id}`)
  },
  actions: {
    syncSavedState(item: FeedItem) {
      if (this.savedStateByImageId[item.id] === undefined) {
        this.savedStateByImageId[item.id] = item.isSaved === true;
      }

      if (item.isSaved === true) {
        this.setBookmarkedState(item.id, true);
      }
    },

    setSavedState(id: number, isSaved: boolean) {
      this.savedStateByImageId[id] = isSaved;
      this.bookmarkedStateByImageId[id] = isSaved;
      this.currentImages = this.currentImages.map((item) => (item.id === id ? { ...item, isSaved } : item));
    },

    setBookmarkedState(id: number, isBookmarked: boolean) {
      this.bookmarkedStateByImageId[id] = isBookmarked;
    },

    resetForRebuild() {
      this.mode = getCollectionMode();
      this.items = [];
      this.membershipByImageId = {};
      this.savedStateByImageId = {};
      this.bookmarkedStateByImageId = {};
      this.pendingImageIds = [];
      this.pendingCollectionKeys = [];
      this.loading = false;
      this.error = null;
      this.initialized = false;
      this.currentCollection = null;
      this.currentImages = [];
      this.currentPage = 1;
      this.currentHasMore = true;
      this.loadingCollection = false;
      this.collectionError = null;
    },

    async initialize(force = false) {
      const authStore = useAuthStore();
      if (!authStore.canUseSharedCollections && !authStore.canUseLocalCollections) {
        this.resetForRebuild();
        return;
      }

      const mode = getCollectionMode();
      if ((this.initialized && this.mode === mode && !force) || this.loading) {
        return;
      }

      this.mode = mode;
      this.loading = true;
      this.error = null;

      try {
        if (mode === 'shared') {
          const payload = await fetchCollections();
          this.items = payload.items;
        } else {
          const collections = readLocalCollections();
          this.items = collections.map(toCollectionSummary);
          const defaultCollection = collections.find((collection) => collection.isDefault);
          this.savedStateByImageId = Object.fromEntries((defaultCollection?.items ?? []).map((item) => [item.id, true]));
          this.bookmarkedStateByImageId = { ...this.savedStateByImageId };
          writeLocalCollections(collections);
        }

        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : i18n.global.t('collections.bookmark.errors.loadCollections');
      } finally {
        this.loading = false;
      }
    },

    async fetchMembership(imageId: number, force = false) {
      await this.initialize();
      if (!force && this.membershipByImageId[imageId]) {
        return this.membershipByImageId[imageId];
      }

      if (this.mode === 'local') {
        const collections = readLocalCollections();
        const items: CollectionMembership[] = collections.map((collection) => ({
          ...toCollectionSummary(collection),
          containsImage: collection.items.some((item) => item.id === imageId)
        }));
        const payload = {
          imageId,
          isSaved: items.some((item) => item.isDefault && item.containsImage),
          items
        };
        this.membershipByImageId[imageId] = payload;
        this.setSavedState(imageId, payload.isSaved);
        return payload;
      }

      const payload = await fetchImageCollections(imageId);
      this.membershipByImageId[imageId] = payload;
      this.setSavedState(imageId, payload.isSaved);
      return payload;
    },

    async toggleDefaultSave(item: FeedItem) {
      const authStore = useAuthStore();
      if ((!authStore.canUseSharedCollections && !authStore.canUseLocalCollections) || this.pendingImageIds.includes(item.id)) {
        return;
      }

      await this.initialize();
      this.syncSavedState(item);
      const wasSaved = this.savedStateByImageId[item.id] === true;
      this.pendingImageIds.push(item.id);
      this.setSavedState(item.id, !wasSaved);

      try {
        if (this.mode === 'local') {
          this.toggleLocalDefaultSave(item, wasSaved);
        } else if (wasSaved) {
          await unsaveImage(item.id);
        } else {
          await saveImage(item.id);
        }

        await this.refreshAfterMembershipChange(item.id);
      } catch (error) {
        this.setSavedState(item.id, wasSaved);
        this.error = error instanceof Error ? error.message : i18n.global.t('errors.updateSavedPost');
      } finally {
        this.pendingImageIds = this.pendingImageIds.filter((id) => id !== item.id);
      }
    },

    async createAndAdd(name: string, item: FeedItem) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error(i18n.global.t('collections.detail.edit.required'));
      }

      await this.initialize();
      if (this.items.some((collection) => collection.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase())) {
        throw new Error(i18n.global.t('errors.collectionNameExists'));
      }

      if (this.mode === 'local') {
        const collections = readLocalCollections();
        const slug = createUniqueSlug(trimmedName, new Set(collections.map((collection) => collection.slug)));
        const timestamp = nowIso();
        collections.push({
          slug,
          name: trimmedName,
          isDefault: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          items: []
        });
        writeLocalCollections(collections);
        this.items = collections.map(toCollectionSummary);
        await this.toggleCollectionMembership(slug, item, true);
        return;
      }

      const payload = await createCollection(trimmedName);
      this.items = (await fetchCollections()).items;
      await this.toggleCollectionMembership(payload.collection.slug, item, true);
    },

    async updateCollectionName(collectionSlug: string, name: string) {
      const trimmedName = name.trim();
      if (!trimmedName) {
        throw new Error(i18n.global.t('collections.detail.edit.required'));
      }

      await this.initialize();
      const existingCollection = this.items.find((collection) => collection.slug === collectionSlug);
      if (!existingCollection || existingCollection.isDefault) {
        throw new Error(i18n.global.t('errors.collectionNotFound'));
      }

      if (
        this.items.some(
          (collection) =>
            collection.slug !== collectionSlug &&
            collection.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
        )
      ) {
        throw new Error(i18n.global.t('errors.collectionNameExists'));
      }

      const updatedCollection = this.mode === 'local'
        ? this.updateLocalCollectionName(collectionSlug, trimmedName)
        : (await updateCollectionRequest(collectionSlug, trimmedName)).collection;

      this.items = this.items.map((collection) =>
        collection.slug === collectionSlug ? updatedCollection : collection
      );
      if (this.currentCollection?.slug === collectionSlug) {
        this.currentCollection = updatedCollection;
      }

      this.membershipByImageId = Object.fromEntries(
        Object.entries(this.membershipByImageId).map(([imageId, payload]) => [
          imageId,
          {
            ...payload,
            items: payload.items.map((collection) =>
              collection.slug === collectionSlug
                ? { ...updatedCollection, containsImage: collection.containsImage }
                : collection
            )
          }
        ])
      );

      return updatedCollection;
    },

    async deleteCollection(collectionSlug: string) {
      await this.initialize();
      const existingCollection = this.items.find((collection) => collection.slug === collectionSlug);
      if (!existingCollection || existingCollection.isDefault) {
        throw new Error(i18n.global.t('errors.collectionNotFound'));
      }

      const visibleCurrentItems = this.currentCollection?.slug === collectionSlug
        ? [...this.currentImages]
        : [];
      const deletedCollection = this.mode === 'local'
        ? this.deleteLocalCollection(collectionSlug)
        : (await deleteCollectionRequest(collectionSlug)).collection;

      if (this.mode === 'shared') {
        const collectionsPayload = await fetchCollections();
        this.items = collectionsPayload.items;
      }

      this.membershipByImageId = {};
      for (const item of visibleCurrentItems) {
        this.setSavedState(item.id, true);
        this.setBookmarkedState(item.id, true);
      }

      if (this.currentCollection?.slug === collectionSlug) {
        this.currentCollection = null;
        this.currentImages = [];
        this.currentPage = 1;
        this.currentHasMore = true;
      }

      return deletedCollection;
    },

    async toggleCollectionMembership(collectionSlug: string, item: FeedItem, forceAdd = false) {
      await this.initialize();
      if (collectionSlug === DEFAULT_COLLECTION_SLUG) {
        throw new Error(i18n.global.t('errors.defaultCollectionManaged'));
      }

      const key = `${collectionSlug}:${item.id}`;
      if (this.pendingCollectionKeys.includes(key)) {
        return;
      }

      const membership = await this.fetchMembership(item.id);
      const collection = membership.items.find((entry) => entry.slug === collectionSlug);
      const containsImage = collection?.containsImage === true;
      const shouldAdd = forceAdd || !containsImage;

      this.error = null;
      this.pendingCollectionKeys.push(key);

      try {
        if (this.mode === 'local') {
          this.updateLocalCollectionMembership(collectionSlug, item, shouldAdd);
        } else if (shouldAdd) {
          await addImageToCollection(collectionSlug, item.id);
        } else {
          await removeImageFromCollection(collectionSlug, item.id);
        }

        await this.refreshAfterMembershipChange(item.id);
      } catch (error) {
        const mutationError = error instanceof Error ? error : new Error(i18n.global.t('collections.detail.edit.updateError'));
        this.error = mutationError.message;
        throw mutationError;
      } finally {
        this.pendingCollectionKeys = this.pendingCollectionKeys.filter((entry) => entry !== key);
      }
    },

    async loadCollection(slug = DEFAULT_COLLECTION_SLUG, reset = true) {
      await this.initialize();

      if (reset) {
        this.currentCollection = null;
        this.currentImages = [];
        this.currentPage = 1;
        this.currentHasMore = true;
      }

      if (this.loadingCollection || !this.currentHasMore) {
        return;
      }

      this.loadingCollection = true;
      this.collectionError = null;

      try {
        const payload = this.mode === 'local'
          ? this.loadLocalCollection(slug, this.currentPage, this.currentLimit)
          : await fetchCollectionImages(slug, this.currentPage, this.currentLimit);

        this.currentCollection = payload.collection;
        this.currentImages.push(...payload.items);
        for (const item of payload.items) {
          this.setSavedState(item.id, item.isSaved === true);
        }
        this.currentPage += 1;
        this.currentHasMore = payload.hasMore;
      } catch (error) {
        this.currentCollection = null;
        this.collectionError = error instanceof Error ? error.message : i18n.global.t('errors.loadCollection');
      } finally {
        this.loadingCollection = false;
      }
    },

    removeImage(id: number) {
      this.setSavedState(id, false);
      this.setBookmarkedState(id, false);
      this.currentImages = this.currentImages.filter((item) => item.id !== id);
      delete this.membershipByImageId[id];
    },

    updateImageCaption(id: number, caption: string | null) {
      this.currentImages = updateCaptionInItems(this.currentImages, id, caption);
    },

    removeFolderItems(folderSlug: string) {
      this.currentImages = this.currentImages.filter((item) => item.folderSlug !== folderSlug);
      for (const [id, payload] of Object.entries(this.membershipByImageId)) {
        const numericId = Number(id);
        if (payload.items.some((collection) => collection.coverImage?.folderSlug === folderSlug)) {
          delete this.membershipByImageId[numericId];
        }
      }
    },

    toggleLocalDefaultSave(item: FeedItem, wasSaved: boolean) {
      const collections = readLocalCollections();
      const normalizedItem = normalizeFeedItem(item);
      const timestamp = nowIso();
      const defaultCollection = collections.find((collection) => collection.isDefault) ?? createDefaultLocalCollection();

      if (!collections.includes(defaultCollection)) {
        collections.unshift(defaultCollection);
      }

      if (wasSaved) {
        for (const collection of collections) {
          const nextItems = collection.items.filter((entry) => entry.id !== item.id);
          if (nextItems.length === collection.items.length) {
            continue;
          }

          collection.items = nextItems;
          collection.updatedAt = timestamp;
        }
      } else {
        defaultCollection.items = [normalizedItem, ...defaultCollection.items.filter((entry) => entry.id !== item.id)];
        defaultCollection.updatedAt = timestamp;
      }

      writeLocalCollections(collections);
    },

    updateLocalCollectionMembership(collectionSlug: string, item: FeedItem, shouldAdd: boolean) {
      const collections = readLocalCollections();
      const timestamp = nowIso();
      const normalizedItem = normalizeFeedItem(item);
      const defaultCollection = collections.find((collection) => collection.isDefault) ?? createDefaultLocalCollection();
      const targetCollection = collections.find((collection) => collection.slug === collectionSlug);

      if (!collections.includes(defaultCollection)) {
        collections.unshift(defaultCollection);
      }

      if (!targetCollection || targetCollection.isDefault) {
        throw new Error(i18n.global.t('errors.collectionNotFound'));
      }

      if (shouldAdd) {
        if (!defaultCollection.items.some((entry) => entry.id === item.id)) {
          defaultCollection.items = [normalizedItem, ...defaultCollection.items];
          defaultCollection.updatedAt = timestamp;
        }
        targetCollection.items = [normalizedItem, ...targetCollection.items.filter((entry) => entry.id !== item.id)];
        targetCollection.updatedAt = timestamp;
      } else {
        targetCollection.items = targetCollection.items.filter((entry) => entry.id !== item.id);
        targetCollection.updatedAt = timestamp;
      }

      writeLocalCollections(collections);
    },

    updateLocalCollectionName(collectionSlug: string, name: string): CollectionSummary {
      const collections = readLocalCollections();
      const targetCollection = collections.find((collection) => collection.slug === collectionSlug);
      if (!targetCollection || targetCollection.isDefault) {
        throw new Error(i18n.global.t('errors.collectionNotFound'));
      }

      if (
        collections.some(
          (collection) =>
            collection.slug !== collectionSlug &&
            collection.name.toLocaleLowerCase() === name.toLocaleLowerCase()
        )
      ) {
        throw new Error(i18n.global.t('errors.collectionNameExists'));
      }

      targetCollection.name = name;
      targetCollection.updatedAt = nowIso();
      writeLocalCollections(collections);

      return toCollectionSummary(targetCollection);
    },

    deleteLocalCollection(collectionSlug: string): CollectionSummary {
      const collections = readLocalCollections();
      const targetCollection = collections.find((collection) => collection.slug === collectionSlug);
      if (!targetCollection || targetCollection.isDefault) {
        throw new Error(i18n.global.t('errors.collectionNotFound'));
      }

      const deletedSummary = toCollectionSummary(targetCollection);
      const nextCollections = collections.filter((collection) => collection.slug !== collectionSlug);
      writeLocalCollections(nextCollections);
      this.items = nextCollections.map(toCollectionSummary);

      for (const item of targetCollection.items) {
        this.setSavedState(item.id, true);
        this.setBookmarkedState(item.id, true);
      }

      return deletedSummary;
    },

    loadLocalCollection(slug: string, page: number, limit: number): CollectionImagesPayload {
      const collections = readLocalCollections();
      const collection = collections.find((entry) => entry.slug === slug);
      if (!collection) {
        throw new Error(i18n.global.t('errors.collectionNotFound'));
      }

      const defaultCollection = collections.find((entry) => entry.isDefault);
      const offset = (page - 1) * limit;
      const items = collection.items.slice(offset, offset + limit).map((item) => ({
        ...item,
        isSaved: defaultCollection?.items.some((entry) => entry.id === item.id) === true
      }));
      return {
        collection: toCollectionSummary(collection),
        items,
        page,
        limit,
        total: collection.items.length,
        hasMore: page * limit < collection.items.length
      };
    },

    async refreshAfterMembershipChange(imageId: number) {
      if (this.mode === 'local') {
        const collections = readLocalCollections();
        this.items = collections.map(toCollectionSummary);
        writeLocalCollections(collections);
        delete this.membershipByImageId[imageId];
        await this.fetchMembership(imageId, true);
      } else {
        const collectionsPayload = await fetchCollections();
        this.items = collectionsPayload.items;
        await this.fetchMembership(imageId, true);
      }
    }
  }
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useCollectionsStore, import.meta.hot));
}
