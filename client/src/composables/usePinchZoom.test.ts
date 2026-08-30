import { describe, expect, it, vi } from 'vitest';

import { usePinchZoom } from './usePinchZoom';
import type { GesturePoint } from './useHoldToSpeed';

function createHarness(options: {
  canStartPinch?: () => boolean;
  doubleTapZoom?: boolean;
  singlePointerPan?: boolean;
  onDismiss?: () => void;
  onLongPress?: () => void;
  snapToRestThreshold?: number;
  getGesturePoint?: (event: PointerEvent) => GesturePoint;
} = {}) {
  const surface = document.createElement('div');
  const zoom = usePinchZoom(options);

  // jsdom exposes no PointerEvent constructor, so the handlers get the fields they read.
  // `isPrimary` defaults to the first finger only, matching how a browser reports touch.
  function pointer(pointerId: number, x: number, y: number, isPrimary = pointerId === 1) {
    return {
      pointerId,
      clientX: x,
      clientY: y,
      isPrimary,
      pointerType: 'touch',
      currentTarget: surface
    } as unknown as PointerEvent;
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

  it('tracks pinch input continuously and snaps only near the natural size on release', () => {
    const { pointer, zoom } = createHarness();

    zoom.toggleZoom();
    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 140, 160));
    zoom.onPointerup(pointer(1, 140, 160));
    expect(zoom.offset.value).toEqual({ x: 40, y: 60 });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerdown(pointer(2, 200, 100));
    expect(zoom.isPinching.value).toBe(true);

    zoom.onPointermove(pointer(2, 142, 100));
    expect(zoom.scale.value).toBeCloseTo(1.05, 5);
    expect(zoom.offset.value).toEqual({ x: 11, y: 60 });

    zoom.onPointerup(pointer(1, 100, 100));
    zoom.onPointerup(pointer(2, 142, 100));
    expect(zoom.isPinching.value).toBe(false);
    expect(zoom.scale.value).toBe(1);
    expect(zoom.offset.value).toEqual({ x: 0, y: 0 });
  });

  it('keeps arbitrary zoom levels instead of snapping them to fixed steps', () => {
    const { pointer, zoom } = createHarness();

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerdown(pointer(2, 200, 100));
    zoom.onPointermove(pointer(2, 263, 100));
    zoom.onPointerup(pointer(1, 100, 100));
    zoom.onPointerup(pointer(2, 263, 100));

    expect(zoom.scale.value).toBeCloseTo(1.63, 5);
  });

  it('moves in both axes while the pinch centre moves', () => {
    const { pointer, zoom } = createHarness();

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerdown(pointer(2, 200, 100));
    zoom.onPointermove(pointer(2, 300, 180));

    expect(zoom.scale.value).toBeGreaterThan(2);
    expect(zoom.offset.value.x).toBe(50);
    expect(zoom.offset.value.y).toBe(40);
  });

  it('uses the rotated media axes for pinch distance and movement', () => {
    const { pointer, zoom } = createHarness({
      getGesturePoint: (event) => ({ x: event.clientY, y: -event.clientX })
    });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerdown(pointer(2, 100, 200));
    zoom.onPointermove(pointer(2, 180, 300));

    expect(zoom.scale.value).toBeCloseTo(Math.hypot(200, 80) / 100, 5);
    expect(zoom.offset.value).toEqual({ x: 50, y: -40 });
  });

  it('does not hand a pinch over to the remaining finger in strict two-finger mode', () => {
    const { pointer, zoom } = createHarness({ singlePointerPan: false });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerdown(pointer(2, 200, 100));
    zoom.onPointermove(pointer(1, 50, 100));
    zoom.onPointermove(pointer(2, 250, 100));
    const pinchOffset = { ...zoom.offset.value };
    zoom.onPointerup(pointer(2, 250, 100));
    zoom.onPointermove(pointer(1, 90, 160));
    zoom.onPointerup(pointer(1, 90, 160));

    expect(zoom.offset.value).toEqual(pinchOffset);
  });

  it('leaves single-finger horizontal movement to the video scrubber', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss, singlePointerPan: false });

    zoom.toggleZoom();
    const initialOffset = { ...zoom.offset.value };
    const initialScale = zoom.scale.value;

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 280, 125));
    zoom.onPointerup(pointer(1, 280, 125));

    expect(zoom.scale.value).toBe(initialScale);
    expect(zoom.offset.value).toEqual(initialOffset);
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('promotes a second finger to a pinch even mid-scrub', () => {
    const { pointer, zoom } = createHarness({ singlePointerPan: false });

    // The finger has already established a sideways scrub.
    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 240, 108));

    // A second finger outranks the scrub: refusing it here is what used to make zooming
    // impossible for the rest of the touch once the timeline had been dragged.
    zoom.onPointerdown(pointer(2, 340, 108));
    zoom.onPointermove(pointer(2, 340, 108));
    expect(zoom.isPinching.value).toBe(true);

    zoom.onPointermove(pointer(2, 440, 108));
    expect(zoom.scale.value).toBeCloseTo(2, 5);
  });

  it('does not promote a long-press fast-forward into a pinch', () => {
    vi.useFakeTimers();
    let canStartPinch = true;
    const { pointer, zoom } = createHarness({ singlePointerPan: false, canStartPinch: () => canStartPinch });

    zoom.onPointerdown(pointer(1, 100, 100));
    canStartPinch = false;
    zoom.onPointerdown(pointer(2, 200, 100));
    zoom.onPointermove(pointer(2, 300, 100));

    expect(zoom.isPinching.value).toBe(false);
    expect(zoom.scale.value).toBe(1);
    expect(zoom.offset.value).toEqual({ x: 0, y: 0 });
    vi.useRealTimers();
  });

  it('still dismisses on the next vertical gesture after a horizontal scrub gesture', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss, singlePointerPan: false });

    zoom.toggleZoom();
    const initialOffset = { ...zoom.offset.value };

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 260, 110));
    zoom.onPointerup(pointer(1, 260, 110));

    zoom.onPointerdown(pointer(2, 140, 120));
    zoom.onPointermove(pointer(2, 145, 280));
    zoom.onPointerup(pointer(2, 145, 280));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(zoom.offset.value).toEqual(initialOffset);
  });

  it('recovers when the player steals pointer capture during a horizontal scrub', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss, singlePointerPan: false });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 260, 110));
    const releaseEvent = new Event('pointerup');
    Object.defineProperties(releaseEvent, {
      pointerId: { value: 1 },
      clientX: { value: 260 },
      clientY: { value: 110 }
    });
    window.dispatchEvent(releaseEvent);

    zoom.onPointerdown(pointer(2, 140, 120));
    zoom.onPointermove(pointer(2, 145, 280));
    zoom.onPointerup(pointer(2, 145, 280));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('clears a scrub-owned pointer explicitly before the next dismiss or pinch', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss, singlePointerPan: false });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 260, 110));
    zoom.cancelActiveGesture();

    zoom.onPointerdown(pointer(2, 120, 100));
    zoom.onPointerdown(pointer(3, 220, 100));
    zoom.onPointermove(pointer(3, 320, 100));
    expect(zoom.scale.value).toBeCloseTo(2, 5);
    zoom.onPointerup(pointer(2, 120, 100));
    zoom.onPointerup(pointer(3, 320, 100));

    zoom.onPointerdown(pointer(4, 140, 120));
    zoom.onPointermove(pointer(4, 145, 280));
    zoom.onPointerup(pointer(4, 145, 280));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses on a vertical drag while at rest', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 100, 260));
    zoom.onPointerup(pointer(1, 100, 260));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses a completed vertical drag even when the platform cancels the pointer', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 100, 260));
    zoom.onPointercancel(pointer(1, 100, 260));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismisses a single-finger vertical drag without moving a zoomed video canvas', () => {
    const onDismiss = vi.fn();
    const { pointer, zoom } = createHarness({ onDismiss, singlePointerPan: false });

    zoom.toggleZoom();
    expect(zoom.isZoomed.value).toBe(true);
    const initialOffset = { ...zoom.offset.value };

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 140, 300));
    zoom.onPointerup(pointer(1, 140, 300));

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(zoom.offset.value).toEqual(initialOffset);
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

  it('can disable double-tap zoom for surfaces that only use pinch gestures', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T00:00:00Z'));
    const { pointer, zoom } = createHarness({ doubleTapZoom: false });

    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerup(pointer(1, 100, 100));
    vi.advanceTimersByTime(120);
    zoom.onPointerdown(pointer(1, 100, 100));
    zoom.onPointerup(pointer(1, 100, 100));

    expect(zoom.scale.value).toBe(1);
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
