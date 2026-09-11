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
  VideoPlaybackQuality
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

import type { FeedMode, ReelsFeedMode, SupportedLocale, FeedCapsuleDefinition, CalendarDateParts, MomentDateMetadata, FeedRailDefinition, DeleteFolderOptions, StoryRailCapsule, StoryRailPayload, PlaceRowFields, IndexedFeedImage, ScannerProgress, ViewerScanProgress, IndexedImageDetail, IndexedTrashImage, ScanSummaryRecord, VideoPlaybackSource, ShareAssetContext, FolderSummaryContext } from './shared.js';
import { REDISCOVER_MIN_AGE_MS, DIVERSIFIED_FETCH_BATCH_SIZE, MAX_DIVERSIFIED_CANDIDATES, THIS_WEEK_RADIUS_DAYS, LAST_YEAR_RADIUS_DAYS, HIGHLIGHT_BATCH_CANDIDATE_LIMIT, HIGHLIGHT_BATCH_COUNT, HIGHLIGHT_CAPSULE_MAX_ITEMS, HIGHLIGHT_FEED_OVERLAP_WINDOW, RAIL_COVER_CANDIDATE_LIMIT, FALLBACK_AVATAR_STORY_LIMIT, FALLBACK_AVATAR_STORY_ID, SUPPORTED_LOCALES, toViewerSafeScanSummary, buildViewerSafeStorageReason, getLocalDayBounds, parseFeedMode, getDefaultHomeFeedMode, parseSupportedLocale, getDefaultLocale, parseReelsFeedMode, getDefaultReelsFeedMode, parseFolderImageOrder, getDefaultFolderImageOrder, VIDEO_PLAYBACK_QUALITIES, getVideoPlaybackQuality, getNestedFolderTitleFormat, getTreatStoriesAsFolders, getTreatCarouselsAsFolders, getCustomExcludedFolders, getExcludedFolderSettings, getStoriesMigrationStatus, getCarouselsMigrationStatus, getDerivativeAssetVersion, toPublicMediaUrl, buildOriginalUrl, buildStreamUrl, resolveVideoPlaybackSource, appendVersion, FOLDER_SHARE_ASSET_BASE_PATH, buildShareThumbnailUrl, buildSharePreviewUrl, buildPreviewUrl, buildVideoPreviewFileUrl, mapPlaceSummaryFromRow, resolveOriginalMediaFile, resolveIndexedOriginalPath, resolveWithinRoot, resolveStoredPathWithinRoot, removeFileIfPresent, removeFileAndPruneAncestors, removeDirectoryIfEmpty, removeDirectoryTree, countDerivativeFilesOnDisk, isSameOrDescendantFolderPath, getParentFolderDisplayName, mapFeedImage, resolvePostRecord, isCoverPost, FOLDER_SHARE_ASSET_CONTEXT, buildShareStreamUrl, mapSharedMediaItem, mapSharedFeedImage, mapImageDetail, mapSharedImageDetail, mapTrashImage, createFolderSummaryContext, buildFolderSummary, buildSharedFolderSummary, mapFeedImageForOwnerFolder, formatStoryDateContext, formatMonthDay, formatShortRange, formatMonthYear, mapFeedItems, mapCollectionSummary, mapCollectionMembership, buildPaginatedPayload, buildTrashPaginatedPayload, sliceItemsForPage } from './shared.js';

export const sharesGalleryMethods = {
  getSharedFolderBySlug(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildSharedFolderSummary(folder);
  },

  getSharedFolderImages(slug: string, page: number, limit: number, mediaType?: MediaType) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const total = imageRepository.countVisibleByFolder(folder.id, mediaType);
    const derivativeVersion = getDerivativeAssetVersion();
    const defaultFolderImageOrder = getDefaultFolderImageOrder();

    return {
      folder: buildSharedFolderSummary(folder),
      items: imageRepository
        .listFolderImages(folder.id, page, limit, mediaType, defaultFolderImageOrder)
        .map((image) => mapSharedFeedImage(image, derivativeVersion)),
      page,
      limit,
      total,
      hasMore: page * limit < total
    };
  },

  getSharedImageDetail(id: number, mediaType?: MediaType, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || post.is_deleted || post.is_trashed) {
      return null;
    }

    const defaultFolderImageOrder = getDefaultFolderImageOrder();
    const detail = imageRepository.getImageDetail(post.id, mediaType, false, defaultFolderImageOrder);
    if (!detail) {
      return null;
    }

    return mapSharedImageDetail(detail, getDerivativeAssetVersion());
  },

  /**
   * Detail payload for a single-post share token. Media URLs are rewritten onto the
   * token's own prefix, and videos additionally get an HLS master so a phone on a slow
   * link is not forced to pull the untouched original.
   */

  getTokenSharedPostDetail(postId: number, assetBasePath: string, streamBasePath: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(postId);
    if (!post || post.is_deleted || post.is_trashed) {
      return null;
    }

    const detail = imageRepository.getImageDetail(post.id, undefined, false, getDefaultFolderImageOrder());
    if (!detail) {
      return null;
    }

    const mapped = mapSharedImageDetail(detail, getDerivativeAssetVersion(), {
      assetBasePath,
      streamBasePath
    });

    // A token unlocks exactly one post, so neighbour navigation must not leak ids.
    return {
      ...mapped,
      nextImageId: null,
      previousImageId: null
    };
  },

  getShareDerivativeImage(id: number): ImageRecord | null {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const image = imageRepository.getById(id);
    if (!image || image.is_deleted || image.is_trashed) {
      return null;
    }

    const folder = folderRepository.getById(image.folder_id);
    if (!folder) {
      return null;
    }

    if (folder.role === 'normal') return image;
    if (folder.role === 'carousel_source' && folder.carousel_owner_folder_id) {
      return { ...image, folder_id: folder.carousel_owner_folder_id };
    }
    return null;
  },
};
