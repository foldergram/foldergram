<template>
  <section
    ref="homeLayoutElement"
    :class="[
      'grid gap-[4rem] items-start justify-center mx-auto',
      isCompactHomeLayout
        ? 'grid-cols-1 w-full'
        : 'grid-cols-[minmax(0,39.375rem)_19.9375rem] w-[min(100%,63.3125rem)] md:relative',
    ]"
    :style="
      isCompactHomeLayout
        ? undefined
        : { left: 'calc(var(--desktop-content-compensation) * -1)' }
    "
  >
    <!-- Pull-to-refresh indicator: only ever visible while the gesture is active. -->
    <div
      v-if="pullToRefresh.isPulling.value || pullToRefresh.isRefreshing.value"
      class="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center"
      :style="{ transform: `translateY(${pullIndicatorOffset}px)` }"
      data-test="pull-to-refresh"
      role="status"
    >
      <span class="mt-2 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-[0.78rem] font-semibold text-muted shadow-[var(--shadow)]">
        <span
          class="h-4 w-4"
          :class="pullToRefresh.isRefreshing.value ? 'i-fluent-arrow-sync-16-regular animate-spin' : 'i-fluent-arrow-down-16-regular'"
          aria-hidden="true"
        />
        {{ pullToRefreshLabel }}
      </span>
    </div>

    <!-- Main feed column -->
    <div class="min-w-0">
      <section
        v-if="appStore.isLibraryRebuildRequired && appStore.stats && !appStore.isRebuilding"
        class="grid gap-[0.55rem] px-5 py-[1rem] mb-[1.1rem] border rounded-[1rem] shadow-[var(--shadow)]"
        style="background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 88%, #fff4d1 12%) 0%, color-mix(in srgb, var(--surface) 82%, #ffe49a 18%) 100%); border-color: color-mix(in srgb, var(--border) 72%, #d2a133 28%);"
      >
        <div class="flex items-start justify-between gap-4 max-sm:flex-col max-sm:items-start">
          <div class="grid gap-[0.2rem]">
            <strong>Library location changed</strong>
            <p class="m-0 text-muted">
              The current index may still contain folders and cached media from a previous gallery location. Review the rebuild steps to reset the index, reuse any matching thumbnails and previews, and generate only the missing derivatives for the current library.
            </p>
          </div>
          <RouterLink
            v-if="canManageLibrary"
            class="inline-flex items-center justify-center min-h-10 px-4 rounded-[0.8rem] text-[0.84rem] font-bold text-white bg-[#9f6a00] whitespace-nowrap"
            :to="{ name: 'settings', query: { action: 'rebuild' } }"
          >
            Review Rebuild
          </RouterLink>
          <p v-else class="m-0 text-[0.84rem] text-muted">An admin session needs to rebuild the library.</p>
        </div>
      </section>

      <section v-if="!appStore.isLibraryUnavailable" class="grid min-w-0 gap-[1rem] mb-5 w-full max-w-[39.375rem]">
        <section v-if="displayMomentItems.length" class="mb-2 min-w-0">
          <div class="story-rail-shell">
            <div class="stories-bar story-rail pb-5 pt-[0.12rem]" :aria-label="momentsStore.displayRailTitle">
              <div class="story-rail__track">
              <button
                v-for="moment in displayMomentItems"
                :key="moment.id"
                class="story-rail__item story-rail__button"
                :title="`${moment.title} · ${moment.subtitle}`"
                type="button"
                @click="openRailViewer(moment.id)"
              >
                <div
                  class="story-rail__ring"
                  style="background: var(--story-ring);"
                >
                  <div class="story-rail__ring-inner">
                    <Avatar class="story-rail__avatar" :name="moment.title" :src="moment.coverImage.thumbnailUrl" />
                  </div>
                </div>
                <span class="story-rail__label">{{ moment.title }}</span>
              </button>
            </div>
          </div>
          </div>
        </section>

        <div class="w-full max-w-[29.375rem] mx-auto flex items-center justify-between gap-[0.8rem] max-sm:flex-col max-sm:items-center">
          <div class="flex flex-wrap gap-[0.35rem] max-sm:w-full max-sm:justify-center">
            <button
              v-for="mode in feedModes"
              :key="mode.id"
              class="min-h-[2rem] px-[0.82rem] rounded-full border text-[0.71rem] font-bold transition-[background-color,border-color,color,box-shadow] duration-180"
              :class="feedStore.mode === mode.id ? 'border-[#1f2937] text-white shadow-[var(--shadow)]' : 'border-border text-text bg-surface hover:border-text/25 hover:bg-surface-alt'"
              :style="
                feedStore.mode === mode.id
                  ? 'background: linear-gradient(135deg, #1f2937 0%, #111827 100%);'
                  : undefined
              "
              :title="mode.description"
              :aria-label="`${mode.label}. ${mode.description}`"
              type="button"
              @click="selectMode(mode.id)"
            >
              {{ mode.label }}
            </button>
          </div>

          <div
            v-if="appStore.stats"
            class="m-0 shrink-0 flex items-center gap-[0.75rem] whitespace-nowrap text-[0.85rem] text-muted max-sm:mt-[3px] max-sm:justify-center"
            :aria-label="indexedSummaryLabel"
            role="status"
          >
            <span class="inline-flex items-center gap-[0.28rem]">
              <span class="i-fluent-image-16-regular w-[1.1rem] h-[1.1rem]" aria-hidden="true" />
              <strong class="font-semibold text-text">{{ formattedIndexedImageCount }}</strong>
            </span>
            <span class="inline-flex items-center gap-[0.28rem]">
              <span class="i-fluent-play-circle-24-filled w-[1.1rem] h-[1.1rem]" aria-hidden="true" />
              <strong class="font-semibold text-text">{{ formattedIndexedVideoCount }}</strong>
            </span>
            <span class="inline-flex items-center gap-[0.28rem]">
              <span class="i-fluent-folder-16-regular w-[1.1rem] h-[1.1rem]" aria-hidden="true" />
              <strong class="font-semibold text-text">{{ formattedFolderCount }}</strong>
            </span>
          </div>
        </div>
      </section>

      <!-- States -->
      <EmptyState v-if="appStore.isLibraryUnavailable" title="Library storage unavailable" :description="appStore.libraryUnavailableReason" />
      <ErrorState v-else-if="feedStore.error" title="Could not load feed" :message="feedStore.error" />

      <!-- Initial scan state (no feed yet) -->
      <section v-else-if="showInitialScanState" class="grid gap-[0.85rem] px-5 py-5 mb-[1.1rem] border border-border rounded-[1rem] shadow-[var(--shadow)]" style="background: radial-gradient(circle at top right, rgba(0,149,246,0.12), transparent 38%), linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 90%, var(--accent) 10%) 100%);">
        <div class="flex items-start justify-between gap-3 max-sm:flex-col max-sm:items-start">
          <span class="text-accent-strong text-[0.75rem] font-bold tracking-[0.08em] uppercase">Startup scan in progress</span>
          <span
            data-test="initial-scan-phase"
            class="inline-flex items-center justify-center min-h-8 px-[0.72rem] py-[0.34rem] rounded-full text-[0.73rem] font-bold whitespace-nowrap text-accent-strong"
            style="background: color-mix(in srgb, var(--surface-alt) 78%, var(--accent) 22%);"
          >
            {{ initialScanPhaseLabel }}
          </span>
        </div>
        <h2 class="m-0">Indexing your library</h2>
        <p class="m-0 text-muted">{{ scanDescription }}</p>
        <p v-if="scanActionLine" class="m-0 text-[0.86rem] font-semibold text-text">{{ scanActionLine }}</p>
        <dl class="grid grid-cols-4 gap-[0.8rem] m-0 max-sm:grid-cols-2">
          <div
            v-for="stat in initialScanStats"
            :key="stat.label"
            class="px-[0.9rem] py-[0.8rem] rounded-[0.85rem]"
            style="background: color-mix(in srgb, var(--surface-alt) 88%, var(--accent) 12%)"
          >
            <dt class="m-0 mb-[0.25rem] text-muted text-[0.74rem] uppercase tracking-[0.05em]">{{ stat.label }}</dt>
            <dd class="m-0 text-base font-bold">{{ stat.value }}</dd>
          </div>
        </dl>
      </section>

      <section
        v-else-if="showHomeSetupNotice"
        class="grid gap-[0.85rem] px-5 py-5 mb-[1.1rem] border rounded-[1rem] shadow-[var(--shadow)]"
        :style="homeSetupNoticeStyle"
      >
        <span class="text-[0.75rem] font-bold tracking-[0.08em] uppercase" :class="homeSetupNoticeEyebrowClass">
          {{ homeSetupNoticeEyebrow }}
        </span>
        <h2 class="m-0">{{ homeSetupNoticeTitle }}</h2>
        <p class="m-0 text-muted">{{ homeSetupNoticeDescription }}</p>
        <div class="flex items-center gap-4 max-sm:flex-col max-sm:items-start">
          <button v-if="canManageLibrary" class="btn-primary min-w-[11.5rem]" type="button" :disabled="homeScanDisabled" @click="runHomeScan">
            {{ homeScanButtonLabel }}
          </button>
          <p class="m-0 text-muted">{{ homeScanNote }}</p>
        </div>
        <p
          v-if="homeScanError"
          class="m-0 px-4 py-[0.85rem] border border-[rgba(214,48,49,0.24)] rounded-[0.9rem] text-[#c0392b] bg-[rgba(214,48,49,0.08)]"
        >
          {{ homeScanError }}
        </p>
      </section>
      <EmptyState v-else-if="feedStore.initialized && feedStore.items.length === 0" title="No posts indexed yet" description="Add folders under the gallery root and the feed will populate after the next scan." />
      <template v-else>
        <div
          v-if="feedStoryError"
          class="mx-auto mb-[1.1rem] grid w-full max-w-[29.375rem] gap-[0.75rem] rounded-[1rem] border border-[rgba(214,48,49,0.24)] bg-[rgba(214,48,49,0.08)] px-4 py-[0.95rem] text-[#c0392b]"
          role="alert"
        >
          <p class="m-0 text-[0.92rem]">{{ feedStoryError }}</p>
          <div>
            <button
              class="inline-flex min-h-9 items-center justify-center rounded-[0.8rem] border border-[rgba(192,57,43,0.18)] bg-white/65 px-3 text-[0.82rem] font-semibold text-[#a93226] transition-colors duration-180 hover:bg-white"
              type="button"
              :disabled="!feedStoryRetrySlug"
              @click="retryFeedFolderStory"
            >
              Retry Story
            </button>
          </div>
        </div>

        <!-- Feed cards in home-layout context: transparent card, no shadow -->
        <div class="w-full max-w-[29.375rem] mx-auto flex flex-col gap-[1.2rem]">
          <FeedList
            :items="feedStore.items"
            context="home"
            :show-skeleton="!feedStore.initialized && feedStore.loading"
            @open-folder-story="openFeedFolderStory"
          />
        </div>
        <div class="w-full max-w-[29.375rem] mx-auto">
          <InfiniteLoader :loading="feedStore.loading" :has-more="feedStore.hasMore" @load-more="feedStore.loadMore" />
        </div>
      </template>

      <StoriesModal
        v-if="activeRailViewerId && displayMomentItems.length"
        :items="displayMomentItems"
        :initial-id="activeRailViewerId"
        :rail-singular-label="momentsStore.displayRailSingularLabel"
        :store="momentsStore"
        @close="closeRailViewer"
      />
      <StoriesModal
        v-if="activeFeedStoryId && folderStoriesStore.items.length"
        :items="folderStoriesStore.items"
        :initial-id="activeFeedStoryId"
        :rail-singular-label="folderStoriesStore.railSingularLabel"
        :store="folderStoriesStore"
        @close="closeFeedFolderStory"
      />
    </div>

    <!-- Right rail (suggestions) — hidden on mobile -->
    <aside
      v-if="
        !appStore.isLibraryUnavailable &&
        homeSummaryFolder &&
        !isCompactHomeLayout
      "
      class="sticky top-8 grid gap-[1.15rem] w-[19.9375rem] text-muted"
      :aria-label="t('home.sidebar.ariaLabel')"
    >
      <div class="flex items-center gap-[0.8rem]">
        <Avatar class="w-11 h-11" :name="formatDisplayFolderTitle(homeSummaryFolder)" :src="homeSummaryFolder.avatarUrl" />
        <div class="flex-1 min-w-0">
          <strong class="block text-text text-[0.87rem] font-bold">{{ formatDisplayFolderTitle(homeSummaryFolder) }}</strong>
          <p class="m-0 mt-[0.12rem] text-[0.79rem] truncate">{{ homeSummaryFolder.breadcrumb ?? t('folder.shared.topLevelSourceFolder') }}</p>
        </div>
        <RouterLink class="ml-auto text-accent-strong text-[0.76rem] font-bold" :to="{ name: 'folder', params: { slug: homeSummaryFolder.slug } }">{{ t('home.sidebar.openFolder') }}</RouterLink>
      </div>

      <div class="flex items-center justify-between gap-4 text-text text-[0.96rem] font-bold">
        <span>{{ t('home.sidebar.suggestedFolders') }}</span>
        <RouterLink class="text-muted text-[0.76rem] font-bold" :to="{ name: 'likes' }">{{ homeSidebarLinkLabel }}</RouterLink>
      </div>

      <div class="grid gap-[0.95rem]">
        <RouterLink
          v-for="folder in recommendedFolders"
          :key="folder.id"
          class="flex items-center gap-[0.8rem]"
          :to="{ name: 'folder', params: { slug: folder.slug } }"
        >
          <Avatar class="w-11 h-11" :name="formatDisplayFolderTitle(folder)" :src="folder.avatarUrl" />
          <div class="flex-1 min-w-0">
            <strong class="block text-text text-[0.87rem] font-bold">{{ formatDisplayFolderTitle(folder) }}</strong>
            <p class="m-0 mt-[0.12rem] text-[0.79rem] truncate">{{ folder.breadcrumb ?? t('folder.shared.topLevelSourceFolder') }}</p>
          </div>
          <span class="ml-auto text-accent-strong text-[0.76rem] font-bold">{{ t('home.sidebar.openFolder') }}</span>
        </RouterLink>
      </div>

      <p class="m-0 mt-[1.4rem] text-center text-[0.64rem] font-semibold uppercase tracking-[0.08em] leading-[1.7] text-muted">
        {{ t('home.sidebar.openSourceText') }}
        <a
          class="text-muted transition-colors duration-180 hover:text-text"
          href="https://github.com/foldergram/foldergram"
          target="_blank"
          rel="noreferrer"
        >
          {{ t('home.sidebar.viewOnGitHub') }}
        </a>
      </p>
    </aside>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink } from 'vue-router';

