import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import {
  APP_DEFAULT_LOCALE_SETTING_KEY,
  EXCLUDED_FOLDERS_SETTING_KEY,
  FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY,
  HOME_FEED_DEFAULT_MODE_SETTING_KEY,
  LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY,
  LIBRARY_REBUILD_REQUIRED_SETTING_KEY,
  NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY,
  PREVIOUS_GALLERY_ROOT_SETTING_KEY,
  REELS_FEED_DEFAULT_MODE_SETTING_KEY,
  STORIES_MIGRATION_DECISION_SETTING_KEY,
  TREAT_STORIES_AS_FOLDERS_SETTING_KEY
} from '../constants/app-setting-keys.js';
import { appConfig } from '../config/env.js';
import {
  appSettingsRepository,
  collectionConstants,
  collectionRepository,
  folderRepository,
  folderScanStateRepository,
  imageRepository,
  likeRepository,
  placeRepository,
  scanRunRepository,
  statsRepository
} from '../db/repositories.js';
import type {
  CollectionMembershipRecord,
  CollectionSummaryRecord,
  FeedImage,
  FolderImageOrder,
  NestedFolderTitleFormat,
  FolderRecord,
  FolderSummaryRecord,
  ImageDetail,
  MediaType,
  PlaceKind,
  PlaybackStrategy,
  TrashImage
} from '../types/models.js';
import {
  getEffectiveExcludedFolderRules,
  parseExcludedFolderRulesFromSetting,
  serializeExcludedFolderRulesForSetting
} from '../utils/excluded-folder-rules.js';
import { deserializeImageExifData } from '../utils/exif-utils.js';
import { buildMonthDayKey, countFeedBursts, diversifyFeedCandidates, groupFeedBursts, listMonthDayKeysAroundDate } from '../utils/feed-utils.js';
import { shouldPreferMomentRail, type FeedRailKind } from '../utils/feed-rail-utils.js';
import { parseNestedFolderTitleFormatSetting, serializeNestedFolderTitleFormatSetting } from '../utils/folder-title-format.js';
import { countSupportedRootMediaFiles } from '../utils/gallery-root-utils.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import { getLeafPathName, getParentRelativePath, getPathBreadcrumb } from '../utils/path-utils.js';
import { buildReelQueue, shuffleReelCandidates, type ReelAffinitySignals } from '../utils/reels-utils.js';
import { parseTreatStoriesAsFoldersSetting, serializeTreatStoriesAsFoldersSetting } from '../utils/stories-utils.js';
import { scannerService } from './scanner-service.js';
import { storageService } from './storage-service.js';
import { geodataService, placeResolutionService } from './place-service.js';

type FeedMode = 'recent' | 'rediscover' | 'random';
type ReelsFeedMode = 'recommended' | 'recent' | 'random';
type SupportedLocale = 'en' | 'es' | 'zh';

interface FeedCapsuleDefinition {
  id: string;
  title: string;
  subtitle: string;
  dateContext: string;
  momentDate?: MomentDateMetadata;
  minimumImageCount: number;
  count: () => Promise<number>;
  list: (page: number, limit: number) => Promise<FeedImage[]>;
}

interface CalendarDateParts {
  year: number;
  month: number;
  day: number;
}

type MomentDateMetadata =
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

interface FeedRailDefinition {
  kind: FeedRailKind;
  title: string;
  description: string;
  singularLabel: string;
  capsules: FeedCapsuleDefinition[];
}

interface DeleteFolderOptions {
  deleteSourceFolder?: boolean;
}

interface StoryRailCapsule {
  id: string;
  title: string;
  subtitle: string;
  dateContext: string;
  imageCount: number;
  coverImage: FeedImage;
  presentation: 'avatar' | 'highlight';
  latestActivityTimestamp: number;
}

interface StoryRailPayload {
  railKind: 'stories';
  railTitle: string;
  railDescription: string;
  railSingularLabel: string;
  hasAvatarStory: boolean;
  avatarStoryId: string | null;
  items: StoryRailCapsule[];
  highlights: StoryRailCapsule[];
}

const REDISCOVER_MIN_AGE_MS = 1000 * 60 * 60 * 24 * 180;
const DIVERSIFIED_FETCH_BATCH_SIZE = 72;
const MAX_DIVERSIFIED_CANDIDATES = 2400;
const THIS_WEEK_RADIUS_DAYS = 7;
const LAST_YEAR_RADIUS_DAYS = 45;
const HIGHLIGHT_BATCH_CANDIDATE_LIMIT = 180;
const HIGHLIGHT_BATCH_COUNT = 3;
const HIGHLIGHT_CAPSULE_MAX_ITEMS = 30;
// Keep the rail visually distinct from the first home-feed screen when enough alternatives exist.
const HIGHLIGHT_FEED_OVERLAP_WINDOW = 18;
const RAIL_COVER_CANDIDATE_LIMIT = 12;
const FALLBACK_AVATAR_STORY_LIMIT = 10;
const FALLBACK_AVATAR_STORY_ID = '__story-avatar-fallback__';
const SUPPORTED_LOCALES = ['en', 'es', 'zh'] as const;

interface PlaceRowFields {
  placeId?: number | null;
  placeSlug?: string | null;
  placeName?: string | null;
  placeKind?: PlaceKind | null;
  placeIsApproximate?: number | null;
}

type IndexedFeedImage = FeedImage & PlaceRowFields & { playbackStrategy?: PlaybackStrategy | null };
type IndexedImageDetail = ImageDetail & PlaceRowFields & { playbackStrategy?: PlaybackStrategy | null; exifJson?: string | null };
type IndexedTrashImage = TrashImage & PlaceRowFields & { playbackStrategy?: PlaybackStrategy | null };
type ScanSummaryRecord = Awaited<ReturnType<typeof scanRunRepository.latestCompleted>>;

function toViewerSafeScanSummary(scan: ScanSummaryRecord | null) {
  if (!scan) {
    return null;
  }

  return {
    ...scan,
    error_text: null
  };
}

function buildViewerSafeStorageReason(libraryAvailable: boolean): string | null {
  return libraryAvailable ? null : 'Configured library storage is unavailable.';
}

function parseFeedMode(value: string | null): FeedMode {
  return value === 'recent' || value === 'rediscover' || value === 'random' ? value : 'random';
}

async function getDefaultHomeFeedMode(): Promise<FeedMode> {
  return parseFeedMode(await appSettingsRepository.get(HOME_FEED_DEFAULT_MODE_SETTING_KEY));
}

function parseSupportedLocale(value: string | null): SupportedLocale | null {
  if (!value) {
    return null;
  }

  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as SupportedLocale) : null;
}

async function getDefaultLocale(): Promise<SupportedLocale | null> {
  return parseSupportedLocale(await appSettingsRepository.get(APP_DEFAULT_LOCALE_SETTING_KEY));
}

function parseReelsFeedMode(value: string | null): ReelsFeedMode {
  return value === 'recommended' || value === 'recent' || value === 'random' ? value : 'random';
}

async function getDefaultReelsFeedMode(): Promise<ReelsFeedMode> {
  return parseReelsFeedMode(await appSettingsRepository.get(REELS_FEED_DEFAULT_MODE_SETTING_KEY));
}

function parseFolderImageOrder(value: string | null): FolderImageOrder {
  return value === 'oldest' ? 'oldest' : 'newest';
}

async function getDefaultFolderImageOrder(): Promise<FolderImageOrder> {
  return parseFolderImageOrder(await appSettingsRepository.get(FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY));
}

async function getNestedFolderTitleFormat(): Promise<NestedFolderTitleFormat> {
  return parseNestedFolderTitleFormatSetting(await appSettingsRepository.get(NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY));
}

async function getTreatStoriesAsFolders(): Promise<boolean> {
  return parseTreatStoriesAsFoldersSetting(await appSettingsRepository.get(TREAT_STORIES_AS_FOLDERS_SETTING_KEY));
}

async function getCustomExcludedFolders(): Promise<string[]> {
  return parseExcludedFolderRulesFromSetting(await appSettingsRepository.get(EXCLUDED_FOLDERS_SETTING_KEY));
}

async function getExcludedFolderSettings() {
  const envExcludedFolders = [...appConfig.galleryExcludedFolders];
  const customExcludedFolders = await getCustomExcludedFolders();

  return {
    envExcludedFolders,
    customExcludedFolders,
    effectiveExcludedFolders: getEffectiveExcludedFolderRules({
      envRules: envExcludedFolders,
      customRules: customExcludedFolders
    })
  };
}

