import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  APP_DEFAULT_LOCALE_SETTING_KEY,
  CAROUSELS_APPLIED_MODE_SETTING_KEY,
  CAROUSELS_MIGRATION_DECISION_SETTING_KEY,
  EXCLUDED_FOLDERS_SETTING_KEY,
  FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY,
  HOME_FEED_DEFAULT_MODE_SETTING_KEY,
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
  LIBRARY_REBUILD_REQUIRED_SETTING_KEY,
  NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY,
  PREVIOUS_GALLERY_ROOT_SETTING_KEY,
  REELS_FEED_DEFAULT_MODE_SETTING_KEY,
  STORIES_MIGRATION_DECISION_SETTING_KEY,
  TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY,
  TREAT_STORIES_AS_FOLDERS_SETTING_KEY,
  VIDEO_PLAYBACK_QUALITY_SETTING_KEY,
  VIDEO_PLAYBACK_MODE_SETTING_KEY,
  SHARE_PUBLIC_BASE_URL_SETTING_KEY
} from '../../constants/app-setting-keys.js';
import { appConfig } from '../../config/env.js';
import {
  appSettingsRepository,
  collectionConstants,
  collectionRepository,
  folderRepository,
  folderScanStateRepository,
  imageRepository,
  libraryStateRepository,
  likeRepository,
  placeRepository,
  postRepository,
  scanRunRepository
} from '../../db/repositories.js';
import { parseTreatCarouselsAsFoldersSetting, serializeTreatCarouselsAsFoldersSetting } from '../../utils/carousels-utils.js';
import type {
  CollectionMembershipRecord,
  CollectionSummaryRecord,
  FeedImage,
  FolderImageOrder,
  NestedFolderTitleFormat,
  FolderRecord,
  FolderSummaryRecord,
  ImageDetail,
  ImageRecord,
  MediaType,
  PlaceKind,
  PlaybackStrategy,
  PostMediaItem,
  PostRecord,
  ReelCandidate,
  SharedFeedItem,
  SharedFolderSummary,
  SharedImageDetail,
  TrashImage,
  VideoPlaybackQuality,
  VideoPlaybackMode
} from '../../types/models.js';
import {
  getEffectiveExcludedFolderRules,
  parseExcludedFolderRulesFromSetting,
  serializeExcludedFolderRulesForSetting
} from '../../utils/excluded-folder-rules.js';
import { deserializeImageExifData } from '../../utils/exif-utils.js';
import { buildMonthDayKey, countFeedBursts, diversifyFeedCandidates, groupFeedBursts, listMonthDayKeysAroundDate } from '../../utils/feed-utils.js';
import { shouldPreferMomentRail, type FeedRailKind } from '../../utils/feed-rail-utils.js';
import { parseNestedFolderTitleFormatSetting, serializeNestedFolderTitleFormatSetting } from '../../utils/folder-title-format.js';
import { countSupportedRootMediaFiles } from '../../utils/gallery-root-utils.js';
import { resolveOriginalPath } from '../../utils/media-paths.js';
import { normalizePublicBaseUrl } from '../../utils/share-url.js';
import { getLeafPathName, getParentRelativePath, getPathBreadcrumb } from '../../utils/path-utils.js';
import { buildReelQueue, shuffleReelCandidates, type ReelAffinitySignals } from '../../utils/reels-utils.js';
import { parseTreatStoriesAsFoldersSetting, serializeTreatStoriesAsFoldersSetting } from '../../utils/stories-utils.js';
import { scannerService } from '../scanner-service.js';
import { storageService } from '../storage-service.js';
import { geodataService, placeResolutionService } from '../place-service.js';
import { permanentDeletionService } from '../permanent-deletion-service.js';

export type FeedMode = 'recent' | 'rediscover' | 'random';
export type ReelsFeedMode = 'recommended' | 'recent' | 'random';
export type SupportedLocale = 'en' | 'es' | 'zh';