import { triggerManualScan } from '../api/gallery';
import Avatar from '../components/Avatar.vue';
import EmptyState from '../components/EmptyState.vue';
import ErrorState from '../components/ErrorState.vue';
import FeedList from '../components/FeedList.vue';
import InfiniteLoader from '../components/InfiniteLoader.vue';
import StoriesModal from '../components/StoriesModal.vue';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { useFeedStore } from '../stores/feed';
import { useFolderStoriesStore } from '../stores/folder-stories';
import { useLikesStore } from '../stores/likes';
import { useFoldersStore } from '../stores/folders';
import { useMomentsStore } from '../stores/moments';
import type { FeedMode } from '../types/api';
import { formatFolderTitle } from '../utils/folder-titles';
import { buildLikedCountByFolder, selectHomeRecommendations } from '../utils/home-recommendations';
import { usePullToRefresh } from '../composables/usePullToRefresh';
import { getInitialScanStats, getScanActionLine, getScanPhaseLabel, getScanSummary } from '../utils/scan-progress';

const appStore = useAppStore();
const authStore = useAuthStore();
const feedStore = useFeedStore();
const folderStoriesStore = useFolderStoriesStore();
const likesStore = useLikesStore();
const foldersStore = useFoldersStore();
const momentsStore = useMomentsStore();
const { t } = useI18n();
const likedCountByFolder = computed(() => buildLikedCountByFolder(likesStore.items));
const homeRecommendations = computed(() =>
  selectHomeRecommendations(foldersStore.items, likedCountByFolder.value, appStore.lastOpenedFolderSlug)
);
const homeSummaryFolder = computed(() => homeRecommendations.value.homeSummaryFolder);
const recommendedFolders = computed(() => homeRecommendations.value.recommendedFolders);
const activeRailViewerId = ref<string | null>(null);
const activeFeedStoryId = ref<string | null>(null);
const feedStoryRetrySlug = ref<string | null>(null);
const homeLayoutElement = ref<HTMLElement | null>(null);
const isCompactHomeLayout = ref(false);
const requestingHomeScan = ref(false);
const homeScanError = ref<string | null>(null);
const feedStoryError = ref<string | null>(null);

