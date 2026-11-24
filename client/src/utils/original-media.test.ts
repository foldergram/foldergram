import { describe, expect, it } from 'vitest';

import { getImageViewingFallback, isHeicMedia, needsWebpViewing } from './original-media';

describe('original media helpers', () => {
  it('treats HEIC content behind a JPEG extension like a HEIC file', () => {
    expect(isHeicMedia({ filename: 'IMG_0001.HEIC' })).toBe(true);
    expect(isHeicMedia({ filename: 'IMG_0001.HEIC.jpeg', mimeType: 'image/heic' })).toBe(true);
    expect(isHeicMedia({ filename: 'IMG_0002.HEIC.jpeg', mimeType: 'image/jpeg' })).toBe(false);
    expect(isHeicMedia({ filename: 'photo.jpg' })).toBe(false);
  });

  it('falls back to the WebP thumbnail for local HEIC content only', () => {
    const media = {
      filename: 'IMG_0001.HEIC.jpeg',
      mimeType: 'image/heic',
      previewUrl: '/previews/ab/cd.webp',
      thumbnailUrl: '/thumbnails/ab/cd.webp',
      originalUrl: '/api/originals/1'
    };
    expect(needsWebpViewing(media)).toBe(true);
    expect(getImageViewingFallback(media)).toBe(media.thumbnailUrl);
    expect(needsWebpViewing({ ...media, previewUrl: '/api/remote-media/1/preview' })).toBe(false);
    expect(getImageViewingFallback({ ...media, mimeType: 'image/jpeg' })).toBe(media.originalUrl);
  });
});
