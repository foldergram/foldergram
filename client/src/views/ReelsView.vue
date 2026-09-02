<template>
  <section class="reels-view">
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

    <div v-else-if="showLoadingState" class="reels-view__loading-canvas" aria-hidden="true" />

    <section v-else-if="reelsStore.initialized && reelsStore.items.length === 0" class="reels-view__message-card">
      <p class="reels-view__eyebrow">{{ t('nav.reels') }}</p>
      <h1 class="reels-view__title">{{ t('reels.view.emptyTitle') }}</h1>
      <p class="reels-view__message">{{ t('reels.view.emptyDescription') }}</p>
    </section>

    <div v-else class="reels-view__layout">
      <div class="reels-view__deck-shell">
        <ReelDeck
          ref="deckElement"
          :items="reelsStore.items"
          :folders="foldersStore.items"
          :active-reel-id="reelsStore.activeReelId"
          :loading="reelsStore.loading"
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
                <!-- Teleported out of the rail: the reel card is transformed when rotated,
                     which would make a fixed sheet inside it position against the card
                     instead of the viewport. -->
                <Teleport to="body">
                  <Transition name="reels-info-sheet">
                    <div
                      v-if="isInfoSidebarOpen"
                      data-test="info-shell"
                      class="reels-view__info-sheet-shell"
                    >
                      <div class="reels-view__info-sheet-backdrop" @click="closeInfoSidebar" />
                      <ReelInfoSidebar
                        :item="item"
                        :folder="activeFolder"
                        anchor="right"
                        variant="sheet"
                        :open="isInfoSidebarOpen"
                        @close="closeInfoSidebar"
                      />
                    </div>
                  </Transition>
                </Teleport>
              </template>
            </ReelActionRail>
          </template>
        </ReelDeck>
      </div>

      <div v-if="!isMobileViewport" class="reels-view__right-column">
        <div class="reels-view__nav-controls" :aria-label="t('reels.view.navigationAria')">
          <button
            class="reels-view__nav-button"
            type="button"
            :aria-label="t('reels.view.previous')"
            :disabled="!canGoPrevious"
            @click="goToPrevious"
          >
            <svg class="reels-view__nav-icon" viewBox="0 0 24 24" role="presentation">
              <path
                d="m6.75 14.75 5.25-5.25 5.25 5.25"
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
                d="m6.75 9.25 5.25 5.25 5.25-5.25"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.9"
              />
            </svg>
          </button>
        </div>

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
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import ReelActionRail from '../components/ReelActionRail.vue';
import ReelDeck from '../components/ReelDeck.vue';
import ReelInfoSidebar from '../components/ReelInfoSidebar.vue';
import { useAppStore } from '../stores/app';
import { useFoldersStore } from '../stores/folders';
import { useReelsStore } from '../stores/reels';

import { provideViewActivation } from '../composables/useViewActivation';
import { useRouteScrollMemory } from '../composables/useRouteScrollMemory';

// Named explicitly so <KeepAlive include> keeps matching after a minified build.
defineOptions({ name: 'ReelsView' });

// This view is cached, so its players stay in memory when another tab is showing.
// Descendants read this flag to pause instead of decoding audio in the background.
provideViewActivation();

