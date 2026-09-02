import { describe, expect, it, vi } from 'vitest';

import { useHoldToSpeed } from './useHoldToSpeed';
import { usePinchZoom } from './usePinchZoom';
import { useVerticalDismiss } from './useVerticalDismiss';
import { resolveGesturePoint } from '../utils/gesture-coordinates';

describe('immersive gesture coordination', () => {
  it('releases scrub ownership before the next dismiss and pinch gestures', () => {
    vi.useFakeTimers();
    const surface = document.createElement('div');
    const onDismiss = vi.fn();
    let currentTime = 30;
    let playbackRate = 1;

    const zoom = usePinchZoom({
      singlePointerPan: false,
      onDismiss
    });
    const dismiss = useVerticalDismiss({ onDismiss });
    const hold = useHoldToSpeed({
      getCurrentTime: () => currentTime,
      getDuration: () => 120,
      seekTo: (seconds) => {
        currentTime = seconds;
      },
      getPlaybackRate: () => playbackRate,
      setPlaybackRate: (rate) => {
        playbackRate = rate;
      },
      onGestureStart: () => {
        zoom.suspendSinglePointer();
        dismiss.reset();
      }
    });

    // Only the first finger of a touch session is primary, which is what the browser
    // reports and what the zoom layer uses to spot a stale pointer.
    const pointer = (pointerId: number, clientX: number, clientY: number, isPrimary = true) =>
      ({ pointerId, clientX, clientY, isPrimary, pointerType: 'touch', currentTarget: surface }) as unknown as PointerEvent;

    zoom.onPointerdown(pointer(1, 100, 100));
    dismiss.onPointerdown(pointer(1, 100, 100));
    hold.onPointerdown(pointer(1, 100, 100));
    zoom.onPointermove(pointer(1, 260, 108));
    hold.onPointermove(pointer(1, 260, 108));
    hold.onPointerup(pointer(1, 260, 108));

    zoom.onPointerdown(pointer(2, 140, 120));
    zoom.onPointermove(pointer(2, 145, 280));
    zoom.onPointerup(pointer(2, 145, 280));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    zoom.onPointerdown(pointer(3, 100, 100));
    zoom.onPointerdown(pointer(4, 200, 100, false));
    zoom.onPointermove(pointer(4, 300, 100, false));
    expect(zoom.isPinching.value).toBe(true);
    expect(zoom.scale.value).toBeCloseTo(2, 5);

    zoom.onPointerup(pointer(3, 100, 100));
    zoom.onPointerup(pointer(4, 300, 100, false));
    vi.useRealTimers();
  });

  it('keeps dismiss and pinch alive after the player swallows a scrub release', () => {
    const surface = document.createElement('div');
    const onDismiss = vi.fn();

    const zoom = usePinchZoom({
      singlePointerPan: false,
      onDismiss
    });

    const pointer = (pointerId: number, clientX: number, clientY: number, isPrimary = true) =>
      ({ pointerId, clientX, clientY, isPrimary, pointerType: 'touch', currentTarget: surface }) as unknown as PointerEvent;

    // A sideways drag: the video captures the pointer and its release never reaches the
    // zoom layer, so pointer id 1 stays in the map.
    zoom.onPointerdown(pointer(1, 100, 400));
    zoom.onPointermove(pointer(1, 300, 404));
    zoom.suspendSinglePointer();
    expect(zoom.pointerCount()).toBe(1);

    // The next single finger must be read as a new gesture, not as finger two of a pinch.
    zoom.onPointerdown(pointer(2, 195, 240));
    expect(zoom.pointerCount()).toBe(1);
    expect(zoom.isPinching.value).toBe(false);
    zoom.onPointermove(pointer(2, 195, 640));
    zoom.onPointerup(pointer(2, 195, 640));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    // And a real two-finger pinch still zooms from a correct reference distance.
    zoom.onPointerdown(pointer(3, 150, 420));
    zoom.onPointerdown(pointer(4, 240, 420, false));
    zoom.onPointermove(pointer(4, 330, 420, false));
    expect(zoom.isPinching.value).toBe(true);
    expect(zoom.scale.value).toBeCloseTo(2, 5);
    zoom.onPointerup(pointer(4, 330, 420, false));
    zoom.onPointerup(pointer(3, 150, 420));
  });

  it('reads gestures in the picture frame while the stage is turned', () => {
    const rotated = resolveGesturePoint({ clientX: 40, clientY: 300 }, 'rotated');
    const normal = resolveGesturePoint({ clientX: 40, clientY: 300 });

    expect(normal).toEqual({ x: 40, y: 300 });
    // Turned a quarter, screen-vertical travel becomes the picture's horizontal axis,
    // which is the axis the scrub gesture measures.
    expect(rotated).toEqual({ x: 300, y: -40 });
  });
});
