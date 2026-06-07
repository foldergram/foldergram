import { describe, expect, it } from 'vitest';

import { getActiveReelId, resolveReelsAffinitySnapshot, shouldPrefetchReels } from '../../client/src/utils/reels.js';

describe('reel deck utils', () => {
  it('selects the panel whose center is closest to the viewport center', async () => {
    expect(
      getActiveReelId(
        [
          { id: 11, offsetTop: 0, offsetHeight: 600 },
          { id: 22, offsetTop: 600, offsetHeight: 600 },
          { id: 33, offsetTop: 1200, offsetHeight: 600 }
        ],
        620,
        600
      )
    ).toBe(22);
  });

  it('returns null when there are no visible panels', async () => {
    expect(getActiveReelId([], 0, 600)).toBeNull();
  });

  it('requests a prefetch near the end of the queue only', async () => {
    expect(shouldPrefetchReels(0, 6)).toBe(false);
    expect(shouldPrefetchReels(3, 6)).toBe(true);
    expect(shouldPrefetchReels(4, 6)).toBe(true);
  });

  it('freezes the first affinity snapshot for later pages in the same session', async () => {
    const firstSnapshot = resolveReelsAffinitySnapshot(null, 'alpha', ['alpha', 'beta', 'beta']);
    const secondSnapshot = resolveReelsAffinitySnapshot(firstSnapshot, 'gamma', ['gamma', 'delta']);

    expect(firstSnapshot).toBe(secondSnapshot);
    expect(secondSnapshot).toEqual({
      lastFolder: 'alpha',
      recentFolders: ['alpha', 'beta']
    });
  });
});
