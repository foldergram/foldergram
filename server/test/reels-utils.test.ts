import { describe, expect, it } from 'vitest';

import {
  buildReelQueue,
  decodeReelCursor,
  encodeReelCursor,
  getReelRandomRank,
  getReelSignalsFingerprint,
  normalizeReelAffinitySignals,
  rankReelCandidates,
  REEL_CURSOR_MAX_LENGTH,
  REEL_MAX_AFFINITY_FOLDERS,
  REEL_MAX_FOLDER_SLUG_LENGTH,
  REEL_RECOMMENDED_WINDOW_SIZE,
  REEL_RECOMMENDED_WINDOW_SLICES,
  type ReelRecommendationCandidate
} from '../src/utils/reels-utils.js';

function createCandidate(
  id: number,
  overrides: Partial<ReelRecommendationCandidate> = {}
): ReelRecommendationCandidate {
  return {
    id,
    folderId: id,
    folderSlug: `folder-${id}`,
    folderName: `Folder ${id}`,
    folderPath: `gallery/folder-${id}`,
    filename: `clip-${id}.mp4`,
    width: 1080,
    height: 1920,
    mediaType: 'video',
    durationMs: 18_000,
    thumbnailUrl: `thumb-${id}.webp`,
    previewUrl: `preview-${id}.webp`,
    sortTimestamp: 1_778_000_000_000 + id * 1_000,
    takenAt: 1_778_000_000_000 + id * 1_000,
    likedAt: null,
    ...overrides
  };
}

