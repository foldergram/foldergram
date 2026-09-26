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

import type { FeedMode, ReelsFeedMode, SupportedLocale, FeedCapsuleDefinition, CalendarDateParts, MomentDateMetadata, FeedRailDefinition, DeleteFolderOptions, StoryRailCapsule, StoryRailPayload, PlaceRowFields, IndexedFeedImage, ScannerProgress, ViewerScanProgress, IndexedImageDetail, IndexedTrashImage, ScanSummaryRecord, VideoPlaybackSource, ShareAssetContext, FolderSummaryContext } from './shared.js';
import { REDISCOVER_MIN_AGE_MS, DIVERSIFIED_FETCH_BATCH_SIZE, MAX_DIVERSIFIED_CANDIDATES, THIS_WEEK_RADIUS_DAYS, LAST_YEAR_RADIUS_DAYS, HIGHLIGHT_BATCH_CANDIDATE_LIMIT, HIGHLIGHT_BATCH_COUNT, HIGHLIGHT_CAPSULE_MAX_ITEMS, HIGHLIGHT_FEED_OVERLAP_WINDOW, RAIL_COVER_CANDIDATE_LIMIT, FALLBACK_AVATAR_STORY_LIMIT, FALLBACK_AVATAR_STORY_ID, SUPPORTED_LOCALES, toViewerSafeScanSummary, buildViewerSafeStorageReason, getLocalDayBounds, parseFeedMode, getDefaultHomeFeedMode, parseSupportedLocale, getDefaultLocale, parseReelsFeedMode, getDefaultReelsFeedMode, parseFolderImageOrder, getDefaultFolderImageOrder, VIDEO_PLAYBACK_QUALITIES, getVideoPlaybackQuality, getVideoPlaybackMode, getNestedFolderTitleFormat, getTreatStoriesAsFolders, getTreatCarouselsAsFolders, getCustomExcludedFolders, getExcludedFolderSettings, getStoriesMigrationStatus, getCarouselsMigrationStatus, getDerivativeAssetVersion, toPublicMediaUrl, buildOriginalUrl, buildStreamUrl, resolveVideoPlaybackSource, appendVersion, FOLDER_SHARE_ASSET_BASE_PATH, buildShareThumbnailUrl, buildSharePreviewUrl, buildPreviewUrl, buildVideoPreviewFileUrl, mapPlaceSummaryFromRow, resolveOriginalMediaFile, resolveIndexedOriginalPath, resolveWithinRoot, resolveStoredPathWithinRoot, removeFileIfPresent, removeFileAndPruneAncestors, removeDirectoryIfEmpty, removeDirectoryTree, countDerivativeFilesOnDisk, isSameOrDescendantFolderPath, getParentFolderDisplayName, mapFeedImage, resolvePostRecord, isCoverPost, FOLDER_SHARE_ASSET_CONTEXT, buildShareStreamUrl, mapSharedMediaItem, mapSharedFeedImage, mapImageDetail, mapSharedImageDetail, mapTrashImage, createFolderSummaryContext, buildFolderSummary, buildSharedFolderSummary, mapFeedImageForOwnerFolder, formatStoryDateContext, formatMonthDay, formatShortRange, formatMonthYear, mapFeedItems, mapCollectionSummary, mapCollectionMembership, buildPaginatedPayload, buildTrashPaginatedPayload, sliceItemsForPage } from './shared.js';