export interface FeedCapsuleDefinition {
  id: string;
  title: string;
  subtitle: string;
  dateContext: string;
  momentDate?: MomentDateMetadata;
  minimumImageCount: number;
  count: () => number;
  list: (page: number, limit: number) => FeedImage[];
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

export interface FeedRailDefinition {
  kind: FeedRailKind;
  title: string;
  description: string;
  singularLabel: string;
  capsules: FeedCapsuleDefinition[];
}

export interface DeleteFolderOptions {
  deleteSourceFolder?: boolean;
}

export interface StoryRailCapsule {
  id: string;
  title: string;
  subtitle: string;
  dateContext: string;
  imageCount: number;
  coverImage: FeedImage;
  presentation: 'avatar' | 'highlight';
  latestActivityTimestamp: number;
}

export interface StoryRailPayload {
  railKind: 'stories';
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  hasAvatarStory: boolean;
  avatarStoryId: string | null;
  items: StoryRailCapsule[];
  highlights: StoryRailCapsule[];
}

export const REDISCOVER_MIN_AGE_MS = 1000 * 60 * 60 * 24 * 180;
export const DIVERSIFIED_FETCH_BATCH_SIZE = 72;
export const MAX_DIVERSIFIED_CANDIDATES = 2400;
export const THIS_WEEK_RADIUS_DAYS = 7;
export const LAST_YEAR_RADIUS_DAYS = 45;
export const HIGHLIGHT_BATCH_CANDIDATE_LIMIT = 180;
export const HIGHLIGHT_BATCH_COUNT = 3;
export const HIGHLIGHT_CAPSULE_MAX_ITEMS = 30;
// Keep the rail visually distinct from the first home-feed screen when enough alternatives exist.
export const HIGHLIGHT_FEED_OVERLAP_WINDOW = 18;
export const RAIL_COVER_CANDIDATE_LIMIT = 12;
export const FALLBACK_AVATAR_STORY_LIMIT = 10;
export const FALLBACK_AVATAR_STORY_ID = '__story-avatar-fallback__';
export const SUPPORTED_LOCALES = ['en', 'es', 'zh'] as const;

export interface PlaceRowFields {
  placeId?: number | null;
  placeSlug?: string | null;
  placeName?: string | null;
  placeKind?: PlaceKind | null;
  placeIsApproximate?: number | null;
}

export type IndexedFeedImage = FeedImage & PlaceRowFields & { playbackStrategy?: PlaybackStrategy | null };
export type ScannerProgress = ReturnType<typeof scannerService.getProgress>;
export type ViewerScanProgress = ScannerProgress & {
  currentFolder: null;
  currentFile: null;
};
export type IndexedImageDetail = ImageDetail & PlaceRowFields & { playbackStrategy?: PlaybackStrategy | null; exifJson?: string | null };
export type IndexedTrashImage = TrashImage & PlaceRowFields & { playbackStrategy?: PlaybackStrategy | null };
export type ScanSummaryRecord = ReturnType<typeof scanRunRepository.latestCompleted>;

export function toViewerSafeScanSummary(scan: ScanSummaryRecord | null) {
  if (!scan) {
    return null;
  }

  return {
    ...scan,
    error_text: null,
    warning_text: null
  };
}

export function buildViewerSafeStorageReason(libraryAvailable: boolean): string | null {
  return libraryAvailable ? null : 'Configured library storage is unavailable.';
}

export function getLocalDayBounds(now = new Date()): { startIso: string; endIso: string } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

export function parseFeedMode(value: string | null): FeedMode {
  return value === 'recent' || value === 'rediscover' || value === 'random' ? value : 'random';
}

export function getDefaultHomeFeedMode(): FeedMode {
  return parseFeedMode(appSettingsRepository.get(HOME_FEED_DEFAULT_MODE_SETTING_KEY));
}

export function parseSupportedLocale(value: string | null): SupportedLocale | null {
  if (!value) {
    return null;
  }

  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as SupportedLocale) : null;
}

export function getDefaultLocale(): SupportedLocale | null {
  return parseSupportedLocale(appSettingsRepository.get(APP_DEFAULT_LOCALE_SETTING_KEY));
}

export function parseReelsFeedMode(value: string | null): ReelsFeedMode {
  return value === 'recommended' || value === 'recent' || value === 'random' ? value : 'random';
}

export function getDefaultReelsFeedMode(): ReelsFeedMode {
  return parseReelsFeedMode(appSettingsRepository.get(REELS_FEED_DEFAULT_MODE_SETTING_KEY));
}

export function parseFolderImageOrder(value: string | null): FolderImageOrder {
  return value === 'oldest' ? 'oldest' : 'newest';
}

export function getDefaultFolderImageOrder(): FolderImageOrder {
  return parseFolderImageOrder(appSettingsRepository.get(FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY));
}

export const VIDEO_PLAYBACK_QUALITIES: VideoPlaybackQuality[] = ['auto', 'original', '1080p', '720p', '480p'];

export function getVideoPlaybackQuality(): VideoPlaybackQuality {
  const stored = appSettingsRepository.get(VIDEO_PLAYBACK_QUALITY_SETTING_KEY);
  return VIDEO_PLAYBACK_QUALITIES.includes(stored as VideoPlaybackQuality)
    ? (stored as VideoPlaybackQuality)
    : 'auto';
}

export const VIDEO_PLAYBACK_MODES: VideoPlaybackMode[] = ['direct', 'transcode'];

export function getVideoPlaybackMode(): VideoPlaybackMode {
  const stored = appSettingsRepository.get(VIDEO_PLAYBACK_MODE_SETTING_KEY);
  return VIDEO_PLAYBACK_MODES.includes(stored as VideoPlaybackMode)
    ? (stored as VideoPlaybackMode)
    : 'transcode';
}