async function getStoriesMigrationStatus() {
  return {
    hasLegacyStoriesCandidates: await folderRepository.hasLegacyStoriesCandidates(),
    decisionPending: await appSettingsRepository.get(STORIES_MIGRATION_DECISION_SETTING_KEY) === null
  };
}

async function getDerivativeAssetVersion(): Promise<string | null> {
  const lastCompletedScanId = (await scanRunRepository.latestCompleted())?.id ?? null;
  return lastCompletedScanId === null ? null : String(lastCompletedScanId);
}

function toPublicMediaUrl(basePath: '/thumbnails' | '/previews', relativePath: string, version?: string | null): string {
  const encodedSegments = relativePath.split('/').map(encodeURIComponent).join('/');
  if (!version) {
    return `${basePath}/${encodedSegments}`;
  }

  return `${basePath}/${encodedSegments}?v=${encodeURIComponent(version)}`;
}

function buildOriginalUrl(id: number): string {
  return `/api/originals/${id}`;
}

function buildPreviewUrl(
  image: {
    id: number;
    mediaType: MediaType;
    previewUrl: string;
  },
  useOriginalForImages = false,
  version?: string | null
): string {
  if (useOriginalForImages && image.mediaType === 'image') {
    return buildOriginalUrl(image.id);
  }

  return toPublicMediaUrl('/previews', image.previewUrl, version);
}

function mapPlaceSummaryFromRow(image: PlaceRowFields) {
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

async function resolveOriginalMediaFile(id: number): Promise<{ path: string; filename: string } | null> {
  if (!storageService.getState().libraryAvailable || await scannerService.isLibraryRebuildRequired()) {
    return null;
  }

  const detail = await imageRepository.getById(id);
  if (!detail || detail.is_deleted || detail.is_trashed) {
    return null;
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolveOriginalPath(detail.relative_path);
  } catch {
    return null;
  }

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return null;
  }

  return {
    path: resolvedPath,
    filename: detail.filename
  };
}

function resolveIndexedOriginalPath(relativePath: string): string | null {
  try {
    return resolveOriginalPath(relativePath);
  } catch {
    return null;
  }
}

function resolveWithinRoot(rootPath: string, targetPath: string): string | null {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(path.resolve(rootPath), resolved);

  if ((relative.startsWith('..') || path.isAbsolute(relative)) || relative === '') {
    return relative === '' ? resolved : null;
  }

  return resolved;
}

function resolveStoredPathWithinRoot(rootPath: string, relativePath: string, label: string): string | null {
  const resolvedPath = resolveWithinRoot(rootPath, path.join(rootPath, relativePath));
  if (!resolvedPath && relativePath) {
    throw new Error(`Stored ${label} path is outside the configured root`);
  }

  return resolvedPath;
}

async function removeFileIfPresent(targetPath: string | null): Promise<void> {
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

async function removeFileAndPruneAncestors(rootPath: string, targetPath: string | null): Promise<void> {
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
      if (directoryError.code === 'ENOENT' || directoryError.code === 'ENOTEMPTY' || directoryError.code === 'EEXIST') {
        return;
      }

      throw error;
    }

    currentDirectory = path.dirname(currentDirectory);
  }
}

async function removeDirectoryIfEmpty(targetPath: string | null): Promise<void> {
  if (!targetPath) {
    return;
  }

  try {
    await fsPromises.rmdir(targetPath);
  } catch (error) {
    const directoryError = error as NodeJS.ErrnoException;
    if (directoryError.code !== 'ENOENT' && directoryError.code !== 'ENOTEMPTY' && directoryError.code !== 'EEXIST') {
      throw error;
    }
  }
}

async function removeDirectoryTree(targetPath: string | null): Promise<void> {
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

function countDerivativeFilesOnDisk(rootPath: string): number {
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

function isSameOrDescendantFolderPath(rootFolderPath: string, candidateFolderPath: string): boolean {
  return candidateFolderPath === rootFolderPath || candidateFolderPath.startsWith(`${rootFolderPath}/`);
}

async function getParentFolderDisplayName(folderPath: string): Promise<string | null> {
  const parentFolderPath = getParentRelativePath(folderPath);
  if (!parentFolderPath) {
    return null;
  }

  const parentFolder = await folderRepository.getByFolderPath(parentFolderPath);
  if (parentFolder?.name.trim()) {
    return parentFolder.name.trim();
  }

  return getLeafPathName(parentFolderPath);
}

async function mapFeedImage(
  image: IndexedFeedImage,
  derivativeVersion: string | null,
  parentNames?: Map<string, string | null>
): Promise<FeedImage> {
  const { playbackStrategy, placeId, placeSlug, placeName, placeKind, placeIsApproximate, isSaved, ...rest } = image;
  return {
    ...rest,
    isAnimated: Boolean(rest.isAnimated),
    isSaved: Boolean(isSaved),
    folderParentName: parentNames
      ? (parentNames.get(rest.folderPath) ?? null)
      : await getParentFolderDisplayName(rest.folderPath),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: rest.id,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, false, derivativeVersion),
    place: mapPlaceSummaryFromRow({ placeId, placeSlug, placeName, placeKind, placeIsApproximate })
  };
}

async function mapImageDetail(image: IndexedImageDetail, derivativeVersion: string | null): Promise<ImageDetail> {
  const { playbackStrategy, exifJson, placeId, placeSlug, placeName, placeKind, placeIsApproximate, isSaved, ...rest } = image;
  const useOriginalForImages = appConfig.imageDetailSource === 'original';
  return {
    ...rest,
    isAnimated: Boolean(rest.isAnimated),
    isSaved: Boolean(isSaved),
    exif: deserializeImageExifData(exifJson),
    folderParentName: await getParentFolderDisplayName(rest.folderPath),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: rest.id,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, useOriginalForImages, derivativeVersion),
    originalUrl: buildOriginalUrl(rest.id),
    playbackStrategy,
    place: mapPlaceSummaryFromRow({ placeId, placeSlug, placeName, placeKind, placeIsApproximate })
  };
}

async function mapTrashImage(image: IndexedTrashImage, derivativeVersion: string | null): Promise<TrashImage> {
  const { playbackStrategy, placeId, placeSlug, placeName, placeKind, placeIsApproximate, isSaved, ...rest } = image;
  return {
    ...rest,
    isAnimated: Boolean(rest.isAnimated),
    isSaved: Boolean(isSaved),
    folderParentName: await getParentFolderDisplayName(rest.folderPath),
    folderBreadcrumb: getPathBreadcrumb(rest.folderPath),
    thumbnailUrl: toPublicMediaUrl('/thumbnails', rest.thumbnailUrl, derivativeVersion),
    previewUrl: buildPreviewUrl({
      id: rest.id,
      mediaType: rest.mediaType,
      previewUrl: rest.previewUrl
    }, false, derivativeVersion),
    place: mapPlaceSummaryFromRow({ placeId, placeSlug, placeName, placeKind, placeIsApproximate })
  };
}

async function buildFolderSummary(folder: FolderSummaryRecord) {
  const derivativeVersion = await getDerivativeAssetVersion();
  const hasPreloadedAvatarSummary =
    Object.hasOwn(folder, 'summary_avatar_image_id') || Object.hasOwn(folder, 'summary_avatar_thumbnail_path');

  if (hasPreloadedAvatarSummary) {
    return {
      id: folder.id,
      slug: folder.slug,
      name: folder.name,
      description: folder.description,
      parentFolderName: await getParentFolderDisplayName(folder.folder_path),
      folderPath: folder.folder_path,
      breadcrumb: getPathBreadcrumb(folder.folder_path),
      imageCount: folder.image_count,
      videoCount: folder.video_count,
      latestImageMtimeMs: folder.latest_image_mtime_ms,
      hasAvatarStory: Boolean(folder.has_avatar_story),
      avatarImageId: folder.summary_avatar_image_id ?? null,
      avatarUrl: folder.summary_avatar_thumbnail_path
        ? toPublicMediaUrl('/thumbnails', folder.summary_avatar_thumbnail_path, derivativeVersion)
        : null
    };
  }

  const preferredAvatarImageId = folder.avatar_image_id ?? await imageRepository.getLatestFolderImageId(folder.id);
  let avatar = preferredAvatarImageId ? await imageRepository.getImageDetail(preferredAvatarImageId, undefined, true) : undefined;

  if (!avatar) {
    const fallbackAvatarImageId = await imageRepository.getLatestFolderImageId(folder.id);
    avatar = fallbackAvatarImageId ? await imageRepository.getImageDetail(fallbackAvatarImageId, undefined, true) : undefined;
  }

  return {
    id: folder.id,
    slug: folder.slug,
    name: folder.name,
    description: folder.description,
    parentFolderName: await getParentFolderDisplayName(folder.folder_path),
    folderPath: folder.folder_path,
    breadcrumb: getPathBreadcrumb(folder.folder_path),
    imageCount: folder.image_count,
    videoCount: folder.video_count,
    latestImageMtimeMs: folder.latest_image_mtime_ms,
    hasAvatarStory: Boolean(folder.has_avatar_story),
    avatarImageId: avatar?.id ?? null,
    avatarUrl: avatar ? (await mapImageDetail(avatar, derivativeVersion)).thumbnailUrl : null
  };
}

