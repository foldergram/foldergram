export type MediaType = 'image' | 'video';
export type FolderImageOrder = 'newest' | 'oldest';
export type NestedFolderTitleFormat = 'folder' | 'parent-plus-folder';
export type TakenAtSource = 'exif' | 'mtime' | 'first_seen' | 'sort_timestamp';
export type PlaybackStrategy = 'preview' | 'original';
export type VideoPlaybackQuality = 'auto' | 'original' | '1080p' | '720p';
export type FolderAvatarSource = 'auto' | 'manual' | 'cover';
export type FolderRole = 'normal' | 'story_root' | 'story_capsule' | 'carousel_source';
export type PlaceKind = 'city' | 'approximate_spot' | 'manual';
export type PostType = 'single' | 'carousel';

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
  carousel_owner_folder_id: number | null;
  description: string | null;
  avatar_image_id: number | null;
  avatar_source: FolderAvatarSource;
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
  image_count: number;
  post_count: number;
  carousel_count: number;
  video_count: number;
  latest_image_mtime_ms: number | null;
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

export interface PostRecord {
  id: number;
  folder_id: number;
  place_id: number | null;
  source_path: string;
  post_type: PostType;
  caption: string | null;
  sort_timestamp: number;
  taken_at: number | null;
  taken_at_source: TakenAtSource | null;
  is_deleted: number;
  deleted_at: string | null;
  is_trashed: number;
  trashed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostItemRecord {
  post_id: number;
  image_id: number;
  position: number;
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
  warning_count: number;
  warning_text: string | null;
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
  post_id: number;
  image_id?: number;
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
  cover_post_id?: number | null;
}

export interface CollectionMembershipRecord extends CollectionSummaryRecord {
  contains_image: number;
  contains_post?: number;
}

export interface FolderShareLinkRecord {
  id: number;
  folder_id: number;
  token_hash: string;
  token_prefix: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  allow_original_downloads: number;
  created_at: string;
  last_used_at: string | null;
}

export interface PostShareLinkRecord {
  id: number;
  post_id: number;
  token_hash: string;
  token_prefix: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface FolderSharePasswordRecord {
  folder_id: number;
  password_hash: string;
  password_salt: string;
  version: number;
  updated_at: string;
}

export interface PostMediaItem {
  imageId: number;
  position: number;
  filename: string;
  width: number;
  height: number;
  mediaType: MediaType;
  durationMs: number | null;
  isAnimated: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  originalUrl?: string;
  playbackStrategy?: PlaybackStrategy | null;
  streamUrl?: string | null;
  exif?: ImageExifData | null;
  mimeType?: string;
  fileSize?: number;
  relativePath?: string;
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
  sourcePath?: string;
  caption: string | null;
  carouselTitle?: string | null;
  width: number;
  height: number;
  mediaType: MediaType;
  durationMs: number | null;
  isAnimated?: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  playbackStrategy?: PlaybackStrategy | null;
  streamUrl?: string | null;
  originalUrl?: string;
  sortTimestamp: number;
  takenAt: number | null;
  isSaved: boolean;
  place?: PlaceSummary | null;

  // Carousel post properties
  postType?: PostType;
  itemCount?: number;
  mediaItems?: PostMediaItem[];
}

export interface FeedPost extends FeedImage {
  postType: PostType;
  itemCount: number;
  mediaItems: PostMediaItem[];
}

export interface ReelCandidate extends FeedPost {
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

export interface PostDetail extends ImageDetail {
  postType: PostType;
  itemCount: number;
  mediaItems: PostMediaItem[];
  nextPostId: number | null;
  previousPostId: number | null;
}

export interface TrashImage extends FeedImage {
  trashedAt: string | null;
}

export interface TrashPost extends TrashImage {
  postType: PostType;
  itemCount: number;
  mediaItems: PostMediaItem[];
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

export interface SharedFolderSummary {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  imageCount: number;
  postCount: number;
  videoCount: number;
  avatarThumbnailUrl: string | null;
  sortTimestamp: number;
}

export interface SharedFeedItem {
  id: number;
  folderId: number;
  folderSlug: string;
  folderName: string;
  filename: string;
  caption: string | null;
  carouselTitle?: string | null;
  width: number;
  height: number;
  mediaType: MediaType;
  durationMs: number | null;
  isAnimated?: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  sortTimestamp: number;

  postType?: PostType;
  itemCount?: number;
  mediaItems?: PostMediaItem[];
}

export interface SharedImageDetail {
  id: number;
  folderId: number;
  folderSlug: string;
  folderName: string;
  filename: string;
  caption: string | null;
  carouselTitle?: string | null;
  mediaType: MediaType;
  mimeType: string;
  width: number;
  height: number;
  durationMs: number | null;
  isAnimated?: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  /** Only set for videos, and only on token-scoped share links. */
  streamUrl?: string | null;
  originalUrl?: string;
  playbackStrategy?: PlaybackStrategy | null;
  sortTimestamp: number;
  nextImageId: number | null;
  previousImageId: number | null;

  postType?: PostType;
  itemCount?: number;
  mediaItems?: PostMediaItem[];
}
