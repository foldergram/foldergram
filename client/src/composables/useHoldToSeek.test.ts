import { describe, expect, it, vi } from 'vitest';

import { useHoldToSeek } from './useHoldToSeek';

interface HarnessOptions {
  duration?: number;
  currentTime?: number;
}

function createHarness(options: HarnessOptions = {}) {
  let currentTime = options.currentTime ?? 30;
  const surface = document.createElement('div');
  surface.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

  const holdSeek = useHoldToSeek({
    getCurrentTime: () => currentTime,
    getDuration: () => options.duration ?? 120,
    seekTo: (seconds) => {
      currentTime = seconds;
    }
  });

  // jsdom has no PointerEvent constructor, so the handlers get the shape they read.
  function press(clientX: number) {
    const event = { clientX, isPrimary: true, pointerId: 1, currentTarget: surface } as unknown as PointerEvent;
    holdSeek.onPointerdown(event);
    return event;
  }

  function release() {
    holdSeek.onPointerup({ pointerId: 1 } as unknown as PointerEvent);
  }

  return {
    holdSeek,
    press,
    release,
    getCurrentTime: () => currentTime
  };
}

describe('useHoldToSeek', () => {
  it('rewinds while held on the left edge and keeps repeating', () => {
    vi.useFakeTimers();
    const harness = createHarness({ currentTime: 30 });

    harness.press(10);
    vi.advanceTimersByTime(320);
    expect(harness.holdSeek.direction.value).toBe('backward');
    expect(harness.getCurrentTime()).toBe(27);

    vi.advanceTimersByTime(220);
    expect(harness.getCurrentTime()).toBe(24);

    harness.release();
    vi.advanceTimersByTime(1000);
    expect(harness.holdSeek.direction.value).toBeNull();
    expect(harness.getCurrentTime()).toBe(24);
    vi.useRealTimers();
  });

  it('fast-forwards on the right edge and stops short of the duration', () => {
    vi.useFakeTimers();
    const harness = createHarness({ currentTime: 119, duration: 120 });

    harness.press(395);
    vi.advanceTimersByTime(320);
    expect(harness.holdSeek.direction.value).toBe('forward');
    expect(harness.getCurrentTime()).toBe(119.75);
    harness.release();
    vi.useRealTimers();
  });

  it('ignores presses in the middle of the surface', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press(200);
    vi.advanceTimersByTime(600);

    expect(harness.holdSeek.direction.value).toBeNull();
    expect(harness.getCurrentTime()).toBe(30);
    expect(harness.holdSeek.shouldSuppressClick()).toBe(false);
    vi.useRealTimers();
  });

  it('swallows the click that ends a hold exactly once', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press(5);
    vi.advanceTimersByTime(320);
    harness.release();

    expect(harness.holdSeek.shouldSuppressClick()).toBe(true);
    expect(harness.holdSeek.shouldSuppressClick()).toBe(false);
    vi.useRealTimers();
  });
});
