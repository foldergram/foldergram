import { computed, ref } from 'vue';

import type { GesturePoint } from './useHoldToSpeed';

interface PinchZoomOptions {
  maxScale?: number;
  doubleTapZoom?: boolean;
  /**
   * Allow one finger to move zoomed media. Disable when one-finger gestures belong to
   * video controls. A getter lets a host turn panning on only while the media is zoomed.
   */
  singlePointerPan?: boolean | (() => boolean);
  /** Prevent a second pointer from stealing a gesture owned by video controls. */
  canStartPinch?: () => boolean;
  snapToRestThreshold?: number;
  /** Past this the gesture is treated as a dismiss instead of a pan. */
  dismissDistance?: number;
  onDismiss?: () => void;
  onLongPress?: (event: PointerEvent) => void;
  /** Converts screen coordinates into the media's local coordinate system. */
  getGesturePoint?: (event: PointerEvent) => GesturePoint;
}

type Point = GesturePoint;

const DEFAULT_MAX_SCALE = 4;
const DEFAULT_SNAP_TO_REST_THRESHOLD = 1.08;
const DEFAULT_DISMISS_DISTANCE = 110;
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_SCALE = 2.5;
const LONG_PRESS_MS = 520;
const LONG_PRESS_TOLERANCE_PX = 12;

/**
 * Pinch, pan and double-tap zoom for immersive media. Images can keep one-finger
 * panning, while video disables it so horizontal drags scrub and vertical drags
 * dismiss. Long press is reported instead of swallowed so native save actions work.
 */
