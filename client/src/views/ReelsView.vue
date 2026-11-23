<template>
  <section class="reels-view">
    <button v-if="route.params.id" class="reels-view__close" type="button" :aria-label="t('common.close')" @click="closeViewer">×</button>
    <section v-if="appStore.isLibraryUnavailable" class="reels-view__message-card">
      <p class="reels-view__eyebrow">{{ t('nav.reels') }}</p>
      <h1 class="reels-view__title">{{ t('reels.view.libraryUnavailableTitle') }}</h1>
      <p class="reels-view__message">{{ appStore.libraryUnavailableReason }}</p>
    </section>

    <section v-else-if="reelsStore.error" class="reels-view__message-card">
      <p class="reels-view__eyebrow">{{ t('nav.reels') }}</p>
      <h1 class="reels-view__title">{{ t('reels.view.loadErrorTitle') }}</h1>
      <p class="reels-view__message">{{ reelsStore.error }}</p>
    </section>

    <section v-else-if="showLoadingState" class="reels-view__message-card">
      <p class="reels-view__eyebrow">{{ t('nav.reels') }}</p>
      <h1 class="reels-view__title">{{ t('reels.view.loadingTitle') }}</h1>
      <p class="reels-view__message">{{ t('reels.view.loadingDescription') }}</p>
    </section>

    <section v-else-if="reelsStore.initialized && reelsStore.items.length === 0" class="reels-view__message-card">
      <p class="reels-view__eyebrow">{{ t('nav.reels') }}</p>
      <h1 class="reels-view__title">{{ t('reels.view.emptyTitle') }}</h1>
      <p class="reels-view__message">{{ t('reels.view.emptyDescription') }}</p>
    </section>

    <div
      v-else
      class="reels-view__layout"
      :class="{ 'reels-view__layout--active-portrait': activeItem && activeItem.height > activeItem.width }"
      :style="{ '--reels-active-stage-ratio': activeItem && activeItem.width > 0 && activeItem.height > 0 ? activeItem.width / activeItem.height : 9 / 16 }"
    >
      <div class="reels-view__deck-shell">
        <ReelDeck
          ref="deckElement"
          :items="reelsStore.items"
          :folders="knownFolders"
          :active-reel-id="reelsStore.activeReelId"
          :loading="reelsStore.loading"
          :external-metadata="showExternalMetadata"
          @active-change="handleActiveChange"
          @prefetch="handlePrefetch"
        >
          <template #mobile-action-rail="{ item }">
            <ReelActionRail
              v-if="isMobileViewport"
              class="reels-view__action-rail reels-view__action-rail--mobile"
              :item="item"
              :info-open="isInfoSidebarOpen"
              @toggle-info="handleInfoToggle"
            >
              <template #info-panel>
                <Transition name="reels-info-popup">
                  <div v-if="isInfoSidebarOpen" data-test="info-shell" class="reels-view__info-shell">
                    <ReelInfoSidebar
                      :item="item"
                      :folder="activeFolder"
                      anchor="right"
                      :open="isInfoSidebarOpen"
                      @close="closeInfoSidebar"
                    />
                  </div>
                </Transition>
              </template>
            </ReelActionRail>
          </template>
        </ReelDeck>
        <div v-if="!isMobileViewport" ref="metadataGutter" class="reels-view__metadata-gutter">
          <RouterLink
            v-if="showExternalMetadata && activeItem"
            class="reels-view__metadata"
            :to="{ name: 'folder', params: { slug: activeItem.folderSlug } }"
          >
            <Avatar
              class="reels-view__metadata-avatar"
              :name="activeFolderTitle"
              :src="activeFolder ? activeFolder.avatarUrl : activeItem.folderAvatarUrl ?? null"
            />
            <div class="reels-view__metadata-copy">
              <strong class="reels-view__metadata-title">{{ activeFolderTitle }}</strong>
              <p
                v-if="activeItem.caption?.trim()"
                class="reels-view__metadata-caption"
                :title="activeItem.caption"
              >
                {{ activeItem.caption }}
              </p>
              <div class="reels-view__source-line" :title="activeItem.filename">
                <span class="i-fluent-video-20-regular reels-view__source-icon" aria-hidden="true" />
                <span
                  ref="sourceViewport"
                  class="reels-view__source-viewport"
                  :class="{ 'reels-view__source-viewport--scrolling': sourceOverflows }"
                >
                  <span :key="activeItem.id" class="reels-view__source-track">
                    <span ref="sourceLabel" class="reels-view__source-label">{{ activeItem.filename }}</span>
                    <span v-if="sourceOverflows" aria-hidden="true">{{ activeItem.filename }}</span>
                  </span>
                </span>
              </div>
            </div>
          </RouterLink>
        </div>
      </div>

      <div v-if="!isMobileViewport" class="reels-view__nav-controls" :aria-label="t('reels.view.navigationAria')">
        <button
          class="reels-view__nav-button"
          type="button"
          :aria-label="t('reels.view.previous')"
          :disabled="!canGoPrevious"
          @click="goToPrevious"
        >
          <svg class="reels-view__nav-icon" viewBox="0 0 24 24" role="presentation">
            <path
              d="m4 15 8-8 8 8"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.9"
            />
          </svg>
        </button>
        <button
          class="reels-view__nav-button"
          type="button"
          :aria-label="t('reels.view.next')"
          :disabled="!canGoNext"
          @click="goToNext"
        >
          <svg class="reels-view__nav-icon" viewBox="0 0 24 24" role="presentation">
            <path
              d="m4 9 8 8 8-8"
              fill="none"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="1.9"
            />
          </svg>
        </button>
      </div>

      <div v-if="!isMobileViewport" class="reels-view__right-column">
        <div ref="detailsGutter" class="reels-view__details-gutter" aria-hidden="true" />
        <ReelActionRail
          v-if="activeItem"
          class="reels-view__action-rail reels-view__action-rail--desktop"
          :class="desktopInfoPanelSideClass"
          :item="activeItem"
          :info-open="isInfoSidebarOpen"
          @toggle-info="handleInfoToggle"
        >
          <template #info-panel>
            <Transition name="reels-info-popup">
              <div v-if="isInfoSidebarOpen" data-test="info-shell" class="reels-view__info-shell">
                <ReelInfoSidebar
                  :item="activeItem"
                  :folder="activeFolder"
                  :anchor="desktopInfoSidebarAnchor"
                  :open="isInfoSidebarOpen"
                  @close="closeInfoSidebar"
                />
              </div>
            </Transition>
          </template>
        </ReelActionRail>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, useRoute, useRouter } from 'vue-router';

