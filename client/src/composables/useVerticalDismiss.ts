import { ref } from 'vue';

interface VerticalDismissOptions {
  /** Ignore gestures that start on controls, sliders or links. */
  canStart?: (event: PointerEvent) => boolean;
  /** Travel needed before the gesture counts as a dismiss. */
  minDistance?: number;
  /** A gesture that drifts sideways more than this is a horizontal one. */
  maxHorizontalDistance?: number;
  onDismiss?: (direction: 'up' | 'down') => void | Promise<void>;
}

const DEFAULT_MIN_DISTANCE = 96;
const DEFAULT_MAX_HORIZONTAL_DISTANCE = 80;
const DRAG_ACTIVATION_DISTANCE = 8;

/**
 * Drag-to-dismiss for full screen overlays. Reports live offset so the caller can
 * follow the finger, and only fires `onDismiss` once the gesture clears the
 * threshold, mirroring how native photo viewers behave.
 */
export function useVerticalDismiss(options: VerticalDismissOptions = {}) {
  const dragOffset = ref(0);
  const isDragging = ref(false);

  let activePointerId: number | null = null;
  let capturedElement: Element | null = null;
  let startX = 0;
  let startY = 0;

  function releasePointerCapture() {
    if (capturedElement && activePointerId !== null) {
      try {
        capturedElement.releasePointerCapture(activePointerId);
      } catch {
        // The pointer may already be released.
      }
    }

    capturedElement = null;
  }

  function reset() {
    releasePointerCapture();
    activePointerId = null;
    startX = 0;
    startY = 0;
    dragOffset.value = 0;
    isDragging.value = false;
  }

  function onPointerdown(event: PointerEvent) {
    if (!event.isPrimary || event.pointerType === 'mouse') {
      return;
    }

    if (options.canStart && !options.canStart(event)) {
      return;
    }

    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;

    if (event.currentTarget instanceof Element) {
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        capturedElement = event.currentTarget;
      } catch {
        capturedElement = null;
      }
    }
  }

  function onPointermove(event: PointerEvent) {
    if (event.pointerId !== activePointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (!isDragging.value) {
      if (Math.abs(deltaY) < DRAG_ACTIVATION_DISTANCE || Math.abs(deltaY) <= Math.abs(deltaX)) {
        return;
      }

      isDragging.value = true;
    }

    dragOffset.value = deltaY;
  }

  async function onPointerup(event: PointerEvent) {
    if (event.pointerId !== activePointerId) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    const minDistance = options.minDistance ?? DEFAULT_MIN_DISTANCE;
    const maxHorizontalDistance = options.maxHorizontalDistance ?? DEFAULT_MAX_HORIZONTAL_DISTANCE;

    reset();

    if (Math.abs(deltaY) < minDistance || Math.abs(deltaX) > maxHorizontalDistance) {
      return;
    }

    await options.onDismiss?.(deltaY < 0 ? 'up' : 'down');
  }

  function onPointercancel() {
    reset();
  }

  return {
    dragOffset,
    isDragging,
    onPointercancel,
    onPointerdown,
    onPointermove,
    onPointerup,
    reset
  };
}