async function mapFeedImageForOwnerFolder(
  image: IndexedFeedImage,
  ownerFolder: Awaited<ReturnType<typeof buildFolderSummary>>,
  derivativeVersion: string | null
): Promise<FeedImage> {
  return {
    ...await mapFeedImage(image, derivativeVersion),
    folderId: ownerFolder.id,
    folderSlug: ownerFolder.slug,
    folderName: ownerFolder.name,
    folderParentName: ownerFolder.parentFolderName,
    folderPath: ownerFolder.folderPath,
    folderBreadcrumb: ownerFolder.breadcrumb
  };
}

function formatStoryDateContext(timestamp: number | null): string {
  if (timestamp === null) {
    return 'No recent activity';
  }

  return `Latest ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(timestamp))}`;
}

function formatMonthDay(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' }).format(date);
}

function formatShortRange(startDate: Date, endDate: Date): string {
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

function formatMonthYear(date: Date): string {
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(date);
}

async function resolveParentFolderNames(folderPaths: string[]): Promise<Map<string, string | null>> {
  const parentPaths = [...new Set(
    folderPaths.map(getParentRelativePath).filter((p): p is string => p !== null)
  )];
  if (parentPaths.length === 0) return new Map(folderPaths.map((fp) => [fp, null]));
  const parentFolders = await folderRepository.getByFolderPaths(parentPaths);
  const nameByPath = new Map(parentFolders.map((f) => [f.folder_path, f.name.trim() || getLeafPathName(f.folder_path)]));
  return new Map(folderPaths.map((fp) => {
    const pp = getParentRelativePath(fp);
    return [fp, pp ? (nameByPath.get(pp) ?? getLeafPathName(pp)) : null];
  }));
}

async function mapFeedItems(items: IndexedFeedImage[], derivativeVersion: string | null): Promise<FeedImage[]> {
  const parentNames = await resolveParentFolderNames(items.map((item) => item.folderPath));
  return Promise.all(items.map((item) => mapFeedImage(item, derivativeVersion, parentNames)));
}

async function mapCollectionSummary(collection: CollectionSummaryRecord, derivativeVersion: string | null) {
  const previewImages: ImageDetail[] = collection.preview_image_ids
    ? (await Promise.all(
        collection.preview_image_ids
          .split(',')
          .map((value) => Number.parseInt(value, 10))
          .filter((value, index, values) => Number.isInteger(value) && value > 0 && values.indexOf(value) === index)
          .map(async (id) => {
            const previewDetail = await imageRepository.getImageDetail(id, undefined, false);
            return previewDetail ? await mapImageDetail(previewDetail, derivativeVersion) : null;
          })
      )).filter((image): image is ImageDetail => image !== null)
    : [];

  let coverImage: ImageDetail | null = previewImages[0] ?? null;
  if (!coverImage && collection.cover_image_id) {
    const coverDetail = await imageRepository.getImageDetail(collection.cover_image_id, undefined, false);
    coverImage = coverDetail ? await mapImageDetail(coverDetail, derivativeVersion) : null;
  }

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

async function mapCollectionMembership(collection: CollectionMembershipRecord, derivativeVersion: string | null) {
  return {
    ...await mapCollectionSummary(collection, derivativeVersion),
    containsImage: collection.contains_image === 1
  };
}

function paginate<T>(rawItems: T[], limit: number): { items: T[]; hasMore: boolean } {
  const hasMore = rawItems.length > limit;
  return { items: hasMore ? rawItems.slice(0, limit) : rawItems, hasMore };
}

function sliceItemsForPage(items: FeedImage[], page: number, limit: number): FeedImage[] {
  const offset = (page - 1) * limit;
  return items.slice(offset, offset + limit);
}

function filterExcludedFeedItems(items: FeedImage[], excludedImageIds: Set<number>): FeedImage[] {
  if (excludedImageIds.size === 0) {
    return items;
  }

  return items.filter((item) => !excludedImageIds.has(item.id));
}

function limitHighlightItems(items: FeedImage[], minimumImageCount: number, excludedImageIds: Set<number>): FeedImage[] {
  const cappedItems = items.slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
  if (excludedImageIds.size === 0) {
    return cappedItems;
  }

  const filteredItems = filterExcludedFeedItems(items, excludedImageIds).slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
  return filteredItems.length >= minimumImageCount ? filteredItems : cappedItems;
}

function buildStaticCapsuleDefinition(
  capsule: Pick<FeedCapsuleDefinition, 'id' | 'title' | 'subtitle' | 'dateContext' | 'minimumImageCount'>,
  items: FeedImage[]
): FeedCapsuleDefinition {
  const cappedItems = items.slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);

  return {
    ...capsule,
    count: async () => cappedItems.length,
    list: async (page, limit) => sliceItemsForPage(cappedItems, page, limit)
  };
}

async function listDiversifiedModeItems(
  page: number,
  limit: number,
  loadBatch: (offset: number, batchLimit: number) => Promise<FeedImage[]>
): Promise<{ items: FeedImage[]; hasMore: boolean }> {
  const targetCount = page * limit;
  const candidateLimit = Math.min(Math.max(targetCount * 12, 720), MAX_DIVERSIFIED_CANDIDATES);
  const candidates: FeedImage[] = [];
  let offset = 0;

  while (offset < candidateLimit) {
    const batch = await loadBatch(offset, Math.min(DIVERSIFIED_FETCH_BATCH_SIZE, candidateLimit - offset));
    if (batch.length === 0) {
      break;
    }

    candidates.push(...batch);
    offset += batch.length;

    if (countFeedBursts(candidates) >= targetCount || batch.length < DIVERSIFIED_FETCH_BATCH_SIZE) {
      break;
    }
  }

  const diversified = diversifyFeedCandidates(candidates);
  const pageStart = (page - 1) * limit;
  const items = diversified.slice(pageStart, pageStart + limit);
  const hasMore = diversified.length > pageStart + limit || candidates.length >= candidateLimit;
  return { items, hasMore };
}

function createDailySeed(now = new Date()): number {
  return Number(`${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`);
}

function toCalendarDateParts(date: Date): CalendarDateParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate()
  };
}

async function getHighlightFeedOverlapImageIds(): Promise<Set<number>> {
  const recentFeedItems = await imageRepository.listRecentCandidates(0, HIGHLIGHT_FEED_OVERLAP_WINDOW);

  return new Set(recentFeedItems.map((item) => item.id));
}

async function getRecentBatchHighlightItems(excludedImageIds: Set<number>): Promise<FeedImage[]> {
  const candidates = await imageRepository.listRecentCandidates(0, HIGHLIGHT_BATCH_CANDIDATE_LIMIT);
  const bursts = groupFeedBursts(candidates)
    .filter((burst) => burst.items.length >= 2)
    .slice(0, HIGHLIGHT_BATCH_COUNT * 2);
  const filteredBursts = bursts
    .map((burst) => ({
      ...burst,
      items: filterExcludedFeedItems(burst.items, excludedImageIds)
    }))
    .filter((burst) => burst.items.length >= 2)
    .slice(0, HIGHLIGHT_BATCH_COUNT);

  if (filteredBursts.length > 0) {
    return filteredBursts.flatMap((burst) => burst.items).slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
  }

  return bursts
    .slice(0, HIGHLIGHT_BATCH_COUNT)
    .flatMap((burst) => burst.items)
    .slice(0, HIGHLIGHT_CAPSULE_MAX_ITEMS);
}

