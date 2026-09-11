import type { MomentFeedPayload, MomentsPayload } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchMoments() {
  return requestJson<MomentsPayload>('/api/feed/moments');
}

export function fetchMomentFeed(id: string, page = 1, limit = 24) {
  return requestJson<MomentFeedPayload>(`/api/feed/moments/${encodeURIComponent(id)}?page=${page}&limit=${limit}`);
}

