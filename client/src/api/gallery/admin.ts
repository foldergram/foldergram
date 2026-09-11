import type {
  AppLocaleSetting,
  AppStats,
  FeedMode,
  FolderImageOrder,
  FolderImageOrderDefaultSetting,
  HomeFeedDefaultSetting,
  ManualScanResult,
  NestedFolderTitleFormat,
  NestedFolderTitleFormatSetting,
  PlacesPrepareResult,
  PlacesRebuildResult,
  PlacesStatus,
  RebuildLibraryResult,
  RebuildThumbnailsResult,
  ReelsFeedDefaultSetting,
  ReelsFeedMode,
  StoriesModeSetting,
  UpdateExcludedFoldersSettingResult,
  UpdateScanFoldersResult,
  VideoPlaybackQuality,
  VideoPlaybackQualitySetting
} from '../../types/api.js';
import { requestJson } from '../http.js';

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

export function updateScanFolders(folders: string[]) {
  return requestJson<UpdateScanFoldersResult>('/api/admin/settings/scan-folders', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ folders })
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
