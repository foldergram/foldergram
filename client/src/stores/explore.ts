import { defineStore } from 'pinia';

import { fetchFeed, fetchFeedSearch } from '../api/gallery';
import type { FeedItem } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

interface ExploreState {
  items: FeedItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  randomSeed: number | null;
  recentSearchQueries: string[];
  recentSearchesInitialized: boolean;
  searchQuery: string;
  searchItems: FeedItem[];
  searchPage: number;
  searchLimit: number;
  searchHasMore: boolean;
  searchLoading: boolean;
  searchError: string | null;
  searchInitialized: boolean;
  searchRequestToken: number;
}

const RECENT_SEARCHES_STORAGE_KEY = 'foldergram-recent-search-queries';
const RECENT_SEARCH_LIMIT = 12;
const MIN_COMMITTED_SEARCH_LENGTH = 3;

function createRandomSeed(): number {
  const cryptoObject = globalThis.crypto;
  if (cryptoObject?.getRandomValues) {
    return cryptoObject.getRandomValues(new Uint32Array(1))[0] ?? Math.floor(Math.random() * 2_147_483_647);
  }

  return Math.floor(Math.random() * 2_147_483_647);
}

function formatSearchQuery(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeSearchQuery(value: string): string {
  return formatSearchQuery(value).toLocaleLowerCase();
}

function parseStoredRecentSearchQueries(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    const seen = new Set<string>();

    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map(formatSearchQuery)
      .filter((entry) => {
        if (entry.length < MIN_COMMITTED_SEARCH_LENGTH) {
          return false;
        }

        const normalizedEntry = normalizeSearchQuery(entry);
        if (seen.has(normalizedEntry)) {
          return false;
        }

        seen.add(normalizedEntry);
        return true;
      })
      .slice(0, RECENT_SEARCH_LIMIT);
  } catch {
    return [];
  }
}

function isPrefixVariant(previousQuery: string, nextQuery: string): boolean {
  return previousQuery.startsWith(nextQuery) || nextQuery.startsWith(previousQuery);
}