export function getNestedFolderTitleFormat(): NestedFolderTitleFormat {
  return parseNestedFolderTitleFormatSetting(appSettingsRepository.get(NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY));
}

export function getTreatStoriesAsFolders(): boolean {
  return parseTreatStoriesAsFoldersSetting(appSettingsRepository.get(TREAT_STORIES_AS_FOLDERS_SETTING_KEY));
}

export function getTreatCarouselsAsFolders(): boolean {
  return parseTreatCarouselsAsFoldersSetting(appSettingsRepository.get(TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY));
}

export function getCustomExcludedFolders(): string[] {
  return parseExcludedFolderRulesFromSetting(appSettingsRepository.get(EXCLUDED_FOLDERS_SETTING_KEY));
}

export function getExcludedFolderSettings() {
  const envExcludedFolders = [...appConfig.galleryExcludedFolders];
  const customExcludedFolders = getCustomExcludedFolders();

  return {
    envExcludedFolders,
    customExcludedFolders,
    effectiveExcludedFolders: getEffectiveExcludedFolderRules({
      envRules: envExcludedFolders,
      customRules: customExcludedFolders
    })
  };
}

export function getStoriesMigrationStatus() {
  return {
    hasLegacyStoriesCandidates: folderRepository.hasLegacyStoriesCandidates(),
    decisionPending: appSettingsRepository.get(STORIES_MIGRATION_DECISION_SETTING_KEY) === null
  };
}

export function getCarouselsMigrationStatus() {
  const decision = appSettingsRepository.get(CAROUSELS_MIGRATION_DECISION_SETTING_KEY);
  const selectedMode = serializeTreatCarouselsAsFoldersSetting(getTreatCarouselsAsFolders());
  const appliedMode = appSettingsRepository.get(CAROUSELS_APPLIED_MODE_SETTING_KEY);

  return {
    hasLegacyCarouselsCandidates: folderRepository.hasLegacyCarouselsCandidates(),
    decisionPending: decision === null,
    reconciliationPending: decision !== null && appliedMode !== selectedMode
  };
}

export function getDerivativeAssetVersion(): string | null {
  const lastCompletedScanId = scanRunRepository.latestCompleted()?.id ?? null;
  return lastCompletedScanId === null ? null : String(lastCompletedScanId);
}

export function toPublicMediaUrl(basePath: '/thumbnails' | '/previews', relativePath: string, version?: string | null): string {
  const encodedSegments = relativePath.split('/').map(encodeURIComponent).join('/');
  if (!version) {
    return `${basePath}/${encodedSegments}`;
  }

  return `${basePath}/${encodedSegments}?v=${encodeURIComponent(version)}`;
}

export function buildOriginalUrl(id: number): string {
  return `/api/originals/${id}`;
}

export function buildStreamUrl(id: number): string {
  return `/api/videos/${id}/hls/master.m3u8`;
}

export interface VideoPlaybackSource {
  previewUrl: string;
  streamUrl: string | null;
}

/**
 * Videos are never served from a pre-rendered preview file. Sources the browser
 * can decode as-is play straight from the original, and everything else is
 * transcoded on demand into HLS segments so playback starts immediately and
 * seeking only pays for the segment being watched.
 *
 * Every video still advertises a stream URL even when the original is directly
 * playable, because that is what lets a viewer pick a lower quality by hand.
 */
export function resolveVideoPlaybackSource(
  id: number,
  playbackStrategy: PlaybackStrategy | null | undefined
): VideoPlaybackSource {
  const streamUrl = buildStreamUrl(id);

  return {
    previewUrl: playbackStrategy === 'original' ? buildOriginalUrl(id) : streamUrl,
    streamUrl
  };
}

export function appendVersion(url: string, version?: string | null): string {
  if (!version) {
    return url;
  }

  return `${url}?v=${encodeURIComponent(version)}`;
}

export const FOLDER_SHARE_ASSET_BASE_PATH = '/api/share/images';

export function buildShareThumbnailUrl(
  id: number,
  version?: string | null,
  assetBasePath: string = FOLDER_SHARE_ASSET_BASE_PATH
): string {
  return appendVersion(`${assetBasePath}/${id}/thumbnail`, version);
}

export function buildSharePreviewUrl(
  id: number,
  version?: string | null,
  assetBasePath: string = FOLDER_SHARE_ASSET_BASE_PATH
): string {
  return appendVersion(`${assetBasePath}/${id}/preview`, version);
}

export function buildPreviewUrl(
  image: {
    id: number;
    mediaType: MediaType;
    previewUrl: string;
    playbackStrategy?: PlaybackStrategy | null;
  },
  useOriginalForImages = false,
  version?: string | null
): string {
  if (image.mediaType === 'video') {
    return resolveVideoPlaybackSource(image.id, image.playbackStrategy).previewUrl;
  }

  if (useOriginalForImages && image.mediaType === 'image') {
    return buildOriginalUrl(image.id);
  }

  return toPublicMediaUrl('/previews', image.previewUrl, version);
}

