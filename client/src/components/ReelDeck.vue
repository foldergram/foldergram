<template>
  <section
    ref="scrollerElement"
    class="reel-deck"
    :class="{ 'reel-deck--tail-portrait': lastItem && lastItem.height > lastItem.width }"
    :style="{ '--reel-last-ratio': lastRatio }"
    :aria-label="t('reels.view.feedAria')"
    @scroll="handleScroll"
  >
    <div
      v-for="(item, index) in items"
      :key="item.id"
      :ref="setPanelRef(item.id)"
      class="reel-deck__panel"
      :class="{ 'reel-deck__panel--portrait': item.height > item.width }"
      :style="{ '--reel-item-ratio': item.width > 0 && item.height > 0 ? item.width / item.height : 9 / 16 }"
    >
      <ReelPlayerCard
        :item="item"
        :folder="folderLookup.get(item.folderSlug) ?? null"
        :active="item.id === activeReelId"
        :video-preparation="videoPreparation"
        :next-video-playback-url="item.id === activeReelId ? items[index + 1]?.videoPlaybackUrl ?? undefined : undefined"
        :external-metadata="externalMetadata"
      >
        <template v-if="item.id === activeReelId" #mobile-action-rail>
          <slot
            name="mobile-action-rail"
            :item="item"
            :folder="folderLookup.get(item.folderSlug) ?? null"
          />
        </template>
      </ReelPlayerCard>
    </div>

    <div v-if="loading && items.length > 0" class="reel-deck__status" role="status" aria-live="polite">
      {{ t('reels.view.loadingMore') }}
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';
import { useI18n } from 'vue-i18n';

import type { FeedItem, FolderSummary } from '../types/api';
import { ReelVideoPreparation } from '../utils/local-video-provider';
import { getActiveReelId, shouldPrefetchReels } from '../utils/reels';
import ReelPlayerCard from './ReelPlayerCard.vue';

const { t } = useI18n();

const props = defineProps<{
  items: FeedItem[];
  folders: FolderSummary[];
  activeReelId: number | null;
  loading?: boolean;
  externalMetadata?: boolean;
}>();

const emit = defineEmits<{
  activeChange: [id: number];
  prefetch: [activeIndex: number];
}>();

const scrollerElement = ref<HTMLElement | null>(null);
const panelElements = new Map<number, HTMLElement>();
const videoPreparation = new ReelVideoPreparation();
const folderLookup = computed(() => new Map(props.folders.map((folder) => [folder.slug, folder])));
const lastItem = computed(() => props.items.at(-1) ?? null);
const lastRatio = computed(() => lastItem.value && lastItem.value.width > 0 && lastItem.value.height > 0
  ? lastItem.value.width / lastItem.value.height
  : 9 / 16);

let resizeObserver: ResizeObserver | null = null;
let scrollFrame = 0;
let navigationLock = false;
let navigationFallbackTimer = 0;
let navigationSettleTimer = 0;
let wheelDeltaAccumulator = 0;

const WHEEL_NAVIGATION_THRESHOLD = 28;
const NAVIGATION_SETTLE_DELAY_MS = 120;
const NAVIGATION_FALLBACK_DELAY_MS = 420;

function setPanelRef(id: number) {
  return (element: Element | ComponentPublicInstance | null) => {
    if (element instanceof HTMLElement) {
      panelElements.set(id, element);
      return;
    }

    panelElements.delete(id);
  };
}

