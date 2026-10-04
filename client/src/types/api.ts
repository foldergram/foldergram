import type { SupportedLocale } from '../locales';

export type FeedMode = 'recent' | 'rediscover' | 'random';
export type ReelsFeedMode = 'recommended' | 'recent' | 'random';
export type FolderImageOrder = 'newest' | 'oldest';
export type NestedFolderTitleFormat = 'folder' | 'parent-plus-folder';
export type FeedRailKind = 'moments' | 'highlights';
export type StoryCapsulePresentation = 'avatar' | 'highlight';
export type MediaType = 'image' | 'video';

export type ScanOperation =
  | 'checking_derivatives'
  | 'backfilling_asset_key'
  | 'moving_thumbnail'
  | 'moving_preview'
  | 'repairing_thumbnail'
  | 'repairing_preview'
  | 'regenerating_derivatives'
  | 'discovering_media'
  | 'generating_thumbnail'
  | 'generating_preview'
  | 'generating_thumbnail_and_preview';

export interface HomeFeedDefaultSetting {
  defaultMode: FeedMode;
}

export interface AppLocaleSetting {
  defaultLocale: SupportedLocale;
}

export interface ReelsFeedDefaultSetting {
  defaultMode: ReelsFeedMode;
}

export interface FolderImageOrderDefaultSetting {
  defaultOrder: FolderImageOrder;
}

export interface NestedFolderTitleFormatSetting {
  titleFormat: NestedFolderTitleFormat;
}

export interface StoriesModeSetting {
  treatStoriesAsFolders: boolean;
}

export interface ExcludedFoldersSettings {
  envExcludedFolders: string[];
  customExcludedFolders: string[];
  effectiveExcludedFolders: string[];
}

export interface UpdateExcludedFoldersSettingResult extends ExcludedFoldersSettings {
  requiresScan: boolean;
}

export type PostType = 'single' | 'carousel';

export interface PostMediaItem {
  imageId: number;
  position: number;
  filename: string;
  mediaType: MediaType;
  width: number;
  height: number;
  durationMs: number | null;
  isAnimated: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  playbackStrategy?: 'preview' | 'original' | null;
  originalUrl?: string;
  mimeType?: string;
  fileSize?: number;
  relativePath?: string;
  exif?: ImageExifData | null;
}

export interface FeedItem {
  id: number;
  folderId: number;
  folderSlug: string;
  folderName: string;
  folderParentName?: string | null;
  folderPath: string;
  folderBreadcrumb: string | null;
  filename: string;
  sourcePath?: string;
  caption?: string | null;
  carouselTitle?: string | null;
  postType?: PostType;
  width: number;
  height: number;
  mediaType: 'image' | 'video';
  durationMs: number | null;
  isAnimated?: boolean | null;
  thumbnailUrl: string;
  previewUrl: string;
  sortTimestamp: number;
  takenAt: number | null;
  isSaved?: boolean;
  place?: PlaceSummary | null;
  mediaItems?: PostMediaItem[];
  itemCount?: number;
}

export type PlaceKind = 'city' | 'approximate_spot' | 'manual';

