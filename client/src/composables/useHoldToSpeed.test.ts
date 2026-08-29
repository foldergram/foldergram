import { describe, expect, it, vi } from 'vitest';

import { useHoldToSpeed } from './useHoldToSpeed';

function createHarness(options: { currentTime?: number; duration?: number } = {}) {
  let currentTime = options.currentTime ?? 30;
  let playbackRate = 1;
  let playCalls = 0;
  const surface = document.createElement('div');

  const hold = useHoldToSpeed({
    getCurrentTime: () => currentTime,
    getDuration: () => options.duration ?? 120,
    seekTo: (seconds) => {
      currentTime = seconds;
    },
    getPlaybackRate: () => playbackRate,
    setPlaybackRate: (rate) => {
      playbackRate = rate;
    },
    play: () => {
      playCalls += 1;
    }
  });

  // jsdom has no PointerEvent constructor, so the handlers get the shape they read.
  function press(clientX = 200, clientY = 150) {
    hold.onPointerdown({ clientX, clientY, isPrimary: true, pointerId: 1, currentTarget: surface } as unknown as PointerEvent);
  }

  function move(clientX: number, clientY = 150) {
    hold.onPointermove({ clientX, clientY, pointerId: 1 } as unknown as PointerEvent);
  }

  function release(clientX = 200, clientY = 150) {
    hold.onPointerup({ clientX, clientY, pointerId: 1 } as unknown as PointerEvent);
  }

  return {
    hold,
    press,
    move,
    release,
    getCurrentTime: () => currentTime,
    getPlaybackRate: () => playbackRate,
    getPlayCalls: () => playCalls
  };
}

describe('useHoldToSpeed', () => {
  it('speeds playback up while held anywhere and restores the rate on release', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press();
    expect(harness.getPlaybackRate()).toBe(1);

    vi.advanceTimersByTime(300);
    expect(harness.hold.isFastForwarding.value).toBe(true);
    expect(harness.getPlaybackRate()).toBe(2);

    harness.release();
    expect(harness.hold.isFastForwarding.value).toBe(false);
    expect(harness.getPlaybackRate()).toBe(1);
    // Never leave the clip parked: releasing resumes normal-speed playback.
    expect(harness.getPlayCalls()).toBeGreaterThanOrEqual(2);
    vi.useRealTimers();
  });

  it('leaves a short tap alone so it still counts as a click', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press();
    vi.advanceTimersByTime(120);
    harness.release();

    expect(harness.hold.isFastForwarding.value).toBe(false);
    expect(harness.getPlaybackRate()).toBe(1);
    expect(harness.hold.shouldSuppressClick()).toBe(false);
    vi.useRealTimers();
  });

  it('scrubs on a horizontal drag and commits the seek when the finger lifts', () => {
    vi.useFakeTimers();
    const harness = createHarness({ currentTime: 30 });

    harness.press(200);
    harness.move(300);

    expect(harness.hold.isScrubbing.value).toBe(true);
    expect(harness.hold.scrubSeconds.value).toBeCloseTo(42, 5);
    // Not committed until release, so the preview can be shown first.
    expect(harness.getCurrentTime()).toBe(30);

    harness.release(300);
    expect(harness.getCurrentTime()).toBeCloseTo(42, 5);
    expect(harness.hold.isScrubbing.value).toBe(false);
    expect(harness.hold.shouldSuppressClick()).toBe(true);
    vi.useRealTimers();
  });

  it('clamps a scrub inside the clip duration', () => {
    vi.useFakeTimers();
    const harness = createHarness({ currentTime: 110, duration: 120 });

    harness.press(200);
    harness.move(600);
    harness.release(600);

    expect(harness.getCurrentTime()).toBe(119.75);
    vi.useRealTimers();
  });

  it('ignores a vertical drag so the host keeps its own gesture', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press(200, 150);
    harness.move(206, 260);

    expect(harness.hold.isScrubbing.value).toBe(false);
    harness.release(206, 260);
    expect(harness.getCurrentTime()).toBe(30);
    vi.useRealTimers();
  });
});
