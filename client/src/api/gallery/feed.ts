import type { FeedMode, PaginatedFeed, PaginatedReels, ReelsFeedMode } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchFeed(
  page = 1,
  limit = 24,
  mode: FeedMode = 'random',
  seed?: number,
  excludeIds?: number[]
) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    mode
  });

  if (typeof seed === 'number') {
    params.set('seed', String(seed));
  }

  if (excludeIds && excludeIds.length > 0) {
    params.set('exclude', excludeIds.join(','));
  }

  return requestJson<PaginatedFeed>(`/api/feed?${params.toString()}`);
}

export function fetchReels(
  page = 1,
  limit = 6,
  mode: ReelsFeedMode = 'recommended',
  seed?: number,
  options: {
    lastFolder?: string | null;
    recentFolders?: string[];
  } = {}
) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    mode
  });

  if (typeof seed === 'number') {
    params.set('seed', String(seed));
  }

  if (options.lastFolder) {
    params.set('lastFolder', options.lastFolder);
  }

  if (options.recentFolders && options.recentFolders.length > 0) {
    params.set('recentFolders', options.recentFolders.join(','));
  }

  return requestJson<PaginatedReels>(`/api/reels?${params.toString()}`);
}

export function fetchFeedSearch(query: string, page = 1, limit = 24) {
  const params = new URLSearchParams({
    q: query,
    page: String(page),
    limit: String(limit)
  });

  return requestJson<PaginatedFeed>(`/api/feed/search?${params.toString()}`);
}

