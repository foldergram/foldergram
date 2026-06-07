import type {
  AppLocaleSetting,
  AppStatus,
  AppStats,
  AuthMutationResult,
  AuthStatus,
  CollectionImagesPayload,
  CollectionMutationResult,
  CollectionsPayload,
  CreateCollectionResult,
  DeleteCollectionResult,
  FolderStoriesPayload,
  FolderStoryFeedPayload,
  HomeFeedDefaultSetting,
  UpdateCollectionResult,
  UpdateExcludedFoldersSettingResult,
  NestedFolderTitleFormatSetting,
  ReelsFeedDefaultSetting,
  StoriesModeSetting,
  ViewerAccessMode,
  DeleteImageResult,
  DeleteFolderResult,
  FeedMode,
  FolderImageOrder,
  FolderImageOrderDefaultSetting,
  NestedFolderTitleFormat,
  ImageCaptionMutationResult,
  ImageDetail,
  ImageCollectionsPayload,
  LikeMutationResult,
  LikesPayload,
  ManualScanResult,
  MomentFeedPayload,
  MomentsPayload,
  PaginatedFeed,
  PaginatedReels,
  FolderImagesPayload,
  PlaceDetail,
  PlaceImagesPayload,
  PlacesPrepareResult,
  PlacesRebuildResult,
  PlacesStatus,
  ReelsFeedMode,
  RestoreImageResult,
  RebuildLibraryResult,
  RebuildThumbnailsResult,
  ScanProgress,
  FolderSummary,
  LikeIdsPayload,
  PaginatedFolders,
  TrashImageResult,
  TrashImagesPayload
} from '../types/api';
import { requestJson } from './http';

export function fetchFeed(page = 1, limit = 24, mode: FeedMode = 'random', seed?: number) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    mode
  });

  if (typeof seed === 'number') {
    params.set('seed', String(seed));
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

export function fetchMoments() {
  return requestJson<MomentsPayload>('/api/feed/moments');
}

export function fetchMomentFeed(id: string, page = 1, limit = 24) {
  return requestJson<MomentFeedPayload>(`/api/feed/moments/${encodeURIComponent(id)}?page=${page}&limit=${limit}`);
}

export function fetchFolders(page = 1, limit = 24) {
  return requestJson<PaginatedFolders>(`/api/folders?page=${page}&limit=${limit}`);
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

export function fetchFolderStories(slug: string) {
  return requestJson<FolderStoriesPayload>(`/api/folders/${encodeURIComponent(slug)}/stories`);
}

export function fetchFolderStoryFeed(slug: string, storyId: string, page = 1, limit = 24) {
  return requestJson<FolderStoryFeedPayload>(
    `/api/folders/${encodeURIComponent(slug)}/stories/${encodeURIComponent(storyId)}?page=${page}&limit=${limit}`
  );
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

export function fetchImage(id: number, mediaType?: 'image' | 'video') {
  const params = new URLSearchParams();
  if (mediaType) {
    params.set('mediaType', mediaType);
  }

  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return requestJson<ImageDetail>(`/api/images/${id}${suffix}`);
}

export async function updateImageCaption(id: number, caption: string | null) {
  const payload = await requestJson<ImageCaptionMutationResult>(`/api/images/${id}/caption`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ caption })
  });

  return payload.image;
}

export function fetchLikeIds() {
  return requestJson<LikeIdsPayload>('/api/likes/ids');
}

export function fetchLikes(page = 1, limit = 24) {
  return requestJson<LikesPayload>(`/api/likes?page=${page}&limit=${limit}`);
}

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
  return requestJson<ImageCollectionsPayload>(`/api/images/${id}/collections`);
}

export function fetchTrashImages(page = 1, limit = 24) {
  return requestJson<TrashImagesPayload>(`/api/trash/images?page=${page}&limit=${limit}`);
}

export function likeImage(id: number) {
  return requestJson<LikeMutationResult>(`/api/images/${id}/like`, {
    method: 'POST'
  });
}

export function unlikeImage(id: number) {
  return requestJson<LikeMutationResult>(`/api/images/${id}/like`, {
    method: 'DELETE'
  });
}

export function saveImage(id: number) {
  return requestJson<CollectionMutationResult>(`/api/images/${id}/save`, {
    method: 'POST'
  });
}

export function unsaveImage(id: number) {
  return requestJson<CollectionMutationResult>(`/api/images/${id}/save`, {
    method: 'DELETE'
  });
}

