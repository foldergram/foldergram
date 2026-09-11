import type {
  DeleteImageResult,
  PermanentDeletionJobResult,
  RestoreImageResult,
  TrashImageResult,
  TrashImagesPayload
} from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchTrashImages(page = 1, limit = 24) {
  return requestJson<TrashImagesPayload>(`/api/trash/images?page=${page}&limit=${limit}`);
}

export function trashImage(id: number) {
  return requestJson<TrashImageResult>(`/api/posts/${id}/trash`, {
    method: 'POST'
  });
}

export function restoreImage(id: number) {
  return requestJson<RestoreImageResult>(`/api/posts/${id}/restore`, {
    method: 'POST'
  });
}

export function deleteImage(id: number) {
  return requestJson<DeleteImageResult>(`/api/posts/${id}`, {
    method: 'DELETE'
  });
}

export function enqueuePermanentDeletionBatch(ids: number[]) {
  return requestJson<PermanentDeletionJobResult>('/api/posts/deletions/batch', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids })
  });
}

export function fetchPermanentDeletionJob() {
  return requestJson<PermanentDeletionJobResult>('/api/posts/deletions/batch');
}

export function acknowledgePermanentDeletionJob() {
  return requestJson<PermanentDeletionJobResult>('/api/posts/deletions/batch', {
    method: 'DELETE'
  });
}