function buildMomentRailDefinition(now = new Date()): FeedRailDefinition {
  const currentYear = now.getFullYear();
  const onThisDayKeys = [buildMonthDayKey(now)];
  const weekKeys = listMonthDayKeysAroundDate(now, THIS_WEEK_RADIUS_DAYS, THIS_WEEK_RADIUS_DAYS);
  const lastYearReference = new Date(now);
  lastYearReference.setFullYear(lastYearReference.getFullYear() - 1);
  const lastYearStart = new Date(lastYearReference);
  lastYearStart.setDate(lastYearStart.getDate() - LAST_YEAR_RADIUS_DAYS);
  lastYearStart.setHours(0, 0, 0, 0);
  const lastYearEnd = new Date(lastYearReference);
  lastYearEnd.setDate(lastYearEnd.getDate() + LAST_YEAR_RADIUS_DAYS);
  lastYearEnd.setHours(23, 59, 59, 999);
  const thisWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - THIS_WEEK_RADIUS_DAYS);
  const thisWeekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + THIS_WEEK_RADIUS_DAYS);

  return {
    kind: 'moments',
    title: 'Moments',
    description: 'Memory capsules shaped by real capture dates from your library.',
    singularLabel: 'Moment',
    capsules: [
      {
        id: 'on-this-day',
        title: 'On This Day',
        subtitle: `${formatMonthDay(now)} across previous years`,
        dateContext: formatMonthDay(now),
        momentDate: {
          type: 'on-this-day',
          date: toCalendarDateParts(now)
        },
        minimumImageCount: 1,
        count: () => imageRepository.countByMonthDayKeys(onThisDayKeys, currentYear),
        list: async (page, limit) => mapFeedItems(await imageRepository.listByMonthDayKeys(onThisDayKeys, currentYear, (page - 1) * limit, limit), await getDerivativeAssetVersion())
      },
      {
        id: 'this-week-previous-years',
        title: 'This Week',
        subtitle: `${formatShortRange(thisWeekStart, thisWeekEnd)} from previous years`,
        dateContext: formatShortRange(thisWeekStart, thisWeekEnd),
        momentDate: {
          type: 'this-week-previous-years',
          startDate: toCalendarDateParts(thisWeekStart),
          endDate: toCalendarDateParts(thisWeekEnd)
        },
        minimumImageCount: 2,
        count: () => imageRepository.countByMonthDayKeys(weekKeys, currentYear),
        list: async (page, limit) => mapFeedItems(await imageRepository.listByMonthDayKeys(weekKeys, currentYear, (page - 1) * limit, limit), await getDerivativeAssetVersion())
      },
      {
        id: 'from-last-year',
        title: 'Last Year Around Now',
        subtitle: `A revisit to ${formatMonthYear(lastYearReference)}`,
        dateContext: formatShortRange(lastYearStart, lastYearEnd),
        momentDate: {
          type: 'from-last-year',
          referenceDate: toCalendarDateParts(lastYearReference),
          startDate: toCalendarDateParts(lastYearStart),
          endDate: toCalendarDateParts(lastYearEnd)
        },
        minimumImageCount: 1,
        count: () => imageRepository.countByEffectiveTimeRange(lastYearStart.getTime(), lastYearEnd.getTime()),
        list: async (page, limit) => mapFeedItems(await imageRepository.listByEffectiveTimeRange(lastYearStart.getTime(), lastYearEnd.getTime(), (page - 1) * limit, limit), await getDerivativeAssetVersion())
      }
    ]
  };
}

async function buildHighlightRailDefinition(now = new Date()): Promise<FeedRailDefinition> {
  const excludedImageIds = await getHighlightFeedOverlapImageIds();
  const rediscoverCutoff = now.getTime() - REDISCOVER_MIN_AGE_MS;
  const dailySeed = createDailySeed(now);
  const highlightFetchLimit = HIGHLIGHT_CAPSULE_MAX_ITEMS + HIGHLIGHT_FEED_OVERLAP_WINDOW;
  const derivativeVersion = await getDerivativeAssetVersion();
  const recentBatchItems = await getRecentBatchHighlightItems(excludedImageIds);
  const forgottenFavoriteItems = limitHighlightItems(
    await mapFeedItems(await likeRepository.listLikedOlderThan(0, highlightFetchLimit, rediscoverCutoff), derivativeVersion),
    1,
    excludedImageIds
  );
  const deepCutItems = limitHighlightItems(
    (await listDiversifiedModeItems(1, highlightFetchLimit, async (offset, batchLimit) =>
      mapFeedItems(await imageRepository.listRediscoverCandidates(offset, batchLimit, rediscoverCutoff), derivativeVersion)
    )).items,
    1,
    excludedImageIds
  );
  const luckyDipItems = limitHighlightItems(
    await mapFeedItems(await imageRepository.listRandom(0, highlightFetchLimit, dailySeed), derivativeVersion),
    1,
    excludedImageIds
  );
  const recentBatchCount = groupFeedBursts(recentBatchItems).length;

  return {
    kind: 'highlights',
    title: 'Stories',
    description: 'Curated story-style sets from your library when capture dates are sparse or synthetic.',
    singularLabel: 'Story',
    capsules: [
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-recent-batches',
          title: 'Recent Batches',
          subtitle: 'Latest runs gathered into one set',
          dateContext: `${recentBatchCount} batch${recentBatchCount === 1 ? '' : 'es'}`,
          minimumImageCount: 2
        },
        recentBatchItems
      ),
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-forgotten-favorites',
          title: 'Forgotten Favorites',
          subtitle: 'Older liked posts worth another look',
          dateContext: 'Liked and older than 6 months',
          minimumImageCount: 1
        },
        forgottenFavoriteItems
      ),
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-deep-cuts',
          title: 'Deep Cuts',
          subtitle: 'Older posts resurfaced from the archive',
          dateContext: 'Older than 6 months',
          minimumImageCount: 1
        },
        deepCutItems
      ),
      buildStaticCapsuleDefinition(
        {
          id: 'highlight-lucky-dip',
          title: 'Lucky Dip',
          subtitle: 'A playful mix from across the library',
          dateContext: 'Stable for today',
          minimumImageCount: 1
        },
        luckyDipItems
      )
    ]
  };
}

async function materializeRailDefinition(definition: FeedRailDefinition) {
  const usedCoverImageIds = new Set<number>();
  const derivativeVersion = await getDerivativeAssetVersion();

  const materializedCapsules = await Promise.all(
    definition.capsules.map(async (capsule) => {
      const imageCount = await capsule.count();
      if (imageCount < capsule.minimumImageCount) {
        return null;
      }

      const coverCandidates = await capsule.list(1, RAIL_COVER_CANDIDATE_LIMIT);
      const coverImage = coverCandidates.find((image) => !usedCoverImageIds.has(image.id)) ?? coverCandidates[0];
      if (!coverImage) {
        return null;
      }

      usedCoverImageIds.add(coverImage.id);

      return {
        id: capsule.id,
        title: capsule.title,
        subtitle: capsule.subtitle,
        dateContext: capsule.dateContext,
        momentDate: capsule.momentDate,
        imageCount,
        coverImage: await mapFeedImage(coverImage, derivativeVersion)
      };
    })
  );

  return {
    ...definition,
    capsules: materializedCapsules.filter((capsule): capsule is NonNullable<typeof capsule> => capsule !== null)
  };
}

async function getSelectedFeedRail(now = new Date()) {
  const [totalImages, exifImages] = await Promise.all([
    imageRepository.countFeed(),
    imageRepository.countByTakenAtSource('exif')
  ]);
  const preferMoments = shouldPreferMomentRail(totalImages, exifImages);
  const [momentRail, highlightRail] = await Promise.all([
    materializeRailDefinition(buildMomentRailDefinition(now)),
    materializeRailDefinition(await buildHighlightRailDefinition(now))
  ]);

  if (preferMoments && momentRail.capsules.length > 0) {
    return momentRail;
  }

  if (highlightRail.capsules.length > 0) {
    return highlightRail;
  }

  return momentRail.capsules.length > 0 ? momentRail : highlightRail;
}

async function buildFolderStoryRail(folder: FolderSummaryRecord): Promise<StoryRailPayload> {
  const ownerFolder = await buildFolderSummary(folder);
  const derivativeVersion = await getDerivativeAssetVersion();
  const storyFolders = await folderRepository.listOwnedStoryFolders(folder.id);
  const rootStoryFolder = storyFolders.find((entry) => entry.role === 'story_root') ?? null;
  const highlightStoryFolders = storyFolders.filter((entry) => entry.role === 'story_capsule');

  const rootStoryCapsule = rootStoryFolder ? await buildStoryRailCapsule(rootStoryFolder, ownerFolder, derivativeVersion) : null;
  const highlightCapsules = (await Promise.all(
    highlightStoryFolders.map((storyFolder) => buildStoryRailCapsule(storyFolder, ownerFolder, derivativeVersion))
  ))
    .filter((capsule): capsule is StoryRailCapsule => capsule !== null)
    .sort((left, right) => {
      if (left.latestActivityTimestamp !== right.latestActivityTimestamp) {
        return right.latestActivityTimestamp - left.latestActivityTimestamp;
      }

      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    });
  const avatarStoryCapsule = rootStoryCapsule ?? await buildFallbackAvatarStoryCapsule(ownerFolder, derivativeVersion);
  const items = avatarStoryCapsule ? [avatarStoryCapsule, ...highlightCapsules] : highlightCapsules;

  return {
    railKind: 'stories',
    railTitle: 'Stories',
    railDescription: `Stories and highlights for ${folder.name}.`,
    railSingularLabel: 'Story',
    hasAvatarStory: avatarStoryCapsule !== null,
    avatarStoryId: avatarStoryCapsule?.id ?? null,
    items,
    highlights: highlightCapsules
  };
}