export function usePinchZoom(options: PinchZoomOptions = {}) {
  const scale = ref(1);
  const offset = ref<Point>({ x: 0, y: 0 });
  const isPanning = ref(false);
  const isPinching = ref(false);
  const isZoomed = computed(() => scale.value > 1.01);

  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const snapToRestThreshold = options.snapToRestThreshold ?? DEFAULT_SNAP_TO_REST_THRESHOLD;
  const dismissDistance = options.dismissDistance ?? DEFAULT_DISMISS_DISTANCE;

  /**
   * Resolved per gesture rather than once at setup: a zoomed picture hands single-finger
   * drags to panning, while a picture at rest leaves them to the video's scrub and
   * dismiss gestures.
   */
  function isSinglePointerPanEnabled(): boolean {
    const value = options.singlePointerPan ?? true;
    return typeof value === 'function' ? value() : value;
  }

  const pointers = new Map<number, Point>();
  let gestureStartScale = 1;
  let gestureStartDistance = 0;
  let gestureStartMidpoint: Point = { x: 0, y: 0 };
  let gestureStartOffset: Point = { x: 0, y: 0 };
  let panStart: Point | null = null;
  let panStartOffset: Point = { x: 0, y: 0 };
  let singlePointerIntent: 'pending' | 'horizontal' | 'vertical' = 'pending';
  let singlePointerDragY = 0;
  let suppressSinglePointerUntilRelease = false;
  let lastTapAt = 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressOrigin: Point | null = null;
  let longPressFired = false;
  let releaseFallbackAttached = false;

  function clearLongPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    longPressOrigin = null;
  }

  function handleWindowRelease(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    onPointerup(event);
  }

  function attachReleaseFallback() {
    if (releaseFallbackAttached || typeof window === 'undefined') {
      return;
    }

    // Capture phase on purpose: the immersive stage stops propagation on the way back
    // up, so a bubbling listener here never sees the release.
    window.addEventListener('pointerup', handleWindowRelease, true);
    window.addEventListener('pointercancel', handleWindowRelease, true);
    releaseFallbackAttached = true;
  }

  function detachReleaseFallback() {
    if (!releaseFallbackAttached || typeof window === 'undefined') {
      return;
    }

    window.removeEventListener('pointerup', handleWindowRelease, true);
    window.removeEventListener('pointercancel', handleWindowRelease, true);
    releaseFallbackAttached = false;
  }

  function reset() {
    scale.value = 1;
    offset.value = { x: 0, y: 0 };
    isPanning.value = false;
    isPinching.value = false;
    pointers.clear();
    detachReleaseFallback();
    panStart = null;
    singlePointerIntent = 'pending';
    singlePointerDragY = 0;
    suppressSinglePointerUntilRelease = false;
    clearLongPress();
    longPressFired = false;
  }

  /**
   * Hands the finger that is currently down to another owner (video scrub or fast
   * playback) while still tracking that it is down.
   *
   * `cancelActiveGesture` was used here before and it clears `pointers`, after which
   * every later move, release and second finger was ignored. That is what made
   * swipe-to-dismiss and pinch stop working for the rest of the touch session once a
   * sideways drag had scrubbed the timeline.
   */
  function suspendSinglePointer() {
    if (pointers.size >= 2) {
      return;
    }

    isPanning.value = false;
    panStart = null;
    singlePointerIntent = 'pending';
    singlePointerDragY = 0;
    suppressSinglePointerUntilRelease = true;
    clearLongPress();
    longPressFired = false;
  }

  function cancelActiveGesture() {
    isPanning.value = false;
    isPinching.value = false;
    pointers.clear();
    detachReleaseFallback();
    panStart = null;
    singlePointerIntent = 'pending';
    singlePointerDragY = 0;
    suppressSinglePointerUntilRelease = false;
    clearLongPress();
    longPressFired = false;
  }

  function getDistance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function getGesturePoint(event: PointerEvent): Point {
    return options.getGesturePoint?.(event) ?? { x: event.clientX, y: event.clientY };
  }

  function getMidpoint(a: Point, b: Point): Point {
    return {
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2
    };
  }

  function clampScale(next: number): number {
    return Math.min(Math.max(next, 1), maxScale);
  }

  function capturePointers(element: Element, pointerIds: Iterable<number>) {
    for (const pointerId of pointerIds) {
      try {
        element.setPointerCapture(pointerId);
      } catch {
        // Capture is an optimisation; ignore platforms that refuse it.
      }
    }
  }

  /**
   * A primary pointerdown is by definition the first contact of a new touch session, so
   * nothing else can still be down. Anything left in `pointers` is a release we never
   * observed: the video player captures the pointer part way through a sideways scrub
   * and the matching `pointerup` is delivered somewhere this layer cannot see.
   *
   * That stale entry is what broke every gesture after the first scrub. The next single
   * finger arrived while the map already held one id, so it was read as the second finger
   * of a pinch: swipe-to-dismiss stopped closing the layer and a real pinch started from
   * a bogus reference distance.
   */
  function dropStalePointers(event: PointerEvent) {
    if (!event.isPrimary || pointers.size === 0) {
      return;
    }

    pointers.clear();
    isPinching.value = false;
    isPanning.value = false;
    panStart = null;
    singlePointerIntent = 'pending';
    singlePointerDragY = 0;
    suppressSinglePointerUntilRelease = false;
    gestureStartDistance = 0;
    clearLongPress();
    longPressFired = false;
  }

  function onPointerdown(event: PointerEvent) {
    if (pointers.has(event.pointerId)) {
      return;
    }

    dropStalePointers(event);

    // A second finger always promotes the gesture to a pinch, even part way through a
    // scrub or a hold: the host cancels those when pinching starts. Refusing the
    // promotion here is what used to make zooming impossible after a sideways drag.
    if (pointers.size === 1 && options.canStartPinch?.() === false) {
      return;
    }

    pointers.set(event.pointerId, getGesturePoint(event));
    attachReleaseFallback();

    if (pointers.size >= 2) {
      if (pointers.size > 2) {
        return;
      }

      isPinching.value = true;
      suppressSinglePointerUntilRelease = true;
      const [first, second] = Array.from(pointers.values());
      gestureStartDistance = getDistance(first!, second!);
      gestureStartScale = scale.value;
      gestureStartMidpoint = getMidpoint(first!, second!);
      gestureStartOffset = { ...offset.value };
      panStart = null;
      singlePointerIntent = 'pending';
      singlePointerDragY = 0;
      clearLongPress();
      if (event.currentTarget instanceof Element) {
        capturePointers(event.currentTarget, pointers.keys());
      }
      return;
    }

    if (suppressSinglePointerUntilRelease) {
      return;
    }

    if (isSinglePointerPanEnabled() && event.currentTarget instanceof Element) {
      capturePointers(event.currentTarget, [event.pointerId]);
    }

    panStart = getGesturePoint(event);
    panStartOffset = { ...offset.value };
    singlePointerIntent = 'pending';
    singlePointerDragY = 0;
    longPressFired = false;

    if (options.onLongPress) {
      longPressOrigin = getGesturePoint(event);
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        longPressFired = true;
        options.onLongPress?.(event);
      }, LONG_PRESS_MS);
    }
  }

  function onPointermove(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    pointers.set(event.pointerId, getGesturePoint(event));

    if (longPressOrigin && getDistance(longPressOrigin, getGesturePoint(event)) > LONG_PRESS_TOLERANCE_PX) {
      clearLongPress();
    }

    if (pointers.size >= 2) {
      const [first, second] = Array.from(pointers.values());
      if (gestureStartDistance <= 0) {
        return;
      }

      const midpoint = getMidpoint(first!, second!);
      scale.value = clampScale((getDistance(first!, second!) / gestureStartDistance) * gestureStartScale);
      offset.value = {
        x: gestureStartOffset.x + midpoint.x - gestureStartMidpoint.x,
        y: gestureStartOffset.y + midpoint.y - gestureStartMidpoint.y
      };
      return;
    }

    if (!panStart) {
      return;
    }

    const point = getGesturePoint(event);
    const deltaX = point.x - panStart.x;
    const deltaY = point.y - panStart.y;

    if (singlePointerIntent === 'pending' && Math.hypot(deltaX, deltaY) < 6) {
      return;
    }

    if (singlePointerIntent === 'pending') {
      singlePointerIntent = Math.abs(deltaY) > Math.abs(deltaX) ? 'vertical' : 'horizontal';
    }

    if (!isSinglePointerPanEnabled()) {
      if (singlePointerIntent === 'vertical') {
        isPanning.value = true;
        singlePointerDragY = deltaY;
      }
      return;
    }

    isPanning.value = true;
    offset.value = isZoomed.value
      ? { x: panStartOffset.x + deltaX, y: panStartOffset.y + deltaY }
      : { x: 0, y: panStartOffset.y + deltaY };
  }

  function onPointerup(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    const start = panStart;
    const wasPanning = isPanning.value;
    const pointerIntent = singlePointerIntent;
    const panEnabled = isSinglePointerPanEnabled();
    const draggedY = panEnabled ? offset.value.y : singlePointerDragY;
    const wasSuppressed = suppressSinglePointerUntilRelease;

    pointers.delete(event.pointerId);
    clearLongPress();

    if (pointers.size >= 1) {
      isPinching.value = false;
      isPanning.value = false;
      panStart = null;
      return;
    }

    detachReleaseFallback();

    isPinching.value = false;
    isPanning.value = false;
    panStart = null;
    singlePointerIntent = 'pending';
    singlePointerDragY = 0;

    if (wasSuppressed) {
      suppressSinglePointerUntilRelease = false;
      if (scale.value <= snapToRestThreshold) {
        scale.value = 1;
        offset.value = { x: 0, y: 0 };
      }
      return;
    }

    if (!panEnabled) {
      if (wasPanning && pointerIntent === 'vertical' && Math.abs(draggedY) >= dismissDistance) {
        options.onDismiss?.();
        return;
      }

      if (scale.value <= snapToRestThreshold) {
        scale.value = 1;
        offset.value = { x: 0, y: 0 };
      }
    } else if (!isZoomed.value) {
      if (wasPanning && Math.abs(draggedY) >= dismissDistance) {
        options.onDismiss?.();
        return;
      }

      offset.value = { x: 0, y: 0 };
    } else if (scale.value <= snapToRestThreshold) {
      scale.value = 1;
      offset.value = { x: 0, y: 0 };
    }

    if (wasPanning || pointerIntent !== 'pending' || longPressFired || !start) {
      longPressFired = false;
      return;
    }

    if (options.doubleTapZoom === false) {
      return;
    }

    const now = Date.now();
    if (now - lastTapAt <= DOUBLE_TAP_WINDOW_MS) {
      lastTapAt = 0;
      scale.value = isZoomed.value ? 1 : DOUBLE_TAP_SCALE;
      if (!isZoomed.value) {
        offset.value = { x: 0, y: 0 };
      }
      return;
    }

    lastTapAt = now;
  }

  function onPointercancel(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    const wasPanning = isPanning.value;
    const pointerIntent = singlePointerIntent;
    const panEnabled = isSinglePointerPanEnabled();
    const draggedY = panEnabled ? offset.value.y : singlePointerDragY;
    const wasSuppressed = suppressSinglePointerUntilRelease;

    pointers.delete(event.pointerId);
    clearLongPress();
    isPinching.value = pointers.size >= 2;
    isPanning.value = false;

    if (pointers.size === 1) {
      panStart = null;
      return;
    }

    panStart = null;
    singlePointerIntent = 'pending';
    singlePointerDragY = 0;

    if (wasSuppressed) {
      suppressSinglePointerUntilRelease = false;
      if (scale.value <= snapToRestThreshold) {
        scale.value = 1;
        offset.value = { x: 0, y: 0 };
      }
      return;
    }

    if (!panEnabled) {
      if (wasPanning && pointerIntent === 'vertical' && Math.abs(draggedY) >= dismissDistance) {
        options.onDismiss?.();
        return;
      }

      if (scale.value <= snapToRestThreshold) {
        scale.value = 1;
        offset.value = { x: 0, y: 0 };
      }
      return;
    }

    if (!isZoomed.value) {
      if (wasPanning && Math.abs(draggedY) >= dismissDistance) {
        offset.value = { x: 0, y: 0 };
        options.onDismiss?.();
        return;
      }

      offset.value = { x: 0, y: 0 };
    } else if (scale.value <= snapToRestThreshold) {
      scale.value = 1;
      offset.value = { x: 0, y: 0 };
    }
  }

  function onWheel(event: WheelEvent) {
    if (!event.ctrlKey && Math.abs(event.deltaY) < 2) {
      return;
    }

    event.preventDefault();
    scale.value = clampScale(scale.value - event.deltaY / 500);

    if (!isZoomed.value) {
      offset.value = { x: 0, y: 0 };
    }
  }

  function toggleZoom() {
    scale.value = isZoomed.value ? 1 : DOUBLE_TAP_SCALE;
    offset.value = { x: 0, y: 0 };
  }

  const transform = computed(
    () => `translate3d(${offset.value.x}px, ${offset.value.y}px, 0) scale(${scale.value})`
  );

  return {
    cancelActiveGesture,
    /** Fingers the zoom layer is currently tracking. */
    pointerCount: () => pointers.size,
    suspendSinglePointer,
    isPanning,
    isPinching,
    isZoomed,
    offset,
    onPointercancel,
    onPointerdown,
    onPointermove,
    onPointerup,
    onWheel,
    reset,
    scale,
    toggleZoom,
    transform
  };
}