function updateActiveReel() {
  scrollFrame = 0;

  const scroller = scrollerElement.value;
  if (!scroller || props.items.length === 0) {
    return;
  }

  const { scrollPaddingTop, scrollPaddingBottom } = getComputedStyle(scroller);
  const topInset = parseFloat(scrollPaddingTop) || 0;
  const bottomInset = parseFloat(scrollPaddingBottom) || 0;
  const activeReelId = getActiveReelId(
    props.items
      .map((item) => {
        const panel = panelElements.get(item.id);
        if (!panel) {
          return null;
        }

        return {
          id: item.id,
          offsetTop: panel.offsetTop,
          offsetHeight: panel.offsetHeight
        };
      })
      .filter((panel): panel is { id: number; offsetTop: number; offsetHeight: number } => panel !== null),
    scroller.scrollTop + topInset,
    scroller.clientHeight - topInset - bottomInset
  );
  if (activeReelId === null) {
    return;
  }

  if (activeReelId !== props.activeReelId) {
    emit('activeChange', activeReelId);
  }

  const activeIndex = props.items.findIndex((item) => item.id === activeReelId);
  if (shouldPrefetchReels(activeIndex, props.items.length)) {
    emit('prefetch', activeIndex);
  }
}

function scheduleActiveUpdate() {
  if (scrollFrame !== 0) {
    return;
  }

  scrollFrame = window.requestAnimationFrame(updateActiveReel);
}

function clearNavigationTimers() {
  if (navigationFallbackTimer !== 0) {
    window.clearTimeout(navigationFallbackTimer);
    navigationFallbackTimer = 0;
  }

  if (navigationSettleTimer !== 0) {
    window.clearTimeout(navigationSettleTimer);
    navigationSettleTimer = 0;
  }
}

function unlockNavigation() {
  clearNavigationTimers();
  navigationLock = false;
  wheelDeltaAccumulator = 0;
}

function scheduleNavigationFallbackUnlock() {
  if (navigationFallbackTimer !== 0) {
    window.clearTimeout(navigationFallbackTimer);
  }

  navigationFallbackTimer = window.setTimeout(() => {
    unlockNavigation();
  }, NAVIGATION_FALLBACK_DELAY_MS);
}

function scheduleNavigationSettleUnlock() {
  if (navigationSettleTimer !== 0) {
    window.clearTimeout(navigationSettleTimer);
  }

  navigationSettleTimer = window.setTimeout(() => {
    unlockNavigation();
  }, NAVIGATION_SETTLE_DELAY_MS);
}

function handleScroll() {
  if (navigationLock) {
    scheduleNavigationSettleUnlock();
  }

  scheduleActiveUpdate();
}

function scrollToIndex(index: number, behavior: ScrollBehavior = 'smooth') {
  const nextItem = props.items[index];
  const scroller = scrollerElement.value;
  if (!nextItem || !scroller) {
    return;
  }

  const panel = panelElements.get(nextItem.id);
  if (!panel) {
    return;
  }

  const topInset = parseFloat(getComputedStyle(scroller).scrollPaddingTop) || 0;
  scroller.scrollTo({
    top: panel.offsetTop - topInset,
    behavior
  });
}

function navigateByOffset(offset: number) {
  if (navigationLock) {
    return;
  }

  const activeIndex = props.items.findIndex((item) => item.id === props.activeReelId);
  if (activeIndex < 0) {
    return;
  }

  const nextIndex = Math.min(props.items.length - 1, Math.max(0, activeIndex + offset));
  if (nextIndex === activeIndex) {
    wheelDeltaAccumulator = 0;
    return;
  }

  navigationLock = true;
  wheelDeltaAccumulator = 0;
  scheduleNavigationFallbackUnlock();
  scrollToIndex(nextIndex);
}

function scrollToReel(id: number) {
  const index = props.items.findIndex((item) => item.id === id);
  if (index >= 0) {
    scrollToIndex(index, 'instant');
    scheduleActiveUpdate();
  }
}

function goToPrevious() {
  navigateByOffset(-1);
}

function goToNext() {
  navigateByOffset(1);
}

function navigateByWheel(deltaY: number) {
  if (!Number.isFinite(deltaY) || deltaY === 0 || navigationLock) {
    return;
  }

  wheelDeltaAccumulator += deltaY;
  if (Math.abs(wheelDeltaAccumulator) < WHEEL_NAVIGATION_THRESHOLD) {
    return;
  }

  navigateByOffset(wheelDeltaAccumulator > 0 ? 1 : -1);
}

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, a, [contenteditable="true"]'));
}

