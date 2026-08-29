import { computed, ref } from 'vue';

interface PinchZoomOptions {
  maxScale?: number;
  /** Past this the gesture is treated as a dismiss instead of a pan. */
  dismissDistance?: number;
  onDismiss?: () => void;
  onLongPress?: (event: PointerEvent) => void;
}

interface Point {
  x: number;
  y: number;
}

const DEFAULT_MAX_SCALE = 4;
const DEFAULT_DISMISS_DISTANCE = 110;
const DOUBLE_TAP_WINDOW_MS = 300;
const DOUBLE_TAP_SCALE = 2.5;
const LONG_PRESS_MS = 520;
const LONG_PRESS_TOLERANCE_PX = 12;

/**
 * Pinch, pan and double-tap zoom for a single image, plus drag-to-dismiss while at
 * rest. Written against pointer events so one code path covers touch and mouse;
 * long press is reported instead of swallowed so the browser's own "save image"
 * menu still appears.
 */
export function usePinchZoom(options: PinchZoomOptions = {}) {
  const scale = ref(1);
  const offset = ref<Point>({ x: 0, y: 0 });
  const isPanning = ref(false);
  const isZoomed = computed(() => scale.value > 1.01);

  const maxScale = options.maxScale ?? DEFAULT_MAX_SCALE;
  const dismissDistance = options.dismissDistance ?? DEFAULT_DISMISS_DISTANCE;

  const pointers = new Map<number, Point>();
  let gestureStartScale = 1;
  let gestureStartDistance = 0;
  let panStart: Point | null = null;
  let panStartOffset: Point = { x: 0, y: 0 };
  let lastTapAt = 0;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressOrigin: Point | null = null;
  let longPressFired = false;

  function clearLongPress() {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }

    longPressOrigin = null;
  }

  function reset() {
    scale.value = 1;
    offset.value = { x: 0, y: 0 };
    isPanning.value = false;
    pointers.clear();
    panStart = null;
    clearLongPress();
    longPressFired = false;
  }

  function getDistance(a: Point, b: Point): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clampScale(next: number): number {
    return Math.min(Math.max(next, 1), maxScale);
  }

  function onPointerdown(event: PointerEvent) {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (event.currentTarget instanceof Element) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // Capture is an optimisation; ignore platforms that refuse it.
      }
    }

    if (pointers.size === 2) {
      const [first, second] = Array.from(pointers.values());
      gestureStartDistance = getDistance(first!, second!);
      gestureStartScale = scale.value;
      clearLongPress();
      return;
    }

    panStart = { x: event.clientX, y: event.clientY };
    panStartOffset = { ...offset.value };
    longPressFired = false;

    if (options.onLongPress) {
      longPressOrigin = { x: event.clientX, y: event.clientY };
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

    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (longPressOrigin && getDistance(longPressOrigin, { x: event.clientX, y: event.clientY }) > LONG_PRESS_TOLERANCE_PX) {
      clearLongPress();
    }

    if (pointers.size >= 2) {
      const [first, second] = Array.from(pointers.values());
      if (gestureStartDistance <= 0) {
        return;
      }

      scale.value = clampScale((getDistance(first!, second!) / gestureStartDistance) * gestureStartScale);
      return;
    }

    if (!panStart) {
      return;
    }

    const deltaX = event.clientX - panStart.x;
    const deltaY = event.clientY - panStart.y;

    if (!isPanning.value && Math.hypot(deltaX, deltaY) < 6) {
      return;
    }

    isPanning.value = true;
    offset.value = isZoomed.value
      ? { x: panStartOffset.x + deltaX, y: panStartOffset.y + deltaY }
      : { x: 0, y: panStartOffset.y + deltaY };
  }

  function onPointerup(event: PointerEvent) {
    const start = panStart;
    const wasPanning = isPanning.value;
    const draggedY = offset.value.y;

    pointers.delete(event.pointerId);
    clearLongPress();

    if (pointers.size >= 1) {
      // Still pinching with the remaining finger; keep the transform as-is.
      isPanning.value = false;
      panStart = null;
      return;
    }

    isPanning.value = false;
    panStart = null;

    if (!isZoomed.value) {
      if (wasPanning && Math.abs(draggedY) >= dismissDistance) {
        options.onDismiss?.();
        return;
      }

      offset.value = { x: 0, y: 0 };
    }

    if (wasPanning || longPressFired || !start) {
      longPressFired = false;
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
    pointers.delete(event.pointerId);
    clearLongPress();
    isPanning.value = false;
    panStart = null;

    if (!isZoomed.value) {
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
    isPanning,
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