/**
 * Pull-to-refresh swaps in content the viewer has not seen instead of re-rendering the
 * same rows, which is what the feed did before when a page was reloaded.
 */
const pullToRefresh = usePullToRefresh({
  isEnabled: () =>
    !appStore.isLibraryUnavailable && activeRailViewerId.value === null && activeFeedStoryId.value === null,
  onRefresh: async () => {
    await feedStore.refreshWithNewSeed();
    await momentsStore.fetchMoments(true).catch(() => {});
  }
});
const pullIndicatorOffset = computed(() =>
  pullToRefresh.isRefreshing.value ? pullToRefresh.threshold : pullToRefresh.pullDistance.value
);
const pullToRefreshLabel = computed(() => {
  if (pullToRefresh.isRefreshing.value) {
    return t('app.pullToRefresh.refreshing');
  }

  return pullToRefresh.pullDistance.value >= pullToRefresh.threshold
    ? t('app.pullToRefresh.release')
    : t('app.pullToRefresh.pull');
});

function formatDisplayFolderTitle(folder: NonNullable<typeof homeSummaryFolder.value> | (typeof recommendedFolders.value)[number]) {
  return formatFolderTitle(folder, appStore.nestedFolderTitleFormat);
}

const HOME_RIGHT_RAIL_BREAKPOINT = 960;
let homeLayoutResizeObserver: ResizeObserver | null = null;

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

