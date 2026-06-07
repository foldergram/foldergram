export type MediaType = 'image' | 'video';
export type FolderImageOrder = 'newest' | 'oldest';
export type NestedFolderTitleFormat = 'folder' | 'parent-plus-folder';
export type TakenAtSource = 'exif' | 'mtime' | 'first_seen' | 'sort_timestamp';
export type PlaybackStrategy = 'preview' | 'original';
export type FolderAvatarSource = 'auto' | 'manual' | 'cover';
export type FolderRole = 'normal' | 'story_root' | 'story_capsule';
export type PlaceKind = 'city' | 'approximate_spot' | 'manual';

export interface ImageExifData {
  cameraMake?: string;
  cameraModel?: string;
  lensModel?: string;
  fNumber?: number;
  exposureTimeSeconds?: number;
  iso?: number;
  focalLengthMm?: number;
  focalLength35mmMm?: number;
  latitude?: number;
  longitude?: number;
  altitudeMeters?: number;
}

export interface FolderRecord {
  id: number;
  slug: string;
  name: string;
  folder_path: string;
  role: FolderRole;
  story_owner_folder_id: number | null;
  description: string | null;
  avatar_image_id: number | null;
  avatar_source: FolderAvatarSource;
  image_count: number;
  video_count: number;
  latest_image_mtime_ms: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlaceRecord {
  id: number;
  slug: string;
  display_name: string;
  kind: PlaceKind;
  source: string;
  source_confidence: number | null;
  provider: string | null;
  provider_place_id: string | null;
  latitude: number | null;
  longitude: number | null;
  city_name: string | null;
  admin1_name: string | null;
  country_name: string | null;
  country_code: string | null;
  geonames_id: number | null;
  is_approximate: number;
  name_override: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface FolderSummaryRecord extends FolderRecord {
  has_avatar_story?: number | null;
  summary_avatar_image_id?: number | null;
  summary_avatar_thumbnail_path?: string | null;
}

export interface ImageRecord {
  id: number;
  folder_id: number;
  place_id: number | null;
  asset_key: string | null;
  filename: string;
  extension: string;
  relative_path: string;
  absolute_path: string;
  file_size: number;
  width: number;
  height: number;
  display_orientation: number | null;
  media_type: MediaType;
  mime_type: string;
  duration_ms: number | null;
  is_animated: number | null;
  checksum_or_fingerprint: string;
  mtime_ms: number;
  first_seen_at: string;
  sort_timestamp: number;
  taken_at: number | null;
  taken_at_source: TakenAtSource | null;
  caption: string | null;
  exif_json: string | null;
  thumbnail_path: string;
  preview_path: string;
  playback_strategy: PlaybackStrategy | null;
  is_deleted: number;
  deleted_at: string | null;
  is_trashed: number;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlaceSummary {
  id: number;
  slug: string;
  name: string;
  kind: PlaceKind;
  isApproximate: boolean;
}

export interface ScanRunRecord {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  scanned_files: number;
  new_files: number;
  updated_files: number;
  removed_files: number;
  error_text: string | null;
}

export interface AppSettingRecord {
  key: string;
  value: string;
}

export interface FolderScanStateRecord {
  folder_path: string;
  signature: string;
  file_count: number;
  max_mtime_ms: number;
  total_size: number;
  updated_at: string;
}

export interface LikeRecord {
  image_id: number;
  created_at: string;
}

export interface CollectionRecord {
  id: number;
  slug: string;
  name: string;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionSummaryRecord extends CollectionRecord {
  item_count: number;
  cover_image_id: number | null;
  cover_thumbnail_path: string | null;
  preview_image_ids: string | null;
}

export interface CollectionMembershipRecord extends CollectionSummaryRecord {
  contains_image: number;
}

export interface FeedImage {
  id: number;
  folderId: number;
  folderSlug: string;
  folderName: string;
  folderParentName?: string | null;
  folderPath: string;
  folderBreadcrumb?: string | null;
  filename: string;
  caption: string | null;
  width: number;
  height: number;
  mediaType: MediaType;
  durationMs: number | null;
  isAnimated?: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  sortTimestamp: number;
  takenAt: number | null;
  isSaved: boolean;
  place?: PlaceSummary | null;
}

export interface ReelCandidate extends FeedImage {
  likedAt: string | null;
}

export interface ImageDetail extends FeedImage {
  folderAvatarImageId: number | null;
  relativePath: string;
  mimeType: string;
  fileSize: number;
  exif: ImageExifData | null;
  originalUrl: string;
  playbackStrategy?: PlaybackStrategy | null;
  nextImageId: number | null;
  previousImageId: number | null;
}

export interface TrashImage extends FeedImage {
  trashedAt: string | null;
}

export interface PlaceDetail extends PlaceSummary {
  latitude: number | null;
  longitude: number | null;
  cityName: string | null;
  admin1Name: string | null;
  countryName: string | null;
  countryCode: string | null;
  description: string | null;
  postCount: number;
}
