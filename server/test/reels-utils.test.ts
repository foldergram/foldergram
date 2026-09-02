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

  it('returns the same head when the queue is capped as when it is built in full', () => {
    const candidates = Array.from({ length: 60 }, (_, index) =>
      createCandidate(index + 1, {
        folderSlug: index % 3 === 0 ? 'dominant' : `folder-${index % 11}`,
        takenAt: 1_778_300_000_000 + index * 1_000,
        sortTimestamp: 1_778_300_000_000 + index * 1_000
      })
    );

    const full = buildReelQueue(candidates, 4_242);
    const capped = buildReelQueue(candidates, 4_242, {}, 12);

    expect(capped).toHaveLength(12);
    expect(capped.map((candidate) => candidate.id)).toEqual(full.slice(0, 12).map((candidate) => candidate.id));
  });

  it('builds a page of reels for a large library without walking the whole queue', () => {
    const candidates = Array.from({ length: 4_000 }, (_, index) =>
      createCandidate(index + 1, {
        // Half the library in one folder is what makes the diversity pass expensive.
        folderSlug: index % 2 === 0 ? 'dominant' : `folder-${index % 400}`,
        takenAt: 1_778_300_000_000 + index * 1_000,
        sortTimestamp: 1_778_300_000_000 + index * 1_000
      })
    );

    const startedAt = Date.now();
    const page = buildReelQueue(candidates, 9_001, {}, 6);

    expect(page).toHaveLength(6);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
