import type { PlaceDetail, PlaceImagesPayload } from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchPlaces() {
  return requestJson<{ items: PlaceDetail[] }>('/api/places');
}

export function fetchPlace(slug: string) {
  return requestJson<PlaceDetail>(`/api/places/${encodeURIComponent(slug)}`);
}

export function fetchPlaceImages(slug: string, page = 1, limit = 24, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });

  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  return requestJson<PlaceImagesPayload>(`/api/places/${encodeURIComponent(slug)}/images?${params.toString()}`);
}

