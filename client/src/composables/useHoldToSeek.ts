import { ref } from 'vue';

export type HoldSeekDirection = 'forward' | 'backward';

interface HoldToSeekOptions {
  /** Skip the gesture when the press landed on a control. */
  canStart?: (event: PointerEvent) => boolean;
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number) => void;
  activationMs?: number;
  intervalMs?: number;
  stepSeconds?: number;
  /** Fraction of the width on each side that arms the gesture. */
  edgeRatio?: number;
}

const DEFAULT_ACTIVATION_MS = 320;
const DEFAULT_INTERVAL_MS = 220;
const DEFAULT_STEP_SECONDS = 3;
const DEFAULT_EDGE_RATIO = 0.28;

/**
 * Press-and-hold seeking on the left and right edges of a video surface, the way
 * short-video apps scrub. Exposes `shouldSuppressClick` so the surface can drop
 * the click that ends a hold instead of treating it as a tap.
 */
export function useHoldToSeek(options: HoldToSeekOptions) {
  const direction = ref<HoldSeekDirection | null>(null);

  let activationTimer: ReturnType<typeof setTimeout> | null = null;
  let repeatTimer: ReturnType<typeof setInterval> | null = null;
  let pointerId: number | null = null;
  let suppressClick = false;

  const activationMs = options.activationMs ?? DEFAULT_ACTIVATION_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const stepSeconds = options.stepSeconds ?? DEFAULT_STEP_SECONDS;
  const edgeRatio = options.edgeRatio ?? DEFAULT_EDGE_RATIO;

  function clearActivationTimer() {
    if (activationTimer !== null) {
      clearTimeout(activationTimer);
      activationTimer = null;
    }
  }

  function stop() {
    clearActivationTimer();
    if (repeatTimer !== null) {
      clearInterval(repeatTimer);
      repeatTimer = null;
    }
    direction.value = null;
    pointerId = null;
  }

  function seekBy(delta: number) {
    const duration = options.getDuration();
    const next = options.getCurrentTime() + delta;
    const upperBound = Number.isFinite(duration) && duration > 0 ? duration - 0.25 : next;
    options.seekTo(Math.min(Math.max(next, 0), Math.max(upperBound, 0)));
  }

  function begin(nextDirection: HoldSeekDirection) {
    direction.value = nextDirection;
    suppressClick = true;

    const delta = nextDirection === 'forward' ? stepSeconds : -stepSeconds;
    seekBy(delta);
    repeatTimer = setInterval(() => seekBy(delta), intervalMs);
  }

  function onPointerdown(event: PointerEvent) {
    if (!event.isPrimary) {
      return;
    }

    if (options.canStart && !options.canStart(event)) {
      return;
    }

    const surface = event.currentTarget;
    if (!(surface instanceof HTMLElement)) {
      return;
    }

    const bounds = surface.getBoundingClientRect();
    if (bounds.width <= 0) {
      return;
    }

    const ratio = (event.clientX - bounds.left) / bounds.width;
    if (ratio > edgeRatio && ratio < 1 - edgeRatio) {
      return;
    }

    pointerId = event.pointerId;
    clearActivationTimer();
    activationTimer = setTimeout(() => {
      activationTimer = null;
      begin(ratio <= edgeRatio ? 'backward' : 'forward');
    }, activationMs);
  }

  function onPointerup(event: PointerEvent) {
    if (event.pointerId !== pointerId) {
      return;
    }

    stop();
  }

  function onPointercancel() {
    stop();
  }

  function shouldSuppressClick(): boolean {
    if (!suppressClick) {
      return false;
    }

    suppressClick = false;
    return true;
  }

  return {
    direction,
    onPointercancel,
    onPointerdown,
    onPointerup,
    shouldSuppressClick,
    stop
  };
}