const displayMomentItems = computed(() => momentsStore.localizedItems);
const homeSidebarLinkLabel = computed(() =>
  authStore.likesMode === 'local' ? t('home.sidebar.viewFavorites') : t('home.sidebar.viewLikes')
);

const indexedSummaryLabel = computed(() => {
  if (!appStore.stats) {
    return '';
  }

  return `${formatCount(appStore.stats.indexedImages)} posts, ${formatCount(appStore.stats.indexedVideos)} videos across ${formatCount(appStore.stats.folders)} folders`;
});
const formattedIndexedImageCount = computed(() => formatCount(appStore.stats?.indexedImages ?? 0));
const formattedIndexedVideoCount = computed(() => formatCount(appStore.stats?.indexedVideos ?? 0));
const formattedFolderCount = computed(() => formatCount(appStore.stats?.folders ?? 0));
const feedModes = computed<Array<{ id: FeedMode; label: string; description: string }>>(() => [
  {
    id: 'recent',
    label: t('settings.general.homeFeed.options.recent.label'),
    description: t('settings.general.homeFeed.options.recent.description')
  },
  {
    id: 'rediscover',
    label: t('settings.general.homeFeed.options.rediscover.label'),
    description: t('settings.general.homeFeed.options.rediscover.description')
  },
  {
    id: 'random',
    label: t('settings.general.homeFeed.options.random.label'),
    description: t('settings.general.homeFeed.options.random.description')
  }
]);
const showInitialScanState = computed(
  () => appStore.isScanning && feedStore.items.length === 0 && !feedStore.loading && !feedStore.error
);
const ignoredRootMediaCount = computed(() => appStore.stats?.libraryIndex.ignoredRootMediaCount ?? 0);
const hasIndexedFolders = computed(() => (appStore.stats?.folders ?? 0) > 0);
const showHomeSetupNotice = computed(
  () =>
    !appStore.isLibraryUnavailable &&
    !showInitialScanState.value &&
    Boolean(appStore.stats) &&
    feedStore.initialized &&
    feedStore.items.length === 0 &&
    !hasIndexedFolders.value
);
const homeSetupNoticeEyebrow = computed(() => (ignoredRootMediaCount.value > 0 ? 'Gallery Root' : 'Get Started'));
const homeSetupNoticeEyebrowClass = computed(() => (ignoredRootMediaCount.value > 0 ? 'text-[#9f6a00]' : 'text-accent-strong'));
const homeSetupNoticeTitle = computed(() =>
  ignoredRootMediaCount.value > 0 ? 'Files in the gallery root are being ignored' : 'No folders found yet'
);
const homeSetupNoticeDescription = computed(() => {
  if (ignoredRootMediaCount.value > 0) {
    const supportedFileLabel = ignoredRootMediaCount.value === 1 ? 'supported file is' : 'supported files are';
    return `${formatCount(ignoredRootMediaCount.value)} ${supportedFileLabel} being ignored in the gallery root. Move them into a folder inside your gallery root, such as example-album, to create App Folders. Files placed directly in the gallery root are ignored.`;
  }

  return 'Create a folder inside your gallery root, such as example-album, and place photos or videos in it to create your first App Folder. Files placed directly in the gallery root are ignored.';
});
const homeSetupNoticeStyle = computed(() =>
  ignoredRootMediaCount.value > 0
    ? 'background: radial-gradient(circle at top right, rgba(210,161,51,0.16), transparent 38%), linear-gradient(180deg, color-mix(in srgb, var(--surface) 92%, #fff4d1 8%) 0%, color-mix(in srgb, var(--surface) 88%, #ffeab1 12%) 100%); border-color: color-mix(in srgb, var(--border) 70%, #d2a133 30%);'
    : 'background: radial-gradient(circle at top right, rgba(0,149,246,0.12), transparent 38%), linear-gradient(180deg, var(--surface) 0%, color-mix(in srgb, var(--surface) 92%, var(--accent) 8%) 100%); border-color: color-mix(in srgb, var(--border) 78%, var(--accent) 22%);'
);
const homeScanDisabled = computed(
  () =>
    !authStore.canManageLibrary ||
    appStore.isLibraryUnavailable ||
    appStore.isLibraryRebuildRequired ||
    appStore.isScanning ||
    requestingHomeScan.value
);
const canManageLibrary = computed(() => authStore.canManageLibrary);
const homeScanButtonLabel = computed(() => {
  if (appStore.isScanning || requestingHomeScan.value) {
    return 'Scanning library...';
  }

  return 'Run Scan Library';
});
const homeScanNote = computed(() => {
  if (appStore.isLibraryUnavailable) {
    return appStore.libraryUnavailableReason;
  }

  if (appStore.isLibraryRebuildRequired) {
    return 'Rebuild the library index first because the gallery location changed.';
  }

  if (!authStore.canManageLibrary) {
    return 'An admin session needs to run the next scan before new folders or moved media will appear here.';
  }

  if (appStore.isScanning || requestingHomeScan.value) {
    return 'Scanning the gallery now and refreshing the Home feed when it finishes.';
  }

  return 'Run a scan after adding folders or moving files so the library can index them.';
});
const initialScanPhaseLabel = computed(() => getScanPhaseLabel(appStore.stats?.scan ?? null));
const initialScanStats = computed(() => getInitialScanStats(appStore.stats?.scan ?? null));
const scanDescription = computed(() => {
  const scan = appStore.stats?.scan;
  return scan ? getScanSummary(scan) : 'Preparing scan status...';
});
const scanActionLine = computed(() => getScanActionLine(appStore.stats?.scan ?? null));

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function warmScanStatus() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await wait(attempt === 0 ? 150 : 250);

    try {
      await appStore.fetchStats({ background: true });
    } catch {
      // The rescan request may win the race; keep polling until scan state flips or the request finishes.
    }

    if (appStore.stats?.scan.isScanning) {
      return;
    }
  }
}

