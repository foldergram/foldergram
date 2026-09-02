<template>
  <section class="explore-view min-h-[calc(100vh-4rem)]">
    <div
      class="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-[72rem] flex-col gap-6 px-4 py-5 md:px-6 md:py-7"
    >
      <header
        class="flex items-center gap-3"
        :class="showSearchChrome ? 'max-w-[35rem]' : 'justify-center'"
      >
        <button
          v-if="showSearchChrome"
          class="inline-flex h-11 w-11 items-center justify-center rounded-full border-0 bg-transparent p-0 text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
          type="button"
          :aria-label="t('explore.back')"
          @click="closeSearch"
        >
          <svg
            class="h-[1.3rem] w-[1.3rem]"
            viewBox="0 0 24 24"
            role="presentation"
          >
            <path
              d="m15 5-7 7 7 7"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.9"
            />
          </svg>
        </button>

        <label
          class="explore-view__search flex flex-1 items-center gap-3 rounded-full bg-surface-alt px-4 py-[0.82rem]"
        >
          <svg
            class="h-[1.15rem] w-[1.15rem] flex-shrink-0 text-muted"
            viewBox="0 0 24 24"
            role="presentation"
          >
            <circle
              cx="11"
              cy="11"
              r="7"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
            <path
              d="m21 21-4.35-4.35"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.8"
            />
          </svg>
          <input
            ref="searchInput"
            v-model="searchQuery"
            class="w-full border-0 bg-transparent p-0 text-[1rem] text-text outline-none placeholder:text-muted"
            type="search"
            :placeholder="t('explore.searchPlaceholder')"
            spellcheck="false"
            @focus="activateSearch"
            @keydown.enter.prevent="commitSearch()"
            @keydown.esc.prevent="handleEscape"
          />
          <button
            v-if="searchQuery.length > 0"
            class="inline-flex h-6 w-6 items-center justify-center rounded-full border-0 bg-surface-hover p-0 text-muted transition-colors duration-150 hover:bg-border hover:text-text"
            type="button"
            :aria-label="t('explore.clearSearch')"
            @click="clearSearch"
          >
            <svg
              class="h-[0.85rem] w-[0.85rem]"
              viewBox="0 0 24 24"
              role="presentation"
            >
              <path
                d="m8 8 8 8M16 8l-8 8"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2.1"
              />
            </svg>
          </button>
        </label>
      </header>

      <section
        v-if="appStore.isLibraryUnavailable"
        class="explore-view__message-card max-w-[35rem]"
      >
        <h1 class="m-0 text-[1.15rem] font-semibold text-text">
          {{ t('reels.view.libraryUnavailableTitle') }}
        </h1>
        <p class="m-0 text-muted">{{ appStore.libraryUnavailableReason }}</p>
      </section>

      <section v-else-if="showRecentSearches" class="max-w-[35rem]">
        <div class="grid gap-4 pt-2">
          <div class="flex items-center justify-between gap-3">
            <h1
              class="m-0 text-[1.45rem] font-semibold tracking-[-0.03em] text-text"
            >
              {{ t('explore.recentTitle') }}
            </h1>
            <button
              class="explore-view__recent-clear"
              type="button"
              @click="clearRecentSearches"
            >
              {{ t('explore.clearAll') }}
            </button>
          </div>

          <div class="grid gap-1">
            <button
              v-for="query in recentSearchQueries"
              :key="query"
              class="explore-view__recent-query"
              type="button"
              @click="applyRecentSearch(query)"
            >
              <span class="explore-view__recent-query-icon" aria-hidden="true">
                <svg class="h-[1rem] w-[1rem]" viewBox="0 0 24 24" role="presentation">
                  <circle
                    cx="11"
                    cy="11"
                    r="7"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.8"
                  />
                  <path
                    d="m21 21-4.35-4.35"
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="1.8"
                  />
                </svg>
              </span>
              <span class="min-w-0 flex-1 truncate text-left text-[0.96rem] text-text">
                {{ query }}
              </span>
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="hasActiveQuery" class="grid gap-5">
        <div
          class="explore-view__tabs flex flex-wrap gap-2"
          role="tablist"
          :aria-label="t('explore.tabsAria')"
        >
          <button
            class="explore-view__tab"
            :class="{ 'explore-view__tab--active': activeSearchTab === 'media' }"
            type="button"
            role="tab"
            :aria-selected="activeSearchTab === 'media'"
            @click="selectSearchTab('media')"
          >
            {{ t('explore.tabs.media') }}
          </button>
          <button
            class="explore-view__tab"
            :class="{ 'explore-view__tab--active': activeSearchTab === 'folders' }"
            type="button"
            role="tab"
            :aria-selected="activeSearchTab === 'folders'"
            @click="selectSearchTab('folders')"
          >
            {{ t('explore.tabs.folders') }}
          </button>
        </div>

        <template v-if="activeSearchTab === 'media'">
          <div
            v-if="showSearchLoading"
            class="explore-view__skeleton-grid"
            aria-hidden="true"
          >
            <div
              v-for="index in 15"
              :key="index"
              class="explore-view__skeleton"
              :class="index % 6 === 0 ? 'explore-view__skeleton--feature' : ''"
            />
          </div>

          <section
            v-else-if="exploreStore.searchError"
            class="explore-view__message-card mx-auto"
          >
            <h1 class="m-0 text-[1.15rem] font-semibold text-text">
              {{ t('explore.errors.search') }}
            </h1>
            <p class="m-0 text-muted">{{ exploreStore.searchError }}</p>
          </section>

          <section
            v-else-if="
              exploreStore.searchInitialized &&
              exploreStore.searchItems.length === 0
            "
            class="explore-view__message-card mx-auto"
          >
            <h1 class="m-0 text-[1.15rem] font-semibold text-text">
              {{ t('explore.emptySearchTitle') }}
            </h1>
            <p class="m-0 text-muted">
              {{ t('explore.emptySearchDescription') }}
            </p>
          </section>

          <template v-else>
            <ExploreGrid
              :items="exploreStore.searchItems"
              @open="handleSearchMediaOpen"
            />
            <InfiniteLoader
              :loading="exploreStore.searchLoading"
              :has-more="exploreStore.searchHasMore"
              :button-fallback="false"
              @load-more="loadMoreSearch"
            />
          </template>
        </template>

        <section v-else class="max-w-[35rem]">
          <p
            v-if="foldersStore.loadingList && foldersStore.items.length === 0"
            class="m-0 text-[0.96rem] text-muted"
          >
            {{ t('explore.loadingFolders') }}
          </p>

          <div v-else class="grid gap-1">
            <button
              v-for="folder in folderSearchResults"
              :key="folder.id"
              class="explore-view__result"
              type="button"
              @click="openFolder(folder)"
            >
              <Avatar
                class="h-12 w-12 flex-shrink-0"
                :name="formatDisplayFolderTitle(folder)"
                :src="folder.avatarUrl"
              />
              <span class="min-w-0 flex-1 text-left">
                <strong
                  class="block truncate text-[0.96rem] font-semibold text-text"
                >
                  {{ formatDisplayFolderTitle(folder) }}
                </strong>
                <span class="block truncate text-[0.84rem] text-muted">
                  {{ describeFolder(folder) }}
                </span>
              </span>
            </button>

            <p
              v-if="folderSearchResults.length === 0"
              class="m-0 pt-2 text-[1rem] text-muted"
            >
              {{ t('explore.noFoldersFound') }}
            </p>
          </div>
        </section>
      </section>

      <template v-else>
        <div
          v-if="showInitialLoading"
          class="explore-view__skeleton-grid"
          aria-hidden="true"
        >
          <div
            v-for="index in 15"
            :key="index"
            class="explore-view__skeleton"
            :class="index % 6 === 0 ? 'explore-view__skeleton--feature' : ''"
          />
        </div>

        <section
          v-else-if="exploreStore.error"
          class="explore-view__message-card mx-auto"
        >
          <h1 class="m-0 text-[1.15rem] font-semibold text-text">
            {{ t('explore.errors.load') }}
          </h1>
          <p class="m-0 text-muted">{{ exploreStore.error }}</p>
        </section>

        <section
          v-else-if="rankedItems.length === 0"
          class="explore-view__message-card mx-auto"
        >
          <h1 class="m-0 text-[1.15rem] font-semibold text-text">
            {{ t('explore.emptyTitle') }}
          </h1>
          <p class="m-0 text-muted">
            {{ t('explore.emptyDescription') }}
          </p>
        </section>

        <template v-else>
          <ExploreGrid :items="rankedItems" />
          <InfiniteLoader
            :loading="exploreStore.loading"
            :has-more="exploreStore.hasMore"
            :button-fallback="false"
            @load-more="loadMore"
          />
        </template>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import Avatar from '../components/Avatar.vue';