import Avatar from '../components/Avatar.vue';
import ReelActionRail from '../components/ReelActionRail.vue';
import ReelDeck from '../components/ReelDeck.vue';
import ReelInfoSidebar from '../components/ReelInfoSidebar.vue';
import { useAppStore } from '../stores/app';
import { useFoldersStore } from '../stores/folders';
import { useReelsStore } from '../stores/reels';
import { formatFolderTitle } from '../utils/folder-titles';

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const foldersStore = useFoldersStore();
const reelsStore = useReelsStore();
const { t } = useI18n();
const deckElement = ref<InstanceType<typeof ReelDeck> | null>(null);
const isInfoSidebarOpen = ref(false);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 0);
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 0);
const isMobileViewport = computed(() => viewportWidth.value < 768);
const metadataGutter = ref<HTMLElement | null>(null);
const detailsGutter = ref<HTMLElement | null>(null);
const metadataFits = ref(false);
const detailsFit = ref(false);
const showExternalMetadata = computed(() =>
  viewportWidth.value >= 1152 && viewportWidth.value > viewportHeight.value && metadataFits.value
);
const sourceViewport = ref<HTMLElement | null>(null);
const sourceLabel = ref<HTMLElement | null>(null);
const sourceOverflows = ref(false);
const desktopInfoPanelSide = computed<'left' | 'right'>(() =>
  viewportWidth.value > viewportHeight.value && detailsFit.value ? 'right' : 'left'
);
const desktopInfoPanelSideClass = computed(() =>
  desktopInfoPanelSide.value === 'right'
    ? 'reels-view__action-rail--desktop-info-right'
    : 'reels-view__action-rail--desktop-info-left'
);
const desktopInfoSidebarAnchor = computed<'left' | 'right'>(() =>
  desktopInfoPanelSide.value === 'right' ? 'left' : 'right'
);

