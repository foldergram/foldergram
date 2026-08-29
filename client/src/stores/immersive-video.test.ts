import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useImmersiveVideoStore, type ImmersiveVideoTarget } from './immersive-video';

function createTarget(id: number): ImmersiveVideoTarget {
  return {
    id,
    filename: `clip-${id}.mp4`,
    thumbnailUrl: `/api/thumbnails/${id}.webp`,
    previewUrl: `/api/previews/${id}.mp4`,
    originalUrl: `/api/originals/${id}`,
    streamUrl: `/api/videos/${id}/hls/master.m3u8`,
    playbackStrategy: 'preview',
    width: 1080,
    height: 1920,
    durationMs: 30_000
  };
}

describe('immersive video store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens with a resume position and reports itself as open', () => {
    const store = useImmersiveVideoStore();

    store.open(createTarget(7), { startTime: 12.5 });

    expect(store.isOpen).toBe(true);
    expect(store.target?.id).toBe(7);
    expect(store.startTime).toBe(12.5);
    expect(store.startPaused).toBe(false);
  });

  it('clamps negative and non-finite resume positions to zero', () => {
    const store = useImmersiveVideoStore();

    store.open(createTarget(8), { startTime: -4 });
    expect(store.startTime).toBe(0);

    store.open(createTarget(8), { startTime: Number.NaN });
    expect(store.startTime).toBe(0);
  });

  it('hands the exit position back only to the surface that owns the clip', () => {
    const store = useImmersiveVideoStore();

    store.open(createTarget(9));
    store.close({ id: 9, currentTime: 42, paused: true });

    expect(store.isOpen).toBe(false);
    expect(store.consumeExitState(10)).toBeNull();

    const exitState = store.consumeExitState(9);
    expect(exitState).toEqual({ id: 9, currentTime: 42, paused: true });
    // Consuming is one-shot so a later remount does not seek again.
    expect(store.consumeExitState(9)).toBeNull();
  });

  it('drops everything on reset', () => {
    const store = useImmersiveVideoStore();

    store.open(createTarget(11), { startTime: 5, startPaused: true });
    store.reset();

    expect(store.isOpen).toBe(false);
    expect(store.startTime).toBe(0);
    expect(store.startPaused).toBe(false);
    expect(store.exitState).toBeNull();
  });
});
