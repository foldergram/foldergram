import type { GesturePoint } from '../composables/useHoldToSpeed';

export function resolveGesturePoint(
  event: Pick<PointerEvent, 'clientX' | 'clientY'>,
  orientation: 'normal' | 'rotated' = 'normal'
): GesturePoint {
  return orientation === 'rotated'
    ? { x: event.clientY, y: -event.clientX }
    : { x: event.clientX, y: event.clientY };
}
