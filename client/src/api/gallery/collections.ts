import type {
  CollectionImagesPayload,
  CollectionMutationResult,
  CollectionsPayload,
  CreateCollectionResult,
  DeleteCollectionResult,
  ImageCollectionsPayload,
  UpdateCollectionResult
} from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchCollections() {
  return requestJson<CollectionsPayload>('/api/collections');
}

export function createCollection(name: string) {
  return requestJson<CreateCollectionResult>('/api/collections', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
}

export function updateCollection(slug: string, name: string) {
  return requestJson<UpdateCollectionResult>(`/api/collections/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
}

export function deleteCollection(slug: string) {
  return requestJson<DeleteCollectionResult>(`/api/collections/${encodeURIComponent(slug)}`, {
    method: 'DELETE'
  });
}

export function fetchCollectionImages(slug: string, page = 1, limit = 24) {
  return requestJson<CollectionImagesPayload>(`/api/collections/${encodeURIComponent(slug)}/images?page=${page}&limit=${limit}`);
}

export function fetchImageCollections(id: number) {
  return requestJson<ImageCollectionsPayload>(`/api/posts/${id}/collections`);
}

export function addImageToCollection(slug: string, id: number) {
  return requestJson<CollectionMutationResult>(`/api/collections/${encodeURIComponent(slug)}/posts/${id}`, {
    method: 'POST'
  });
}

export function removeImageFromCollection(slug: string, id: number) {
  return requestJson<CollectionMutationResult>(`/api/collections/${encodeURIComponent(slug)}/posts/${id}`, {
    method: 'DELETE'
  });
}