export function buildVideoPreviewFileUrl(
  image: { mediaType: MediaType; previewUrl: string },
  version?: string | null
): string | null {
  return image.mediaType === 'video'
    ? toPublicMediaUrl('/previews', image.previewUrl, version)
    : null;
}

export function mapPlaceSummaryFromRow(image: PlaceRowFields) {
  if (!image.placeId || !image.placeSlug || !image.placeName || !image.placeKind) {
    return null;
  }

  return {
    id: image.placeId,
    slug: image.placeSlug,
    name: image.placeName,
    kind: image.placeKind,
    isApproximate: image.placeIsApproximate === 1
  };
}

const ORIGINAL_MEDIA_PATH_CACHE_TTL_MS = 30_000;
const originalMediaPathCache = new Map<number, { path: string; filename: string; expiresAt: number }>();

export function invalidateOriginalMediaPathCache(imageIds: readonly number[] = []): void {
  if (imageIds.length === 0) {
    originalMediaPathCache.clear();
    return;
  }

  for (const imageId of imageIds) {
    originalMediaPathCache.delete(imageId);
  }
}

export function resolveOriginalMediaFile(id: number): { path: string; filename: string } | null {
  if (!storageService.getState().libraryAvailable || scannerService.isLibraryRebuildRequired()) {
    return null;
  }

  const cached = originalMediaPathCache.get(id);
  if (cached && cached.expiresAt > Date.now()) {
    return { path: cached.path, filename: cached.filename };
  }

  const detail = imageRepository.getById(id);
  if (!detail || detail.is_deleted || detail.is_trashed) {
    originalMediaPathCache.delete(id);
    return null;
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveOriginalPath(detail.relative_path);
  } catch {
    originalMediaPathCache.delete(id);
    return null;
  }

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    // The index outlived the file. Soft deleting here keeps the feed from
    // handing out the same dead post on every reload, instead of waiting for
    // the next full scan to notice.
    originalMediaPathCache.delete(id);
    imageRepository.markDeleted(detail.relative_path);
    return null;
  }

  originalMediaPathCache.set(id, {
    path: resolvedPath,
    filename: detail.filename,
    expiresAt: Date.now() + ORIGINAL_MEDIA_PATH_CACHE_TTL_MS
  });

  return {
    path: resolvedPath,
    filename: detail.filename
  };
}

export function resolveIndexedOriginalPath(relativePath: string): string | null {
  try {
    return resolveOriginalPath(relativePath);
  } catch {
    return null;
  }
}

export function resolveWithinRoot(rootPath: string, targetPath: string): string | null {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(path.resolve(rootPath), resolved);

  if ((relative.startsWith('..') || path.isAbsolute(relative)) || relative === '') {
    return relative === '' ? resolved : null;
  }

  return resolved;
}

export function resolveStoredPathWithinRoot(rootPath: string, relativePath: string, label: string): string | null {
  const resolvedPath = resolveWithinRoot(rootPath, path.join(rootPath, relativePath));
  if (!resolvedPath && relativePath) {
    throw new Error(`Stored ${label} path is outside the configured root`);
  }

  return resolvedPath;
}

export async function removeFileIfPresent(targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  try {
    await fsPromises.unlink(targetPath);
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code !== 'ENOENT') {
      throw error;
    }
  }
}

export async function removeFileAndPruneAncestors(rootPath: string, targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  await removeFileIfPresent(targetPath);

  let currentDirectory = path.dirname(targetPath);
  const resolvedRoot = path.resolve(rootPath);

  while (currentDirectory.startsWith(resolvedRoot) && currentDirectory !== resolvedRoot) {
    try {
      await fsPromises.rmdir(currentDirectory);
    } catch (error) {
      const directoryError = error as NodeJS.ErrnoException;
      if (directoryError.code === 'ENOENT' || directoryError.code === 'ENOTEMPTY' || directoryError.code === 'EEXIST' || directoryError.code === 'EPERM' || directoryError.code === 'EBUSY') {
        return;
      }

      throw error;
    }

    currentDirectory = path.dirname(currentDirectory);
  }
}

export async function removeDirectoryIfEmpty(targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  try {
    await fsPromises.rmdir(targetPath);
  } catch (error) {
    const directoryError = error as NodeJS.ErrnoException;
    if (directoryError.code !== 'ENOENT' && directoryError.code !== 'ENOTEMPTY' && directoryError.code !== 'EEXIST' && directoryError.code !== 'EPERM' && directoryError.code !== 'EBUSY') {
      throw error;
    }
  }
}

