import { onActivated, onBeforeUnmount, onMounted, onUpdated, ref, watch, type Ref } from 'vue';

/**
 * Keeps the feed column rendering only the rows near the viewport.
 *
 * Nothing about a card's markup or styling changes: rows that scrolled far away are
 * unmounted and the space they used to occupy is held by padding on the column, so the
 * scrollbar, the scroll offset, pull-to-refresh and the infinite loader all behave exactly
 * like a fully rendered list. Without this the homepage kept every card alive, which is
 * what pushed the DOM past 20k nodes, halved main-thread throughput and left scrolled-away
 * `<video>` elements holding a source whose buffer the platform had already dropped.
 */

/** The feed column's row gap, used before the computed style can be read. */
const FALLBACK_GAP_PX = 19.2;
/** Header + action row + caption + date that wrap a card's media block. */
const FALLBACK_OVERHEAD_PX = 156;
const MIN_LEARNED_OVERHEAD_PX = 90;
const MAX_LEARNED_OVERHEAD_PX = 420;
/** Media boxes are aspect-ratio driven; clamp absurd metadata instead of trusting it. */
const MIN_MEDIA_HEIGHT_PX = 40;
const MAX_MEDIA_HEIGHT_PX = 4000;
const HEIGHT_EPSILON_PX = 0.5;
const OVERHEAD_SMOOTHING = 0.15;
/** Enough rows to know this feed's chrome height; past that the estimate stops drifting. */
const OVERHEAD_SAMPLE_TARGET = 12;
/** Sub-pixel padding churn would re-trigger the resize observer forever. */
const PADDING_EPSILON_PX = 0.5;

/** Marks a rendered row so its real height can be measured and cached by id. */
export const FEED_WINDOW_ID_ATTR = 'data-feed-window-id';

export interface FeedWindowItem {
  id: number;
  width: number;
  height: number;
}

export interface FeedWindowGeometry {
  /** Row heights in list order, each covering one card's media plus its chrome. */
  heights: readonly number[];
  gapPx: number;
  /** Distance from the top of the column to the top of the viewport. */
  viewportTop: number;
  viewportHeight: number;
  overscanScreens: number;
  minRendered: number;
  /**
   * Row that must stay mounted no matter where it sits, used for the card whose player the
   * immersive layer has claimed. Unmounting it would destroy the shared decoder.
   */
  pinnedIndex?: number | null;
}

export interface FeedWindowRange {
  startIndex: number;
  /** Inclusive. `-1` means there is nothing to render. */
  endIndex: number;
  padTopPx: number;
  padBottomPx: number;
}

export function resolveFeedWindowRange(geometry: FeedWindowGeometry): FeedWindowRange {
  const count = geometry.heights.length;
  if (count === 0) {
    return { startIndex: 0, endIndex: -1, padTopPx: 0, padBottomPx: 0 };
  }

  const gap = Math.max(0, geometry.gapPx);
  // offsets[i] is the top of row i measured from the top of the column, gaps included.
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let index = 0; index < count; index += 1) {
    offsets[index + 1] = offsets[index] + Math.max(0, geometry.heights[index] ?? 0) + gap;
  }
  const totalHeight = Math.max(0, offsets[count] - gap);

  const overscan = Math.max(0, geometry.viewportHeight * Math.max(0, geometry.overscanScreens));
  const keepFrom = geometry.viewportTop - overscan;
  const keepTo = geometry.viewportTop + geometry.viewportHeight + overscan;

  let startIndex = 0;
  while (startIndex < count - 1 && offsets[startIndex + 1] - gap <= keepFrom) {
    startIndex += 1;
  }

  let endIndex = startIndex;
  while (endIndex < count - 1 && offsets[endIndex + 1] < keepTo) {
    endIndex += 1;
  }

  const minRendered = Math.max(1, Math.min(geometry.minRendered, count));
  while (endIndex - startIndex + 1 < minRendered && endIndex < count - 1) {
    endIndex += 1;
  }
  while (endIndex - startIndex + 1 < minRendered && startIndex > 0) {
    startIndex -= 1;
  }

  const pinnedIndex = geometry.pinnedIndex ?? null;
  if (pinnedIndex !== null && pinnedIndex >= 0 && pinnedIndex < count) {
    startIndex = Math.min(startIndex, pinnedIndex);
    endIndex = Math.max(endIndex, pinnedIndex);
  }

  return {
    startIndex,
    endIndex,
    padTopPx: offsets[startIndex],
    padBottomPx: Math.max(0, totalHeight - (offsets[endIndex + 1] - gap))
  };
}