export function addImageToCollection(slug: string, id: number) {
  return requestJson<CollectionMutationResult>(`/api/collections/${encodeURIComponent(slug)}/images/${id}`, {
    method: 'POST'
  });
}

export function removeImageFromCollection(slug: string, id: number) {
  return requestJson<CollectionMutationResult>(`/api/collections/${encodeURIComponent(slug)}/images/${id}`, {
    method: 'DELETE'
  });
}

export function trashImage(id: number) {
  return requestJson<TrashImageResult>(`/api/images/${id}/trash`, {
    method: 'POST'
  });
}

export function restoreImage(id: number) {
  return requestJson<RestoreImageResult>(`/api/images/${id}/restore`, {
    method: 'POST'
  });
}

export function deleteImage(id: number) {
  return requestJson<DeleteImageResult>(`/api/images/${id}`, {
    method: 'DELETE'
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

export function fetchStats() {
  return requestJson<AppStatus>('/api/status');
}

export function fetchAdminStats() {
  return requestJson<AppStats>('/api/admin/stats');
}

export function fetchScanProgress() {
  return requestJson<ScanProgress>('/api/scan-progress');
}

export function fetchAdminScanProgress() {
  return requestJson<ScanProgress>('/api/admin/scan-progress');
}

export function fetchAuthStatus() {
  return requestJson<AuthStatus>('/api/auth/status');
}

export function loginWithPassword(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/login', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

export function unlockAdmin(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/unlock-admin', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'POST'
  });
}

export function logout() {
  return requestJson<AuthMutationResult>('/api/auth/logout', {
    method: 'POST'
  });
}

export function enablePasswordProtection(password: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function changePasswordProtection(currentPassword: string, password: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ currentPassword, password }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function disablePasswordProtection(currentPassword: string) {
  return requestJson<AuthMutationResult>('/api/auth/password', {
    body: JSON.stringify({ currentPassword }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'DELETE'
  });
}

export function updateViewerAccess(mode: ViewerAccessMode, viewerPassword?: string) {
  return requestJson<AuthMutationResult>('/api/auth/viewer-access', {
    body: JSON.stringify({
      mode,
      viewerPassword
    }),
    headers: {
      'content-type': 'application/json'
    },
    method: 'PUT'
  });
}

export function triggerManualScan() {
  return requestJson<ManualScanResult>('/api/admin/rescan', {
    method: 'POST'
  });
}

export function triggerLibraryRebuild() {
  return requestJson<RebuildLibraryResult>('/api/admin/rebuild-index', {
    method: 'POST'
  });
}

export function triggerThumbnailRebuild() {
  return requestJson<RebuildThumbnailsResult>('/api/admin/rebuild-thumbnails', {
    method: 'POST'
  });
}

export function fetchPlacesStatus() {
  return requestJson<PlacesStatus>('/api/admin/places/status');
}

export function preparePlacesGeodata() {
  return requestJson<PlacesPrepareResult>('/api/admin/places/geodata/prepare', {
    method: 'POST'
  });
}

export function rebuildPlaces() {
  return requestJson<PlacesRebuildResult>('/api/admin/places/rebuild', {
    method: 'POST'
  });
}

export function updateHomeFeedDefault(defaultMode: FeedMode) {
  return requestJson<HomeFeedDefaultSetting>('/api/admin/settings/home-feed-default', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defaultMode })
  });
}

export function updateAppLocale(defaultLocale: AppLocaleSetting['defaultLocale']) {
  return requestJson<AppLocaleSetting>('/api/admin/settings/app-locale', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defaultLocale })
  });
}

export function updateReelsFeedDefault(defaultMode: ReelsFeedMode) {
  return requestJson<ReelsFeedDefaultSetting>('/api/admin/settings/reels-feed-default', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defaultMode })
  });
}

export function updateFolderImageOrderDefault(defaultOrder: FolderImageOrder) {
  return requestJson<FolderImageOrderDefaultSetting>('/api/admin/settings/folder-image-order-default', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ defaultOrder })
  });
}

export function updateNestedFolderTitleFormat(titleFormat: NestedFolderTitleFormat) {
  return requestJson<NestedFolderTitleFormatSetting>('/api/admin/settings/nested-folder-title-format', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ titleFormat })
  });
}

export function updateStoriesMode(treatStoriesAsFolders: boolean) {
  return requestJson<StoriesModeSetting>('/api/admin/settings/stories-mode', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ treatStoriesAsFolders })
  });
}

export function updateExcludedFolders(rules: string[]) {
  return requestJson<UpdateExcludedFoldersSettingResult>('/api/admin/settings/excluded-folders', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rules })
  });
}