export async function removeDirectoryTree(targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  try {
    await fsPromises.rm(targetPath, { recursive: true, force: true });
  } catch (error) {
    const directoryError = error as NodeJS.ErrnoException;
    if (directoryError.code !== 'ENOENT') {
      throw error;
    }
  }
}

export function countDerivativeFilesOnDisk(rootPath: string): number {
  try {
    const entries = fs.readdirSync(rootPath, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      const entryPath = path.join(rootPath, entry.name);

      if (entry.isDirectory()) {
        count += countDerivativeFilesOnDisk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name !== '.gitkeep') {
        count += 1;
      }
    }

    return count;
  } catch (error) {
    const filesystemError = error as NodeJS.ErrnoException;
    if (filesystemError.code === 'ENOENT') {
      return 0;
    }

    throw error;
  }
}

export function isSameOrDescendantFolderPath(rootFolderPath: string, candidateFolderPath: string): boolean {
  return candidateFolderPath === rootFolderPath || candidateFolderPath.startsWith(`${rootFolderPath}/`);
}

export function getParentFolderDisplayName(folderPath: string, folderNamesByPath?: Map<string, string>): string | null {
  const parentFolderPath = getParentRelativePath(folderPath);
  if (!parentFolderPath) {
    return null;
  }

  const parentName = folderNamesByPath
    ? folderNamesByPath.get(parentFolderPath)
    : folderRepository.getByFolderPath(parentFolderPath)?.name;
  if (parentName?.trim()) {
    return parentName.trim();
  }

  return getLeafPathName(parentFolderPath);
}

export function mapFeedImage(image: IndexedFeedImage, derivativeVersion = getDerivativeAssetVersion()): FeedImage {
  const { playbackStrategy, placeId, placeSlug, placeName, placeKind, placeIsApproximate, isSaved, mediaItems, itemCount, ...rest } = image as any;
  return {
    ...rest,
    postType: rest.postType ?? 'single',
    carouselTitle: rest.postType === 'carousel' && rest.sourcePath ? getLeafPathName(rest.sourcePath) : null,
    isAnimated: Boolean(rest.isAnimated),
    isSaved: Boolean(isSaved),
    folderParentName: getParentFolderDisplayName(rest.folderPath),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: rest.id,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl,
      playbackStrategy
    }, false, derivativeVersion),
    previewFileUrl: buildVideoPreviewFileUrl({
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, derivativeVersion),
    playbackStrategy: rest.mediaType === 'video' ? (playbackStrategy ?? 'preview') : null,
    streamUrl: rest.mediaType === 'video'
      ? resolveVideoPlaybackSource(rest.id, playbackStrategy).streamUrl
      : null,
    originalUrl: buildOriginalUrl(rest.id),
    place: mapPlaceSummaryFromRow({ placeId, placeSlug, placeName, placeKind, placeIsApproximate }),
    mediaItems: (mediaItems ?? []).map((item: any) => ({
      imageId: item.imageId,
      position: item.position,
      filename: item.filename,
      mediaType: item.mediaType,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
      isAnimated: Boolean(item.isAnimated),
      thumbnailUrl: toPublicMediaUrl('/thumbnails', item.thumbnailUrl, derivativeVersion),
      previewUrl: buildPreviewUrl({
        id: item.imageId,
        mediaType: item.mediaType,
        previewUrl: item.previewUrl,
        playbackStrategy: item.playbackStrategy
      }, false, derivativeVersion),
      previewFileUrl: buildVideoPreviewFileUrl({
        mediaType: item.mediaType,
        previewUrl: item.previewUrl
      }, derivativeVersion),
      originalUrl: buildOriginalUrl(item.imageId),
      playbackStrategy: item.playbackStrategy ?? 'preview',
      streamUrl: item.mediaType === 'video'
        ? resolveVideoPlaybackSource(item.imageId, item.playbackStrategy).streamUrl
        : null,
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      relativePath: item.relativePath,
      exif: item.exif ?? null
    })),
    itemCount: itemCount ?? (mediaItems ? mediaItems.length : 1)
  };
}

export function resolvePostRecord(id: number, isLegacyImageAlias = false): PostRecord | undefined {
  if (isLegacyImageAlias) {
    return postRepository.findByImageId(id);
  }
  return postRepository.findById(id);
}

export function isCoverPost(postId: number): boolean {
  return postRepository.isExplicitFolderCover(postId);
}

/**
 * Where a share response should point its media. Folder shares use the shared
 * `/api/share/images` routes; a single-post token gets its own prefix so the token
 * itself carries the authorization and nothing else in the library is reachable.
 */
export interface ShareAssetContext {
  assetBasePath: string;
  /** Set only for token shares, which can also stream HLS. */
  streamBasePath?: string;
}

export const FOLDER_SHARE_ASSET_CONTEXT: ShareAssetContext = { assetBasePath: FOLDER_SHARE_ASSET_BASE_PATH };