interface UseFeedWindowOptions {
  items: () => readonly FeedWindowItem[];
  container: Ref<HTMLElement | null>;
  /** Viewport heights kept mounted above and below the visible slice. */
  overscanScreens?: number;
  /** Floor on rendered rows, so a bad estimate can never blank the feed. */
  minRendered?: number;
  pinnedIndex?: () => number | null;
}

function requestFrame(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }

  return setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(handle: number) {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }

  clearTimeout(handle);
}

export function useFeedWindow(options: UseFeedWindowOptions) {
  const overscanScreens = options.overscanScreens ?? 2;
  const minRendered = options.minRendered ?? 5;

  const startIndex = ref(0);
  /** `-1` tells the caller to render everything, which is what happens before layout exists. */
  const endIndex = ref(-1);

  const measuredHeights = new Map<number, number>();
  let overheadPx = FALLBACK_OVERHEAD_PX;
  let overheadSamples = 0;
  let gapPx = FALLBACK_GAP_PX;
  let frame = 0;
  let measureOnNextFrame = false;
  let appliedPadTop = 0;
  let appliedPadBottom = 0;
  /** Column width the current range was resolved against; `0` means nothing is resolved yet. */
  let resolvedContentWidth = 0;
  let resizeObserver: ResizeObserver | null = null;

  function mediaHeightOf(item: FeedWindowItem, contentWidth: number): number {
    const ratio = item.width > 0 && item.height > 0 ? item.width / item.height : 1;
    const height = contentWidth / ratio;
    if (!Number.isFinite(height)) {
      return contentWidth;
    }

    return Math.min(MAX_MEDIA_HEIGHT_PX, Math.max(MIN_MEDIA_HEIGHT_PX, height));
  }

  function readGap(element: HTMLElement) {
    if (typeof getComputedStyle !== 'function') {
      return;
    }

    const parsed = Number.parseFloat(getComputedStyle(element).rowGap);
    if (Number.isFinite(parsed) && parsed >= 0) {
      gapPx = parsed;
    }
  }

  function applyPadding(element: HTMLElement, padTopPx: number, padBottomPx: number) {
    // Writing padding resizes the column, which wakes the resize observer again. Only
    // commit changes that matter so the two can never chase each other frame after frame.
    if (Math.abs(padTopPx - appliedPadTop) > PADDING_EPSILON_PX || (padTopPx === 0) !== (appliedPadTop === 0)) {
      element.style.paddingTop = padTopPx > 0 ? `${padTopPx}px` : '';
      appliedPadTop = padTopPx;
    }

    if (Math.abs(padBottomPx - appliedPadBottom) > PADDING_EPSILON_PX || (padBottomPx === 0) !== (appliedPadBottom === 0)) {
      element.style.paddingBottom = padBottomPx > 0 ? `${padBottomPx}px` : '';
      appliedPadBottom = padBottomPx;
    }
  }

  /** Caches the real height of every mounted row and learns the non-media overhead from it. */
  function measureRendered() {
    const element = options.container.value;
    if (!element) {
      return;
    }

    const contentWidth = element.clientWidth;
    if (contentWidth <= 0) {
      return;
    }

    const nodes = element.querySelectorAll<HTMLElement>(`[${FEED_WINDOW_ID_ATTR}]`);
    if (nodes.length === 0) {
      return;
    }

    const learnOverhead = overheadSamples < OVERHEAD_SAMPLE_TARGET;
    const itemsById = learnOverhead ? new Map(options.items().map((item) => [item.id, item])) : null;

    for (const node of nodes) {
      const id = Number(node.getAttribute(FEED_WINDOW_ID_ATTR));
      if (!Number.isFinite(id)) {
        continue;
      }

      const height = node.getBoundingClientRect().height;
      if (height <= 0) {
        continue;
      }

      const previous = measuredHeights.get(id);
      if (previous === undefined || Math.abs(previous - height) > HEIGHT_EPSILON_PX) {
        measuredHeights.set(id, height);
      }

      const item = itemsById?.get(id);
      if (!item) {
        continue;
      }

      const observed = height - mediaHeightOf(item, contentWidth);
      if (observed >= MIN_LEARNED_OVERHEAD_PX && observed <= MAX_LEARNED_OVERHEAD_PX) {
        overheadPx = overheadPx * (1 - OVERHEAD_SMOOTHING) + observed * OVERHEAD_SMOOTHING;
        overheadSamples += 1;
      }
    }
  }

  function update() {
    const element = options.container.value;
    if (!element) {
      return;
    }

    const items = options.items();
    const contentWidth = element.clientWidth;
    const viewportHeight = typeof window === 'undefined' ? 0 : window.innerHeight;

    if (items.length === 0) {
      applyPadding(element, 0, 0);
      startIndex.value = 0;
      endIndex.value = -1;
      resolvedContentWidth = 0;
      return;
    }

    if (contentWidth <= 0 || viewportHeight <= 0) {
      // A cached view that another tab is covering reports no box, and the resize observer
      // fires exactly that 0x0 the moment KeepAlive detaches the column. Keeping the window
      // the reader left behind is what stops the hidden feed from rebuilding every card in
      // the background, and it leaves the column tall enough for scroll restoration.
      if (endIndex.value >= 0) {
        return;
      }

      // Nothing has ever been resolved (jsdom, the very first paint): a plain full render is
      // safer than risking an empty feed.
      applyPadding(element, 0, 0);
      startIndex.value = 0;
      endIndex.value = -1;
      return;
    }

    const viewportTop = -element.getBoundingClientRect().top;
    const heights = items.map((item) => measuredHeights.get(item.id) ?? mediaHeightOf(item, contentWidth) + overheadPx);
    const pinnedIndex = options.pinnedIndex?.() ?? null;

    // While the immersive layer holds one of these cards the feed behind it is not being
    // read, so the range is frozen. That keeps the claimed decoder mounted without letting
    // a scroll behind the overlay stretch the range from the claimed row all the way to the
    // viewport. If the pinned row somehow fell outside the frozen range, the pin below still
    // forces it back in.
    if (pinnedIndex !== null && pinnedIndex >= startIndex.value && pinnedIndex <= endIndex.value) {
      return;
    }

    const range = resolveFeedWindowRange({
      heights,
      gapPx,
      viewportTop,
      viewportHeight,
      overscanScreens,
      minRendered,
      pinnedIndex
    });

    applyPadding(element, range.padTopPx, range.padBottomPx);
    startIndex.value = range.startIndex;
    endIndex.value = range.endIndex;
    resolvedContentWidth = contentWidth;
  }

  function schedule() {
    if (frame !== 0) {
      return;
    }

    frame = requestFrame(() => {
      frame = 0;
      const shouldMeasure = measureOnNextFrame;
      measureOnNextFrame = false;
      if (shouldMeasure) {
        measureRendered();
      }
      update();
    });
  }

  function scheduleMeasurement() {
    measureOnNextFrame = true;
    schedule();
  }

  function refresh() {
    measureRendered();
    update();
  }

  function activate() {
    const element = options.container.value;
    if (element) {
      readGap(element);

      // Coming back to a cached view: the window and its padding are still the ones the
      // reader left, so the column is already the right height for the scroll restoration
      // that runs a tick later. Resolving now would use the not-yet-restored offset and
      // swap in the rows at the top of the feed for a frame.
      if (endIndex.value >= 0 && element.clientWidth === resolvedContentWidth) {
        scheduleMeasurement();
        return;
      }
    }

    // Scroll restoration runs one tick after activation and needs the column to already be
    // full height, so the first pass is synchronous instead of waiting for a frame.
    refresh();
  }

  onMounted(() => {
    if (typeof window !== 'undefined') {
      // `capture` also catches scrolling inside any ancestor scroller, and the range is
      // derived from the column's own rect, so the scroller does not need to be known.
      window.addEventListener('scroll', schedule, { passive: true, capture: true });
      window.addEventListener('resize', scheduleMeasurement, { passive: true });
    }

    if (typeof ResizeObserver === 'function' && options.container.value) {
      // The column's own box changes both when the viewport width changes and when a
      // mounted card grows, for instance once a video reports its real aspect ratio.
      resizeObserver = new ResizeObserver(() => scheduleMeasurement());
      resizeObserver.observe(options.container.value);
    }

    activate();
  });

  onActivated(activate);
  onUpdated(scheduleMeasurement);

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', scheduleMeasurement);
    }

    resizeObserver?.disconnect();
    resizeObserver = null;

    if (frame !== 0) {
      cancelFrame(frame);
      frame = 0;
    }
  });

  watch(
    () => options.items().map((item) => item.id),
    (ids) => {
      const known = new Set(ids);
      for (const id of measuredHeights.keys()) {
        if (!known.has(id)) {
          measuredHeights.delete(id);
        }
      }

      update();
    },
    { flush: 'post' }
  );

  watch(() => options.pinnedIndex?.() ?? null, refresh, { flush: 'post' });

  return { startIndex, endIndex, refresh };
}