async function selectMode(mode: FeedMode) {
  await feedStore.setMode(mode);
}

function openRailViewer(id: string) {
  activeFeedStoryId.value = null;
  activeRailViewerId.value = id;
}

function closeRailViewer() {
  activeRailViewerId.value = null;
}

async function openFeedFolderStory(slug: string) {
  if (appStore.isLibraryUnavailable) {
    return;
  }

  activeRailViewerId.value = null;
  activeFeedStoryId.value = null;
  feedStoryRetrySlug.value = slug;
  feedStoryError.value = null;

  await folderStoriesStore.fetchStories(slug, folderStoriesStore.currentFolderSlug !== slug);
  if (folderStoriesStore.listError) {
    feedStoryError.value = folderStoriesStore.listError;
    return;
  }

  if (!folderStoriesStore.hasAvatarStory || !folderStoriesStore.avatarStoryId) {
    return;
  }

  activeFeedStoryId.value = folderStoriesStore.avatarStoryId;
}

function closeFeedFolderStory() {
  activeFeedStoryId.value = null;
}

async function retryFeedFolderStory() {
  if (!feedStoryRetrySlug.value) {
    return;
  }

  await folderStoriesStore.fetchStories(feedStoryRetrySlug.value, true);
  if (folderStoriesStore.listError) {
    feedStoryError.value = folderStoriesStore.listError;
    return;
  }

  feedStoryError.value = null;

  if (folderStoriesStore.hasAvatarStory && folderStoriesStore.avatarStoryId) {
    activeFeedStoryId.value = folderStoriesStore.avatarStoryId;
  }
}