const activeItem = computed(() => reelsStore.activeItem);
const knownFolders = computed(() => [...foldersStore.items, ...Object.values(foldersStore.summaryBySlug)]);
const activeFolder = computed(() =>
  activeItem.value ? knownFolders.value.find((folder) => folder.slug === activeItem.value?.folderSlug) ?? null : null
);
const activeFolderTitle = computed(() => {
  const item = activeItem.value;
  return item ? formatFolderTitle(activeFolder.value ?? item, appStore.nestedFolderTitleFormat) : '';
});
const activeIndex = computed(() => reelsStore.items.findIndex((item) => item.id === reelsStore.activeReelId));
const canGoPrevious = computed(() => activeIndex.value > 0);
const canGoNext = computed(() => activeIndex.value >= 0 && activeIndex.value < reelsStore.items.length - 1);
const showLoadingState = computed(() => reelsStore.loading && !reelsStore.initialized);
let pendingDeckRouteId: string | null = null;
let latestRouteRequest = 0;
let loadingLinkedReel = false;

function handleActiveChange(id: number) {
  // An in-flight explicit URL navigation takes precedence over stale scroll events.
  if (loadingLinkedReel) return;
  latestRouteRequest += 1;
  reelsStore.invalidatePendingOpenReel();
  reelsStore.setActiveReel(id);
  if (route.params.id !== String(id)) {
    pendingDeckRouteId = String(id);
    void router.replace({ name: 'reels', params: { id: String(id) }, query: route.query });
  }
}

function closeViewer() {
  if (route.query.from === 'home' && window.history.state?.back) {
    router.back();
  } else {
    void router.push({ name: 'home' });
  }
}

async function openLinkedReel(value: string) {
  const request = ++latestRouteRequest;
  loadingLinkedReel = true;
  reelsStore.error = null;
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    reelsStore.invalidatePendingOpenReel();
    reelsStore.error = 'Invalid Reel ID';
    loadingLinkedReel = false;
    return;
  }

  try {
    const applied = await reelsStore.openReel(id);
    if (!applied || request !== latestRouteRequest || route.params.id !== value) return;
    await nextTick();
    if (request === latestRouteRequest && route.params.id === value) {
      deckElement.value?.scrollToReel(id);
    }
  } catch (error) {
    if (request === latestRouteRequest && route.params.id === value) {
      reelsStore.error = error instanceof Error ? error.message : 'Unable to load Reel';
    }
  } finally {
    if (request === latestRouteRequest) loadingLinkedReel = false;
  }
}

async function openReelsEntry() {
  const request = ++latestRouteRequest;
  // A cancelled deep-link load must not keep scroll-to-URL updates disabled.
  loadingLinkedReel = false;
  reelsStore.invalidatePendingOpenReel();
  reelsStore.error = null;
  await reelsStore.loadInitial();
  if (request !== latestRouteRequest || route.params.id) return;
  if (reelsStore.activeReelId !== null) {
    const id = String(reelsStore.activeReelId);
    pendingDeckRouteId = id;
    await router.replace({ name: 'reels', params: { id }, query: route.query });
  }
}

watch(() => route.params.id, (value) => {
  if (value === pendingDeckRouteId) {
    pendingDeckRouteId = null;
    return;
  }
  pendingDeckRouteId = null;
  if (typeof value === 'string' && value.length > 0) {
    void openLinkedReel(value);
  } else {
    void openReelsEntry();
  }
});

async function handlePrefetch(activeIndex: number) {
  await reelsStore.prefetchIfNeeded(activeIndex);
}

function goToPrevious() {
  deckElement.value?.goToPrevious();
}

function goToNext() {
  deckElement.value?.goToNext();
}

function handleInfoToggle() {
  isInfoSidebarOpen.value = !isInfoSidebarOpen.value;
}

function closeInfoSidebar() {
  isInfoSidebarOpen.value = false;
}

function updateViewportMode() {
  viewportWidth.value = window.innerWidth;
  viewportHeight.value = window.innerHeight;
}

function shouldCaptureGlobalWheel(event: WheelEvent) {
  if (event.defaultPrevented || Math.abs(event.deltaY) < 0.5) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return true;
  }

  if (target.closest('.sidebar, .collection-bookmark__popover')) {
    return false;
  }

  if (target.closest('input, textarea, select, [contenteditable="true"]')) {
    return false;
  }

  return true;
}

function handleGlobalWheel(event: WheelEvent) {
  if (!deckElement.value || !shouldCaptureGlobalWheel(event)) {
    return;
  }

  event.preventDefault();
  deckElement.value?.navigateByWheel(event.deltaY);
}

onMounted(async () => {
  updateViewportMode();
  window.addEventListener('resize', updateViewportMode);
  window.addEventListener('wheel', handleGlobalWheel, { passive: false });
  const requestedId = route.params.id;
  if (typeof requestedId === 'string' && requestedId.length > 0) {
    await openLinkedReel(requestedId);
  } else {
    await openReelsEntry();
  }
});