async function buildStoryRailCapsule(
  storyFolder: FolderRecord,
  ownerFolder: Awaited<ReturnType<typeof buildFolderSummary>>,
  derivativeVersion: string | null
): Promise<StoryRailCapsule | null> {
  const imageCount = await imageRepository.countStoryMediaByFolder(storyFolder.id);
  if (imageCount === 0) {
    return null;
  }

  const coverImages = await imageRepository.listStoryFolderImages(storyFolder.id, 0, 1);
  const coverImage = coverImages[0];
  if (!coverImage) {
    return null;
  }

  const latestActivityTimestamp = await imageRepository.getLatestEffectiveTimestampByFolder(storyFolder.id) ?? 0;
  const presentation = storyFolder.role === 'story_root' ? 'avatar' as const : 'highlight' as const;

  return {
    id: storyFolder.slug,
    title: presentation === 'avatar' ? ownerFolder.name : storyFolder.name,
    subtitle: presentation === 'avatar' ? `${ownerFolder.name} story set` : 'Profile highlight',
    dateContext: formatStoryDateContext(latestActivityTimestamp),
    imageCount,
    coverImage: await mapFeedImageForOwnerFolder(coverImage, ownerFolder, derivativeVersion),
    presentation,
    latestActivityTimestamp
  };
}

async function buildFallbackAvatarStoryCapsule(
  ownerFolder: Awaited<ReturnType<typeof buildFolderSummary>>,
  derivativeVersion: string | null
): Promise<StoryRailCapsule | null> {
  const imageCount = Math.min(await imageRepository.countStoryCapsuleMediaByOwnerFolder(ownerFolder.id), FALLBACK_AVATAR_STORY_LIMIT);
  if (imageCount === 0) {
    return null;
  }

  const coverImages = await imageRepository.listStoryCapsuleImagesByOwnerFolder(ownerFolder.id, 0, 1);
  const coverImage = coverImages[0];
  if (!coverImage) {
    return null;
  }

  const latestActivityTimestamp = coverImage.takenAt ?? coverImage.sortTimestamp;

  return {
    id: FALLBACK_AVATAR_STORY_ID,
    title: ownerFolder.name,
    subtitle: 'Latest from highlights',
    dateContext: formatStoryDateContext(latestActivityTimestamp),
    imageCount,
    coverImage: await mapFeedImageForOwnerFolder(coverImage, ownerFolder, derivativeVersion),
    presentation: 'avatar',
    latestActivityTimestamp
  };
}

async function listFallbackAvatarStoryItems(
  ownerFolder: Awaited<ReturnType<typeof buildFolderSummary>>,
  page: number,
  limit: number,
  derivativeVersion: string | null
): Promise<{ items: FeedImage[]; hasMore: boolean }> {
  const offset = (page - 1) * limit;
  if (offset >= FALLBACK_AVATAR_STORY_LIMIT) {
    return { items: [], hasMore: false };
  }
  const maxFetch = Math.min(limit + 1, FALLBACK_AVATAR_STORY_LIMIT - offset);
  const raw = await imageRepository.listStoryCapsuleImagesByOwnerFolder(ownerFolder.id, offset, maxFetch);
  const { items: rawPage, hasMore } = paginate(raw, limit);
  const items = await Promise.all(rawPage.map((image) => mapFeedImageForOwnerFolder(image, ownerFolder, derivativeVersion)));
  return { items, hasMore };
}

