import type { FeedImage } from '../types/models.js';

export interface ReelRecommendationCandidate extends FeedImage {
  likedAt: string | null;
}

export interface ReelAffinitySignals {
  lastOpenedFolderSlug?: string | null;
  recentOpenedFolderSlugs?: string[];
}

export interface RankedReelCandidate {
  candidate: ReelRecommendationCandidate;
  score: number;
}

export const REEL_RECOMMENDATION_WEIGHTS = {
  freshness: 0.35,
  liked: 0.2,
  folderAffinity: 0.15,
  portraitFit: 0.15,
  durationFit: 0.1,
  seededJitter: 0.05
} as const;

const PRIMARY_REPEAT_FOLDER_PENALTY = 0.5;
const SECONDARY_REPEAT_FOLDER_PENALTY = 0.15;
const FOLDER_REPEAT_COUNT_PENALTY = 0.03;
const TARGET_REEL_ASPECT_RATIO = 9 / 16;

interface ReelScoreContext {
  maximumTimestamp: number;
  minimumTimestamp: number;
  folderAffinityLookup: Map<string, number>;
  seed: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSeed(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 0;
  }

  return Math.abs(Math.trunc(seed)) >>> 0;
}

function createSeededUnit(seed: number, value: number): number {
  let hash = normalizeSeed(seed) ^ (Math.abs(Math.trunc(value)) >>> 0) ^ 0x9e3779b9;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return hash / 0xffffffff;
}

function getEffectiveTimestamp(candidate: ReelRecommendationCandidate): number {
  return candidate.takenAt ?? candidate.sortTimestamp;
}

function getFreshnessScore(candidate: ReelRecommendationCandidate, minimumTimestamp: number, maximumTimestamp: number): number {
  if (maximumTimestamp <= minimumTimestamp) {
    return 0.5;
  }

  return (getEffectiveTimestamp(candidate) - minimumTimestamp) / (maximumTimestamp - minimumTimestamp);
}

function getFolderAffinityLookup(signals: ReelAffinitySignals): Map<string, number> {
  const orderedSlugs: string[] = [];
  const seenSlugs = new Set<string>();

  for (const slug of [signals.lastOpenedFolderSlug ?? null, ...(signals.recentOpenedFolderSlugs ?? [])]) {
    if (!slug) {
      continue;
    }

    const normalizedSlug = slug.trim();
    if (normalizedSlug.length === 0 || seenSlugs.has(normalizedSlug)) {
      continue;
    }

    seenSlugs.add(normalizedSlug);
    orderedSlugs.push(normalizedSlug);
  }

  return new Map(
    orderedSlugs.map((slug, index) => [slug, clamp(1 - index * 0.16, 0.24, 1)])
  );
}

function getAspectRatioScore(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 0;
  }

  const aspectRatio = width / height;
  const distanceFromTarget = Math.abs(aspectRatio - TARGET_REEL_ASPECT_RATIO);
  return clamp(1 - distanceFromTarget / 1.05, 0, 1);
}

function getDurationScore(durationMs: number | null): number {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs <= 0) {
    return 0.35;
  }

  const durationSeconds = durationMs / 1000;

  if (durationSeconds <= 10) {
    return 0.82 + (durationSeconds / 10) * 0.18;
  }

  if (durationSeconds <= 30) {
    return 1;
  }

  if (durationSeconds <= 60) {
    return 1 - ((durationSeconds - 30) / 30) * 0.28;
  }

  if (durationSeconds <= 120) {
    return 0.72 - ((durationSeconds - 60) / 60) * 0.52;
  }

  return 0.2;
}

export function scoreReelCandidate(
  candidate: ReelRecommendationCandidate,
  seed: number,
  signals: ReelAffinitySignals,
  candidates: ReelRecommendationCandidate[]
): number {
  const context = createReelScoreContext(candidates, seed, signals);
  return scoreReelCandidateWithContext(candidate, context);
}

function createReelScoreContext(
  candidates: ReelRecommendationCandidate[],
  seed: number,
  signals: ReelAffinitySignals
): ReelScoreContext {
  const effectiveTimestamps = candidates.map(getEffectiveTimestamp);

  return {
    minimumTimestamp: Math.min(...effectiveTimestamps),
    maximumTimestamp: Math.max(...effectiveTimestamps),
    folderAffinityLookup: getFolderAffinityLookup(signals),
    seed
  };
}

