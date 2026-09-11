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

export const interactionsGalleryMethods = {
  getTrashImages(page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const total = imageRepository.countTrashed();
    const derivativeVersion = getDerivativeAssetVersion();
    const items = imageRepository.listTrashed(page, limit).map((image) => mapTrashImage(image as IndexedTrashImage, derivativeVersion));

    return buildTrashPaginatedPayload(items, page, limit, total);
  },

  getLikes() {
    if (!storageService.getState().libraryAvailable) {
      return {
        items: []
      };
    }

    return {
      items: mapFeedItems(likeRepository.listLikedImages())
    };
  },

  likeImage(id: number, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || post.is_deleted || post.is_trashed || isCoverPost(post.id)) {
      return null;
    }

    likeRepository.upsert(post.id);

    return {
      id: post.id,
      liked: true
    };
  },

  unlikeImage(id: number, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || post.is_deleted || post.is_trashed || isCoverPost(post.id)) {
      return null;
    }

    likeRepository.remove(post.id);

    return {
      id: post.id,
      liked: false
    };
  },

  trashImage(id: number, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || post.is_deleted) {
      return null;
    }

    const folder = folderRepository.getById(post.folder_id);
    if (!folder) {
      return null;
    }

    if (post.is_trashed === 0) {
      imageRepository.moveToTrash(post.id);
      folderRepository.syncAvatarSelection(post.folder_id);
    }

    return {
      id: post.id,
      folderSlug: folder.slug
    };
  },

  restoreImage(id: number, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || post.is_deleted || post.is_trashed === 0) {
      return null;
    }

    const folder = folderRepository.getById(post.folder_id);
    if (!folder) {
      return null;
    }

    imageRepository.restoreFromTrash(post.id);
    folderRepository.syncAvatarSelection(post.folder_id);

    return {
      id: post.id,
      folderSlug: folder.slug
    };
  },
};
