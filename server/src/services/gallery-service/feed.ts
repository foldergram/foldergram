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
    count: () => cappedItems.length,
    list: (page, limit) => sliceItemsForPage(cappedItems, page, limit)
  };
}

/**
 * `countRenderableFeed` scans every visible post, which on the live library is most of
 * the wait before the first feed card can render, and every page of every mode asks for
 * it again. The library signature is far cheaper than the count and changes whenever the
 * answer could, so caching on it is safe.
 */
let renderableFeedCountCache: { signature: string; count: number } | null = null;

function countCachedRenderableFeed(): number {
  const signature = libraryStateRepository.getSignature();
  if (renderableFeedCountCache?.signature === signature) {
    return renderableFeedCountCache.count;
  }

  const count = imageRepository.countRenderableFeed();
  renderableFeedCountCache = { signature, count };
  return count;
}

/**
 * Reels ranks the entire video catalogue to answer a single page, and the candidate
 * query itself walks every visible post. Both were being redone on every request and
 * every page, which is what made opening the reels deck, and paging inside it, wait
 * hundreds of milliseconds before any clip could even start loading.
 *
 * The cache is keyed on the library signature, so a scan, an edit, a deletion or a scan
 * selection change drops it immediately; nothing here can serve stale content.
 */
let reelCandidateCache: { signature: string; candidates: ReelCandidate[] } | null = null;

function listCachedReelCandidates(): ReelCandidate[] {
  const signature = libraryStateRepository.getSignature();
  if (reelCandidateCache?.signature === signature) {
    return reelCandidateCache.candidates;
  }

  const candidates = imageRepository.listVisibleVideoCandidates();
  reelCandidateCache = { signature, candidates };
  return candidates;
}

/**
 * Ranking and interleaving the whole catalogue is the expensive half of a reels page,
 * and paging asks for a strictly longer prefix of the very same ordering. Keeping the
 * last ordering per (library, mode, seed, affinity) turns page two onwards into a slice.
 */
let reelQueueCache:
  | { key: string; queue: ReelCandidate[]; builtLength: number; isComplete: boolean }
  | null = null;

function listCachedReelQueue(
  candidates: ReelCandidate[],
  mode: 'recommended' | 'random',
  sessionSeed: number,
  signals: ReelAffinitySignals,
  requiredLength: number
): ReelCandidate[] {
  const key = [
    libraryStateRepository.getSignature(),
    mode,
    sessionSeed,
    signals.lastOpenedFolderSlug ?? '',
    (signals.recentOpenedFolderSlugs ?? []).join(',')
  ].join('|');

  if (reelQueueCache?.key === key && (reelQueueCache.isComplete || reelQueueCache.builtLength >= requiredLength)) {
    return reelQueueCache.queue;
  }

  if (mode === 'random') {
    const queue = shuffleReelCandidates(candidates, sessionSeed) as ReelCandidate[];
    reelQueueCache = { key, queue, builtLength: queue.length, isComplete: true };
    return queue;
  }

  const queue = buildReelQueue(candidates, sessionSeed, signals, requiredLength) as ReelCandidate[];
  reelQueueCache = {
    key,
    queue,
    builtLength: requiredLength,
    isComplete: queue.length < requiredLength
  };
  return queue;
}

