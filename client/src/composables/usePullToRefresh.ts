import { onBeforeUnmount, onMounted, ref } from 'vue';

interface PullToRefreshOptions {
  /** Travel needed before the release triggers a refresh. */
  threshold?: number;
  /** How far the indicator may travel; the pull is damped past the threshold. */
  maxDistance?: number;
  /** Skip the gesture entirely, e.g. while a modal owns the screen. */
  isEnabled?: () => boolean;
  onRefresh: () => Promise<void> | void;
}

const DEFAULT_THRESHOLD = 72;
const DEFAULT_MAX_DISTANCE = 120;
/** Below this the finger is still deciding; above it the pull owns the gesture. */
const ACTIVATION_DISTANCE = 10;

function getScrollTop(): number {
  return window.scrollY || document.documentElement.scrollTop || 0;
}

/**
 * Pull-to-refresh on the document scroller, written directly against touch events.
 *
 * The pull only starts when the page is already at the very top, which is what keeps it
 * from fighting normal scrolling. Nothing is preventDefault-ed until the gesture has
 * clearly become a pull, so a plain scroll never loses a frame to this.
 */
export function usePullToRefresh(options: PullToRefreshOptions) {
  const pullDistance = ref(0);
  const isPulling = ref(false);
  const isRefreshing = ref(false);

  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;

  let startY = 0;
  let tracking = false;

  function reset() {
    tracking = false;
    isPulling.value = false;
    pullDistance.value = 0;
  }

  function handleTouchStart(event: TouchEvent) {
    if (isRefreshing.value || event.touches.length !== 1) {
      return;
    }

    if (options.isEnabled && !options.isEnabled()) {
      return;
    }

    if (getScrollTop() > 0) {
      return;
    }

    tracking = true;
    startY = event.touches[0].clientY;
  }

  function handleTouchMove(event: TouchEvent) {
    if (!tracking || event.touches.length !== 1) {
      return;
    }

    // A modal/player can open after touchstart. Once another surface owns the
    // gesture, release pull-to-refresh immediately instead of refreshing the page
    // when that surface's swipe ends.
    if (options.isEnabled && !options.isEnabled()) {
      reset();
      return;
    }

    const delta = event.touches[0].clientY - startY;

    if (delta <= 0 || getScrollTop() > 0) {
      // The finger went back up or the page started scrolling: hand the gesture back.
      if (isPulling.value) {
        reset();
      } else {
        tracking = false;
      }
      return;
    }

    if (!isPulling.value) {
      if (delta < ACTIVATION_DISTANCE) {
        return;
      }

      isPulling.value = true;
    }

    // Damped past the threshold so the sheet feels attached to the finger rather than
    // sliding away with it.
    const damped = delta <= threshold ? delta : threshold + (delta - threshold) * 0.35;
    pullDistance.value = Math.min(damped, maxDistance);

    if (event.cancelable) {
      event.preventDefault();
    }
  }

  async function handleTouchEnd() {
    if (!tracking) {
      return;
    }

    if (options.isEnabled && !options.isEnabled()) {
      reset();
      return;
    }

    const shouldRefresh = isPulling.value && pullDistance.value >= threshold;
    reset();

    if (!shouldRefresh || isRefreshing.value) {
      return;
    }

    isRefreshing.value = true;

    try {
      await options.onRefresh();
    } finally {
      isRefreshing.value = false;
    }
  }

  onMounted(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    // Not passive: an active pull has to stop the browser's own overscroll.
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', reset);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('touchstart', handleTouchStart);
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    window.removeEventListener('touchcancel', reset);
  });

  return {
    isPulling,
    isRefreshing,
    pullDistance,
    threshold
  };
}
