import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useImmersiveImageStore } from './immersive-image';

describe('immersive image store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('tracks the open target and clears it on close', () => {
    const store = useImmersiveImageStore();
    expect(store.isOpen).toBe(false);

    store.open({
      id: 5,
      filename: 'photo.jpg',
      thumbnailUrl: '/api/thumbnails/5.webp',
      fullUrl: '/api/originals/5',
      width: 4000,
      height: 3000,
      caption: 'A caption'
    });

    expect(store.isOpen).toBe(true);
    expect(store.target?.fullUrl).toBe('/api/originals/5');

    store.close();
    expect(store.isOpen).toBe(false);
    expect(store.target).toBeNull();
  });
});