function listDiversifiedModeItems(
  total: number,
  page: number,
  limit: number,
  loadBatch: (offset: number, limit: number) => FeedImage[]
): FeedImage[] {
  if (total === 0) {
    return [];
  }

  const targetCount = Math.min(total, page * limit);
  const candidateLimit = Math.min(total, Math.max(targetCount * 12, 720), MAX_DIVERSIFIED_CANDIDATES);
  const candidates: FeedImage[] = [];
  let offset = 0;

  while (offset < candidateLimit) {
    const batch = loadBatch(offset, Math.min(DIVERSIFIED_FETCH_BATCH_SIZE, candidateLimit - offset));
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
  return diversified.slice((page - 1) * limit, page * limit);
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

function getHighlightFeedOverlapImageIds(): Set<number> {
  const recentFeedItems = imageRepository.listRecentCandidates(0, HIGHLIGHT_FEED_OVERLAP_WINDOW);

  return new Set(recentFeedItems.map((item) => item.id));
}

function getRecentBatchHighlightItems(excludedImageIds: Set<number>): FeedImage[] {
  const candidates = imageRepository.listRecentCandidates(0, HIGHLIGHT_BATCH_CANDIDATE_LIMIT);
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
        list: (page, limit) => imageRepository.listByMonthDayKeys(onThisDayKeys, currentYear, page, limit)
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
        list: (page, limit) => imageRepository.listByMonthDayKeys(weekKeys, currentYear, page, limit)
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
        list: (page, limit) => imageRepository.listByEffectiveTimeRange(lastYearStart.getTime(), lastYearEnd.getTime(), page, limit)
      }
    ]
  };
}

function buildHighlightRailDefinition(now = new Date()): FeedRailDefinition {
  const excludedImageIds = getHighlightFeedOverlapImageIds();
  const rediscoverCutoff = now.getTime() - REDISCOVER_MIN_AGE_MS;
  const dailySeed = createDailySeed(now);
  const highlightFetchLimit = HIGHLIGHT_CAPSULE_MAX_ITEMS + HIGHLIGHT_FEED_OVERLAP_WINDOW;
  const recentBatchItems = getRecentBatchHighlightItems(excludedImageIds);
  const forgottenFavoriteItems = limitHighlightItems(
    likeRepository.listLikedOlderThan(1, highlightFetchLimit, rediscoverCutoff),
    1,
    excludedImageIds
  );
  const deepCutItems = limitHighlightItems(
    listDiversifiedModeItems(imageRepository.countRediscover(rediscoverCutoff), 1, highlightFetchLimit, (offset, batchLimit) =>
      imageRepository.listRediscoverCandidates(offset, batchLimit, rediscoverCutoff)
    ),
    1,
    excludedImageIds
  );
  const luckyDipItems = limitHighlightItems(imageRepository.listRandom(1, highlightFetchLimit, dailySeed), 1, excludedImageIds);
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

function materializeRailDefinition(definition: FeedRailDefinition) {
  const usedCoverImageIds = new Set<number>();
  const derivativeVersion = getDerivativeAssetVersion();

  return {
    ...definition,
    capsules: definition.capsules
      .map((capsule) => {
        const imageCount = capsule.count();
        if (imageCount < capsule.minimumImageCount) {
          return null;
        }

        const coverCandidates = capsule.list(1, RAIL_COVER_CANDIDATE_LIMIT);
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
          coverImage: mapFeedImage(coverImage, derivativeVersion)
        };
      })
      .filter((capsule): capsule is NonNullable<typeof capsule> => capsule !== null)
  };
}

function getSelectedFeedRail(now = new Date()) {
  const totalImages = imageRepository.countFeed();
  const exifImages = imageRepository.countByTakenAtSource('exif');
  const preferMoments = shouldPreferMomentRail(totalImages, exifImages);
  const momentRail = materializeRailDefinition(buildMomentRailDefinition(now));
  const highlightRail = materializeRailDefinition(buildHighlightRailDefinition(now));

  if (preferMoments && momentRail.capsules.length > 0) {
    return momentRail;
  }

  if (highlightRail.capsules.length > 0) {
    return highlightRail;
  }

  return momentRail.capsules.length > 0 ? momentRail : highlightRail;
}


