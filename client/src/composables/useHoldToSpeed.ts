import { computed, ref } from 'vue';

export interface HoldToSpeedPlayer {
  getCurrentTime: () => number;
  getDuration: () => number;
  seekTo: (seconds: number) => void;
  getPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  /** Resumed after a hold so the clip never stays parked on a frame. */
  play?: () => void | Promise<void>;
}

interface HoldToSpeedOptions extends HoldToSpeedPlayer {
  /** Skip the gesture when the press landed on a control. */
  canStart?: (event: PointerEvent) => boolean;
  /** Delay before a press turns into fast playback rather than a tap. */
  activationMs?: number;
  /** Multiplier applied while held. */
  rate?: number;
  /** Seconds travelled per pixel of horizontal drag. */
  secondsPerPixel?: number;
  /** Horizontal travel that switches the gesture from press to scrub. */
  scrubActivationPx?: number;
  /** Movement before activation that hands the gesture back to the host. */
  cancelActivationPx?: number;
}

const DEFAULT_ACTIVATION_MS = 300;
const DEFAULT_RATE = 2;
const DEFAULT_SECONDS_PER_PIXEL = 0.12;
const DEFAULT_SCRUB_ACTIVATION_PX = 12;
const DEFAULT_CANCEL_ACTIVATION_PX = 10;

/**
 * Press-and-hold fast playback plus horizontal drag scrubbing, the way short-video
 * apps behave: holding anywhere speeds the clip up (audio included, because the
 * rate change keeps decoding normally) and releasing drops straight back to normal
 * speed at the position reached. Dragging sideways instead scrubs the timeline and
 * commits the seek when the finger lifts.
 *
 * `shouldSuppressClick` lets the host drop the click that terminates a gesture so a
 * hold or a scrub is never also read as a tap.
 */
export function useHoldToSpeed(options: HoldToSpeedOptions) {
  const isFastForwarding = ref(false);
  const scrubSeconds = ref<number | null>(null);
  const isScrubbing = computed(() => scrubSeconds.value !== null);

  const activationMs = options.activationMs ?? DEFAULT_ACTIVATION_MS;
  const rate = options.rate ?? DEFAULT_RATE;
  const secondsPerPixel = options.secondsPerPixel ?? DEFAULT_SECONDS_PER_PIXEL;
  const scrubActivationPx = options.scrubActivationPx ?? DEFAULT_SCRUB_ACTIVATION_PX;
  const cancelActivationPx = options.cancelActivationPx ?? DEFAULT_CANCEL_ACTIVATION_PX;

  let activationTimer: ReturnType<typeof setTimeout> | null = null;
  let pointerId: number | null = null;
  let surfaceElement: Element | null = null;
  let capturedElement: Element | null = null;
  let startX = 0;
  let startY = 0;
  let scrubOrigin = 0;
  let restoreRate = 1;
  let suppressClick = false;

  function clearActivationTimer() {
    if (activationTimer !== null) {
      clearTimeout(activationTimer);
      activationTimer = null;
    }
  }

  function releasePointerCapture() {
    if (capturedElement && pointerId !== null) {
      try {
        capturedElement.releasePointerCapture(pointerId);
      } catch {
        // The pointer may already be released.
      }
    }

    capturedElement = null;
  }

  function restorePlaybackRate() {
    if (!isFastForwarding.value) {
      return;
    }

    isFastForwarding.value = false;
    options.setPlaybackRate(restoreRate);
    void options.play?.();
  }

  function clampToDuration(seconds: number): number {
    const duration = options.getDuration();
    const upperBound = Number.isFinite(duration) && duration > 0 ? duration - 0.25 : seconds;
    return Math.min(Math.max(seconds, 0), Math.max(upperBound, 0));
  }

  function stop() {
    clearActivationTimer();
    restorePlaybackRate();
    releasePointerCapture();
    scrubSeconds.value = null;
    pointerId = null;
    surfaceElement = null;
  }

  function capturePointer() {
    if (capturedElement || !surfaceElement || pointerId === null) {
      return;
    }

    try {
      surfaceElement.setPointerCapture(pointerId);
      capturedElement = surfaceElement;
    } catch {
      capturedElement = null;
    }
  }

  function beginFastForward() {
    capturePointer();
    restoreRate = options.getPlaybackRate() || 1;
    isFastForwarding.value = true;
    suppressClick = true;
    options.setPlaybackRate(rate);
    void options.play?.();
  }

  function beginScrub() {
    capturePointer();
    clearActivationTimer();
    restorePlaybackRate();
    suppressClick = true;
    scrubOrigin = options.getCurrentTime();
    scrubSeconds.value = scrubOrigin;
  }

  function onPointerdown(event: PointerEvent) {
    if (!event.isPrimary) {
      return;
    }

    if (options.canStart && !options.canStart(event)) {
      return;
    }

    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    // Capture is claimed only once a gesture actually starts: taking it up front
    // would fight the reels deck's native vertical scrolling.
    surfaceElement = event.currentTarget instanceof Element ? event.currentTarget : null;

    clearActivationTimer();
    activationTimer = setTimeout(() => {
      activationTimer = null;
      beginFastForward();
    }, activationMs);
  }

  function onPointermove(event: PointerEvent) {
    if (event.pointerId !== pointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (scrubSeconds.value === null) {
      // A vertical drag belongs to the host (dismiss or deck navigation). Dropping
      // the pending activation matters most for a slow swipe: the finger would
      // otherwise sit still long enough to trip fast playback mid-scroll.
      if (activationTimer !== null && Math.abs(deltaY) > cancelActivationPx && Math.abs(deltaY) > Math.abs(deltaX)) {
        stop();
        return;
      }

      if (isFastForwarding.value || Math.abs(deltaX) < scrubActivationPx || Math.abs(deltaX) <= Math.abs(deltaY)) {
        return;
      }

      beginScrub();
    }

    scrubSeconds.value = clampToDuration(scrubOrigin + deltaX * secondsPerPixel);
  }

  function onPointerup(event: PointerEvent) {
    if (event.pointerId !== pointerId) {
      return;
    }

    const target = scrubSeconds.value;
    if (target !== null) {
      options.seekTo(target);
      void options.play?.();
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
    isFastForwarding,
    isScrubbing,
    /** Live preview position while a scrub is in flight. */
    scrubSeconds,
    rate,
    onPointercancel,
    onPointerdown,
    onPointermove,
    onPointerup,
    shouldSuppressClick,
    stop
  };
}
