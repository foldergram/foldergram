import type { ImageCaptionMutationResult, ImageDetail } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchImage(id: number, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams();
  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestJson<ImageDetail>(`/api/posts/${id}${suffix}`);
}

export async function updateImageCaption(id: number, caption: string | null) {
  const payload = await requestJson<ImageCaptionMutationResult>(`/api/posts/${id}/caption`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caption })
  });

  return payload.image;
}

