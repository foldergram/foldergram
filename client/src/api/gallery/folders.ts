import type { DeleteFolderResult, FolderImagesPayload, FolderSummary } from '../../types/api.js';
import { requestJson } from '../http.js';

export async function fetchFolders() {
  const payload = await requestJson<{ items: FolderSummary[] }>('/api/folders');
  return payload.items;
}

export function fetchFolder(slug: string) {
  return requestJson<FolderSummary>(`/api/folders/${encodeURIComponent(slug)}`);
}

export function fetchFolderImages(slug: string, page = 1, limit = 24, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });

  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  return requestJson<FolderImagesPayload>(`/api/folders/${encodeURIComponent(slug)}/images?${params.toString()}`);
}

export function updateFolderProfile(slug: string, name: string, description: string | null) {
  return requestJson<FolderSummary>(`/api/folders/${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, description })
  });
}

export function setFolderCover(slug: string, imageId: number) {
  return requestJson<{ ok: boolean }>(`/api/folders/${encodeURIComponent(slug)}/cover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ imageId })
  });
}

export function deleteFolder(slug: string, options: { deleteSourceFolder?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.deleteSourceFolder) {
    params.set('deleteSourceFolder', 'true');
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestJson<DeleteFolderResult>(`/api/folders/${encodeURIComponent(slug)}${suffix}`, {
    method: 'DELETE'
  });
}