function updateHomeLayout() {
  const layoutWidth = homeLayoutElement.value?.clientWidth ?? window.innerWidth;
  isCompactHomeLayout.value = layoutWidth <= HOME_RIGHT_RAIL_BREAKPOINT;
}

async function runHomeScan() {
  if (homeScanDisabled.value || !authStore.canManageLibrary) {
    return;
  }

  requestingHomeScan.value = true;
  homeScanError.value = null;

  try {
    const request = triggerManualScan();
    void warmScanStatus();
    await request;
    await appStore.fetchStats({ background: true });
    await Promise.all([foldersStore.fetchFolders(true), feedStore.loadInitial(true), momentsStore.fetchMoments(true)]);
  } catch (error) {
    homeScanError.value = error instanceof Error ? error.message : 'Unable to start a library scan.';
  } finally {
    requestingHomeScan.value = false;
  }
}

onMounted(async () => {
  updateHomeLayout();

  if (typeof ResizeObserver !== 'undefined' && homeLayoutElement.value) {
    homeLayoutResizeObserver = new ResizeObserver(() => {
      updateHomeLayout();
    });
    homeLayoutResizeObserver.observe(homeLayoutElement.value);
  } else {
    window.addEventListener('resize', updateHomeLayout);
  }

  if (!appStore.stats) {
    await appStore.fetchStats().catch(() => {});
  }

  if (appStore.isLibraryUnavailable) {
    return;
  }

  feedStore.initializeMode(appStore.defaultHomeFeedMode);
  await Promise.all([feedStore.loadInitial(), momentsStore.fetchMoments()]);
});

