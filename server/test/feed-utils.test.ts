import { describe, expect, it } from 'vitest';

import { countFeedBursts, diversifyFeedCandidates, listMonthDayKeysAroundDate } from '../src/utils/feed-utils.js';

describe('feed diversification', () => {
  it('spreads bursty runs from the same folder across the feed', async () => {
    const items = [
      { id: 1, folderId: 10, sortTimestamp: 600_000, takenAt: 600_000 },
      { id: 2, folderId: 10, sortTimestamp: 590_000, takenAt: 590_000 },
      { id: 3, folderId: 10, sortTimestamp: 580_000, takenAt: 580_000 },
      { id: 4, folderId: 10, sortTimestamp: 570_000, takenAt: 570_000 },
      { id: 5, folderId: 20, sortTimestamp: 560_000, takenAt: 560_000 },
      { id: 6, folderId: 30, sortTimestamp: 550_000, takenAt: 550_000 }
    ];

    expect(diversifyFeedCandidates(items).map((item) => item.id)).toEqual([1, 5, 6, 2, 3, 4]);
  });

  it('treats large time gaps in one folder as separate bursts', async () => {
    const items = [
      { id: 1, folderId: 10, sortTimestamp: 3_000_000, takenAt: 3_000_000 },
      { id: 2, folderId: 10, sortTimestamp: 2_400_000, takenAt: 2_400_000 },
      { id: 3, folderId: 10, sortTimestamp: 900_000, takenAt: 900_000 },
      { id: 4, folderId: 10, sortTimestamp: 840_000, takenAt: 840_000 },
      { id: 5, folderId: 20, sortTimestamp: 780_000, takenAt: 780_000 }
    ];

    expect(countFeedBursts(items)).toBe(3);
    expect(diversifyFeedCandidates(items).map((item) => item.id)).toEqual([1, 3, 5, 2, 4]);
  });
});

describe('moment date helpers', () => {
  it('builds week keys across calendar boundaries', async () => {
    expect(listMonthDayKeysAroundDate(new Date('2026-01-01T12:00:00.000Z'), 3, 3)).toEqual([
      '12-29',
      '12-30',
      '12-31',
      '01-01',
      '01-02',
      '01-03',
      '01-04'
    ]);
  });
});