function handleKeydown(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || isEditableTarget(event.target)) {
    return;
  }

  const activeIndex = props.items.findIndex((item) => item.id === props.activeReelId);
  if (activeIndex < 0) {
    return;
  }

  if (event.key === 'ArrowDown' || event.key === 'PageDown') {
    event.preventDefault();
    navigateByOffset(1);
    return;
  }

  if (event.key === 'ArrowUp' || event.key === 'PageUp') {
    event.preventDefault();
    navigateByOffset(-1);
  }
}

watch(
  () => props.items.map((item) => item.id),
  async () => {
    await nextTick();
    scheduleActiveUpdate();

    if (resizeObserver) {
      resizeObserver.disconnect();
      const scroller = scrollerElement.value;
      if (scroller) {
        resizeObserver.observe(scroller);
      }

      for (const panel of panelElements.values()) {
        resizeObserver.observe(panel);
      }
    }
  },
  {
    immediate: true
  }
);

watch(
  () => props.activeReelId,
  () => {
    scheduleActiveUpdate();
  }
);

onMounted(async () => {
  await nextTick();
  resizeObserver = new ResizeObserver(() => {
    scheduleActiveUpdate();
  });

  const scroller = scrollerElement.value;
  if (scroller) {
    resizeObserver.observe(scroller);
  }

  for (const panel of panelElements.values()) {
    resizeObserver.observe(panel);
  }

  window.addEventListener('keydown', handleKeydown);
  if (props.activeReelId !== null) {
    scrollToReel(props.activeReelId);
  } else {
    scheduleActiveUpdate();
  }
});

onBeforeUnmount(() => {
  if (scrollFrame !== 0) {
    window.cancelAnimationFrame(scrollFrame);
    scrollFrame = 0;
  }

  unlockNavigation();
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('keydown', handleKeydown);
});

defineExpose({
  goToPrevious,
  goToNext,
  navigateByWheel,
  scrollToReel
});
</script>

<style scoped>
.reel-deck {
  position: relative;
  height: 100%;
  padding-block: var(--reel-deck-top-inset, 0px) var(--reel-deck-bottom-inset, 0px);
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scroll-snap-type: y mandatory;
  scroll-padding-block: var(--reel-deck-top-inset, 0px) var(--reel-deck-bottom-inset, 0px);
  scroll-behavior: smooth;
  scrollbar-width: none;
}

.reel-deck::-webkit-scrollbar {
  display: none;
}

.reel-deck__panel {
  display: grid;
  place-items: center;
  /* Square and landscape panels always occupy a full scrolling viewport.
     Only portrait panels on portrait desktop viewports may be shorter. */
  height: 100cqh;
  min-height: 100cqh;
  scroll-snap-align: start;
  scroll-snap-stop: always;
}

.reel-deck__panel + .reel-deck__panel {
  margin-block-start: var(--reel-deck-panel-gap, 0px);
}

/* The snap geometry belongs to each item and never changes when another Reel becomes active. */
@media (min-width: 768px) and (orientation: portrait) {
  .reel-deck__panel--portrait {
    --reel-portrait-panel-height: min(
      calc(88cqh - var(--reel-deck-top-inset, 1rem) - var(--reel-deck-panel-gap, 2rem)),
      calc(var(--reels-desktop-stage-width) / var(--reel-item-ratio))
    );
    height: var(--reel-portrait-panel-height);
    min-height: var(--reel-portrait-panel-height);
  }

  /* Give the last portrait Reel enough room to snap into view, without affecting earlier panels. */
  .reel-deck--tail-portrait {
    --reel-deck-bottom-inset: max(
      0px,
      calc(100cqh - var(--reel-deck-top-inset, 1rem) - min(
        calc(88cqh - var(--reel-deck-top-inset, 1rem) - var(--reel-deck-panel-gap, 2rem)),
        calc(var(--reels-desktop-stage-width) / var(--reel-last-ratio))
      ))
    );
  }
}

.reel-deck__status {
  padding: 0.75rem 0 1.5rem;
  text-align: center;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: rgba(255, 255, 255, 0.68);
}
</style>