import ExploreGrid from '../components/ExploreGrid.vue';
import InfiniteLoader from '../components/InfiniteLoader.vue';
import { useAppStore } from '../stores/app';
import { useExploreStore } from '../stores/explore';
import { useFoldersStore } from '../stores/folders';
import { useLikesStore } from '../stores/likes';
import type { FolderSummary } from '../types/api';
import { searchFolders, rankExploreItems } from '../utils/explore';
import { formatFolderTitle } from '../utils/folder-titles';
import { buildLikedCountByFolder } from '../utils/home-recommendations';
import { useRouteScrollMemory } from '../composables/useRouteScrollMemory';

// Named explicitly so <KeepAlive include> keeps matching after a minified build.
defineOptions({ name: 'ExploreView' });

type SearchTab = 'media' | 'folders';

const SEARCH_DEBOUNCE_MS = 180;

const appStore = useAppStore();
const exploreStore = useExploreStore();
const foldersStore = useFoldersStore();
const likesStore = useLikesStore();
useRouteScrollMemory({ key: 'explore' });
const route = useRoute();
const router = useRouter();
const { t, locale } = useI18n();

const searchInput = ref<HTMLInputElement | null>(null);
const searchQuery = ref(readRouteQueryValue(route.query.q));
const isSearchActive = ref(searchQuery.value.trim().length > 0);
const activeSearchTab = ref<SearchTab>(
  searchQuery.value.trim().length > 0 ? parseSearchTab(route.query.tab) : 'media'
);

