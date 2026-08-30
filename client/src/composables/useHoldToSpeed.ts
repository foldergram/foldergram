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

export interface GesturePoint {
  x: number;
  y: number;
}

interface HoldToSpeedOptions extends HoldToSpeedPlayer {
  /** Skip the gesture when the press landed on a control. */
  canStart?: (event: PointerEvent) => boolean;
  /** Delay before a press turns into fast playback rather than a tap. */
  activationMs?: number;
  /** Multiplier applied while held. */
  rate?: number;
  /** Rate restored on release. Fixed rather than sampled, so a stuck rate never becomes the new baseline. */
  baseRate?: number;
  /** Seconds travelled per pixel of horizontal drag. */
  secondsPerPixel?: number;
  /** Horizontal travel that switches the gesture from press to scrub. */
  scrubActivationPx?: number;
  /** Movement before activation that hands the gesture back to the host. */
  cancelActivationPx?: number;
  /** Converts screen coordinates into the media's local coordinate system. */
  getGesturePoint?: (event: PointerEvent) => GesturePoint;
  /** Notifies a host that this surface has fully released its gesture ownership. */
  onGestureEnd?: () => void;
  /** Notifies a host as soon as horizontal scrub owns the pointer. */
  onGestureStart?: () => void;
}

const DEFAULT_ACTIVATION_MS = 300;
const DEFAULT_RATE = 2;
const DEFAULT_BASE_RATE = 1;
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
  const baseRate = options.baseRate ?? DEFAULT_BASE_RATE;
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
  let suppressClick = false;
  let releaseFallbackAttached = false;

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

  /**
   * Always writes the baseline back, even when the flag says no hold is running and
   * even when the reported rate already looks right: vidstack reports its own pending
   * state, so a player that was really still at 2x used to be skipped here and stayed
   * fast forever. Resuming is still limited to a real hold so a tap-to-pause is not
   * undone.
   */
  function restorePlaybackRate() {
    const wasFastForwarding = isFastForwarding.value;
    isFastForwarding.value = false;

    options.setPlaybackRate(baseRate);

    if (wasFastForwarding) {
      void options.play?.();
    }
  }

  function clampToDuration(seconds: number): number {
    const duration = options.getDuration();
    const upperBound = Number.isFinite(duration) && duration > 0 ? duration - 0.25 : seconds;
    return Math.min(Math.max(seconds, 0), Math.max(upperBound, 0));
  }

  /**
   * A pointer capture target that leaves the DOM mid-hold (source swap, card
   * recycling) never delivers `pointerup` to the surface listener, so the gesture
   * would never end and the clip stayed at 2x. Window-level listeners guarantee a
   * release is always observed.
   */
  function handleWindowRelease(event: PointerEvent) {
    if (pointerId === null || event.pointerId !== pointerId) {
      return;
    }

    const target = scrubSeconds.value;
    if (target !== null) {
      options.seekTo(target);
      void options.play?.();
    }

    stop();
  }

  /**
   * Losing capture only ends the gesture when the surface we captured lost it.
   *
   * Taking capture ourselves makes the browser fire `lostpointercapture` at whatever
   * held the pointer before, and on a video that is the `<video>` element's implicit
   * capture. Treating that as a release ended every sideways drag a few pixels in: the
   * seek was committed immediately, the rest of the drag was ignored, and the immersive
   * layer was left holding a finger it would never see released, which is what killed
   * swipe-to-dismiss and pinch for the rest of the touch.
   */
  function handleCaptureLoss(event: PointerEvent) {
    if (capturedElement === null || event.target !== capturedElement) {
      return;
    }

    handleWindowRelease(event);
  }

  function attachReleaseFallback() {
    if (releaseFallbackAttached || typeof window === 'undefined') {
      return;
    }

    window.addEventListener('pointerup', handleWindowRelease);
    window.addEventListener('pointercancel', handleWindowRelease);
    window.addEventListener('lostpointercapture', handleCaptureLoss);
    releaseFallbackAttached = true;
  }

  function detachReleaseFallback() {
    if (!releaseFallbackAttached || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('pointerup', handleWindowRelease);
    window.removeEventListener('pointercancel', handleWindowRelease);
    window.removeEventListener('lostpointercapture', handleCaptureLoss);
    releaseFallbackAttached = false;
  }

  function stop() {
    const hadActiveGesture = pointerId !== null;
    clearActivationTimer();
    restorePlaybackRate();
    releasePointerCapture();
    detachReleaseFallback();
    scrubSeconds.value = null;
    pointerId = null;
    surfaceElement = null;

    if (hadActiveGesture) {
      options.onGestureEnd?.();
    }
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
    isFastForwarding.value = true;
    suppressClick = true;
    options.setPlaybackRate(rate);
    void options.play?.();
  }

  function beginScrub() {
    options.onGestureStart?.();
    capturePointer();
    clearActivationTimer();
    // Resets the rate whether or not the hold had already fired, and resumes playback
    // if it had, so the scrub preview tracks a clip running at normal speed.
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

    const point = options.getGesturePoint?.(event) ?? { x: event.clientX, y: event.clientY };
    pointerId = event.pointerId;
    startX = point.x;
    startY = point.y;
    // Capture is claimed only once a gesture actually starts: taking it up front
    // would fight the reels deck's native vertical scrolling.
    surfaceElement = event.currentTarget instanceof Element ? event.currentTarget : null;

    attachReleaseFallback();
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

    const point = options.getGesturePoint?.(event) ?? { x: event.clientX, y: event.clientY };
    const deltaX = point.x - startX;
    const deltaY = point.y - startY;

    if (scrubSeconds.value === null) {
      // A vertical drag belongs to the host (dismiss or deck navigation). Dropping
      // the pending activation matters most for a slow swipe: the finger would
      // otherwise sit still long enough to trip fast playback mid-scroll.
      if (
        (activationTimer !== null || isFastForwarding.value) &&
        Math.abs(deltaY) > cancelActivationPx &&
        Math.abs(deltaY) > Math.abs(deltaX)
      ) {
        stop();
        return;
      }

      // A sideways drag is a scrub, so the pending hold is dropped before it can fire.
      // Without this a swipe that took longer than `activationMs` to get going turned
      // into fast playback first, and fast playback used to win the gesture for good.
      if (activationTimer !== null && Math.abs(deltaX) > cancelActivationPx && Math.abs(deltaX) > Math.abs(deltaY)) {
        clearActivationTimer();
      }

      if (Math.abs(deltaX) < scrubActivationPx || Math.abs(deltaX) <= Math.abs(deltaY)) {
        return;
      }

      // Horizontal travel takes the gesture over even when fast playback already
      // started: `beginScrub` drops the rate back to the baseline first, so the clip
      // cannot be left running at 2x for the rest of the drag.
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
    baseRate,
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
