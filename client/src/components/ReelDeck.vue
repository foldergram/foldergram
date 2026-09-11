<template>
  <section
    ref="scrollerElement"
    class="reel-deck"
    aria-label="Reels feed"
    @scroll="handleScroll"
  >
    <div
      v-if="windowStartIndex > 0"
      class="reel-deck__spacer reel-deck__spacer--before"
      :style="{ height: `${windowStartIndex * 100}%` }"
      aria-hidden="true"
    />

    <div
      v-for="entry in renderedEntries"
      :key="entry.item.id"
      :ref="setPanelRef(entry.item.id)"
      class="reel-deck__panel"
    >
      <ReelPlayerCard
        :item="entry.item"
        :folder="folderLookup.get(entry.item.folderSlug) ?? null"
        :active="entry.item.id === activeReelId"
        :prefetch="prefetchIndexes.has(entry.index)"
      >
        <template v-if="entry.item.id === activeReelId" #mobile-action-rail>
          <slot
            name="mobile-action-rail"
            :item="entry.item"
            :folder="folderLookup.get(entry.item.folderSlug) ?? null"
          />
        </template>
      </ReelPlayerCard>
    </div>

    <div
      v-if="windowEndIndex < items.length - 1"
      class="reel-deck__spacer reel-deck__spacer--after"
      :style="{ height: `${(items.length - windowEndIndex - 1) * 100}%` }"
      aria-hidden="true"
    />

    <div v-if="loading && items.length > 0" class="reel-deck__status" role="status" aria-live="polite">
      Loading more reels...
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue';

import type { FeedItem, FolderSummary } from '../types/api';
import { getReelPrefetchIndexes, shouldPrefetchReels } from '../utils/reels';
import ReelPlayerCard from './ReelPlayerCard.vue';

const props = defineProps<{
  items: FeedItem[];
  folders: FolderSummary[];
  activeReelId: number | null;
  loading?: boolean;
}>();

const emit = defineEmits<{
  activeChange: [id: number];
  prefetch: [activeIndex: number];
}>();

const scrollerElement = ref<HTMLElement | null>(null);
const panelElements = new Map<number, HTMLElement>();
const folderLookup = computed(() => new Map(props.folders.map((folder) => [folder.slug, folder])));
const activeIndex = computed(() => props.items.findIndex((item) => item.id === props.activeReelId));
// Five mounted cards keep the previous and next two swipes ready while capping the
// number of media providers, event listeners and decoders no matter how long the feed grows.
const REEL_WINDOW_RADIUS = 2;
const windowStartIndex = computed(() => Math.max(0, activeIndex.value < 0 ? 0 : activeIndex.value - REEL_WINDOW_RADIUS));
const windowEndIndex = computed(() =>
  Math.min(props.items.length - 1, activeIndex.value < 0 ? REEL_WINDOW_RADIUS * 2 : activeIndex.value + REEL_WINDOW_RADIUS)
);
const renderedEntries = computed(() =>
  props.items
    .slice(windowStartIndex.value, windowEndIndex.value + 1)
    .map((item, offset) => ({ item, index: windowStartIndex.value + offset }))
);
// Warming one neighbour prevents the next-swipe cold start without making four
// videos compete for bandwidth, cache and hardware decoder slots.
const prefetchIndexes = computed(() =>
  getReelPrefetchIndexes(activeIndex.value, props.items.length, 1)
);

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
  if (!scroller || props.items.length === 0 || scroller.clientHeight <= 0) {
    return;
  }

  // Every logical row is exactly one deck viewport tall, including the virtual
  // spacers. Rounding the scroll position avoids walking every panel and forcing
  // layout on every animation frame as the list grows.
  const nextIndex = Math.min(
    props.items.length - 1,
    Math.max(0, Math.round(scroller.scrollTop / scroller.clientHeight))
  );
  const nextItem = props.items[nextIndex];
  if (!nextItem) {
    return;
  }

  if (nextItem.id !== props.activeReelId) {
    emit('activeChange', nextItem.id);
  }

  if (shouldPrefetchReels(nextIndex, props.items.length)) {
    emit('prefetch', nextIndex);
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
  const scroller = scrollerElement.value;
  if (!props.items[index] || !scroller || scroller.clientHeight <= 0) {
    return;
  }

  scroller.scrollTo({
    top: index * scroller.clientHeight,
    behavior
  });
}

function restoreActiveReel() {
  const activeIndex = props.items.findIndex((item) => item.id === props.activeReelId);
  if (activeIndex < 0) {
    return;
  }

  // A kept-alive snap scroller can be laid out at scrollTop 0 while hidden. Restore
  // from the stable reel id after the route becomes visible, not from that transient 0.
  scrollToIndex(activeIndex, 'auto');
  scheduleActiveUpdate();
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

  window.addEventListener('keydown', handleKeydown);
  scheduleActiveUpdate();
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
  restoreActiveReel,
  getScrollElement: () => scrollerElement.value
});
</script>

<style scoped>
.reel-deck {
  height: 100%;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  scroll-snap-type: y mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
}

.reel-deck::-webkit-scrollbar {
  display: none;
}

.reel-deck__panel,
.reel-deck__spacer {
  min-height: 100%;
  height: 100%;
}

.reel-deck__panel {
  display: grid;
  place-items: center;
  scroll-snap-align: start;
  scroll-snap-stop: always;
}

.reel-deck__spacer {
  pointer-events: none;
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