function scoreReelCandidateWithContext(candidate: ReelRecommendationCandidate, context: ReelScoreContext): number {
  const freshnessScore = getFreshnessScore(candidate, context.minimumTimestamp, context.maximumTimestamp);
  const likedScore = candidate.likedAt ? 1 : 0;
  const folderAffinityScore = context.folderAffinityLookup.get(candidate.folderSlug) ?? 0;
  const portraitFitScore = getAspectRatioScore(candidate.width, candidate.height);
  const durationFitScore = getDurationScore(candidate.durationMs);
  const seededJitterScore = createSeededUnit(context.seed, candidate.id);

  return (
    freshnessScore * REEL_RECOMMENDATION_WEIGHTS.freshness +
    likedScore * REEL_RECOMMENDATION_WEIGHTS.liked +
    folderAffinityScore * REEL_RECOMMENDATION_WEIGHTS.folderAffinity +
    portraitFitScore * REEL_RECOMMENDATION_WEIGHTS.portraitFit +
    durationFitScore * REEL_RECOMMENDATION_WEIGHTS.durationFit +
    seededJitterScore * REEL_RECOMMENDATION_WEIGHTS.seededJitter
  );
}

export function rankReelCandidates(
  candidates: ReelRecommendationCandidate[],
  seed: number,
  signals: ReelAffinitySignals = {}
): RankedReelCandidate[] {
  const context = createReelScoreContext(candidates, seed, signals);

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreReelCandidateWithContext(candidate, context)
    }))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return right.candidate.id - left.candidate.id;
    });
}

export function shuffleReelCandidates(
  candidates: ReelRecommendationCandidate[],
  seed: number
): ReelRecommendationCandidate[] {
  return [...candidates].sort((left, right) => {
    const leftRank = createSeededUnit(seed, left.id);
    const rightRank = createSeededUnit(seed, right.id);

    if (rightRank !== leftRank) {
      return rightRank - leftRank;
    }

    return right.id - left.id;
  });
}

/**
 * Interleaves the ranked candidates so consecutive reels come from different
 * folders. `limit` caps how many picks are produced: the greedy walk is
 * sequential, so asking for one page worth of reels avoids paying for the whole
 * library on every request.
 */
export function buildReelQueue(
  candidates: ReelRecommendationCandidate[],
  seed: number,
  signals: ReelAffinitySignals = {},
  limit = Number.POSITIVE_INFINITY
): ReelRecommendationCandidate[] {
  const rankedCandidates = rankReelCandidates(candidates, seed, signals);
  const remaining = [...rankedCandidates];
  const queue: ReelRecommendationCandidate[] = [];
  const folderCounts = new Map<string, number>();

  // Tracks how many unplaced candidates each folder still has. Deriving
  // "is another folder available" from these counters keeps the interleave
  // linear per pick; scanning the remaining list for it made the whole queue
  // quadratic on the number of candidates, which stalled the event loop for
  // minutes on libraries with thousands of clips.
  const remainingFolderCounts = new Map<string, number>();
  for (const entry of remaining) {
    remainingFolderCounts.set(entry.candidate.folderSlug, (remainingFolderCounts.get(entry.candidate.folderSlug) ?? 0) + 1);
  }

  const maximumPicks = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : Number.POSITIVE_INFINITY;

  while (remaining.length > 0 && queue.length < maximumPicks) {
    const previousFolderSlug = queue.at(-1)?.folderSlug ?? null;
    const secondaryPreviousFolderSlug = queue.at(-2)?.folderSlug ?? null;
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      if (!entry) {
        continue;
      }

      // `remaining` stays sorted by descending raw score and every penalty only
      // lowers it, so once the raw score drops to the best adjusted score found
      // so far nothing further down the list can win.
      if (entry.score <= bestAdjustedScore) {
        break;
      }

      let adjustedScore = entry.score;
      const hasAlternativeFolder =
        remaining.length - (remainingFolderCounts.get(entry.candidate.folderSlug) ?? 0) > 0;

      if (hasAlternativeFolder && previousFolderSlug && entry.candidate.folderSlug === previousFolderSlug) {
        adjustedScore -= PRIMARY_REPEAT_FOLDER_PENALTY;
      }

      if (hasAlternativeFolder && secondaryPreviousFolderSlug && entry.candidate.folderSlug === secondaryPreviousFolderSlug) {
        adjustedScore -= SECONDARY_REPEAT_FOLDER_PENALTY;
      }

      adjustedScore -= (folderCounts.get(entry.candidate.folderSlug) ?? 0) * FOLDER_REPEAT_COUNT_PENALTY;

      if (adjustedScore > bestAdjustedScore) {
        bestAdjustedScore = adjustedScore;
        bestIndex = index;
      }
    }

    const [nextEntry] = remaining.splice(bestIndex, 1);
    if (!nextEntry) {
      break;
    }

    queue.push(nextEntry.candidate);
    folderCounts.set(nextEntry.candidate.folderSlug, (folderCounts.get(nextEntry.candidate.folderSlug) ?? 0) + 1);
    const stillRemaining = (remainingFolderCounts.get(nextEntry.candidate.folderSlug) ?? 1) - 1;
    if (stillRemaining > 0) {
      remainingFolderCounts.set(nextEntry.candidate.folderSlug, stillRemaining);
    } else {
      remainingFolderCounts.delete(nextEntry.candidate.folderSlug);
    }
  }

  return queue;
}