let searchDebounceTimer: number | null = null;

const likedCountByFolder = computed(() =>
  buildLikedCountByFolder(likesStore.items)
);
const trimmedSearchQuery = computed(() => searchQuery.value.trim());
const hasActiveQuery = computed(() => trimmedSearchQuery.value.length > 0);
const recentSearchQueries = computed(() => exploreStore.recentSearchQueries);
const showRecentSearches = computed(
  () =>
    isSearchActive.value &&
    !hasActiveQuery.value &&
    recentSearchQueries.value.length > 0
);
const showSearchChrome = computed(
  () => hasActiveQuery.value || showRecentSearches.value
);
const folderSearchResults = computed(() =>
  searchFolders(foldersStore.items, trimmedSearchQuery.value)
);
const rankedItems = computed(() =>
  rankExploreItems(
    exploreStore.items,
    foldersStore.items,
    likedCountByFolder.value,
    appStore.recentOpenedFolderSlugs,
    appStore.lastOpenedFolderSlug
  )
);
const showInitialLoading = computed(
  () =>
    exploreStore.loading &&
    exploreStore.items.length === 0 &&
    !exploreStore.error
);
const showSearchLoading = computed(
  () =>
    activeSearchTab.value === 'media' &&
    exploreStore.searchLoading &&
    exploreStore.searchItems.length === 0 &&
    !exploreStore.searchError
);

function formatDisplayFolderTitle(folder: FolderSummary) {
  return formatFolderTitle(folder, appStore.nestedFolderTitleFormat);
}