onBeforeUnmount(() => {
  latestRouteRequest += 1;
  reelsStore.invalidatePendingOpenReel();
  window.removeEventListener('resize', updateViewportMode);
  window.removeEventListener('wheel', handleGlobalWheel);
});

watch([metadataGutter, detailsGutter, viewportWidth, viewportHeight], ([metadata, details], _previous, onCleanup) => {
  const updateGutters = () => {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    metadataFits.value = !!metadata && metadata.clientWidth >= 9 * rem;
    detailsFit.value = !!details && details.clientWidth >= 16 * rem;
  };

  updateGutters();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(updateGutters);
    if (metadata) observer.observe(metadata);
    if (details) observer.observe(details);
    onCleanup(() => observer.disconnect());
  }
}, { flush: 'post' });

watch([sourceViewport, sourceLabel], ([viewport, label], _previous, onCleanup) => {
  sourceOverflows.value = false;
  if (!viewport || !label) {
    return;
  }

  const measureOverflow = () => {
    sourceOverflows.value = label.scrollWidth > viewport.clientWidth;
  };
  measureOverflow();
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(measureOverflow);
    observer.observe(viewport);
    observer.observe(label);
    onCleanup(() => observer.disconnect());
  }
}, { flush: 'post' });

watch(activeItem, (item) => {
  if (!item) {
    isInfoSidebarOpen.value = false;
  }
});
</script>

<style scoped>
.reels-view {
  position: relative;
  height: 100%;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
}

.reels-view__close {
  position: absolute;
  z-index: 10;
  top: 0.75rem;
  right: 0.75rem;
  width: 2.5rem;
  height: 2.5rem;
  border: 0;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text) 12%, var(--bg));
  color: var(--text);
  font-size: 1.8rem;
  cursor: pointer;
}

.reels-view__layout {
  --reels-desktop-rail-width: 3.8rem;
  --reels-desktop-column-gap: 0.5rem;
  --reel-stage-block-gap: 0.75rem;
  --reel-stage-inline-gap: 1.25rem;
  --reels-nav-clearance: 13rem;
  --reels-nav-inset: 1.5rem;
  --reels-nav-button-size: 2.75rem;
  --reels-details-offset: 2.05rem;
  --reels-details-width: 0px;
  --reels-metadata-gap: 3.5rem;
  --reels-metadata-width: 0px;
  --reels-desktop-stage-width: 24.4rem;
  --reels-active-block-limit: calc(100cqh - var(--reel-stage-block-gap));
  --reels-rail-adjustment: 2rem;
  --reels-active-stage-width: min(var(--reels-desktop-stage-width), calc(var(--reels-active-block-limit) * var(--reels-active-stage-ratio)));
  --reels-active-stage-height: calc(var(--reels-active-stage-width) / var(--reels-active-stage-ratio));
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, var(--reels-desktop-stage-width)) var(--reels-desktop-rail-width);
  column-gap: var(--reels-desktop-column-gap);
  justify-content: center;
  align-items: center;
  height: 100%;
  min-height: 100%;
  width: 100%;
  padding: 0 0.75rem;
  container-type: size;
}

@supports (width: 1cqw) {
  .reels-view__layout {
    /* Keep the deck width fixed while individual Reels choose their own aspect ratio. */
    --reels-desktop-stage-width: min(
      calc((100cqh - var(--reel-stage-block-gap)) * 16 / 9),
      calc(100cqw - var(--reels-desktop-rail-width) - var(--reels-desktop-column-gap) - var(--reels-nav-clearance))
    );
    --reels-metadata-width: clamp(
      0px,
      calc(
        (100cqw - var(--reels-active-stage-width) - var(--reels-desktop-rail-width) - var(--reels-desktop-column-gap)) / 2
        - var(--reels-metadata-gap) - (var(--desktop-sidebar-expanded-width) - var(--desktop-sidebar-width)) - 0.75rem
      ),
      15.5rem
    );
    --reels-details-width: max(
      0px,
      calc(
        (100cqw - var(--reels-desktop-stage-width) - var(--reels-desktop-column-gap)) / 2
        - var(--reels-details-offset) - var(--reels-nav-inset) - var(--reels-nav-button-size)
      )
    );
  }
}

