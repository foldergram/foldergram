import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import { useSharedVideoSurfaceStore } from './shared-video-surface';

describe('shared video surface', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('claims and attaches the same registered player without changing ownership', () => {
    const store = useSharedVideoSurfaceStore();
    const player = {} as any;
    const slot = document.createElement('div');

    store.register('feed:42', player);
    expect(store.claim('feed:42')).toBe(true);
    expect(store.getPlayer('feed:42')).toBe(player);
    expect(store.attach(slot)).toBe(true);
    expect(store.ownerId).toBe('feed:42');
    expect(store.target).toBe(slot);
    expect(store.isAttached).toBe(true);

    store.release();
    expect(store.ownerId).toBeNull();
    expect(store.target).toBeNull();
    expect(store.isAttached).toBe(false);
  });

  it('does not claim an unregistered player', () => {
    const store = useSharedVideoSurfaceStore();
    expect(store.claim('missing')).toBe(false);
    expect(store.attach(document.createElement('div'))).toBe(false);
  });
});