watch(
  () => [route.query.q, route.query.tab] as const,
  ([routeQuery, routeTab]) => {
    const nextQuery = readRouteQueryValue(routeQuery);
    const hasRouteQuery = nextQuery.trim().length > 0;

    if (nextQuery !== searchQuery.value) {
      searchQuery.value = nextQuery;
    }

    const nextTab = hasRouteQuery ? parseSearchTab(routeTab) : 'media';
    if (nextTab !== activeSearchTab.value) {
      activeSearchTab.value = nextTab;
    }

    if (hasRouteQuery) {
      isSearchActive.value = true;
    }
  },
  { immediate: true }
);

watch([trimmedSearchQuery, activeSearchTab], ([query, tab]) => {
  const currentQuery = readRouteQueryValue(route.query.q).trim();
  const currentTab =
    currentQuery.length > 0 ? parseSearchTab(route.query.tab) : 'media';
  const nextTab = query.length > 0 ? tab : 'media';

  if (currentQuery === query && currentTab === nextTab) {
    return;
  }

  const nextRouteQuery = {
    ...route.query
  };

  if (query.length > 0) {
    nextRouteQuery.q = query;
    if (tab === 'folders') {
      nextRouteQuery.tab = 'folders';
    } else {
      delete nextRouteQuery.tab;
    }
  } else {
    delete nextRouteQuery.q;
    delete nextRouteQuery.tab;
  }

  void router.replace({
    name: 'explore',
    query: nextRouteQuery
  });
});

watch(
  trimmedSearchQuery,
  (query, previousQuery) => {
    const previousValue = previousQuery ?? '';

    if (searchDebounceTimer !== null) {
      window.clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }

    if (query.length === 0) {
      exploreStore.resetSearch();
      activeSearchTab.value = 'media';

      if (previousValue.length > 0) {
        isSearchActive.value = recentSearchQueries.value.length > 0;
      }

      return;
    }

    isSearchActive.value = true;
    searchDebounceTimer = window.setTimeout(() => {
      void exploreStore.loadSearch(query, true);
    }, SEARCH_DEBOUNCE_MS);
  },
  { immediate: true }
);

function activateSearch() {
  isSearchActive.value = true;
}

function commitSearch(query = trimmedSearchQuery.value) {
  exploreStore.recordRecentSearch(query);
}

async function applyRecentSearch(query: string) {
  commitSearch(query);
  activeSearchTab.value = 'media';
  isSearchActive.value = true;
  searchQuery.value = query;

  await nextTick();
  searchInput.value?.focus();
  searchInput.value?.setSelectionRange(query.length, query.length);
}

async function clearRecentSearches() {
  exploreStore.clearRecentSearches();

  if (!hasActiveQuery.value) {
    isSearchActive.value = false;
  }

  await nextTick();
  searchInput.value?.focus();
}

async function closeSearch() {
  if (searchDebounceTimer !== null) {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  searchQuery.value = '';
  activeSearchTab.value = 'media';
  isSearchActive.value = false;
  exploreStore.resetSearch();

  await nextTick();
  searchInput.value?.blur();
}

async function clearSearch() {
  if (searchDebounceTimer !== null) {
    window.clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  searchQuery.value = '';
  activeSearchTab.value = 'media';
  exploreStore.resetSearch();

  await nextTick();
  isSearchActive.value = recentSearchQueries.value.length > 0;
  searchInput.value?.focus();
}

async function handleEscape() {
  if (hasActiveQuery.value || showRecentSearches.value) {
    await closeSearch();
    return;
  }

  searchInput.value?.blur();
}

function selectSearchTab(tab: SearchTab) {
  activeSearchTab.value = tab;
}

async function openFolder(folder: FolderSummary) {
  commitSearch();
  await router.push({ name: 'folder', params: { slug: folder.slug } });
}

function handleSearchMediaOpen() {
  commitSearch();
}

function describeFolder(folder: FolderSummary): string {
  const location = folder.breadcrumb ?? folder.folderPath;
  const postLabel = folder.imageCount === 1
    ? t('explore.folderPostsOne', { count: new Intl.NumberFormat(locale.value).format(folder.imageCount) })
    : t('explore.folderPostsOther', { count: new Intl.NumberFormat(locale.value).format(folder.imageCount) });

  return `${location} • ${postLabel}`;
}

async function loadMore() {
  await exploreStore.loadMore();
}

async function loadMoreSearch() {
  if (activeSearchTab.value !== 'media') {
    return;
  }

  await exploreStore.loadMoreSearch();
}

function handleWindowKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !showSearchChrome.value) {
    return;
  }

  void handleEscape();
}

