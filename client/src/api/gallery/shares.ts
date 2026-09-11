import type {
  CreateFolderShareLinkInput,
  CreateFolderShareLinkResult,
  CreatePostShareLinkResult,
  FolderShareAccessState,
  FolderShareLinksPayload,
  FolderSharePasswordMutationResult,
  FolderShareUnlockResult,
  PostShareLinksPayload,
  SharePublicBaseUrlSetting,
  SharedFolderImagesPayload,
  SharedFolderSummary,
  SharedImageDetail
} from '../../types/api.js';
import { requestJson } from '../http.js';

export function fetchFolderShareLinks(slug: string) {
  return requestJson<FolderShareLinksPayload>(`/api/admin/folders/${encodeURIComponent(slug)}/share-links`);
}

export function createFolderShareLink(slug: string, input: CreateFolderShareLinkInput) {
  return requestJson<CreateFolderShareLinkResult>(`/api/admin/folders/${encodeURIComponent(slug)}/share-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export function revokeFolderShareLink(slug: string, linkId: number) {
  return requestJson<{ ok: boolean; link: CreateFolderShareLinkResult['link'] }>(
    `/api/admin/folders/${encodeURIComponent(slug)}/share-links/${linkId}`,
    {
      method: 'DELETE'
    }
  );
}

export function setFolderSharePassword(slug: string, password: string) {
  return requestJson<FolderSharePasswordMutationResult>(`/api/admin/folders/${encodeURIComponent(slug)}/share-password`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password })
  });
}

export function removeFolderSharePassword(slug: string) {
  return requestJson<FolderSharePasswordMutationResult>(`/api/admin/folders/${encodeURIComponent(slug)}/share-password`, {
    method: 'DELETE'
  });
}

export function fetchSharedFolderAccess(slug: string) {
  return requestJson<FolderShareAccessState>(`/api/share/folders/${encodeURIComponent(slug)}/access`);
}

export function unlockSharedFolderLink(slug: string, token: string) {
  return requestJson<FolderShareUnlockResult>(`/api/share/folders/${encodeURIComponent(slug)}/unlock-link`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });
}

export function unlockSharedFolderPassword(slug: string, password: string) {
  return requestJson<FolderShareUnlockResult>(`/api/share/folders/${encodeURIComponent(slug)}/unlock-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password })
  });
}

export function fetchSharedFolder(slug: string) {
  return requestJson<SharedFolderSummary>(`/api/share/folders/${encodeURIComponent(slug)}`);
}

export function fetchSharedFolderImages(slug: string, page = 1, limit = 24, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit)
  });

  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  return requestJson<SharedFolderImagesPayload>(`/api/share/folders/${encodeURIComponent(slug)}/images?${params.toString()}`);
}

function fetchSharedDetail(resource: 'posts' | 'images', id: number, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams();
  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestJson<SharedImageDetail>(`/api/share/${resource}/${id}${suffix}`);
}

export function fetchPostShareLinks(postId: number) {
  return requestJson<PostShareLinksPayload>(`/api/share/posts/${postId}/links`);
}

export function createPostShareLink(postId: number, input: CreateFolderShareLinkInput = { expiresIn: 'unlimited', unlimited: true }) {
  return requestJson<CreatePostShareLinkResult>(`/api/share/posts/${postId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
}

export function revokePostShareLink(postId: number, linkId: number) {
  return requestJson<{ ok: boolean; link: CreatePostShareLinkResult['link'] }>(
    `/api/share/posts/${postId}/links/${linkId}`,
    { method: 'DELETE' }
  );
}

export function fetchSharedPostByToken(token: string) {
  return requestJson<SharedImageDetail>(`/api/share/post-links/${encodeURIComponent(token)}`);
}

export function updateSharePublicBaseUrl(publicBaseUrl: string | null) {
  return requestJson<SharePublicBaseUrlSetting>('/api/admin/settings/share-public-base-url', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicBaseUrl })
  });
}

export function fetchSharedPost(id: number, mediaType?: 'image' | 'video') {
  return fetchSharedDetail('posts', id, mediaType);
}

export function fetchSharedImage(id: number, mediaType?: 'image' | 'video') {
  return fetchSharedDetail('images', id, mediaType);
}

