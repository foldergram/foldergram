import { describe, expect, it } from 'vitest';

import { resolveFeedAspectRatio } from '../../client/src/utils/media-layout.js';

describe('feed media layout', () => {
  it('returns an aspect ratio string from valid media dimensions', async () => {
    expect(resolveFeedAspectRatio(1080, 1350)).toBe('1080 / 1350');
    expect(resolveFeedAspectRatio(1920, 1080)).toBe('1920 / 1080');
  });

  it('falls back to square when dimensions are missing or invalid', async () => {
    expect(resolveFeedAspectRatio(0, 1080)).toBe('1 / 1');
    expect(resolveFeedAspectRatio(1080, 0)).toBe('1 / 1');
    expect(resolveFeedAspectRatio(Number.NaN, 1080)).toBe('1 / 1');
  });
});