watch(
  () => [appStore.stats?.indexedImages ?? 0, appStore.stats?.folders ?? 0] as const,
  async ([indexedImages, folderCount]) => {
    if (appStore.isLibraryUnavailable) {
      return;
    }

    if (folderCount > 0 && folderCount !== foldersStore.items.length) {
      await foldersStore.fetchFolders(true);
    }

    if (indexedImages > 0 && feedStore.items.length === 0 && !feedStore.loading) {
      await feedStore.loadInitial(true);
    }

    if (indexedImages > 0 && momentsStore.items.length === 0 && !momentsStore.loadingList) {
      await momentsStore.fetchMoments(true);
    }
  }
);

watch(
  () => appStore.stats?.scan.lastCompletedScan?.id ?? null,
  async (lastCompletedScanId, previousScanId) => {
    if (
      appStore.isLibraryUnavailable ||
      lastCompletedScanId === null ||
      lastCompletedScanId === previousScanId ||
      momentsStore.loadingList
    ) {
      return;
    }

    const completedScan = appStore.stats?.scan.lastCompletedScan;
    const changedLibrary = Boolean(
      completedScan &&
        (completedScan.new_files > 0 || completedScan.updated_files > 0 || completedScan.removed_files > 0)
    );

    if (changedLibrary) {
      // Refresh visible caches once after a background watcher scan finishes.
      await Promise.all([
        foldersStore.fetchFolders(true),
        feedStore.loadInitial(true),
        momentsStore.fetchMoments(true)
      ]);
      return;
    }

    await momentsStore.fetchMoments(true);
  }
);

watch(
  () => momentsStore.items.map((item) => item.id),
  (ids) => {
    if (activeRailViewerId.value && !ids.includes(activeRailViewerId.value)) {
      activeRailViewerId.value = ids[0] ?? null;
    }
  }
);

watch(
  () => folderStoriesStore.items.map((item) => item.id),
  (ids) => {
    if (activeFeedStoryId.value && !ids.includes(activeFeedStoryId.value)) {
      activeFeedStoryId.value = folderStoriesStore.avatarStoryId && ids.includes(folderStoriesStore.avatarStoryId)
        ? folderStoriesStore.avatarStoryId
        : null;
    }
  }
);

onUnmounted(() => {
  homeLayoutResizeObserver?.disconnect();
  homeLayoutResizeObserver = null;
  window.removeEventListener('resize', updateHomeLayout);
});
</script>
