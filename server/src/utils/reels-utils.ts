import type { FeedImage, ReelsFeedMode } from '../types/models.js';

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

export interface ReelCursorAnchor {
  sortTimestamp: number;
  id: number;
}

export interface ReelCursorPayload {
  version: typeof REEL_CURSOR_VERSION;
  mode: ReelsFeedMode;
  seed: number | null;
  signalsHash: string;
  page: number;
  offset: number;
  after: ReelCursorAnchor | null;
}

export const REEL_RECOMMENDATION_WEIGHTS = {
  freshness: 0.35,
  liked: 0.2,
  folderAffinity: 0.15,
  portraitFit: 0.15,
  durationFit: 0.1,
  seededJitter: 0.05
} as const;

export const REEL_RECOMMENDED_WINDOW_SIZE = 512;
export const REEL_RECOMMENDED_WINDOW_SLICES = {
  recent: 192,
  affinity: 128,
  liked: 64,
  discovery: 128
} as const;
export const REEL_MAX_AFFINITY_FOLDERS = 8;
export const REEL_MAX_FOLDER_SLUG_LENGTH = 240;
export const REEL_CURSOR_VERSION = 1;
export const REEL_CURSOR_MAX_LENGTH = 1024;

const REEL_CURSOR_MAX_OFFSET = 10_000_000;
const REEL_CURSOR_MAX_SEED = 0xffffffff;
const REEL_CURSOR_MAX_ABSOLUTE_TIMESTAMP = 8_640_000_000_000_000;
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

export function normalizeReelAffinitySignals(signals: ReelAffinitySignals = {}): ReelAffinitySignals {
  const orderedSlugs: string[] = [];
  const seenSlugs = new Set<string>();

  for (const slug of [signals.lastOpenedFolderSlug ?? null, ...(signals.recentOpenedFolderSlugs ?? [])]) {
    if (typeof slug !== 'string') {
      continue;
    }

    const normalizedSlug = slug.trim();
    if (
      normalizedSlug.length === 0 ||
      normalizedSlug.length > REEL_MAX_FOLDER_SLUG_LENGTH ||
      seenSlugs.has(normalizedSlug)
    ) {
      continue;
    }

    seenSlugs.add(normalizedSlug);
    orderedSlugs.push(normalizedSlug);

    if (orderedSlugs.length >= REEL_MAX_AFFINITY_FOLDERS) {
      break;
    }
  }

  return {
    lastOpenedFolderSlug: orderedSlugs[0] ?? null,
    recentOpenedFolderSlugs: orderedSlugs.slice(1)
  };
}

function getFolderAffinityLookup(signals: ReelAffinitySignals): Map<string, number> {
  const normalized = normalizeReelAffinitySignals(signals);
  const orderedSlugs = [
    normalized.lastOpenedFolderSlug ?? null,
    ...(normalized.recentOpenedFolderSlugs ?? [])
  ].filter((slug): slug is string => typeof slug === 'string' && slug.length > 0);

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

export function getReelRandomRank(id: number, seed: number): number {
  let hash = (normalizeSeed(seed) ^ (Math.abs(Math.trunc(id)) >>> 0)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function getReelSignalsFingerprint(signals: ReelAffinitySignals = {}): string {
  const normalized = normalizeReelAffinitySignals(signals);
  const serialized = [
    normalized.lastOpenedFolderSlug ?? '',
    ...(normalized.recentOpenedFolderSlugs ?? [])
  ].join('\u0000');
  let hash = 0x811c9dc5;

  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function encodeReelCursor(payload: Omit<ReelCursorPayload, 'version'>): string {
  return Buffer.from(
    JSON.stringify({
      version: REEL_CURSOR_VERSION,
      ...payload
    }),
    'utf8'
  ).toString('base64url');
}

export function decodeReelCursor(value: string): ReelCursorPayload | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > REEL_CURSOR_MAX_LENGTH) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (!isRecord(parsed) || parsed.version !== REEL_CURSOR_VERSION) {
    return null;
  }

  if (parsed.mode !== 'recommended' && parsed.mode !== 'recent' && parsed.mode !== 'random') {
    return null;
  }

  const seed = parsed.seed;
  if (
    seed !== null &&
    (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > REEL_CURSOR_MAX_SEED)
  ) {
    return null;
  }

  if (parsed.mode !== 'recent' && seed === null) {
    return null;
  }

  if (typeof parsed.signalsHash !== 'string' || parsed.signalsHash.length > 64) {
    return null;
  }

  const page = parsed.page;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 1) {
    return null;
  }

  const offset = parsed.offset;
  if (
    typeof offset !== 'number' ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > REEL_CURSOR_MAX_OFFSET
  ) {
    return null;
  }

  let after: ReelCursorAnchor | null = null;
  if (parsed.mode === 'recent') {
    if (!isRecord(parsed.after)) {
      return null;
    }

    const sortTimestamp = parsed.after.sortTimestamp;
    const id = parsed.after.id;
    if (
      typeof sortTimestamp !== 'number' ||
      !Number.isSafeInteger(sortTimestamp) ||
      Math.abs(sortTimestamp) > REEL_CURSOR_MAX_ABSOLUTE_TIMESTAMP ||
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      id < 1
    ) {
      return null;
    }

    after = {
      sortTimestamp,
      id
    };
  } else if (parsed.after !== null) {
    return null;
  }

  return {
    version: REEL_CURSOR_VERSION,
    mode: parsed.mode,
    seed,
    signalsHash: parsed.signalsHash,
    page,
    offset,
    after
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function buildReelQueue(
  candidates: ReelRecommendationCandidate[],
  seed: number,
  signals: ReelAffinitySignals = {}
): ReelRecommendationCandidate[] {
  const rankedCandidates = rankReelCandidates(candidates, seed, signals);
  const remaining = [...rankedCandidates];
  const queue: ReelRecommendationCandidate[] = [];
  const folderCounts = new Map<string, number>();

  while (remaining.length > 0) {
    const previousFolderSlug = queue.at(-1)?.folderSlug ?? null;
    const secondaryPreviousFolderSlug = queue.at(-2)?.folderSlug ?? null;
    let bestIndex = 0;
    let bestAdjustedScore = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < remaining.length; index += 1) {
      const entry = remaining[index];
      if (!entry) {
        continue;
      }

      let adjustedScore = entry.score;
      const hasAlternativeFolder = remaining.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && candidate.candidate.folderSlug !== entry.candidate.folderSlug
      );

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
  }

  return queue;
}