const appStore = useAppStore();
const foldersStore = useFoldersStore();
const reelsStore = useReelsStore();
const deckElement = ref<InstanceType<typeof ReelDeck> | null>(null);
useRouteScrollMemory({
  key: 'reels',
  getScroller: () => deckElement.value?.getScrollElement() ?? null
});
const { t } = useI18n();
const isInfoSidebarOpen = ref(false);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 0);
const viewportHeight = ref(typeof window !== 'undefined' ? window.innerHeight : 0);
const isMobileViewport = computed(() => viewportWidth.value <= 768);
let activeReelRestoreFrame = 0;
const desktopInfoPanelSide = computed<'left' | 'right'>(() =>
  !isMobileViewport.value && viewportWidth.value > viewportHeight.value ? 'right' : 'left'
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
const activeFolder = computed(() =>
  activeItem.value ? foldersStore.items.find((folder) => folder.slug === activeItem.value?.folderSlug) ?? null : null
);
const activeIndex = computed(() => reelsStore.items.findIndex((item) => item.id === reelsStore.activeReelId));
const canGoPrevious = computed(() => activeIndex.value > 0);
const canGoNext = computed(() => activeIndex.value >= 0 && activeIndex.value < reelsStore.items.length - 1);
const showLoadingState = computed(() => reelsStore.loading && !reelsStore.initialized);

function handleActiveChange(id: number) {
  reelsStore.setActiveReel(id);
}

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

function restoreActiveReelPosition() {
  if (activeReelRestoreFrame !== 0) {
    window.cancelAnimationFrame(activeReelRestoreFrame);
  }

  void nextTick(() => {
    activeReelRestoreFrame = window.requestAnimationFrame(() => {
      activeReelRestoreFrame = 0;
      deckElement.value?.restoreActiveReel();
    });
  });
}

function shouldCaptureGlobalWheel(event: WheelEvent) {
  if (event.defaultPrevented || Math.abs(event.deltaY) < 0.5) {
    return false;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return true;
  }

  if (target.closest('.sidebar')) {
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

function addGlobalListeners() {
  window.addEventListener('resize', updateViewportMode);
  window.addEventListener('wheel', handleGlobalWheel, { passive: false });
}

function removeGlobalListeners() {
  window.removeEventListener('resize', updateViewportMode);
  window.removeEventListener('wheel', handleGlobalWheel);
}

onMounted(async () => {
  updateViewportMode();
  addGlobalListeners();
  await reelsStore.loadInitial();
});

// This route is cached, so it stays mounted behind other dock tabs. The wheel handler
// hijacks scrolling to advance reels, so it must only be bound while reels is on
// screen; otherwise scrolling the home feed would page through reels invisibly.
onActivated(() => {
  updateViewportMode();
  addGlobalListeners();
  restoreActiveReelPosition();
});

onDeactivated(() => {
  removeGlobalListeners();
});

onBeforeUnmount(() => {
  removeGlobalListeners();
  if (activeReelRestoreFrame !== 0) {
    window.cancelAnimationFrame(activeReelRestoreFrame);
  }
});

watch(activeItem, (item) => {
  if (!item) {
    isInfoSidebarOpen.value = false;
  }
});
</script>

<style scoped>
.reels-view {
  height: 100%;
  min-height: 100%;
  background: var(--bg);
  color: var(--text);
}

.reels-view__loading-canvas {
  width: 100%;
  height: 100%;
  min-height: 100%;
}

.reels-view__layout {
  --reels-desktop-rail-width: 3.8rem;
  --reels-desktop-column-gap: 0.85rem;
  --reel-stage-block-gap: 0.75rem;
  --reel-stage-inline-gap: 1.25rem;
  --reels-desktop-stage-width: 24.4rem;
  --reels-desktop-stage-height: calc(var(--reels-desktop-stage-width) * 16 / 9);
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
    --reels-desktop-stage-width: min(
      calc((100cqh - var(--reel-stage-block-gap)) * 9 / 16),
      calc(100cqw - var(--reels-desktop-rail-width) - var(--reels-desktop-column-gap) - var(--reel-stage-inline-gap))
    );
    --reels-desktop-stage-height: calc(var(--reels-desktop-stage-width) * 16 / 9);
  }
}

.reels-view__deck-shell {
  height: 100%;
  min-height: 0;
  min-width: 0;
}

/* ── Right column: nav arrows centered + action rail bottom-aligned ── */

.reels-view__right-column {
  width: var(--reels-desktop-rail-width);
  height: var(--reels-desktop-stage-height);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
  align-self: center;
}

.reels-view__action-rail--desktop {
  position: absolute;
  bottom: 1rem;
  left: 50%;
  transform: translateX(-50%);
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__button) {
  color: color-mix(in srgb, var(--text) 82%, transparent);
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__button:hover:not(:disabled)) {
  color: var(--text);
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__icon) {
  width: 1.6rem;
  height: 1.6rem;
}

.reels-view__action-rail--desktop :deep(.reel-action-rail__info-panel) {
  bottom: 0;
}

.reels-view__action-rail--desktop-info-left :deep(.reel-action-rail__info-panel) {
  right: calc(100% + 0.9rem);
  left: auto;
}

.reels-view__action-rail--desktop-info-right :deep(.reel-action-rail__info-panel) {
  left: calc(100% + 0.9rem);
  right: auto;
}

.reels-view__action-rail--mobile {
  margin-bottom: 0;
}

.reels-view__info-shell {
  display: block;
}

.reels-view__action-rail--mobile :deep(.reel-action-rail__button) {
  color: rgba(255, 255, 255, 0.96);
  filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.28));
}

.reels-view__action-rail--mobile :deep(.reel-action-rail__button:hover:not(:disabled)) {
  color: #fff;
}

.reels-view__action-rail--mobile :deep(.reel-action-rail__info-panel) {
  right: calc(100% + 0.75rem);
  bottom: 0;
  left: auto;
}

/* ── Nav controls: centered in the right column ── */

.reels-view__nav-controls {
  display: grid;
  gap: 0.75rem;
}

.reels-view__nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.8rem;
  height: 2.8rem;
  padding: 0;
  border: 0;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 78%, var(--text) 22%);
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
  background: color-mix(in srgb, var(--surface) 64%, var(--text) 36%);
}

.reels-view__nav-button:disabled {
  cursor: not-allowed;
  opacity: 0.42;
}

.reels-view__nav-icon {
  width: 1.15rem;
  height: 1.15rem;
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

@media (max-width: 768px) {
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

.reels-view__info-sheet-backdrop {
  position: fixed;
  inset: 0;
  z-index: 0;
  background: rgba(0, 0, 0, 0.42);
}

.reels-view__info-sheet-shell {
  position: fixed;
  inset: 0;
  z-index: 79;
  display: grid;
  place-items: center;
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right)) max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  isolation: isolate;
}

.reels-info-sheet-enter-active,
.reels-info-sheet-leave-active {
  transition: opacity 0.2s ease;
}

.reels-info-sheet-enter-active :deep(.reels-info-sidebar--sheet),
.reels-info-sheet-leave-active :deep(.reels-info-sidebar--sheet) {
  transition: transform 0.24s cubic-bezier(0.32, 0.72, 0, 1);
}

.reels-info-sheet-enter-from,
.reels-info-sheet-leave-to {
  opacity: 0;
}

.reels-info-sheet-enter-from :deep(.reels-info-sidebar--sheet),
.reels-info-sheet-leave-to :deep(.reels-info-sidebar--sheet) {
  transform: translateY(100%);
}
</style>
