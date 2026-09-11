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
function buildFolderStoryRail(folder: FolderSummaryRecord): StoryRailPayload {
  const ownerFolder = buildFolderSummary(folder);
  const derivativeVersion = getDerivativeAssetVersion();
  const storyFolders = folderRepository.listOwnedStoryFolders(folder.id);
  const rootStoryFolder = storyFolders.find((entry) => entry.role === 'story_root') ?? null;
  const highlightStoryFolders = storyFolders.filter((entry) => entry.role === 'story_capsule');

  const rootStoryCapsule = rootStoryFolder ? buildStoryRailCapsule(rootStoryFolder, ownerFolder, derivativeVersion) : null;
  const highlightCapsules = highlightStoryFolders
    .map((storyFolder) => buildStoryRailCapsule(storyFolder, ownerFolder, derivativeVersion))
    .filter((capsule): capsule is StoryRailCapsule => capsule !== null)
    .sort((left, right) => {
      if (left.latestActivityTimestamp !== right.latestActivityTimestamp) {
        return right.latestActivityTimestamp - left.latestActivityTimestamp;
      }

      return left.title.localeCompare(right.title, undefined, { sensitivity: 'base' });
    });
  const avatarStoryCapsule = rootStoryCapsule ?? buildFallbackAvatarStoryCapsule(ownerFolder, derivativeVersion);
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

function buildStoryRailCapsule(
  storyFolder: FolderRecord,
  ownerFolder: ReturnType<typeof buildFolderSummary>,
  derivativeVersion: string | null
): StoryRailCapsule | null {
  const imageCount = imageRepository.countStoryMediaByFolder(storyFolder.id);
  if (imageCount === 0) {
    return null;
  }

  const coverImage = imageRepository.listStoryFolderImages(storyFolder.id, 1, 1)[0];
  if (!coverImage) {
    return null;
  }

  const latestActivityTimestamp = imageRepository.getLatestEffectiveTimestampByFolder(storyFolder.id) ?? 0;
  const presentation = storyFolder.role === 'story_root' ? 'avatar' as const : 'highlight' as const;

  return {
    id: storyFolder.slug,
    title: presentation === 'avatar' ? ownerFolder.name : storyFolder.name,
    subtitle: presentation === 'avatar' ? `${ownerFolder.name} story set` : 'Profile highlight',
    dateContext: formatStoryDateContext(latestActivityTimestamp),
    imageCount,
    coverImage: mapFeedImageForOwnerFolder(coverImage, ownerFolder, derivativeVersion),
    presentation,
    latestActivityTimestamp
  };
}

function buildFallbackAvatarStoryCapsule(
  ownerFolder: ReturnType<typeof buildFolderSummary>,
  derivativeVersion: string | null
): StoryRailCapsule | null {
  const imageCount = Math.min(imageRepository.countStoryCapsuleMediaByOwnerFolder(ownerFolder.id), FALLBACK_AVATAR_STORY_LIMIT);
  if (imageCount === 0) {
    return null;
  }

  const coverImage = imageRepository.listStoryCapsuleImagesByOwnerFolder(ownerFolder.id, 1, 1)[0];
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
    coverImage: mapFeedImageForOwnerFolder(coverImage, ownerFolder, derivativeVersion),
    presentation: 'avatar',
    latestActivityTimestamp
  };
}

function listFallbackAvatarStoryItems(
  ownerFolder: ReturnType<typeof buildFolderSummary>,
  page: number,
  limit: number,
  derivativeVersion = getDerivativeAssetVersion()
) {
  const total = Math.min(imageRepository.countStoryCapsuleMediaByOwnerFolder(ownerFolder.id), FALLBACK_AVATAR_STORY_LIMIT);
  const offset = (page - 1) * limit;
  const remaining = Math.max(total - offset, 0);
  const items =
    remaining > 0
      ? imageRepository
          .listStoryCapsuleImagesByOwnerFolder(ownerFolder.id, page, Math.min(limit, remaining))
          .map((image) => mapFeedImageForOwnerFolder(image, ownerFolder, derivativeVersion))
      : [];

  return {
    total,
    items
  };
}