export const galleryService = {
  async getFeed(page: number, limit: number, mode: FeedMode = 'random', randomSeed?: number) {
    if (!storageService.getState().libraryAvailable) {
      return {
        mode,
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const derivativeVersion = await getDerivativeAssetVersion();

    if (mode === 'random') {
      const seed = Number.isFinite(randomSeed)
        ? Number(randomSeed)
        : Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));
      const offset = (page - 1) * limit;
      const raw = await imageRepository.listRandom(offset, limit + 1, seed);
      const { items: rawPage, hasMore } = paginate(raw, limit);

      return {
        mode,
        items: await mapFeedItems(rawPage, derivativeVersion),
        page, limit, total: 0, hasMore
      };
    }

    if (mode === 'rediscover') {
      const cutoffTimestamp = Date.now() - REDISCOVER_MIN_AGE_MS;
      const { items, hasMore } = await listDiversifiedModeItems(page, limit, async (offset, batchLimit) =>
        mapFeedItems(await imageRepository.listRediscoverCandidates(offset, batchLimit, cutoffTimestamp), derivativeVersion)
      );

      return { mode, items, page, limit, total: 0, hasMore };
    }

    const offset = (page - 1) * limit;
    const raw = await imageRepository.listRecentCandidates(offset, limit + 1);
    const { items: rawPage, hasMore } = paginate(raw, limit);

    return {
      mode,
      items: await mapFeedItems(rawPage, derivativeVersion),
      page, limit, total: 0, hasMore
    };
  },

  async getReels(page: number, limit: number, mode: ReelsFeedMode = 'recommended', seed?: number, signals: ReelAffinitySignals = {}) {
    if (!storageService.getState().libraryAvailable) {
      return {
        mode,
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const candidateLimit = appConfig.reelsCandidateLimit;
    const candidates = await imageRepository.listVisibleVideoCandidates(candidateLimit);
    if (candidates.length === 0) {
      return { mode, items: [], page, limit, total: 0, hasMore: false };
    }

    const orderedCandidates =
      mode === 'recent'
        ? candidates
        : (() => {
            const sessionSeed = Number.isFinite(seed)
              ? Number(seed)
              : Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));

            return mode === 'random' ? shuffleReelCandidates(candidates, sessionSeed) : buildReelQueue(candidates, sessionSeed, signals);
          })();
    const offset = (page - 1) * limit;
    const derivativeVersion = await getDerivativeAssetVersion();
    const { items: rawPage, hasMore } = paginate(orderedCandidates.slice(offset, offset + limit + 1), limit);

    return {
      mode,
      items: await mapFeedItems(rawPage, derivativeVersion),
      page, limit, total: 0, hasMore
    };
  },

  async searchMedia(query: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const derivativeVersion = await getDerivativeAssetVersion();
    const offset = (page - 1) * limit;
    const raw = await imageRepository.listVisibleSearch(normalizedQuery, offset, limit + 1);
    const { items: rawPage, hasMore } = paginate(raw, limit);

    return { items: await mapFeedItems(rawPage, derivativeVersion), page, limit, total: 0, hasMore };
  },

  async listMoments() {
    if (!storageService.getState().libraryAvailable) {
      return {
        railKind: 'moments' as FeedRailKind,
        railTitle: 'Moments',
        railDescription: 'Memory capsules shaped by real capture dates from your library.',
        railSingularLabel: 'Moment',
        items: []
      };
    }

    const rail = await getSelectedFeedRail(new Date());
    return {
      railKind: rail.kind,
      railTitle: rail.title,
      railDescription: rail.description,
      railSingularLabel: rail.singularLabel,
      items: rail.capsules
    };
  },

  async getMomentFeed(id: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const now = new Date();
    const rail = await getSelectedFeedRail(now);
    const capsule = rail.capsules.find((entry) => entry.id === id);

    if (!capsule) {
      return null;
    }

    const definition = (rail.kind === 'moments' ? buildMomentRailDefinition(now) : await buildHighlightRailDefinition(now)).capsules.find(
      (entry) => entry.id === id
    );
    if (!definition) {
      return null;
    }

    const rawItems = await definition.list(page, limit + 1);
    const { items, hasMore } = paginate(rawItems, limit);

    return {
      railKind: rail.kind,
      railTitle: rail.title,
      railDescription: rail.description,
      railSingularLabel: rail.singularLabel,
      moment: capsule,
      items, page, limit, total: 0, hasMore
    };
  },

  async listFolders(page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return { items: [], page, limit, total: 0, hasMore: false };
    }

    const offset = (page - 1) * limit;
    const summaries = await folderRepository.getSummaryPage(offset, limit + 1);
    const { items: summaryPage, hasMore } = paginate(summaries, limit);
    const items = await Promise.all(summaryPage.map(buildFolderSummary));
    return { items, page, limit, total: 0, hasMore };
  },

  async listPlaces() {
    if (!storageService.getState().libraryAvailable) {
      return [];
    }

    return (await placeRepository.list()).map((place) => ({
      ...placeResolutionService.placeDetail(place, place.post_count)
    }));
  },

  async getPlaceBySlug(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const place = await placeRepository.getBySlug(slug);
    if (!place) {
      return null;
    }

    return placeResolutionService.placeDetail(place, await placeRepository.countVisibleImages(place.id));
  },

  async getPlaceImages(slug: string, page: number, limit: number, mediaType?: MediaType) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const place = await placeRepository.getBySlug(slug);
    if (!place) {
      return null;
    }

    const derivativeVersion = await getDerivativeAssetVersion();
    const offset = (page - 1) * limit;
    const [raw, placePostCount] = await Promise.all([
      imageRepository.listPlaceImages(place.id, offset, limit + 1, mediaType),
      placeRepository.countVisibleImages(place.id)
    ]);
    const { items: rawPage, hasMore } = paginate(raw, limit);

    return {
      place: placeResolutionService.placeDetail(place, placePostCount),
      items: await Promise.all(rawPage.map((image) => mapFeedImage(image, derivativeVersion))),
      page, limit, total: 0, hasMore
    };
  },

  async getFolderBySlug(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = await folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderSummary(folder);
  },

  async updateFolderMetadata(slug: string, name: string, description: string | null) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    await folderRepository.updateMetadata(slug, name, description);
    const folder = await folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderSummary(folder);
  },

  async updateImageCaption(id: number, caption: string | null) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const defaultFolderImageOrder = await getDefaultFolderImageOrder();
    const existing = await imageRepository.getImageDetail(id, undefined, false, defaultFolderImageOrder);
    if (!existing) {
      return null;
    }

    await imageRepository.updateCaption(id, caption);

    const updated = await imageRepository.getImageDetail(id, undefined, false, defaultFolderImageOrder);
    return updated ? mapImageDetail(updated, await getDerivativeAssetVersion()) : null;
  },

  async setFolderAvatar(slug: string, imageId: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = await folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const image = await imageRepository.getById(imageId);
    if (!image || image.folder_id !== folder.id || image.is_deleted !== 0 || image.is_trashed !== 0) {
      return null;
    }

    await folderRepository.setAvatar(folder.id, imageId, 'manual');
    return true;
  },

  async getFolderStories(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = await folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderStoryRail(folder);
  },

  async getFolderStoryFeed(slug: string, storyId: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = await folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const rail = await buildFolderStoryRail(folder);
    const capsule = rail.items.find((entry) => entry.id === storyId);
    if (!capsule) {
      return null;
    }

    const ownerFolder = await buildFolderSummary(folder);
    const derivativeVersion = await getDerivativeAssetVersion();
    if (storyId === FALLBACK_AVATAR_STORY_ID) {
      const { items, hasMore } = await listFallbackAvatarStoryItems(ownerFolder, page, limit, derivativeVersion);

      return {
        railKind: 'stories' as const,
        railTitle: rail.railTitle,
        railDescription: rail.railDescription,
        railSingularLabel: rail.railSingularLabel,
        story: capsule,
        items, page, limit, total: 0, hasMore
      };
    }

    const storyFolder = await folderRepository.getOwnedStoryFolderBySlug(folder.id, storyId);
    if (!storyFolder) {
      return null;
    }

    const offset = (page - 1) * limit;
    const raw = await imageRepository.listStoryFolderImages(storyFolder.id, offset, limit + 1);
    const { items: rawPage, hasMore } = paginate(raw, limit);
    const items = await Promise.all(rawPage.map((image) => mapFeedImageForOwnerFolder(image, ownerFolder, derivativeVersion)));

    return {
      railKind: 'stories' as const,
      railTitle: rail.railTitle,
      railDescription: rail.railDescription,
      railSingularLabel: rail.railSingularLabel,
      story: capsule,
      items, page, limit, total: 0, hasMore
    };
  },

  async getFolderImages(slug: string, page: number, limit: number, mediaType?: MediaType) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = await folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const derivativeVersion = await getDerivativeAssetVersion();
    const defaultFolderImageOrder = await getDefaultFolderImageOrder();
    const offset = (page - 1) * limit;
    const raw = await imageRepository.listFolderImages(folder.id, offset, limit + 1, mediaType, defaultFolderImageOrder);
    const { items: rawPage, hasMore } = paginate(raw, limit);

    return {
      folder: await buildFolderSummary(folder),
      items: await Promise.all(rawPage.map((image) => mapFeedImage(image, derivativeVersion))),
      page, limit, total: 0, hasMore
    };
  },

  async getImageDetail(id: number, mediaType?: MediaType) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const defaultFolderImageOrder = await getDefaultFolderImageOrder();
    let detail = await imageRepository.getImageDetail(id, mediaType, false, defaultFolderImageOrder);
    if (!detail) {
      const avatarDetail = await imageRepository.getImageDetail(id, mediaType, true, defaultFolderImageOrder);
      if (avatarDetail && avatarDetail.folderAvatarImageId === avatarDetail.id) {
        detail = avatarDetail;
      }
    }

    if (!detail) {
      return null;
    }

    return mapImageDetail(detail, await getDerivativeAssetVersion());
  },

  getPlacesStatus() {
    return geodataService.getStatus();
  },

  async preparePlacesGeodata() {
    return geodataService.prepare();
  },

  rebuildPlaces() {
    return placeResolutionService.rebuildAssignments();
  },

  async getTrashImages(page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const derivativeVersion = await getDerivativeAssetVersion();
    const offset = (page - 1) * limit;
    const raw = await imageRepository.listTrashed(offset, limit + 1);
    const { items: rawPage, hasMore } = paginate(raw, limit);
    const items = await Promise.all(rawPage.map((image) => mapTrashImage(image as IndexedTrashImage, derivativeVersion)));

    return { items, page, limit, total: 0, hasMore };
  },

  async getCollections() {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: []
      };
    }

    const derivativeVersion = await getDerivativeAssetVersion();
    return {
      items: await Promise.all(
        (await collectionRepository.listSummaries()).map((collection) => mapCollectionSummary(collection, derivativeVersion))
      )
    };
  },

  async getCollectionImages(slug: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const collection = await collectionRepository.getBySlug(slug);
    if (!collection) {
      return null;
    }

    const derivativeVersion = await getDerivativeAssetVersion();
    const offset = (page - 1) * limit;
    const [raw, allSummaries] = await Promise.all([
      collectionRepository.listImages(slug, offset, limit + 1),
      collectionRepository.listSummaries()
    ]);
    const { items: rawPage, hasMore } = paginate(raw, limit);
    const collectionSummary = allSummaries.find((entry) => entry.slug === slug) ?? {
      ...collection,
      item_count: 0,
      cover_image_id: null,
      cover_thumbnail_path: null,
      preview_image_ids: null
    };

    return {
      collection: await mapCollectionSummary(collectionSummary, derivativeVersion),
      items: await Promise.all(rawPage.map((image) => mapFeedImage(image, derivativeVersion))),
      page, limit, total: 0, hasMore
    };
  },

  async getImageCollections(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = await imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    const derivativeVersion = await getDerivativeAssetVersion();
    return {
      imageId: id,
      isSaved: await collectionRepository.isImageSaved(id),
      items: await Promise.all(
        (await collectionRepository.listMembershipsForImage(id)).map((collection) => mapCollectionMembership(collection, derivativeVersion))
      )
    };
  },

  async createCollection(name: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const collection = await collectionRepository.create(name);
    const allSummaries = await collectionRepository.listSummaries();
    const summary = allSummaries.find((entry) => entry.id === collection.id);
    return summary ? mapCollectionSummary(summary, await getDerivativeAssetVersion()) : null;
  },

  async updateCollection(slug: string, name: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const collection = await collectionRepository.updateName(slug, name);
    if (!collection) {
      return null;
    }

    const allSummaries = await collectionRepository.listSummaries();
    const summary = allSummaries.find((entry) => entry.id === collection.id);
    return summary ? mapCollectionSummary(summary, await getDerivativeAssetVersion()) : null;
  },

  async deleteCollection(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const allSummaries = await collectionRepository.listSummaries();
    const summary = allSummaries.find((entry) => entry.slug === slug);
    if (!summary) {
      return null;
    }

    const deleted = await collectionRepository.delete(slug);
    if (!deleted) {
      return null;
    }

    return mapCollectionSummary(summary, await getDerivativeAssetVersion());
  },

  async saveImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = await imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    const collection = await collectionRepository.saveToDefault(id);
    const allSummaries = await collectionRepository.listSummaries();
    const summary = allSummaries.find((entry) => entry.id === collection.id);
    const derivativeVersion = await getDerivativeAssetVersion();

    return {
      id,
      imageId: id,
      isSaved: await collectionRepository.isImageSaved(id),
      collection: summary ? await mapCollectionSummary(summary, derivativeVersion) : undefined
    };
  },

  async unsaveImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = await imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    await collectionRepository.unsaveEverywhere(id);

    return {
      id,
      imageId: id,
      isSaved: false
    };
  },

  async addImageToCollection(slug: string, id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = await imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    const collection = slug === collectionConstants.defaultCollectionSlug
      ? await collectionRepository.saveToDefault(id)
      : await collectionRepository.addImage(slug, id);
    if (!collection) {
      return null;
    }

    const allSummaries = await collectionRepository.listSummaries();
    const summary = allSummaries.find((entry) => entry.id === collection.id);
    const derivativeVersion = await getDerivativeAssetVersion();

    return {
      id,
      imageId: id,
      isSaved: true,
      collection: summary ? await mapCollectionSummary(summary, derivativeVersion) : undefined
    };
  },

  async removeImageFromCollection(slug: string, id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = await imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    const collection = await collectionRepository.getBySlug(slug);
    if (!collection) {
      return null;
    }

    if (collection.is_default === 1) {
      await collectionRepository.unsaveEverywhere(id);
      return {
        id,
        imageId: id,
        isSaved: false
      };
    }

    await collectionRepository.removeImage(slug, id);
    const allSummaries = await collectionRepository.listSummaries();
    const summary = allSummaries.find((entry) => entry.id === collection.id);
    const derivativeVersion = await getDerivativeAssetVersion();

    return {
      id,
      imageId: id,
      isSaved: await collectionRepository.isImageSaved(id),
      collection: summary ? await mapCollectionSummary(summary, derivativeVersion) : undefined
    };
  },

  async getLikeIds() {
    if (!storageService.getState().libraryAvailable) return { ids: [] };
    return { ids: await likeRepository.listLikedIds() };
  },

  async getLikes(page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return { items: [], page, limit, total: 0, hasMore: false };
    }

    const offset = (page - 1) * limit;
    const raw = await likeRepository.listLikedImages(offset, limit + 1);
    const { items: rawPage, hasMore } = paginate(raw, limit);
    const items = await mapFeedItems(rawPage, await getDerivativeAssetVersion());
    return { items, page, limit, total: 0, hasMore };
  },

  async likeImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = await imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    await likeRepository.upsert(id);

    return {
      id,
      liked: true
    };
  },

  async unlikeImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = await imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    await likeRepository.remove(id);

    return {
      id,
      liked: false
    };
  },

  async trashImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const imageRecord = await imageRepository.getById(id);
    if (!imageRecord || imageRecord.is_deleted) {
      return null;
    }

    const folder = await folderRepository.getById(imageRecord.folder_id);
    if (!folder) {
      return null;
    }

    if (imageRecord.is_trashed === 0) {
      await imageRepository.moveToTrash(id);
      await folderRepository.syncAvatarSelection(imageRecord.folder_id);
      await folderRepository.updateCounts(imageRecord.folder_id);
      await statsRepository.refresh();
    }

    return {
      id: imageRecord.id,
      folderSlug: folder.slug
    };
  },

  async restoreImage(id: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const imageRecord = await imageRepository.getById(id);
    if (!imageRecord || imageRecord.is_deleted || imageRecord.is_trashed === 0) {
      return null;
    }

    const folder = await folderRepository.getById(imageRecord.folder_id);
    if (!folder) {
      return null;
    }

    await imageRepository.restoreFromTrash(id);
    await folderRepository.syncAvatarSelection(imageRecord.folder_id);
    await folderRepository.updateCounts(imageRecord.folder_id);
    await statsRepository.refresh();

    return {
      id: imageRecord.id,
      folderSlug: folder.slug
    };
  },

  async getStatus() {
    const storageState = storageService.getState();
    const [
      rebuildRequired,
      defaultHomeFeedMode,
      defaultLocale,
      defaultReelsFeedMode,
      defaultFolderImageOrder,
      nestedFolderTitleFormat,
      treatStoriesAsFolders,
      storiesMigration,
      folderCount,
      indexedImages,
      indexedVideos
    ] = await Promise.all([
      appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY).then(v => v === '1'),
      getDefaultHomeFeedMode(),
      getDefaultLocale(),
      getDefaultReelsFeedMode(),
      getDefaultFolderImageOrder(),
      getNestedFolderTitleFormat(),
      getTreatStoriesAsFolders(),
      getStoriesMigrationStatus(),
      storageState.libraryAvailable ? folderRepository.count() : Promise.resolve(0),
      storageState.libraryAvailable ? imageRepository.countFeed() : Promise.resolve(0),
      storageState.libraryAvailable ? imageRepository.countByMediaType('video') : Promise.resolve(0)
    ]);

    return {
      folders: folderCount,
      indexedImages,
      indexedVideos,
      scan: await this.getScanProgress(),
      storage: {
        available: storageState.libraryAvailable,
        reason: buildViewerSafeStorageReason(storageState.libraryAvailable)
      },
      libraryIndex: {
        rebuildRequired,
        reason: rebuildRequired ? 'gallery_root_changed' : null,
        ignoredRootMediaCount: storageState.libraryAvailable ? countSupportedRootMediaFiles(appConfig.galleryRoot) : 0
      },
      preferences: {
        defaultLocale,
        defaultHomeFeedMode,
        defaultReelsFeedMode,
        defaultFolderImageOrder,
        nestedFolderTitleFormat,
        treatStoriesAsFolders
      },
      storiesMigration
    };
  },

  async getScanProgress() {
    const lastCompletedScan = await scanRunRepository.latestCompleted() ?? null;
    const scanProgress = scannerService.getProgress();

    return {
      ...scanProgress,
      currentFolder: null,
      currentFile: null,
      lastCompletedScan: toViewerSafeScanSummary(lastCompletedScan)
    };
  },

  async getAdminScanProgress() {
    const lastCompletedScan = await scanRunRepository.latestCompleted() ?? null;
    const scanProgress = scannerService.getProgress();

    return {
      ...scanProgress,
      lastCompletedScan
    };
  },

  async getStats() {
    const lastCompletedScan = await scanRunRepository.latestCompleted() ?? null;
    const storageState = storageService.getState();
    const currentGalleryRoot = appConfig.galleryRoot;
    const [
      previousGalleryRoot,
      rebuildRequired,
      lastSuccessfulGalleryRoot,
      pendingDerivativeMigrationRows,
      defaultHomeFeedMode,
      defaultLocale,
      defaultReelsFeedMode,
      defaultFolderImageOrder,
      nestedFolderTitleFormat,
      treatStoriesAsFolders,
      storiesMigration,
      excludedFolders,
      folderCount,
      indexedImages,
      indexedVideos,
      deletedImages
    ] = await Promise.all([
      appSettingsRepository.get(PREVIOUS_GALLERY_ROOT_SETTING_KEY),
      appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY).then(v => v === '1'),
      appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY),
      storageState.libraryAvailable ? imageRepository.countPendingDerivativeMigrationRows() : Promise.resolve(0),
      getDefaultHomeFeedMode(),
      getDefaultLocale(),
      getDefaultReelsFeedMode(),
      getDefaultFolderImageOrder(),
      getNestedFolderTitleFormat(),
      getTreatStoriesAsFolders(),
      getStoriesMigrationStatus(),
      getExcludedFolderSettings(),
      storageState.libraryAvailable ? folderRepository.count() : Promise.resolve(0),
      storageState.libraryAvailable ? imageRepository.countFeed() : Promise.resolve(0),
      storageState.libraryAvailable ? imageRepository.countByMediaType('video') : Promise.resolve(0),
      storageState.libraryAvailable ? imageRepository.countDeleted() : Promise.resolve(0)
    ]);

    return {
      folders: folderCount,
      indexedImages,
      indexedVideos,
      deletedImages,
      thumbnailCount: storageState.libraryAvailable ? countDerivativeFilesOnDisk(appConfig.thumbnailsDir) : 0,
      previewCount: storageState.libraryAvailable ? countDerivativeFilesOnDisk(appConfig.previewsDir) : 0,
      lastScan: lastCompletedScan,
      scan: await this.getAdminScanProgress(),
      storage: {
        available: storageState.libraryAvailable,
        reason: storageState.reason,
        usingInMemoryDatabase: storageState.usingInMemoryDatabase
      },
      libraryIndex: {
        rebuildRequired,
        reason: rebuildRequired ? 'gallery_root_changed' : null,
        currentGalleryRoot,
        previousGalleryRoot,
        lastSuccessfulGalleryRoot,
        legacyDerivativeMigrationPending: pendingDerivativeMigrationRows > 0,
        pendingDerivativeMigrationRows,
        ignoredRootMediaCount: storageState.libraryAvailable ? countSupportedRootMediaFiles(currentGalleryRoot) : 0
      },
      preferences: {
        defaultLocale,
        defaultHomeFeedMode,
        defaultReelsFeedMode,
        defaultFolderImageOrder,
        nestedFolderTitleFormat,
        treatStoriesAsFolders
      },
      storiesMigration,
      excludedFolders
    };
  },

  async setDefaultHomeFeedMode(mode: FeedMode) {
    await appSettingsRepository.set(HOME_FEED_DEFAULT_MODE_SETTING_KEY, mode);

    return {
      defaultMode: mode
    };
  },

  async setDefaultLocale(defaultLocale: SupportedLocale) {
    await appSettingsRepository.set(APP_DEFAULT_LOCALE_SETTING_KEY, defaultLocale);

    return {
      defaultLocale
    };
  },

  async setDefaultReelsFeedMode(mode: ReelsFeedMode) {
    await appSettingsRepository.set(REELS_FEED_DEFAULT_MODE_SETTING_KEY, mode);

    return {
      defaultMode: mode
    };
  },

  async setDefaultFolderImageOrder(order: FolderImageOrder) {
    await appSettingsRepository.set(FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY, order);

    return {
      defaultOrder: order
    };
  },

  async setNestedFolderTitleFormat(titleFormat: NestedFolderTitleFormat) {
    await appSettingsRepository.set(
      NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY,
      serializeNestedFolderTitleFormatSetting(titleFormat)
    );

    return {
      titleFormat
    };
  },

  async setTreatStoriesAsFolders(treatStoriesAsFolders: boolean) {
    await appSettingsRepository.set(TREAT_STORIES_AS_FOLDERS_SETTING_KEY, serializeTreatStoriesAsFoldersSetting(treatStoriesAsFolders));
    await appSettingsRepository.set(STORIES_MIGRATION_DECISION_SETTING_KEY, treatStoriesAsFolders ? 'legacy' : 'stories');

    return {
      treatStoriesAsFolders
    };
  },

  async setExcludedFolders(rules: string[]) {
    const serializedRules = serializeExcludedFolderRulesForSetting(rules);

    if (serializedRules.length > 0) {
      await appSettingsRepository.set(EXCLUDED_FOLDERS_SETTING_KEY, serializedRules);
    } else {
      await appSettingsRepository.remove(EXCLUDED_FOLDERS_SETTING_KEY);
    }

    return {
      ...await getExcludedFolderSettings(),
      requiresScan: true
    };
  },

  async getOriginalMediaFile(id: number): Promise<{ path: string; filename: string } | null> {
    return resolveOriginalMediaFile(id);
  },

  async getOriginalImagePath(id: number): Promise<string | null> {
    return (await resolveOriginalMediaFile(id))?.path ?? null;
  },

  async deleteImage(id: number) {
    if (!storageService.getState().libraryAvailable || await scannerService.isLibraryRebuildRequired()) {
      return null;
    }

    const imageRecord = await imageRepository.getById(id);
    if (!imageRecord) {
      return null;
    }

    const folder = await folderRepository.getById(imageRecord.folder_id);
    if (!folder) {
      return null;
    }

    const originalPath = resolveIndexedOriginalPath(imageRecord.relative_path);
    const thumbnailPath = resolveStoredPathWithinRoot(appConfig.thumbnailsDir, imageRecord.thumbnail_path, 'thumbnail');
    const previewPath = resolveStoredPathWithinRoot(appConfig.previewsDir, imageRecord.preview_path, 'preview');

    if (!originalPath) {
      throw new Error('Stored image path is outside the gallery root');
    }

    await Promise.all([
      removeFileAndPruneAncestors(appConfig.galleryRoot, originalPath),
      removeFileAndPruneAncestors(appConfig.thumbnailsDir, thumbnailPath),
      removeFileAndPruneAncestors(appConfig.previewsDir, previewPath)
    ]);

    if (folder.avatar_image_id === imageRecord.id) {
      await folderRepository.setAvatar(imageRecord.folder_id, null, 'auto');
    }

    await imageRepository.deleteById(imageRecord.id);
    await folderRepository.syncAvatarSelection(imageRecord.folder_id);
    await folderRepository.updateCounts(imageRecord.folder_id);
    await statsRepository.refresh();

    return {
      id: imageRecord.id,
      folderSlug: folder.slug
    };
  },

  async deleteFolder(slug: string, options: DeleteFolderOptions = {}) {
    if (!storageService.getState().libraryAvailable || await scannerService.isLibraryRebuildRequired()) {
      return null;
    }

    const folder = await folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const deleteSourceFolder = options.deleteSourceFolder === true;
    const normalizedFolderPath = folder.folder_path;
    const images = await imageRepository.listActiveByFolder(folder.id);

    if (deleteSourceFolder) {
      const allFolders = await folderRepository.getAll();
      const affectedFolders = allFolders.filter((entry) => isSameOrDescendantFolderPath(normalizedFolderPath, entry.folder_path));
      const affectedImages = (await Promise.all(affectedFolders.map((entry) => imageRepository.listActiveByFolder(entry.id)))).flat();
      const deletedImageCount = affectedImages.length;

      await removeDirectoryTree(resolveWithinRoot(appConfig.galleryRoot, path.join(appConfig.galleryRoot, normalizedFolderPath)));
      await Promise.all(
        affectedImages.flatMap((imageRecord) => {
          const thumbnailPath = resolveStoredPathWithinRoot(appConfig.thumbnailsDir, imageRecord.thumbnail_path, 'thumbnail');
          const previewPath = resolveStoredPathWithinRoot(appConfig.previewsDir, imageRecord.preview_path, 'preview');

          return [
            removeFileAndPruneAncestors(appConfig.thumbnailsDir, thumbnailPath),
            removeFileAndPruneAncestors(appConfig.previewsDir, previewPath)
          ];
        })
      );

      await folderScanStateRepository.deleteTree(normalizedFolderPath);

      for (const affectedFolder of affectedFolders) {
        await folderRepository.setAvatar(affectedFolder.id, null, 'auto');
        await folderRepository.delete(affectedFolder.id);
      }

      await statsRepository.refresh();

      return {
        slug: folder.slug,
        deletedImageCount,
        deletedFolderCount: affectedFolders.length,
        deletedSourceFolder: true
      };
    }

    await Promise.all(
      images.map(async (imageRecord) => {
        const originalPath = resolveIndexedOriginalPath(imageRecord.relative_path);
        const thumbnailPath = resolveStoredPathWithinRoot(appConfig.thumbnailsDir, imageRecord.thumbnail_path, 'thumbnail');
        const previewPath = resolveStoredPathWithinRoot(appConfig.previewsDir, imageRecord.preview_path, 'preview');

        if (!originalPath) {
          throw new Error('Stored image path is outside the gallery root');
        }

        await Promise.all([
          removeFileAndPruneAncestors(appConfig.galleryRoot, originalPath),
          removeFileAndPruneAncestors(appConfig.thumbnailsDir, thumbnailPath),
          removeFileAndPruneAncestors(appConfig.previewsDir, previewPath)
        ]);
      })
    );

    await folderRepository.setAvatar(folder.id, null, 'auto');
    await folderScanStateRepository.delete(normalizedFolderPath);
    await folderRepository.delete(folder.id);
    await statsRepository.refresh();

    await Promise.all([
      removeDirectoryIfEmpty(resolveWithinRoot(appConfig.galleryRoot, path.join(appConfig.galleryRoot, normalizedFolderPath))),
      removeDirectoryIfEmpty(resolveWithinRoot(appConfig.thumbnailsDir, path.join(appConfig.thumbnailsDir, normalizedFolderPath))),
      removeDirectoryIfEmpty(resolveWithinRoot(appConfig.previewsDir, path.join(appConfig.previewsDir, normalizedFolderPath)))
    ]);

    return {
      slug: folder.slug,
      deletedImageCount: images.length,
      deletedFolderCount: 1,
      deletedSourceFolder: false
    };
  }
};
