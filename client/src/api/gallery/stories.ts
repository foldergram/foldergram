import type { FolderStoriesPayload, FolderStoryFeedPayload } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchFolderStories(slug: string) {
  return requestJson<FolderStoriesPayload>(`/api/folders/${encodeURIComponent(slug)}/stories`);
}

export function fetchFolderStoryFeed(slug: string, storyId: string, page = 1, limit = 24) {
  return requestJson<FolderStoryFeedPayload>(
    `/api/folders/${encodeURIComponent(slug)}/stories/${encodeURIComponent(storyId)}?page=${page}&limit=${limit}`
  );
}

