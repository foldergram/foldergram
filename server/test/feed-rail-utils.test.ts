import { describe, expect, it } from 'vitest';

import { shouldPreferMomentRail } from '../src/utils/feed-rail-utils.js';

describe('feed rail selection', () => {
  it('keeps the Moments rail for libraries with meaningful EXIF coverage', async () => {
    expect(shouldPreferMomentRail(120, 72)).toBe(true);
    expect(shouldPreferMomentRail(40, 18)).toBe(true);
  });

  it('falls back to Highlights when EXIF coverage is too small or too sparse', async () => {
    expect(shouldPreferMomentRail(20, 20)).toBe(false);
    expect(shouldPreferMomentRail(120, 12)).toBe(false);
    expect(shouldPreferMomentRail(120, 30)).toBe(false);
  });
});