@supports (width: 1cqw) {
  @media (min-width: 768px) and (orientation: portrait) {
    .reels-view {
      container-type: size;
    }

    .reels-view__layout {
      --reel-deck-top-inset: 1rem;
      --reel-deck-panel-gap: 2rem;
      --reels-active-block-limit: calc(100cqh - var(--reel-stage-block-gap));
      --reel-stage-gap: 0px;
      --reel-stage-inline-gap: 0px;
      --reels-action-rail-align: start;
      --reels-action-rail-start: 0.62;
      --reels-portrait-left-inset: 0.75rem;
      /* Square and wide videos need their action rail between the stage and arrow lane. */
      --reels-rail-adjustment: -1.5rem;
      --reels-portrait-arrow-gutter: calc(var(--reels-nav-inset) + var(--reels-nav-button-size) + 0.5rem);
      --reels-desktop-stage-width: min(
        calc((100cqh - var(--reel-stage-block-gap)) * 16 / 9),
        calc(
          100cqw - var(--reels-portrait-left-inset) - var(--reels-portrait-arrow-gutter)
          - var(--reels-desktop-rail-width) - var(--reels-desktop-column-gap)
        )
      );
      container-type: normal;
      /* Preserve the docked sidebar and center the content in the remaining space. */
      justify-content: center;
      padding-inline: var(--reels-portrait-left-inset) var(--reels-portrait-arrow-gutter);
    }

    /* A portrait Reel may reveal the next panel; this only positions its external rail. */
    .reels-view__layout--active-portrait {
      --reels-rail-adjustment: -2.25rem;
      --reels-active-block-limit: calc(88cqh - var(--reel-deck-top-inset) - var(--reel-deck-panel-gap));
    }

  }
}

.reels-view__deck-shell {
  position: relative;
  height: 100%;
  min-height: 0;
  min-width: 0;
}

.reels-view__metadata-gutter {
  position: absolute;
  right: calc((var(--reels-desktop-stage-width) + var(--reels-active-stage-width)) / 2 + var(--reels-metadata-gap));
  bottom: calc((100% - var(--reels-active-stage-height)) / 2 + 1.625rem);
  width: var(--reels-metadata-width);
}

.reels-view__metadata {
  display: flex;
  align-items: flex-end;
  gap: 0.875rem;
  color: var(--text);
  border-radius: 0.5rem;
}

.reels-view__metadata:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 4px;
}

.reels-view__metadata-avatar {
  flex: none;
  width: 2rem;
  height: 2rem;
}

.reels-view__metadata-copy {
  flex: 1;
  min-width: 0;
}