export const foldersGalleryMethods = {
  listFolders() {
    if (!storageService.getState().libraryAvailable) {
      return [];
    }

    const context = createFolderSummaryContext();
    return folderRepository.getAllSummaries().map((folder) => buildFolderSummary(folder, context));
  },

  getFolderBySlug(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderSummary(folder);
  },

  updateFolderMetadata(slug: string, name: string, description: string | null) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    folderRepository.updateMetadata(slug, name, description);
    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderSummary(folder);
  },

  updateImageCaption(id: number, caption: string | null, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || post.is_deleted || post.is_trashed) {
      return null;
    }

    const defaultFolderImageOrder = getDefaultFolderImageOrder();
    const existing = imageRepository.getImageDetail(post.id, undefined, false, defaultFolderImageOrder);
    if (!existing) {
      return null;
    }

    postRepository.updateCaption(post.id, caption);

    const updated = imageRepository.getImageDetail(post.id, undefined, false, defaultFolderImageOrder);
    return updated ? mapImageDetail(updated, getDerivativeAssetVersion()) : null;
  },

  setFolderAvatar(slug: string, imageId: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const image = imageRepository.getById(imageId);
    const imageFolder = image ? folderRepository.getById(image.folder_id) : undefined;
    const belongsToFolder = image?.folder_id === folder.id || (
      imageFolder?.role === 'carousel_source' && imageFolder.carousel_owner_folder_id === folder.id
    );
    if (!image || !belongsToFolder || image.is_deleted !== 0 || image.is_trashed !== 0) {
      return null;
    }

    folderRepository.setAvatar(folder.id, imageId, 'manual');
    return true;
  },

  getFolderStories(slug: string) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    return buildFolderStoryRail(folder);
  },

  getFolderStoryFeed(slug: string, storyId: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const folder = folderRepository.getSummaryBySlug(slug);
    if (!folder) {
      return null;
    }

    const rail = buildFolderStoryRail(folder);
    const capsule = rail.items.find((entry) => entry.id === storyId);
    if (!capsule) {
      return null;
    }

    const ownerFolder = buildFolderSummary(folder);
    if (storyId === FALLBACK_AVATAR_STORY_ID) {
      const fallbackFeed = listFallbackAvatarStoryItems(ownerFolder, page, limit);

      return {
        railKind: 'stories' as const,
        railTitle: rail.railTitle,
        railDescription: rail.railDescription,
        railSingularLabel: rail.railSingularLabel,
        story: capsule,
        ...buildPaginatedPayload(fallbackFeed.items, page, limit, fallbackFeed.total)
      };
    }

    const storyFolder = folderRepository.getOwnedStoryFolderBySlug(folder.id, storyId);
    if (!storyFolder) {
      return null;
    }

    const derivativeVersion = getDerivativeAssetVersion();
    const total = imageRepository.countStoryMediaByFolder(storyFolder.id);
    const items = imageRepository
      .listStoryFolderImages(storyFolder.id, page, limit)
      .map((image) => mapFeedImageForOwnerFolder(image, ownerFolder, derivativeVersion));

    return {
      railKind: 'stories' as const,
      railTitle: rail.railTitle,
      railDescription: rail.railDescription,
      railSingularLabel: rail.railSingularLabel,
      story: capsule,
      ...buildPaginatedPayload(items, page, limit, total)
    };
  },

  getFolderImages(slug: string, page: number, limit: number, mediaType?: MediaType) {
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
      folder: buildFolderSummary(folder),
      items: imageRepository
        .listFolderImages(folder.id, page, limit, mediaType, defaultFolderImageOrder)
        .map((image) => mapFeedImage(image, derivativeVersion)),
      page,
      limit,
      total,
      hasMore: page * limit < total
    };
  },

  getImageDetail(id: number, mediaType?: MediaType, options: { isLegacyImageAlias?: boolean } = {}) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const post = resolvePostRecord(id, options.isLegacyImageAlias);
    if (!post || post.is_deleted || post.is_trashed) {
      return null;
    }

    const defaultFolderImageOrder = getDefaultFolderImageOrder();
    let detail = imageRepository.getImageDetail(post.id, mediaType, false, defaultFolderImageOrder);
    if (!detail) {
      const avatarDetail = imageRepository.getImageDetail(post.id, mediaType, true, defaultFolderImageOrder);
      if (avatarDetail && avatarDetail.folderAvatarImageId === avatarDetail.id) {
        detail = avatarDetail;
      }
    }

    if (!detail) {
      return null;
    }

    return mapImageDetail(detail, getDerivativeAssetVersion());
  },
};
