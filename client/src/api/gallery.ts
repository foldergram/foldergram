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
  CreateFolderShareLinkInput,
  CreateFolderShareLinkResult,
  DeleteCollectionResult,
  FolderShareAccessState,
  FolderShareLinksPayload,
  FolderSharePasswordMutationResult,
  FolderShareUnlockResult,
  FolderStoriesPayload,
  FolderStoryFeedPayload,
  HomeFeedDefaultSetting,
  UpdateCollectionResult,
  UpdateExcludedFoldersSettingResult,
  NestedFolderTitleFormatSetting,
  VideoPlaybackQualitySetting,
  ReelsFeedDefaultSetting,
  SharedFolderImagesPayload,
  SharedFolderSummary,
  SharedImageDetail,
  StoriesModeSetting,
  ViewerAccessMode,
  DeleteImageResult,
  DeleteFolderResult,
  FeedMode,
  FolderImageOrder,
  FolderImageOrderDefaultSetting,
  NestedFolderTitleFormat,
  VideoPlaybackQuality,
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

export function fetchSharedPost(id: number, mediaType?: 'image' | 'video') {
  return fetchSharedDetail('posts', id, mediaType);
}

export function fetchSharedImage(id: number, mediaType?: 'image' | 'video') {
  return fetchSharedDetail('images', id, mediaType);
}

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

export function fetchLikes() {
  return requestJson<LikesPayload>('/api/likes');
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
  return requestJson<ImageCollectionsPayload>(`/api/posts/${id}/collections`);
}

export function fetchTrashImages(page = 1, limit = 24) {
  return requestJson<TrashImagesPayload>(`/api/trash/images?page=${page}&limit=${limit}`);
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

export function updateVideoPlaybackQuality(videoPlaybackQuality: VideoPlaybackQuality) {
  return requestJson<VideoPlaybackQualitySetting>('/api/admin/settings/video-playback-quality', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ videoPlaybackQuality })
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

export function updateCarouselsMode(treatCarouselsAsFolders: boolean) {
  return requestJson<AppStats>('/api/admin/settings/carousels-as-folders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ treatCarouselsAsFolders })
  });
}

export function updateCarouselsMigrationDecision(decision: 'restore' | 'carousels') {
  return requestJson<AppStats>('/api/admin/settings/carousels-migration-decision', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision })
  });
}