describe('reels utils', () => {
  it('keeps ranking stable for the same seed and affinity inputs', () => {
    const candidates = [
      createCandidate(1, { folderSlug: 'alpha' }),
      createCandidate(2, { folderSlug: 'beta', width: 1280, height: 720 }),
      createCandidate(3, { folderSlug: 'gamma', durationMs: 40_000 })
    ];

    const first = rankReelCandidates(candidates, 42, {
      lastOpenedFolderSlug: 'alpha',
      recentOpenedFolderSlugs: ['alpha', 'gamma']
    });
    const second = rankReelCandidates(candidates, 42, {
      lastOpenedFolderSlug: 'alpha',
      recentOpenedFolderSlugs: ['alpha', 'gamma']
    });

    expect(first.map((entry) => entry.candidate.id)).toEqual(second.map((entry) => entry.candidate.id));
  });

  it('allows different seeds to reshuffle otherwise similar top candidates', () => {
    const candidates = [
      createCandidate(1, { takenAt: 1_778_100_000_000, sortTimestamp: 1_778_100_000_000 }),
      createCandidate(2, { takenAt: 1_778_100_000_000, sortTimestamp: 1_778_100_000_000 }),
      createCandidate(3, { takenAt: 1_778_100_000_000, sortTimestamp: 1_778_100_000_000 })
    ];

    const firstSeedOrder = rankReelCandidates(candidates, 11).map((entry) => entry.candidate.id);
    const secondSeedOrder = rankReelCandidates(candidates, 29).map((entry) => entry.candidate.id);

    expect(firstSeedOrder).not.toEqual(secondSeedOrder);
  });

  it('mixes both seed and id so random ordering changes adjacency across seeds', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7];
    const orderForSeed = (seed: number) =>
      [...ids].sort((left, right) => {
        const rankDelta = getReelRandomRank(left, seed) - getReelRandomRank(right, seed);
        return rankDelta !== 0 ? rankDelta : right - left;
      });
    const adjacencyFor = (order: number[]) =>
      order
        .map((id, index) => `${id}:${order[(index + 1) % order.length]}`)
        .sort();
    const firstOrder = orderForSeed(11);
    const secondOrder = orderForSeed(29);

    expect(firstOrder).not.toEqual(secondOrder);
    expect(adjacencyFor(firstOrder)).not.toEqual(adjacencyFor(secondOrder));
  });

  it('boosts liked and recently opened folder candidates when other signals are close', () => {
    const candidates = [
      createCandidate(1, {
        folderSlug: 'liked-folder',
        likedAt: '2026-03-25T00:00:00.000Z',
        takenAt: 1_778_200_000_000,
        sortTimestamp: 1_778_200_000_000
      }),
      createCandidate(2, {
        folderSlug: 'recent-folder',
        takenAt: 1_778_200_000_000,
        sortTimestamp: 1_778_200_000_000
      }),
      createCandidate(3, {
        folderSlug: 'neutral-folder',
        takenAt: 1_778_200_000_000,
        sortTimestamp: 1_778_200_000_000
      })
    ];

    const ranked = rankReelCandidates(candidates, 17, {
      lastOpenedFolderSlug: 'recent-folder'
    });

    expect(ranked[0]?.candidate.folderSlug).toBe('liked-folder');
    expect(ranked[1]?.candidate.folderSlug).toBe('recent-folder');
  });

  it('adds a diversity penalty so consecutive reels do not cluster by folder when alternatives exist', () => {
    const queue = buildReelQueue(
      [
        createCandidate(1, {
          folderSlug: 'alpha',
          likedAt: '2026-03-25T00:00:00.000Z',
          takenAt: 1_778_300_003_000,
          sortTimestamp: 1_778_300_003_000
        }),
        createCandidate(2, {
          folderSlug: 'alpha',
          likedAt: '2026-03-25T00:00:00.000Z',
          takenAt: 1_778_300_002_000,
          sortTimestamp: 1_778_300_002_000
        }),
        createCandidate(3, {
          folderSlug: 'beta',
          takenAt: 1_778_300_001_000,
          sortTimestamp: 1_778_300_001_000,
          width: 1280,
          height: 720
        }),
        createCandidate(4, {
          folderSlug: 'gamma',
          takenAt: 1_778_300_000_000,
          sortTimestamp: 1_778_300_000_000,
          width: 1280,
          height: 720
        })
      ],
      77
    );

    expect(queue[0]?.folderSlug).toBe('alpha');
    expect(queue[1]?.folderSlug).not.toBe('alpha');
  });

  it('keeps the recommended candidate window composed of bounded server-controlled slices', () => {
    const sliceTotal = Object.values(REEL_RECOMMENDED_WINDOW_SLICES).reduce(
      (total, value) => total + value,
      0
    );

    expect(sliceTotal).toBe(REEL_RECOMMENDED_WINDOW_SIZE);
  });

  it('normalizes and limits recent-folder affinity signals', () => {
    const longSlug = 'x'.repeat(REEL_MAX_FOLDER_SLUG_LENGTH + 1);
    const signals = normalizeReelAffinitySignals({
      lastOpenedFolderSlug: '  first  ',
      recentOpenedFolderSlugs: [
        'first',
        '',
        longSlug,
        'second',
        ...Array.from({ length: REEL_MAX_AFFINITY_FOLDERS + 4 }, (_, index) => `folder-${index}`)
      ]
    });

    expect(signals.lastOpenedFolderSlug).toBe('first');
    expect(signals.recentOpenedFolderSlugs).toHaveLength(REEL_MAX_AFFINITY_FOLDERS - 1);
    expect(signals.recentOpenedFolderSlugs).not.toContain(longSlug);
    expect(new Set(signals.recentOpenedFolderSlugs).size).toBe(
      signals.recentOpenedFolderSlugs?.length
    );
  });

  it('changes the affinity fingerprint when folder signals change', () => {
    const first = getReelSignalsFingerprint({ lastOpenedFolderSlug: 'alpha' });
    const repeated = getReelSignalsFingerprint({ lastOpenedFolderSlug: 'alpha' });
    const second = getReelSignalsFingerprint({ lastOpenedFolderSlug: 'beta' });

    expect(first).toBe(repeated);
    expect(first).not.toBe(second);
  });

  it('round-trips opaque cursors and rejects malformed or oversized values', () => {
    const encoded = encodeReelCursor({
      mode: 'recent',
      seed: null,
      signalsHash: '',
      page: 2,
      offset: 6,
      after: { sortTimestamp: 1_778_000_000_000, id: 42 }
    });

    expect(decodeReelCursor(encoded)).toEqual({
      version: 1,
      mode: 'recent',
      seed: null,
      signalsHash: '',
      page: 2,
      offset: 6,
      after: { sortTimestamp: 1_778_000_000_000, id: 42 }
    });

    const negativeTimestampCursor = encodeReelCursor({
      mode: 'recent',
      seed: null,
      signalsHash: '',
      page: 3,
      offset: 12,
      after: { sortTimestamp: -2_000_000_000_000, id: 43 }
    });

    expect(decodeReelCursor(negativeTimestampCursor)).toEqual({
      version: 1,
      mode: 'recent',
      seed: null,
      signalsHash: '',
      page: 3,
      offset: 12,
      after: { sortTimestamp: -2_000_000_000_000, id: 43 }
    });
    expect(decodeReelCursor('not-a-cursor')).toBeNull();
    expect(decodeReelCursor('x'.repeat(REEL_CURSOR_MAX_LENGTH + 1))).toBeNull();
    expect(
      decodeReelCursor(
        Buffer.from(
          JSON.stringify({
            version: 1,
            mode: 'recent',
            seed: null,
            signalsHash: '',
            page: 2,
            offset: 6,
            after: null
          })
        ).toString('base64url')
      )
    ).toBeNull();
    expect(
      decodeReelCursor(
        Buffer.from(
          JSON.stringify({
            version: 1,
            mode: 'random',
            seed: null,
            signalsHash: '',
            page: 2,
            offset: 6,
            after: null
          })
        ).toString('base64url')
      )
    ).toBeNull();
  });
});