export function buildShareStreamUrl(context: ShareAssetContext, imageId: number): string | null {
  return context.streamBasePath ? `${context.streamBasePath}/${imageId}/hls/master.m3u8` : null;
}

export function mapSharedMediaItem(
  item: PostMediaItem,
  derivativeVersion: string | null,
  context: ShareAssetContext = FOLDER_SHARE_ASSET_CONTEXT
): PostMediaItem {
  return {
    imageId: item.imageId,
    position: item.position,
    filename: item.filename,
    mediaType: item.mediaType,
    width: item.width,
    height: item.height,
    durationMs: item.durationMs,
    isAnimated: Boolean(item.isAnimated),
    thumbnailUrl: buildShareThumbnailUrl(item.imageId, derivativeVersion, context.assetBasePath),
    previewUrl: buildSharePreviewUrl(item.imageId, derivativeVersion, context.assetBasePath),
    streamUrl: item.mediaType === 'video' ? buildShareStreamUrl(context, item.imageId) : null,
    playbackStrategy: item.playbackStrategy ?? 'preview',
    mimeType: item.mimeType,
    fileSize: item.fileSize
  };
}

export function mapSharedFeedImage(image: IndexedFeedImage, derivativeVersion = getDerivativeAssetVersion()): SharedFeedItem {
  const mediaItems = image.mediaItems ?? [];
  const representativeImageId = mediaItems[0]?.imageId ?? image.id;
  return {
    id: image.id,
    folderId: image.folderId,
    folderSlug: image.folderSlug,
    folderName: image.folderName,
    filename: image.filename,
    caption: image.caption,
    carouselTitle: image.postType === 'carousel' && image.sourcePath ? getLeafPathName(image.sourcePath) : null,
    width: image.width,
    height: image.height,
    mediaType: image.mediaType,
    durationMs: image.durationMs,
    isAnimated: Boolean(image.isAnimated),
    thumbnailUrl: buildShareThumbnailUrl(representativeImageId, derivativeVersion),
    previewUrl: buildSharePreviewUrl(representativeImageId, derivativeVersion),
    sortTimestamp: image.sortTimestamp,
    postType: image.postType ?? 'single',
    itemCount: image.itemCount ?? (mediaItems.length || 1),
    mediaItems: mediaItems.map((item) => mapSharedMediaItem(item, derivativeVersion))
  };
}

export function mapImageDetail(image: IndexedImageDetail, derivativeVersion = getDerivativeAssetVersion()): ImageDetail {
  const { playbackStrategy, exifJson, placeId, placeSlug, placeName, placeKind, placeIsApproximate, isSaved, mediaItems, itemCount, ...rest } = image as any;
  const useOriginalForImages = appConfig.imageDetailSource === 'original';
  const representativeImageId = mediaItems?.[0]?.imageId ?? rest.id;
  return {
    ...rest,
    postType: rest.postType ?? 'single',
    carouselTitle: rest.postType === 'carousel' && rest.sourcePath ? getLeafPathName(rest.sourcePath) : null,
    isAnimated: Boolean(rest.isAnimated),
    isSaved: Boolean(isSaved),
    exif: deserializeImageExifData(exifJson),
    folderParentName: getParentFolderDisplayName(rest.folderPath),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: representativeImageId,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl,
      playbackStrategy
    }, useOriginalForImages, derivativeVersion),
    previewFileUrl: buildVideoPreviewFileUrl({
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, derivativeVersion),
    originalUrl: buildOriginalUrl(representativeImageId),
    playbackStrategy,
    streamUrl: rest.mediaType === 'video'
      ? resolveVideoPlaybackSource(representativeImageId, playbackStrategy).streamUrl
      : null,
    place: mapPlaceSummaryFromRow({ placeId, placeSlug, placeName, placeKind, placeIsApproximate }),
    mediaItems: (mediaItems ?? []).map((item: any) => ({
      imageId: item.imageId,
      position: item.position,
      filename: item.filename,
      mediaType: item.mediaType,
      width: item.width,
      height: item.height,
      durationMs: item.durationMs,
      isAnimated: Boolean(item.isAnimated),
      thumbnailUrl: toPublicMediaUrl('/thumbnails', item.thumbnailUrl, derivativeVersion),
      previewUrl: buildPreviewUrl({
        id: item.imageId,
        mediaType: item.mediaType,
        previewUrl: item.previewUrl,
        playbackStrategy: item.playbackStrategy
      }, false, derivativeVersion),
      previewFileUrl: buildVideoPreviewFileUrl({
        mediaType: item.mediaType,
        previewUrl: item.previewUrl
      }, derivativeVersion),
      originalUrl: buildOriginalUrl(item.imageId),
      playbackStrategy: item.playbackStrategy ?? 'preview',
      streamUrl: item.mediaType === 'video'
        ? resolveVideoPlaybackSource(item.imageId, item.playbackStrategy).streamUrl
        : null,
      mimeType: item.mimeType,
      fileSize: item.fileSize,
      relativePath: item.relativePath,
      exif: item.exif ?? null
    })),
    itemCount: itemCount ?? (mediaItems ? mediaItems.length : 1)
  };
}

