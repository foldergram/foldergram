import { describe, expect, it } from 'vitest';

import {
  buildReelQueue,
  rankReelCandidates,
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
  it('keeps ranking stable for the same seed and affinity inputs', async () => {
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

  it('allows different seeds to reshuffle otherwise similar top candidates', async () => {
    const candidates = [
      createCandidate(1, { takenAt: 1_778_100_000_000, sortTimestamp: 1_778_100_000_000 }),
      createCandidate(2, { takenAt: 1_778_100_000_000, sortTimestamp: 1_778_100_000_000 }),
      createCandidate(3, { takenAt: 1_778_100_000_000, sortTimestamp: 1_778_100_000_000 })
    ];

    const firstSeedOrder = rankReelCandidates(candidates, 11).map((entry) => entry.candidate.id);
    const secondSeedOrder = rankReelCandidates(candidates, 29).map((entry) => entry.candidate.id);

    expect(firstSeedOrder).not.toEqual(secondSeedOrder);
  });

  it('boosts liked and recently opened folder candidates when other signals are close', async () => {
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

  it('adds a diversity penalty so consecutive reels do not cluster by folder when alternatives exist', async () => {
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
});