export const adminGalleryMethods = {
  getStatus(scanProgress?: ViewerScanProgress) {
    const resolvedScanProgress = scanProgress ?? this.getScanProgress();
    const storageState = storageService.getState();
    const rebuildRequired = appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY) === '1';
    const defaultHomeFeedMode = getDefaultHomeFeedMode();
    const defaultLocale = getDefaultLocale();
    const defaultReelsFeedMode = getDefaultReelsFeedMode();
    const defaultFolderImageOrder = getDefaultFolderImageOrder();
    const nestedFolderTitleFormat = getNestedFolderTitleFormat();
    const videoPlaybackQuality = getVideoPlaybackQuality();
    const videoPlaybackMode = getVideoPlaybackMode();
    const treatStoriesAsFolders = getTreatStoriesAsFolders();
    const storiesMigration = getStoriesMigrationStatus();
    const treatCarouselsAsFolders = getTreatCarouselsAsFolders();
    const carouselsMigration = getCarouselsMigrationStatus();
    const indexedPosts = storageState.libraryAvailable ? imageRepository.countFeed() : 0;

    return {
      folders: storageState.libraryAvailable ? folderRepository.count() : 0,
      indexedImages: indexedPosts,
      indexedPosts,
      indexedMediaAssets: storageState.libraryAvailable ? imageRepository.countVisibleMediaAssets() : 0,
      indexedCarousels: storageState.libraryAvailable ? imageRepository.countVisibleCarousels() : 0,
      indexedVideos: storageState.libraryAvailable ? imageRepository.countVisibleSingleVideos() : 0,
      scan: resolvedScanProgress,
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
        treatStoriesAsFolders,
        treatCarouselsAsFolders,
        videoPlaybackQuality,
        videoPlaybackMode
      },
      storiesMigration,
      carouselsMigration
    };
  },

  getScanProgress(progress = scannerService.getProgress()) {
    const lastCompletedScan = scanRunRepository.latestCompleted() ?? null;

    return {
      ...progress,
      currentFolder: null,
      currentFile: null,
      lastCompletedScan: toViewerSafeScanSummary(lastCompletedScan)
    };
  },

  getAdminScanProgress(progress = scannerService.getProgress()) {
    const lastCompletedScan = scanRunRepository.latestCompleted() ?? null;

    return {
      ...progress,
      lastCompletedScan
    };
  },

  getStats(scanProgress?: ScannerProgress) {
    const resolvedScanProgress = scanProgress ?? this.getAdminScanProgress();
    const lastCompletedScan = scanRunRepository.latestCompleted() ?? null;
    const { startIso, endIso } = getLocalDayBounds();
    const todayScanChanges = scanRunRepository.completedSummaryBetween(startIso, endIso);
    const storageState = storageService.getState();
    const currentGalleryRoot = appConfig.galleryRoot;
    const previousGalleryRoot = appSettingsRepository.get(PREVIOUS_GALLERY_ROOT_SETTING_KEY);
    const rebuildRequired = appSettingsRepository.get(LIBRARY_REBUILD_REQUIRED_SETTING_KEY) === '1';
    const lastSuccessfulGalleryRoot = appSettingsRepository.get(LAST_SUCCESSFUL_GALLERY_ROOT_SETTING_KEY);
    const pendingDerivativeMigrationRows = storageState.libraryAvailable ? imageRepository.countPendingDerivativeMigrationRows() : 0;
    const defaultHomeFeedMode = getDefaultHomeFeedMode();
    const defaultLocale = getDefaultLocale();
    const defaultReelsFeedMode = getDefaultReelsFeedMode();
    const defaultFolderImageOrder = getDefaultFolderImageOrder();
    const nestedFolderTitleFormat = getNestedFolderTitleFormat();
    const videoPlaybackQuality = getVideoPlaybackQuality();
    const videoPlaybackMode = getVideoPlaybackMode();
    const treatStoriesAsFolders = getTreatStoriesAsFolders();
    const storiesMigration = getStoriesMigrationStatus();
    const treatCarouselsAsFolders = getTreatCarouselsAsFolders();
    const carouselsMigration = getCarouselsMigrationStatus();
    const excludedFolders = getExcludedFolderSettings();
    const sharePublicBaseUrl = normalizePublicBaseUrl(appSettingsRepository.get(SHARE_PUBLIC_BASE_URL_SETTING_KEY));

    return {
      folders: storageState.libraryAvailable ? folderRepository.count() : 0,
      indexedImages: storageState.libraryAvailable ? imageRepository.countFeed() : 0,
      indexedPosts: storageState.libraryAvailable ? imageRepository.countFeed() : 0,
      indexedMediaAssets: storageState.libraryAvailable ? imageRepository.countVisibleMediaAssets() : 0,
      indexedCarousels: storageState.libraryAvailable ? imageRepository.countVisibleCarousels() : 0,
      indexedVideos: storageState.libraryAvailable ? imageRepository.countVisibleSingleVideos() : 0,
      deletedImages: storageState.libraryAvailable ? imageRepository.countDeleted() : 0,
      thumbnailCount: storageState.libraryAvailable ? countDerivativeFilesOnDisk(appConfig.thumbnailsDir) : 0,
      previewCount: storageState.libraryAvailable ? countDerivativeFilesOnDisk(appConfig.previewsDir) : 0,
      lastScan: lastCompletedScan,
      todayScanChanges,
      scan: resolvedScanProgress,
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
        treatStoriesAsFolders,
        treatCarouselsAsFolders,
        videoPlaybackQuality,
        videoPlaybackMode,
        sharePublicBaseUrl
      },
      storiesMigration,
      carouselsMigration,
      excludedFolders
    };
  },

  setDefaultHomeFeedMode(mode: FeedMode) {
    appSettingsRepository.set(HOME_FEED_DEFAULT_MODE_SETTING_KEY, mode);

    return {
      defaultMode: mode
    };
  },

  setDefaultLocale(defaultLocale: SupportedLocale) {
    appSettingsRepository.set(APP_DEFAULT_LOCALE_SETTING_KEY, defaultLocale);

    return {
      defaultLocale
    };
  },

  setDefaultReelsFeedMode(mode: ReelsFeedMode) {
    appSettingsRepository.set(REELS_FEED_DEFAULT_MODE_SETTING_KEY, mode);

    return {
      defaultMode: mode
    };
  },

  setDefaultFolderImageOrder(order: FolderImageOrder) {
    appSettingsRepository.set(FOLDER_IMAGE_DEFAULT_ORDER_SETTING_KEY, order);

    return {
      defaultOrder: order
    };
  },

  setSharePublicBaseUrl(publicBaseUrl: string | null) {
    const normalized = normalizePublicBaseUrl(publicBaseUrl);
    appSettingsRepository.set(SHARE_PUBLIC_BASE_URL_SETTING_KEY, normalized ?? '');

    return {
      sharePublicBaseUrl: normalized
    };
  },

  setVideoPlaybackQuality(videoPlaybackQuality: VideoPlaybackQuality) {
    appSettingsRepository.set(VIDEO_PLAYBACK_QUALITY_SETTING_KEY, videoPlaybackQuality);

    return {
      videoPlaybackQuality
    };
  },

  setVideoPlaybackMode(videoPlaybackMode: VideoPlaybackMode) {
    appSettingsRepository.set(VIDEO_PLAYBACK_MODE_SETTING_KEY, videoPlaybackMode);

    return {
      videoPlaybackMode
    };
  },

  setNestedFolderTitleFormat(titleFormat: NestedFolderTitleFormat) {
    appSettingsRepository.set(
      NESTED_FOLDER_TITLE_FORMAT_SETTING_KEY,
      serializeNestedFolderTitleFormatSetting(titleFormat)
    );

    return {
      titleFormat
    };
  },

  setTreatStoriesAsFolders(treatStoriesAsFolders: boolean) {
    appSettingsRepository.set(TREAT_STORIES_AS_FOLDERS_SETTING_KEY, serializeTreatStoriesAsFoldersSetting(treatStoriesAsFolders));
    appSettingsRepository.set(STORIES_MIGRATION_DECISION_SETTING_KEY, treatStoriesAsFolders ? 'legacy' : 'stories');

    return {
      treatStoriesAsFolders
    };
  },

  setExcludedFolders(rules: string[]) {
    const serializedRules = serializeExcludedFolderRulesForSetting(rules);

    if (serializedRules.length > 0) {
      appSettingsRepository.set(EXCLUDED_FOLDERS_SETTING_KEY, serializedRules);
    } else {
      appSettingsRepository.remove(EXCLUDED_FOLDERS_SETTING_KEY);
    }

    return {
      ...getExcludedFolderSettings(),
      requiresScan: true
    };
  },

  getOriginalMediaFile(id: number): { path: string; filename: string } | null {
    return resolveOriginalMediaFile(id);
  },

  getOriginalImagePath(id: number): string | null {
    return resolveOriginalMediaFile(id)?.path ?? null;
  },

  async deleteImage(id: number, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || (scannerService.isLibraryRebuildRequired() && post.is_trashed === 0)) {
      return null;
    }

    return permanentDeletionService.deletePost(post.id);
  },

  async deleteFolder(slug: string, options: DeleteFolderOptions = {}) {
    if (!storageService.getState().libraryAvailable || scannerService.isLibraryRebuildRequired()) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const deleteSourceFolder = options.deleteSourceFolder === true;
    const normalizedFolderPath = folder.folder_path;
    const ownedFolders = folderRepository
      .getAll()
      .filter((entry) => entry.carousel_owner_folder_id === folder.id || entry.story_owner_folder_id === folder.id);
    const affectedFolderIds = [folder.id, ...ownedFolders.map((entry) => entry.id)];
    const images = affectedFolderIds.flatMap((id) => imageRepository.listForFolderDeletion(id));

    if (deleteSourceFolder) {
      const affectedFolders = folderRepository
        .getAll()
        .filter((entry) => isSameOrDescendantFolderPath(normalizedFolderPath, entry.folder_path));
      const affectedImages = affectedFolders.flatMap((entry) => imageRepository.listForFolderDeletion(entry.id));
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

      folderScanStateRepository.deleteTree(normalizedFolderPath);

      for (const affectedFolder of affectedFolders) {
        folderRepository.setAvatar(affectedFolder.id, null, 'auto');
        folderRepository.delete(affectedFolder.id);
      }

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

    for (const affectedFolder of [...ownedFolders, folder]) {
      folderScanStateRepository.delete(affectedFolder.folder_path);
      folderRepository.setAvatar(affectedFolder.id, null, 'auto');
      folderRepository.delete(affectedFolder.id);
    }

    const cleanupRelativePaths = new Set<string>([normalizedFolderPath]);
    for (const ownedFolder of ownedFolders) {
      let candidatePath = ownedFolder.folder_path;
      while (isSameOrDescendantFolderPath(normalizedFolderPath, candidatePath)) {
        cleanupRelativePaths.add(candidatePath);
        if (candidatePath === normalizedFolderPath) break;
        const parentPath = path.posix.dirname(candidatePath);
        if (parentPath === candidatePath || parentPath === '.') break;
        candidatePath = parentPath;
      }
    }

    const orderedCleanupPaths = [...cleanupRelativePaths].sort(
      (left, right) => right.split('/').length - left.split('/').length
    );
    for (const relativePath of orderedCleanupPaths) {
      await Promise.all([
        removeDirectoryIfEmpty(resolveWithinRoot(appConfig.galleryRoot, path.join(appConfig.galleryRoot, relativePath))),
        removeDirectoryIfEmpty(resolveWithinRoot(appConfig.thumbnailsDir, path.join(appConfig.thumbnailsDir, relativePath))),
        removeDirectoryIfEmpty(resolveWithinRoot(appConfig.previewsDir, path.join(appConfig.previewsDir, relativePath)))
      ]);
    }

    return {
      slug: folder.slug,
      deletedImageCount: images.length,
      deletedFolderCount: 1,
      deletedSourceFolder: false
    };
  },

  setTreatCarouselsAsFolders(treatCarouselsAsFolders: boolean) {
    appSettingsRepository.setMany([
      {
        key: TREAT_CAROUSELS_AS_FOLDERS_SETTING_KEY,
        value: serializeTreatCarouselsAsFoldersSetting(treatCarouselsAsFolders)
      },
      {
        key: CAROUSELS_MIGRATION_DECISION_SETTING_KEY,
        value: treatCarouselsAsFolders ? 'restore' : 'carousels'
      }
    ]);

    return this.getStats();
  },

  setCarouselsMigrationDecision(decision: 'restore' | 'carousels') {
    return this.setTreatCarouselsAsFolders(decision === 'restore');
  }
};