export interface PlaceSummary {
  id: number;
  slug: string;
  name: string;
  kind: PlaceKind;
  isApproximate: boolean;
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

export interface FolderSummary {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  parentFolderName?: string | null;
  folderPath: string;
  breadcrumb: string | null;
  imageCount: number;
  videoCount: number;
  latestImageMtimeMs: number | null;
  hasAvatarStory?: boolean;
  avatarImageId: number | null;
  avatarUrl: string | null;
}

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

export interface PaginatedFeed {
  mode?: FeedMode;
  items: FeedItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface PaginatedReels {
  mode?: ReelsFeedMode;
  items: FeedItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface RailCapsule {
  id: string;
  title: string;
  subtitle: string;
  dateContext: string;
  imageCount: number;
  coverImage: FeedItem;
  presentation?: StoryCapsulePresentation;
  latestActivityTimestamp?: number | null;
}

export interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

export type MomentDateMetadata =
  | {
      type: 'on-this-day';
      date: CalendarDateParts;
    }
  | {
      type: 'this-week-previous-years';
      startDate: CalendarDateParts;
      endDate: CalendarDateParts;
    }
  | {
      type: 'from-last-year';
      referenceDate: CalendarDateParts;
      startDate: CalendarDateParts;
      endDate: CalendarDateParts;
    };

export interface MomentCapsule extends RailCapsule {
  momentDate?: MomentDateMetadata;
}

export interface MomentsPayload {
  railKind: FeedRailKind;
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  items: MomentCapsule[];
}

export interface MomentFeedPayload extends PaginatedFeed {
  railKind: FeedRailKind;
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  moment: MomentCapsule;
}

export interface FolderStoriesPayload {
  railKind: 'stories';
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  hasAvatarStory: boolean;
  avatarStoryId: string | null;
  items: RailCapsule[];
  highlights: RailCapsule[];
}

export interface FolderStoryFeedPayload extends PaginatedFeed {
  railKind: 'stories';
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  story: RailCapsule;
}

export interface FolderImagesPayload extends PaginatedFeed {
  folder: FolderSummary;
}

export type FolderShareLinkStatus = 'active' | 'expired' | 'revoked';
export type FolderShareExpirationPreset = '1h' | '24h' | '7d' | 'custom' | 'unlimited';

export interface FolderShareLink {
  id: number;
  folderId: number;
  tokenPrefix: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  status: FolderShareLinkStatus;
}

export interface FolderSharePasswordStatus {
  enabled: boolean;
  updatedAt: string | null;
}

export interface FolderShareLinksPayload {
  links: FolderShareLink[];
  password: FolderSharePasswordStatus;
  publicFolderUrl: string;
  publicAccess: boolean;
}

export interface CreateFolderShareLinkInput {
  expiresIn: FolderShareExpirationPreset;
  customExpiresAt?: string | null;
  unlimited?: boolean;
}

export interface CreateFolderShareLinkResult {
  ok: boolean;
  shareUrl: string;
  link: FolderShareLink;
}

export interface FolderSharePasswordMutationResult {
  ok: boolean;
  password: FolderSharePasswordStatus;
}

export interface FolderShareAccessState {
  exists: boolean;
  granted: boolean;
  hasPassword: boolean;
  publicAccess: boolean;
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
  sortTimestamp: number;
  nextImageId: number | null;
  previousImageId: number | null;
  postType?: PostType;
  itemCount?: number;
  mediaItems?: PostMediaItem[];
}

export interface SharedFolderImagesPayload {
  items: SharedFeedItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  folder: SharedFolderSummary;
}

export interface FolderShareUnlockResult {
  ok: boolean;
}

export interface PlaceImagesPayload extends PaginatedFeed {
  place: PlaceDetail;
}

export interface PlacesStatus {
  prepared: boolean;
  databasePath: string;
  metadata: {
    source: string;
    sourceUrl: string;
    importedAt: string;
    rowCount: number;
  } | null;
}

export interface PlacesPrepareResult {
  ok: boolean;
  status: PlacesStatus;
}

export interface PlacesRebuildResult {
  ok: boolean;
  processed: number;
  assigned: number;
  skipped: number;
}

export interface LikesPayload {
  items: FeedItem[];
}

export interface CollectionSummary {
  id: number;
  slug: string;
  name: string;
  isDefault: boolean;
  itemCount: number;
  coverImage: FeedItem | null;
  previewImages: FeedItem[];
  createdAt: string;
  updatedAt: string;
}

export interface CollectionMembership extends CollectionSummary {
  containsImage: boolean;
}

export interface CollectionsPayload {
  items: CollectionSummary[];
}

export interface ImageCollectionsPayload {
  imageId: number;
  isSaved: boolean;
  items: CollectionMembership[];
}

export interface CollectionImagesPayload extends PaginatedFeed {
  collection: CollectionSummary;
}

export interface CreateCollectionResult {
  ok: boolean;
  collection: CollectionSummary;
}

export interface UpdateCollectionResult {
  ok: boolean;
  collection: CollectionSummary;
}

export interface DeleteCollectionResult {
  ok: boolean;
  collection: CollectionSummary;
}

export interface CollectionMutationResult {
  ok: boolean;
  id?: number;
  imageId: number;
  isSaved: boolean;
  collection?: CollectionSummary;
}

export interface ImageDetail extends FeedItem {
  folderAvatarImageId: number | null;
  relativePath: string;
  mimeType: string;
  fileSize: number;
  exif: ImageExifData | null;
  originalUrl: string;
  playbackStrategy?: 'preview' | 'original' | null;
  nextImageId: number | null;
  previousImageId: number | null;
}

export interface TrashItem extends FeedItem {
  trashedAt: string | null;
}

export interface TrashImagesPayload {
  items: TrashItem[];
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface DeleteImageResult {
  id: number;
  folderSlug: string;
}

export type TrashImageResult = DeleteImageResult;
export type RestoreImageResult = DeleteImageResult;

export interface ImageCaptionMutationResult {
  ok: boolean;
  image: ImageDetail;
}

export interface DeleteFolderResult {
  slug: string;
  deletedImageCount: number;
  deletedFolderCount: number;
  deletedSourceFolder: boolean;
}

export interface LikeMutationResult {
  id: number;
  liked: boolean;
  ok: boolean;
}

export interface ScanRunSummary {
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

export interface ScanProgress {
  isScanning: boolean;
  scanReason: string | null;
  phase: 'idle' | 'migration' | 'discovery' | 'derivatives';
  startedAt: string | null;
  runId: number | null;
  migrationTotalRows: number;
  processedMigrationRows: number;
  migratedDerivativeFiles: number;
  missingDerivativeFiles: number;
  repairedDerivativeFiles: number;
  backfilledAssetKeys: number;
  discoveredFolders: number;
  processedFolders: number;
  discoveredImages: number;
  processedImages: number;
  queuedDerivativeJobs: number;
  processedDerivativeJobs: number;
  generatedThumbnails: number;
  generatedPreviews: number;
  currentOperation: ScanOperation | null;
  currentFile: string | null;
  currentPhaseMessage: string | null;
  currentFolder: string | null;
  lastCompletedScan: ScanRunSummary | null;
}

export interface ManualScanResult {
  ok: boolean;
  lastScan: ScanRunSummary | null;
}

export interface RebuildLibraryResult {
  ok: boolean;
  lastScan: ScanRunSummary | null;
}

export interface RebuildThumbnailsResult {
  ok: boolean;
  lastScan: ScanRunSummary | null;
}

export interface AppStatus {
  folders: number;
  indexedImages: number;
  indexedPosts: number;
  indexedMediaAssets: number;
  indexedCarousels: number;
  indexedVideos: number;
  scan: ScanProgress;
  storage: {
    available: boolean;
    reason: string | null;
  };
  libraryIndex: {
    rebuildRequired: boolean;
    reason: 'gallery_root_changed' | null;
    ignoredRootMediaCount: number;
  };
  preferences: {
    defaultLocale?: SupportedLocale | null;
    defaultHomeFeedMode: FeedMode;
    defaultReelsFeedMode: ReelsFeedMode;
    defaultFolderImageOrder?: FolderImageOrder;
    nestedFolderTitleFormat?: NestedFolderTitleFormat;
    treatStoriesAsFolders: boolean;
    treatCarouselsAsFolders: boolean;
    allowDownloads: boolean;
  };
  storiesMigration: {
    hasLegacyStoriesCandidates: boolean;
    decisionPending: boolean;
  };
  carouselsMigration: {
    hasLegacyCarouselsCandidates: boolean;
    decisionPending: boolean;
    reconciliationPending?: boolean;
  };
}

export interface AppStats extends AppStatus {
  deletedImages: number;
  thumbnailCount: number;
  previewCount: number;
  excludedFolders: ExcludedFoldersSettings;
  storage: AppStatus['storage'] & {
    usingInMemoryDatabase: boolean;
  };
  libraryIndex: AppStatus['libraryIndex'] & {
    currentGalleryRoot: string;
    previousGalleryRoot: string | null;
    lastSuccessfulGalleryRoot: string | null;
    legacyDerivativeMigrationPending: boolean;
    pendingDerivativeMigrationRows: number;
  };
  deletionRecovery: {
    failedCount: number;
    failures: Array<{
      journalName: string;
      operationId: string | null;
      postId: number | null;
      folderSlug: string | null;
      createdAt: string | null;
      message: string;
    }>;
  };
  lastScan: ScanRunSummary | null;
}

export type AuthRole = 'admin' | 'viewer' | 'anonymous';
export type ViewerAccessMode = 'off' | 'password' | 'public';
export type LikesMode = 'shared' | 'local';

export interface AuthCapabilities {
  canManageLibrary: boolean;
  canDeleteMedia: boolean;
  canAccessSettings: boolean;
  canUseSharedLikes: boolean;
  canUseLocalFavorites: boolean;
  canUseSharedCollections?: boolean;
  canUseLocalCollections?: boolean;
}

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  role: AuthRole;
  accessMode: ViewerAccessMode;
  likesMode: LikesMode;
  defaultLocale: SupportedLocale | null;
  capabilities: AuthCapabilities;
}

export interface AuthMutationResult {
  ok: boolean;
  auth: AuthStatus;
}

export interface RailViewerStoreContract {
  currentCapsule: RailCapsule | null;
  currentImages: FeedItem[];
  currentHasMore: boolean;
  currentError?: string | null;
  loadCapsule(id: string, reset?: boolean): Promise<void>;
}