export const feedGalleryMethods = {
  getFeed(page: number, limit: number, mode: FeedMode = 'random', randomSeed?: number, excludePostIds?: number[]) {
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

    if (mode === 'random') {
      // Counting only what the feed will actually return keeps `hasMore` honest while a
      // scan is still producing thumbnails.
      const total = countCachedRenderableFeed();
      const seed = Number.isFinite(randomSeed)
        ? Number(randomSeed)
        : Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));

      return {
        mode,
        ...buildPaginatedPayload(
          mapFeedItems(imageRepository.listRandom(page, limit, seed, excludePostIds)),
          page,
          limit,
          total
        )
      };
    }

    if (mode === 'rediscover') {
      const cutoffTimestamp = Date.now() - REDISCOVER_MIN_AGE_MS;
      const total = imageRepository.countRediscover(cutoffTimestamp);
      const items = listDiversifiedModeItems(total, page, limit, (offset, batchLimit) =>
        imageRepository.listRediscoverCandidates(offset, batchLimit, cutoffTimestamp)
      );

      return {
        mode,
        ...buildPaginatedPayload(mapFeedItems(items), page, limit, total)
      };
    }

    const total = countCachedRenderableFeed();
    const offset = (page - 1) * limit;
    const items = imageRepository.listRecentCandidates(offset, limit, excludePostIds);

    return {
      mode,
      ...buildPaginatedPayload(mapFeedItems(items), page, limit, total)
    };
  },

  getReels(page: number, limit: number, mode: ReelsFeedMode = 'recommended', seed?: number, signals: ReelAffinitySignals = {}) {
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

    const candidates = listCachedReelCandidates();
    const total = candidates.length;
    if (total === 0) {
      return {
        mode,
        items: [],
        page,
        limit,
        total: 0,
        hasMore: false
      };
    }

    const offset = (page - 1) * limit;
    const orderedCandidates =
      mode === 'recent'
        ? candidates
        : (() => {
            const sessionSeed = Number.isFinite(seed)
              ? Number(seed)
              : Number(new Date().toISOString().slice(0, 10).replaceAll('-', ''));

            // The greedy interleave is sequential, so a prefix of the full queue is
            // identical to a queue built with that cap. Only building as far as the
            // requested page keeps reels responsive on large libraries, and the cache
            // keeps paging from rebuilding that prefix again on every swipe.
            return listCachedReelQueue(candidates, mode, sessionSeed, signals, offset + limit);
          })();

    return {
      mode,
      ...buildPaginatedPayload(
        mapFeedItems(orderedCandidates.slice(offset, offset + limit)),
        page,
        limit,
        total
      )
    };
  },

  searchMedia(query: string, page: number, limit: number) {
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

    const total = imageRepository.countVisibleSearch(normalizedQuery);
    const items = total > 0 ? imageRepository.listVisibleSearch(normalizedQuery, page, limit) : [];

    return buildPaginatedPayload(mapFeedItems(items), page, limit, total);
  },

  listMoments() {
    if (!storageService.getState().libraryAvailable) {
      return {
        railKind: 'moments' as FeedRailKind,
        railTitle: 'Moments',
        railDescription: 'Memory capsules shaped by real capture dates from your library.',
        railSingularLabel: 'Moment',
        items: []
      };
    }

    const rail = getSelectedFeedRail(new Date());
    return {
      railKind: rail.kind,
      railTitle: rail.title,
      railDescription: rail.description,
      railSingularLabel: rail.singularLabel,
      items: rail.capsules
    };
  },

  getMomentFeed(id: string, page: number, limit: number) {
    if (!storageService.getState().libraryAvailable) {
      return null;
    }

    const now = new Date();
    const rail = getSelectedFeedRail(now);
    const capsule = rail.capsules.find((entry) => entry.id === id);

    if (!capsule) {
      return null;
    }

    const definition = (rail.kind === 'moments' ? buildMomentRailDefinition(now) : buildHighlightRailDefinition(now)).capsules.find(
      (entry) => entry.id === id
    );
    if (!definition) {
      return null;
    }

    const total = definition.count();

    return {
      railKind: rail.kind,
      railTitle: rail.title,
      railDescription: rail.description,
      railSingularLabel: rail.singularLabel,
      moment: capsule,
      ...buildPaginatedPayload(mapFeedItems(definition.list(page, limit)), page, limit, total)
    };
  },
};
