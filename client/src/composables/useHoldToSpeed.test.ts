import { describe, expect, it, vi } from 'vitest';

import { useHoldToSpeed } from './useHoldToSpeed';

function createHarness(options: { currentTime?: number; duration?: number } = {}) {
  let currentTime = options.currentTime ?? 30;
  let playbackRate = 1;
  let playCalls = 0;
  let rateWrites: number[] | null = null;
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
      rateWrites?.push(rate);
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

  function setPlaybackRate(rate: number) {
    playbackRate = rate;
  }

  function recordRateWrites(sink: number[]) {
    rateWrites = sink;
  }

  return {
    hold,
    press,
    move,
    release,
    setPlaybackRate,
    recordRateWrites,
    surface,
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

  it('does not let a stuck rate become the baseline across two holds', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press();
    vi.advanceTimersByTime(300);
    expect(harness.getPlaybackRate()).toBe(2);

    // Simulate the release being lost, so the element is still parked at 2x.
    harness.hold.isFastForwarding.value = false;

    harness.press();
    vi.advanceTimersByTime(300);
    expect(harness.getPlaybackRate()).toBe(2);

    harness.release();
    // Sampling the current rate on activation used to make 2x the new "normal".
    expect(harness.getPlaybackRate()).toBe(1);
    vi.useRealTimers();
  });

  it('restores the baseline from a window pointerup when the surface never sees it', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press();
    vi.advanceTimersByTime(300);
    expect(harness.getPlaybackRate()).toBe(2);

    // The captured element left the DOM mid-hold, so only the window hears the release.
    const event = new Event('pointerup');
    Object.defineProperty(event, 'pointerId', { value: 1 });
    window.dispatchEvent(event);

    expect(harness.hold.isFastForwarding.value).toBe(false);
    expect(harness.getPlaybackRate()).toBe(1);
    vi.useRealTimers();
  });

  it('writes the baseline back even when stop runs with no hold flagged', () => {
    const harness = createHarness();

    harness.setPlaybackRate(2);
    harness.hold.stop();

    expect(harness.getPlaybackRate()).toBe(1);
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

  it('hands a slow horizontal drag to the scrub instead of fast playback', () => {
    vi.useFakeTimers();
    const harness = createHarness({ currentTime: 30 });

    harness.press(200);
    // The finger moved sideways before the hold timer was due, so the timer must be
    // dropped: it used to fire mid-drag and leave the clip at 2x for the whole scrub.
    harness.move(216);
    vi.advanceTimersByTime(600);

    expect(harness.hold.isFastForwarding.value).toBe(false);
    expect(harness.getPlaybackRate()).toBe(1);
    expect(harness.hold.isScrubbing.value).toBe(true);

    harness.release(216);
    expect(harness.getPlaybackRate()).toBe(1);
    expect(harness.getCurrentTime()).toBeCloseTo(31.92, 5);
    vi.useRealTimers();
  });

  it('drops back to normal speed when a hold turns into a scrub', () => {
    vi.useFakeTimers();
    const harness = createHarness({ currentTime: 30 });

    harness.press(200);
    vi.advanceTimersByTime(300);
    expect(harness.getPlaybackRate()).toBe(2);

    // Sliding after the hold fired used to be ignored, so the clip stayed at 2x until
    // the finger lifted and the seek never happened.
    harness.move(280);
    expect(harness.hold.isFastForwarding.value).toBe(false);
    expect(harness.getPlaybackRate()).toBe(1);
    expect(harness.hold.isScrubbing.value).toBe(true);

    harness.release(280);
    expect(harness.getPlaybackRate()).toBe(1);
    expect(harness.getCurrentTime()).toBeCloseTo(39.6, 5);
    vi.useRealTimers();
  });

  it('rewrites the baseline even when the player misreports its rate', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press();
    vi.advanceTimersByTime(300);
    // vidstack answers with its own pending state, so a player really still at 2x can
    // report 1 here. Trusting that report used to leave it fast forever.
    harness.setPlaybackRate(1);
    const writes: number[] = [];
    harness.recordRateWrites(writes);

    harness.release();
    expect(writes).toEqual([1]);
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

  it('drops a pending activation once the finger swipes vertically', () => {
    vi.useFakeTimers();
    const harness = createHarness();

    harness.press(200, 150);
    harness.move(202, 190);
    vi.advanceTimersByTime(600);

    // A slow reels swipe must not turn into fast playback partway through.
    expect(harness.hold.isFastForwarding.value).toBe(false);
    expect(harness.getPlaybackRate()).toBe(1);
    vi.useRealTimers();
  });
});