.reels-view__metadata-title,
.reels-view__metadata-caption {
  display: block;
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reels-view__metadata-title {
  font-size: 0.95rem;
  font-weight: 700;
  line-height: 1.25;
}

.reels-view__metadata:hover .reels-view__metadata-title {
  text-decoration: underline;
}

.reels-view__metadata-caption,
.reels-view__source-line {
  color: var(--muted);
  font-size: 0.8rem;
  line-height: 1.35;
}

.reels-view__source-line {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: 0.2rem;
}

.reels-view__source-icon {
  flex: none;
  width: 0.875rem;
  height: 0.875rem;
}

.reels-view__source-viewport {
  display: block;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.reels-view__source-track {
  display: flex;
  gap: 1rem;
  width: max-content;
}

.reels-view__source-viewport--scrolling {
  mask-image: linear-gradient(to right, transparent, #000 0.5rem, #000 calc(100% - 0.5rem), transparent);
}

.reels-view__source-viewport--scrolling .reels-view__source-track {
  animation: reels-source-scroll 16s linear infinite;
}

.reels-view__metadata:hover .reels-view__source-track,
.reels-view__metadata:focus-visible .reels-view__source-track {
  animation-play-state: paused;
}

@keyframes reels-source-scroll {
  from { transform: translateX(0); }
  to { transform: translateX(calc(-50% - 0.5rem)); }
}

@media (prefers-reduced-motion: reduce) {
  .reels-view__source-viewport--scrolling {
    mask-image: none;
  }

  .reels-view__source-viewport--scrolling .reels-view__source-track {
    display: block;
    width: auto;
    animation: none;
  }

  .reels-view__source-label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reels-view__source-track > [aria-hidden] {
    display: none;
  }
}

.reels-view__right-column {
  position: absolute;
  top: 50%;
  left: calc(
    (100% - var(--reels-desktop-stage-width) - var(--reels-desktop-rail-width) - var(--reels-desktop-column-gap)) / 2
    + (var(--reels-desktop-stage-width) + var(--reels-active-stage-width)) / 2
    + var(--reels-desktop-column-gap) + var(--reels-rail-adjustment)
  );
  transform: translateY(-50%);
  pointer-events: none;
  display: grid;
  justify-items: center;
  align-self: var(--reels-action-rail-align, center);
  width: var(--reels-desktop-rail-width);
  height: var(--reels-active-stage-height);
  padding-top: clamp(
    0px,
    calc(var(--reels-active-stage-height) * var(--reels-action-rail-start, 0.43)),
    calc(var(--reels-active-stage-height) - 17.5rem)
  );
  padding-bottom: 1rem;
}

.reels-view__action-rail--desktop {
  pointer-events: auto;
  --collection-bookmark-icon-size: 1.6rem;
  align-self: start;
  gap: 1.25rem;
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__button:not(.reel-action-rail__button--liked)) {
  color: var(--text);
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__icon) {
  width: 1.6rem;
  height: 1.6rem;
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__info-wrap) {
  position: static;
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__info-panel) {
  top: 50%;
  bottom: auto;
  transform: translateY(-50%);
}

.reels-view__action-rail--desktop-info-left :deep(.reel-action-rail__info-panel) {
  right: calc(50% + var(--reels-details-offset));
  left: auto;
}

.reels-view__action-rail--desktop-info-right :deep(.reel-action-rail__info-panel) {
  left: calc(50% + var(--reels-details-offset));
  right: auto;
}

.reels-view__details-gutter {
  position: absolute;
  width: var(--reels-details-width);
  height: 0;
  pointer-events: none;
}

.reels-view__action-rail--desktop-info-right :deep(.reels-info-sidebar) {
  max-width: var(--reels-details-width);
}

.reels-view__action-rail--mobile {
  margin-bottom: 0;
}

.reels-view__info-shell {
  display: block;
}

.reels-view__action-rail--mobile :deep(.reel-action-rail__button),
.reels-view__action-rail--mobile :deep(.collection-bookmark__button) {
  color: rgba(255, 255, 255, 0.96);
  filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.28));
}

.reels-view__action-rail--mobile :deep(.reel-action-rail__button:hover:not(:disabled)),
.reels-view__action-rail--mobile :deep(.collection-bookmark__button:hover:not(:disabled)) {
  color: #fff;
}

.reels-view__action-rail--mobile :deep(.reel-action-rail__info-panel) {
  right: calc(100% + 0.75rem);
  bottom: 0;
  left: auto;
}

.reels-view__nav-controls {
  position: absolute;
  top: 50%;
  right: var(--reels-nav-inset);
  display: grid;
  gap: 1rem;
  transform: translateY(-50%);
}

.reels-view__nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--reels-nav-button-size);
  height: var(--reels-nav-button-size);
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 9%, var(--bg));
  color: var(--text);
  cursor: pointer;
  box-shadow: 0 8px 20px rgba(15, 20, 25, 0.14);
  transition:
    transform 0.16s ease,
    opacity 0.16s ease,
    background-color 0.16s ease;
}

.reels-view__nav-button:hover:not(:disabled) {
  transform: translateY(-1px);
  background: color-mix(in srgb, var(--text) 17%, var(--bg));
}

.reels-view__nav-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.reels-view__nav-icon {
  width: 1.5rem;
  height: 1.5rem;
}

.reels-view__message-card {
  display: grid;
  gap: 0.75rem;
  width: min(100%, 30rem);
  margin: 0 auto;
  padding: 2rem 1.5rem;
  border: 1px solid var(--border);
  border-radius: 1.4rem;
  background: var(--surface);
  box-shadow: var(--shadow);
}

.reels-view__eyebrow {
  margin: 0;
  font-size: 0.73rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.reels-view__title {
  margin: 0;
  font-size: 1.55rem;
  font-weight: 700;
  letter-spacing: -0.04em;
  color: var(--text);
}

.reels-view__message {
  margin: 0;
  font-size: 0.96rem;
  line-height: 1.6;
  color: var(--muted);
}

@media (max-width: 767.98px) {
  .reels-view__layout {
    display: block;
    padding: 0;
  }

  .reels-view__deck-shell {
    height: 100%;
    min-height: 100%;
  }

  .reels-view__message-card {
    width: calc(100% - 1.5rem);
    margin: 1rem auto;
    padding: 1.55rem 1.15rem;
  }
}

.reels-info-popup-enter-active,
.reels-info-popup-leave-active {
  transition: opacity 0.18s ease;
}

.reels-info-popup-enter-from,
.reels-info-popup-leave-to {
  opacity: 0;
}
</style>