onMounted(async () => {
  exploreStore.initializeRecentSearches();

  const tasks: Array<Promise<unknown>> = [];
  if (foldersStore.items.length === 0) {
    tasks.push(foldersStore.fetchFolders());
  }

  if (!appStore.isLibraryUnavailable) {
    tasks.push(exploreStore.loadInitial());
  }

  window.addEventListener('keydown', handleWindowKeydown);
  await Promise.all(tasks);
});

// This route is cached, so the Escape handler must only be bound while search is on
// screen; otherwise Escape on another tab would clear the search chrome invisibly.
onActivated(() => {
  window.addEventListener('keydown', handleWindowKeydown);
});

onDeactivated(() => {
  window.removeEventListener('keydown', handleWindowKeydown);
});

onUnmounted(() => {
  if (searchDebounceTimer !== null) {
    window.clearTimeout(searchDebounceTimer);
  }

  window.removeEventListener('keydown', handleWindowKeydown);
});

function readRouteQueryValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0] : '';
  }

  return '';
}

function parseSearchTab(value: unknown): SearchTab {
  return readRouteQueryValue(value) === 'folders' ? 'folders' : 'media';
}
</script>

<style scoped>
.explore-view__search {
  box-shadow: inset 0 1px 0 var(--border);
}

.explore-view__tabs {
  align-items: center;
}

.explore-view__tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.6rem;
  padding: 0.62rem 1rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    color 0.15s ease,
    transform 0.15s ease;
}

.explore-view__tab:hover {
  border-color: color-mix(in srgb, var(--border) 52%, var(--accent) 48%);
  color: var(--text);
  transform: translateY(-1px);
}

.explore-view__tab--active {
  border-color: transparent;
  background: linear-gradient(
    135deg,
    color-mix(in srgb, var(--accent) 88%, white 12%),
    color-mix(in srgb, var(--accent-strong) 84%, white 16%)
  );
  color: #ffffff;
  box-shadow: 0 14px 28px rgba(0, 149, 246, 0.18);
}

.explore-view__recent-clear {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  padding: 0;
  transition: color 0.15s ease;
}

.explore-view__recent-clear:hover {
  color: var(--text);
}

.explore-view__recent-query {
  display: flex;
  align-items: center;
  gap: 0.8rem;
  width: 100%;
  padding: 0.72rem 0.3rem;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background-color 0.15s ease;
}

.explore-view__recent-query:hover {
  background: var(--surface-hover);
}

.explore-view__recent-query-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2.2rem;
  height: 2.2rem;
  border-radius: 999px;
  background: var(--surface);
  color: var(--muted);
  box-shadow: inset 0 0 0 1px var(--border);
}

.explore-view__result {
  display: flex;
  align-items: center;
  gap: 0.9rem;
  width: 100%;
  padding: 0.65rem 0.3rem;
  border: 0;
  background: transparent;
  cursor: pointer;
  color: inherit;
  transition: background-color 0.15s ease;
}

.explore-view__result:hover {
  background: var(--surface-hover);
}

.explore-view__message-card {
  display: grid;
  gap: 0.6rem;
  padding: 1.35rem 1.45rem;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--surface);
}

.explore-view__skeleton-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-flow: dense;
  gap: 0.2rem;
}

.explore-view__skeleton {
  aspect-ratio: 1 / 1;
  background: var(--surface-alt);
  animation: pulse 1.3s ease-in-out infinite;
}

@media (min-width: 1080px) {
  .explore-view__skeleton-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .explore-view__skeleton--feature {
    grid-column: span 2;
    grid-row: span 2;
  }
}
</style>