export function mapSharedImageDetail(
  image: IndexedImageDetail,
  derivativeVersion = getDerivativeAssetVersion(),
  context: ShareAssetContext = FOLDER_SHARE_ASSET_CONTEXT
): SharedImageDetail {
  const mediaItems = image.mediaItems ?? [];
  const representativeImageId = mediaItems[0]?.imageId ?? image.id;
  return {
    id: image.id,
    folderId: image.folderId,
    folderSlug: image.folderSlug,
    folderName: image.folderName,
    filename: image.filename,
    caption: image.caption,
    carouselTitle: image.postType === 'carousel' && image.sourcePath ? getLeafPathName(image.sourcePath) : null,
    mediaType: image.mediaType,
    mimeType: image.mimeType,
    width: image.width,
    height: image.height,
    durationMs: image.durationMs,
    isAnimated: Boolean(image.isAnimated),
    thumbnailUrl: buildShareThumbnailUrl(representativeImageId, derivativeVersion, context.assetBasePath),
    previewUrl: buildSharePreviewUrl(representativeImageId, derivativeVersion, context.assetBasePath),
    streamUrl: image.mediaType === 'video' ? buildShareStreamUrl(context, representativeImageId) : null,
    playbackStrategy: (image as { playbackStrategy?: PlaybackStrategy | null }).playbackStrategy ?? null,
    sortTimestamp: image.sortTimestamp,
    nextImageId: image.nextImageId,
    previousImageId: image.previousImageId,
    postType: image.postType ?? 'single',
    itemCount: image.itemCount ?? (mediaItems.length || 1),
    mediaItems: mediaItems.map((item) => mapSharedMediaItem(item, derivativeVersion, context))
  };
}

export function mapTrashImage(image: IndexedTrashImage, derivativeVersion = getDerivativeAssetVersion()): TrashImage {
  const mapped = mapFeedImage(image as IndexedFeedImage, derivativeVersion);
  return {
    ...mapped,
    trashedAt: image.trashedAt
  };
}

export interface FolderSummaryContext {
  /** Resolved once per list so scan_runs is not queried per folder. */
  derivativeVersion: string | null;
  /** Prebuilt folder_path -> name map so parents are not looked up per folder. */
  folderNamesByPath: Map<string, string>;
}

export function createFolderSummaryContext(): FolderSummaryContext {
  return {
    derivativeVersion: getDerivativeAssetVersion(),
    folderNamesByPath: new Map(folderRepository.listPathNames().map((row) => [row.folder_path, row.name]))
  };
}

export function buildFolderSummary(folder: FolderSummaryRecord, context?: FolderSummaryContext) {
  const derivativeVersion = context ? context.derivativeVersion : getDerivativeAssetVersion();
  const hasPreloadedAvatarSummary =
    Object.hasOwn(folder, 'summary_avatar_image_id') || Object.hasOwn(folder, 'summary_avatar_thumbnail_path');

  if (hasPreloadedAvatarSummary) {
    return {
      id: folder.id,
      slug: folder.slug,
      name: folder.name,
      description: folder.description,
      parentFolderName: getParentFolderDisplayName(folder.folder_path, context?.folderNamesByPath),
      folderPath: folder.folder_path,
      breadcrumb: getPathBreadcrumb(folder.folder_path),
      imageCount: folder.image_count,
      postCount: folder.post_count,
      videoCount: folder.video_count,
      latestImageMtimeMs: folder.latest_image_mtime_ms,
      hasAvatarStory: Boolean(folder.has_avatar_story),
      avatarImageId: folder.summary_avatar_image_id ?? null,
      avatarUrl: folder.summary_avatar_thumbnail_path
        ? toPublicMediaUrl('/thumbnails', folder.summary_avatar_thumbnail_path, derivativeVersion)
        : null
    };
  }

  const preferredAvatarImageId = folder.avatar_image_id ?? imageRepository.getLatestFolderImageId(folder.id);
  let avatar = preferredAvatarImageId ? imageRepository.getImageDetail(preferredAvatarImageId, undefined, true) : undefined;

  if (!avatar) {
    const fallbackAvatarImageId = imageRepository.getLatestFolderImageId(folder.id);
    avatar = fallbackAvatarImageId ? imageRepository.getImageDetail(fallbackAvatarImageId, undefined, true) : undefined;
  }

  return {
    id: folder.id,
    slug: folder.slug,
    name: folder.name,
    description: folder.description,
    parentFolderName: getParentFolderDisplayName(folder.folder_path, context?.folderNamesByPath),
    folderPath: folder.folder_path,
    breadcrumb: getPathBreadcrumb(folder.folder_path),
    imageCount: folder.image_count,
    postCount: folder.post_count,
    videoCount: folder.video_count,
    latestImageMtimeMs: folder.latest_image_mtime_ms,
    hasAvatarStory: Boolean(folder.has_avatar_story),
    avatarImageId: avatar?.id ?? null,
    avatarUrl: avatar ? mapImageDetail(avatar, derivativeVersion).thumbnailUrl : null
  };
}

