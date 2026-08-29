import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useImmersiveMediaOpen } from './useImmersiveMediaOpen';
import { useImmersiveImageStore } from '../stores/immersive-image';
import { useImmersiveVideoStore } from '../stores/immersive-video';
import type { FeedItem } from '../types/api';

function createItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 7,
    folderId: 1,
    folderSlug: 'album',
    folderName: 'Album',
    folderPath: 'album',
    folderBreadcrumb: null,
    filename: 'clip.mp4',
    width: 720,
    height: 1280,
    mediaType: 'video',
    durationMs: 12_400,
    thumbnailUrl: '/thumbnails/clip.webp',
    previewUrl: '/previews/clip.webp',
    sortTimestamp: 1,
    takenAt: null,
    ...overrides
  };
}

describe('useImmersiveMediaOpen', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('opens a video in the immersive player', () => {
    const open = useImmersiveMediaOpen();
    const videoStore = useImmersiveVideoStore();

    expect(open.openInPlace(createItem({ streamUrl: '/api/videos/7/hls/master.m3u8' }))).toBe(true);
    expect(videoStore.isOpen).toBe(true);
    expect(videoStore.target?.id).toBe(7);
  });

  it('opens an image in the zoomable layer', () => {
    const open = useImmersiveMediaOpen();
    const imageStore = useImmersiveImageStore();

    const opened = open.openInPlace(
      createItem({ id: 9, mediaType: 'image', filename: 'shot.jpg', durationMs: null })
    );

    expect(opened).toBe(true);
    expect(imageStore.isOpen).toBe(true);
    expect(imageStore.target?.id).toBe(9);
  });

  it('leaves a carousel to the post route', () => {
    const open = useImmersiveMediaOpen();
    const imageStore = useImmersiveImageStore();
    const videoStore = useImmersiveVideoStore();

    // The immersive layers show a single item, so a carousel still needs its own page.
    expect(open.openInPlace(createItem({ postType: 'carousel' }))).toBe(false);
    expect(imageStore.isOpen).toBe(false);
    expect(videoStore.isOpen).toBe(false);
  });
});
