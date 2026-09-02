import type { FeedItem, FolderSummary } from '../types/api';

const DAILY_RECOMMENDATION_COUNT = 5;
const RANKED_POOL_SIZE = 12;
const RECENT_ACTIVITY_WINDOW_MS = 1000 * 60 * 60 * 24 * 45;

interface RankedFolder {
  folder: FolderSummary;
  score: number;
  likedImageCount: number;
}

export interface HomeRecommendations {
  homeSummaryFolder: FolderSummary | null;
  recommendedFolders: FolderSummary[];
}

export function buildLikedCountByFolder(items: FeedItem[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const item of items) {
    counts.set(item.folderSlug, (counts.get(item.folderSlug) ?? 0) + 1);
  }

  return counts;
}

export function selectHomeRecommendations(
  folders: FolderSummary[],
  likedCountByFolder: Map<string, number>,
  lastOpenedFolderSlug: string | null,
  now = new Date()
): HomeRecommendations {
  if (folders.length === 0) {
    return {
      homeSummaryFolder: null,
      recommendedFolders: []
    };
  }

  const homeSummaryFolder =
    (lastOpenedFolderSlug ? folders.find((folder) => folder.slug === lastOpenedFolderSlug) ?? null : null) ??
    getFallbackTopFolder(folders, likedCountByFolder);

  // Scores are graded against the start of the local day so the ranking, and the
  // daily suggestion list built from it, stay identical for every visit that day.
  const scoringNowMs = getLocalDayStart(now).getTime();
  const rankedCandidates = folders
    .filter((folder) => folder.id !== homeSummaryFolder?.id && folder.imageCount > 0)
    .map((folder) => ({
      folder,
      score: getRecommendationScore(folder, likedCountByFolder, scoringNowMs),
      likedImageCount: likedCountByFolder.get(folder.slug) ?? 0
    }))
    .sort(compareRankedFolders);

  const rankedPool = rankedCandidates.slice(0, Math.min(RANKED_POOL_SIZE, rankedCandidates.length)).map(({ folder }) => folder);
  const recommendedFolders = shuffleWithSeed(rankedPool, createDailySeed(now)).slice(0, DAILY_RECOMMENDATION_COUNT);

  return {
    homeSummaryFolder,
    recommendedFolders
  };
}

function getFallbackTopFolder(folders: FolderSummary[], likedCountByFolder: Map<string, number>): FolderSummary {
  const nonEmptyFolders = folders.filter((folder) => folder.imageCount > 0);
  const candidates = nonEmptyFolders.length > 0 ? nonEmptyFolders : folders;

  return [...candidates].sort((left, right) => {
    const recentComparison = compareNumbers(right.latestImageMtimeMs ?? 0, left.latestImageMtimeMs ?? 0);
    if (recentComparison !== 0) {
      return recentComparison;
    }

    const likedComparison = compareNumbers(
      likedCountByFolder.get(right.slug) ?? 0,
      likedCountByFolder.get(left.slug) ?? 0
    );
    if (likedComparison !== 0) {
      return likedComparison;
    }

    const imageCountComparison = compareNumbers(right.imageCount, left.imageCount);
    if (imageCountComparison !== 0) {
      return imageCountComparison;
    }

    return compareText(left.name, right.name);
  })[0];
}

function getRecommendationScore(folder: FolderSummary, likedCountByFolder: Map<string, number>, nowMs: number): number {
  const recentActivityScore = getRecentActivityScore(folder.latestImageMtimeMs, nowMs);
  const likeScore = normalizeLogarithmicValue(likedCountByFolder.get(folder.slug) ?? 0, 6);
  const imageCountScore = normalizeLogarithmicValue(folder.imageCount, 30);

  return recentActivityScore * 0.6 + likeScore * 0.25 + imageCountScore * 0.15;
}

function getRecentActivityScore(latestImageMtimeMs: number | null, nowMs: number): number {
  if (!latestImageMtimeMs) {
    return 0;
  }

  const ageMs = Math.max(0, nowMs - latestImageMtimeMs);
  return Math.max(0, 1 - ageMs / RECENT_ACTIVITY_WINDOW_MS);
}

function normalizeLogarithmicValue(value: number, cap: number): number {
  if (value <= 0) {
    return 0;
  }

  return Math.min(1, Math.log(value + 1) / Math.log(cap));
}

function compareRankedFolders(left: RankedFolder, right: RankedFolder): number {
  const scoreComparison = compareNumbers(right.score, left.score);
  if (scoreComparison !== 0) {
    return scoreComparison;
  }

  const likedComparison = compareNumbers(right.likedImageCount, left.likedImageCount);
  if (likedComparison !== 0) {
    return likedComparison;
  }

  const recentComparison = compareNumbers(right.folder.latestImageMtimeMs ?? 0, left.folder.latestImageMtimeMs ?? 0);
  if (recentComparison !== 0) {
    return recentComparison;
  }

  const imageCountComparison = compareNumbers(right.folder.imageCount, left.folder.imageCount);
  if (imageCountComparison !== 0) {
    return imageCountComparison;
  }

  return compareText(left.folder.name, right.folder.name);
}

function compareNumbers(left: number, right: number): number {
  if (left === right) {
    return 0;
  }

  return left > right ? 1 : -1;
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base' });
}

function getLocalDayStart(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function createDailySeed(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function shuffleWithSeed<T>(items: T[], seed: string): T[] {
  const shuffled = [...items];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function createSeededRandom(seed: string): () => number {
  let state = hashSeed(seed);

  return () => {
    state += 0x6d2b79f5;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);

    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;

  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