export function buildSharedFolderSummary(folder: FolderSummaryRecord): SharedFolderSummary {
  const derivativeVersion = getDerivativeAssetVersion();
  const summary = buildFolderSummary(folder);

  return {
    id: summary.id,
    slug: summary.slug,
    name: summary.name,
    description: summary.description,
    imageCount: summary.imageCount,
    postCount: summary.postCount,
    videoCount: summary.videoCount,
    avatarThumbnailUrl: summary.avatarImageId ? buildShareThumbnailUrl(summary.avatarImageId, derivativeVersion) : null,
    sortTimestamp: summary.latestImageMtimeMs ?? 0
  };
}

export function mapFeedImageForOwnerFolder(
  image: IndexedFeedImage,
  ownerFolder: ReturnType<typeof buildFolderSummary>,
  derivativeVersion = getDerivativeAssetVersion()
): FeedImage {
  return {
    ...mapFeedImage(image, derivativeVersion),
    folderId: ownerFolder.id,
    folderSlug: ownerFolder.slug,
    folderName: ownerFolder.name,
    folderParentName: ownerFolder.parentFolderName,
    folderPath: ownerFolder.folderPath,
    folderBreadcrumb: ownerFolder.breadcrumb
  };
}

export function formatStoryDateContext(timestamp: number | null): string {
  if (timestamp === null) {
    return 'No recent activity';
  }

  return `Latest ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp))}`;
}

export function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
}

export function formatShortRange(startDate: Date, endDate: Date): string {
  const sameMonth = startDate.getMonth() === endDate.getMonth();
  const sameYear = startDate.getFullYear() === endDate.getFullYear();

  if (sameMonth && sameYear) {
    const month = new Intl.DateTimeFormat(undefined, { month: 'short' }).format(startDate);
    return `${month} ${startDate.getDate()}-${endDate.getDate()}, ${startDate.getFullYear()}`;
  }

  return `${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(startDate)} to ${new Intl.DateTimeFormat(
    undefined,
    {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }
  ).format(endDate)}`;
}

export function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

export function mapFeedItems(items: IndexedFeedImage[], derivativeVersion = getDerivativeAssetVersion()): FeedImage[] {
  return items.map((item) => mapFeedImage(item, derivativeVersion));
}

export function mapCollectionSummary(collection: CollectionSummaryRecord, derivativeVersion = getDerivativeAssetVersion()) {
  const previewImages = collection.preview_image_ids
    ? collection.preview_image_ids
      .split(',')
      .map((value) => Number.parseInt(value, 10))
      .filter((value, index, values) => Number.isInteger(value) && value > 0 && values.indexOf(value) === index)
      .map((id) => {
        const previewDetail = imageRepository.getImageDetail(id, undefined, false);
        return previewDetail ? mapImageDetail(previewDetail, derivativeVersion) : null;
      })
      .filter((image): image is ImageDetail => image !== null)
    : [];
  const coverImage = previewImages[0]
    ?? (collection.cover_image_id
      ? (() => {
          const coverDetail = imageRepository.getImageDetail(collection.cover_image_id, undefined, false);
          return coverDetail ? mapImageDetail(coverDetail, derivativeVersion) : null;
        })()
      : null);

  return {
    id: collection.id,
    slug: collection.slug,
    name: collection.name,
    isDefault: collection.is_default === 1,
    itemCount: collection.item_count,
    coverImage,
    previewImages,
    createdAt: collection.created_at,
    updatedAt: collection.updated_at
  };
}

export function mapCollectionMembership(collection: CollectionMembershipRecord, derivativeVersion = getDerivativeAssetVersion()) {
  return {
    ...mapCollectionSummary(collection, derivativeVersion),
    containsImage: collection.contains_image === 1
  };
}

export function buildPaginatedPayload(items: FeedImage[], page: number, limit: number, total: number) {
  return {
    items,
    page,
    limit,
    total,
    hasMore: page * limit < total
  };
}

export function buildTrashPaginatedPayload(items: TrashImage[], page: number, limit: number, total: number) {
  return {
    items,
    page,
    limit,
    total,
    hasMore: page * limit < total
  };
}

export function sliceItemsForPage(items: FeedImage[], page: number, limit: number): FeedImage[] {
  const offset = (page - 1) * limit;
  return items.slice(offset, offset + limit);
}