export const useExploreStore = defineStore('explore', {
  state: (): ExploreState => ({
    items: [],
    page: 1,
    limit: 30,
    hasMore: true,
    loading: false,
    error: null,
    initialized: false,
    randomSeed: null,
    recentSearchQueries: [],
    recentSearchesInitialized: false,
    searchQuery: '',
    searchItems: [],
    searchPage: 1,
    searchLimit: 30,
    searchHasMore: false,
    searchLoading: false,
    searchError: null,
    searchInitialized: false,
    searchRequestToken: 0
  }),
  actions: {
    reset() {
      this.items = [];
      this.page = 1;
      this.hasMore = true;
      this.loading = false;
      this.error = null;
      this.initialized = false;
      this.randomSeed = null;
    },

    resetSearch() {
      this.searchRequestToken += 1;
      this.searchQuery = '';
      this.searchItems = [];
      this.searchPage = 1;
      this.searchHasMore = false;
      this.searchLoading = false;
      this.searchError = null;
      this.searchInitialized = false;
    },

    initializeRecentSearches() {
      if (this.recentSearchesInitialized) {
        return;
      }

      this.recentSearchQueries = parseStoredRecentSearchQueries(
        window.localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY)
      );
      this.recentSearchesInitialized = true;
    },

    persistRecentSearches() {
      window.localStorage.setItem(
        RECENT_SEARCHES_STORAGE_KEY,
        JSON.stringify(this.recentSearchQueries.slice(0, RECENT_SEARCH_LIMIT))
      );
    },

    ensureRandomSeed() {
      if (this.randomSeed !== null) {
        return this.randomSeed;
      }

      this.randomSeed = createRandomSeed();
      return this.randomSeed;
    },

    recordRecentSearch(query: string) {
      const formattedQuery = formatSearchQuery(query);
      if (formattedQuery.length < MIN_COMMITTED_SEARCH_LENGTH) {
        return;
      }

      this.initializeRecentSearches();

      const normalizedQuery = normalizeSearchQuery(formattedQuery);
      let nextQueries = this.recentSearchQueries.filter(
        (entry) => normalizeSearchQuery(entry) !== normalizedQuery
      );
      const mostRecentQuery = nextQueries[0];

      if (
        mostRecentQuery &&
        isPrefixVariant(normalizeSearchQuery(mostRecentQuery), normalizedQuery)
      ) {
        nextQueries = nextQueries.slice(1);
      }

      this.recentSearchQueries = [formattedQuery, ...nextQueries].slice(
        0,
        RECENT_SEARCH_LIMIT
      );
      this.persistRecentSearches();
    },

    clearRecentSearches() {
      this.initializeRecentSearches();
      this.recentSearchQueries = [];
      window.localStorage.removeItem(RECENT_SEARCHES_STORAGE_KEY);
    },

    updateImageCaption(id: number, caption: string | null) {
      this.items = updateCaptionInItems(this.items, id, caption);
      this.searchItems = updateCaptionInItems(this.searchItems, id, caption);
    },

    /** Deleting from a search result has to drop the tile too, not just the feed copy. */
    removeImage(id: number) {
      this.items = this.items.filter((item) => item.id !== id);
      this.searchItems = this.searchItems.filter((item) => item.id !== id);
    },

    async loadInitial(force = false) {
      if (this.loading) {
        return;
      }

      if (this.initialized && !force) {
        return;
      }

      this.items = [];
      this.page = 1;
      this.hasMore = true;
      this.error = null;
      this.initialized = false;
      this.randomSeed = force ? createRandomSeed() : this.randomSeed;
      await this.loadMore();
    },

    async loadMore() {
      if (this.loading || !this.hasMore) {
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const payload = await fetchFeed(
          this.page,
          this.limit,
          'random',
          this.ensureRandomSeed()
        );
        this.items.push(...payload.items);
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;
      } catch (error) {
        this.error =
          error instanceof Error ? error.message : 'Unable to load explore feed';
      } finally {
        this.loading = false;
      }
    },

    startSearch(query: string) {
      const normalizedQuery = query.trim();

      if (normalizedQuery.length === 0) {
        this.resetSearch();
        return;
      }

      this.searchRequestToken += 1;
      this.searchQuery = normalizedQuery;
      this.searchItems = [];
      this.searchPage = 1;
      this.searchHasMore = true;
      this.searchLoading = false;
      this.searchError = null;
      this.searchInitialized = false;
    },

    async loadSearch(query: string, force = false) {
      const normalizedQuery = query.trim();

      if (normalizedQuery.length === 0) {
        this.resetSearch();
        return;
      }

      if (
        !force &&
        this.searchQuery === normalizedQuery &&
        this.searchInitialized
      ) {
        return;
      }

      this.startSearch(normalizedQuery);
      await this.loadMoreSearch();
    },

    async loadMoreSearch() {
      if (
        this.searchLoading ||
        !this.searchHasMore ||
        this.searchQuery.length === 0
      ) {
        return;
      }

      const requestToken = this.searchRequestToken;
      const query = this.searchQuery;
      const page = this.searchPage;

      this.searchLoading = true;
      this.searchError = null;

      try {
        const payload = await fetchFeedSearch(query, page, this.searchLimit);
        if (
          requestToken !== this.searchRequestToken ||
          query !== this.searchQuery ||
          page !== this.searchPage
        ) {
          return;
        }

        this.searchItems.push(...payload.items);
        this.searchPage += 1;
        this.searchHasMore = payload.hasMore;
        this.searchInitialized = true;
      } catch (error) {
        if (
          requestToken !== this.searchRequestToken ||
          query !== this.searchQuery ||
          page !== this.searchPage
        ) {
          return;
        }

        this.searchError =
          error instanceof Error ? error.message : 'Unable to search posts';
        this.searchHasMore = false;
        this.searchInitialized = true;
      } finally {
        if (requestToken === this.searchRequestToken) {
          this.searchLoading = false;
        }
      }
    }
  }
});
