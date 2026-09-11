import type { CollectionMutationResult, LikeMutationResult, LikesPayload } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchLikes() {
  return requestJson<LikesPayload>('/api/likes');
}

export function likeImage(id: number) {
  return requestJson<LikeMutationResult>(`/api/posts/${id}/like`, {
    method: 'POST'
  });
}

export function unlikeImage(id: number) {
  return requestJson<LikeMutationResult>(`/api/posts/${id}/like`, {
    method: 'DELETE'
  });
}

export function saveImage(id: number) {
  return requestJson<CollectionMutationResult>(`/api/posts/${id}/save`, {
    method: 'POST'
  });
}

export function unsaveImage(id: number) {
  return requestJson<CollectionMutationResult>(`/api/posts/${id}/save`, {
    method: 'DELETE'
  });
}

