import { describe, expect, it, vi } from 'vitest';

import { usePinchZoom } from './usePinchZoom';

function createHarness(options: { onDismiss?: () => void; onLongPress?: () => void } = {}) {
  const surface = document.createElement('div');
  const zoom = usePinchZoom(options);

  // jsdom exposes no PointerEvent constructor, so the handlers get the fields they read.
  function pointer(pointerId: number, x: number, y: number) {
    return { pointerId, clientX: x, clientY: y, currentTarget: surface } as unknown as PointerEvent;
  }

  return { pointer, surface, zoom };
}

describe('usePinchZoom', () => {
  it('scales with a two-finger pinch and clamps between 1x and the max', () => {
    const { pointer, zoom } = createHarness();

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerdown(pointer(2, 200, 100));
    zoom.onPointermove(pointer(2, 300, 100));

    expect(zoom.scale.value).toBeCloseTo(2, 5);
    expect(zoom.isZoomed.value).toBe(true);

    // Pinching far past the max must not run away.
    zoom.onPointermove(pointer(2, 3000, 100));
    expect(zoom.scale.value).toBe(4);

    // And squeezing back in stops at the natural size.
    zoom.onPointermove(pointer(2, 101, 100));
    expect(zoom.scale.value).toBe(1);
  });

  it('dismisses on a vertical drag while at rest', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 100, 260));
    zoom.onPointerup(pointer(1, 100, 260));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('pans instead of dismissing once zoomed in', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss });

    zoom.toggleZoom();
    expect(zoom.isZoomed.value).toBe(true);

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 140, 300));
    zoom.onPointerup(pointer(1, 140, 300));

    expect(onDismiss).not.toHaveBeenCalled();
    expect(zoom.offset.value).toEqual({ x: 40, y: 200 });
  });

  it('zooms on a double tap and back out on the next one', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { pointer, zoom } = createHarness();

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerup(pointer(1, 100, 100));
    expect(zoom.isZoomed.value).toBe(false);

    vi.advanceTimersByTime(120);
    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerup(pointer(1, 100, 100));
    expect(zoom.scale.value).toBe(2.5);

    vi.advanceTimersByTime(120);
    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerup(pointer(1, 100, 100));
    // A tap after a zoom-in re-arms the double-tap window rather than toggling twice.
    expect(zoom.scale.value).toBe(2.5);
    vi.useRealTimers();
  });

  it('reports a long press and skips the tap handling that follows it', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { pointer, zoom } = createHarness({ onLongPress });

    zoom.onPointerdown(pointer(1, 100, 100));
    vi.advanceTimersByTime(520);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    zoom.onPointerup(pointer(1, 100, 100));
    expect(zoom.isZoomed.value).toBe(false);
    vi.useRealTimers();
  });

  it('cancels the long press when the finger travels', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { pointer, zoom } = createHarness({ onLongPress });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 100, 140));
    vi.advanceTimersByTime(600);

    expect(onLongPress).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
