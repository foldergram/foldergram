import { SCAN_FOLDERS_SETTING_KEY, SHARE_SESSION_SECRET_SETTING_KEY } from '../../constants/app-setting-keys.js';
import { normalizePath, safeJoin } from '../../utils/path-utils.js';
import { resolveUniqueSlug, slugifyFolderName } from '../../utils/slug.js';
import type {
  AppSettingRecord,
  CollectionMembershipRecord,
  CollectionRecord,
  CollectionSummaryRecord,
  FeedImage,
  FeedPost,
  FolderAvatarSource,
  FolderImageOrder,
  FolderRole,
  FolderScanStateRecord,
  FolderShareLinkRecord,
  FolderSharePasswordRecord,
  PostShareLinkRecord,
  ImageDetail,
  ImageRecord,
  LikeRecord,
  MediaType,
  PlaceKind,
  PlaceRecord,
  PlaybackStrategy,
  PostDetail,
  PostItemRecord,
  PostMediaItem,
  PostRecord,
  PostType,
  ReelCandidate,
  FolderRecord,
  FolderSummaryRecord,
  ScanRunRecord,
  ScanChangesSummary,
  TrashImage,
  TrashPost,
  TakenAtSource
} from '../../types/models.js';
import {
  database,
  EFFECTIVE_FEED_TIME_SQL,
  EFFECTIVE_IMAGE_FEED_TIME_SQL,
  DEFAULT_COLLECTION_SLUG,
  DEFAULT_COLLECTION_NAME,
  COVER_FILENAMES,
  COVER_FILENAME_SQL,
  NORMAL_FOLDER_ROLE_SQL,
  NORMAL_FOLDER_ID_SUBQUERY_SQL,
  SELECTED_SCAN_IMAGE_SCOPE_SQL,
  SELECTED_SCAN_FOLDER_SCOPE_SQL,
  SELECTED_SCAN_FOLDER_ID_SUBQUERY_SQL,
  SELECTED_SCAN_POST_SCOPE_SQL,
  VISIBLE_IMAGE_WHERE_SQL,
  VISIBLE_IMAGE_WHERE_UNSCOPED_SQL,
  NOT_EXPLICIT_FOLDER_COVER_SQL,
  VISIBLE_POST_WHERE_SQL,
  VISIBLE_POST_WHERE_UNSCOPED_SQL,
  RENDERABLE_COVER_WHERE_SQL,
  buildExcludedPostIdsClause,
  STORY_IMAGE_WHERE_SQL,
  STORY_IMAGE_WHERE_UNSCOPED_SQL,
  HAS_AVATAR_STORY_SQL,
  ACTIVE_FOLDER_AVATAR_IMAGE_ID_SQL,
  EXPLICIT_FOLDER_COVER_IMAGE_ID_SQL,
  NEWEST_POST_AVATAR_IMAGE_ID_SQL,
  FOLDER_SUMMARY_AVATAR_IMAGE_ID_SQL,
  FOLDER_SUMMARY_AVATAR_THUMBNAIL_PATH_SQL,
  getQualifiedFolderPostOrderSql,
  getUnscopedFolderPostOrderSql,
  POST_CAPTION_SEARCH_SQL,
  IMAGE_FILENAME_SEARCH_SQL,
  FOLDER_NAME_SEARCH_SQL,
  FOLDER_SLUG_SEARCH_SQL,
  FOLDER_PATH_SEARCH_SQL,
  POST_SOURCE_PATH_SEARCH_SQL,
  EXIF_CAMERA_MAKE_SEARCH_SQL,
  EXIF_CAMERA_MODEL_SEARCH_SQL,
  EXIF_LENS_MODEL_SEARCH_SQL,
  MEDIA_SEARCH_FIELD_SQL,
  POST_SAVED_SELECT_SQL,
  BASE_POST_SELECT_SQL,
  FOLDER_SUMMARY_SELECT_SQL,
  nowIso,
  serializeAnimatedFlag,
  normalizeSearchQuery,
  escapeLikePattern,
  isValidJson,
  resolvePostIdByImageId,
  resolveImageId,
  buildMediaSearchSql
} from './shared.js';
import type {
  MediaSearchSql,
  UpsertFolderInput,
  SaveFolderResult,
  CreateFolderShareLinkInput,
  CreatePostShareLinkInput,
  UpsertFolderSharePasswordInput,
  UpsertPostInput,
  UpsertImageInput,
  RefreshIndexedImageInput,
  ReconcileImageMoveInput,
  UpsertFolderScanStateInput,
  UpsertCityPlaceInput
} from './shared.js';

export const collectionConstants = {
  defaultCollectionSlug: DEFAULT_COLLECTION_SLUG,
  defaultCollectionName: DEFAULT_COLLECTION_NAME
} as const;

export const appSettingsRepository = {
  get(key: string): string | null {
    const row = database.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as Pick<AppSettingRecord, 'value'> | undefined;
    return row?.value ?? null;
  },

  set(key: string, value: string): void {
    database
      .prepare(
        `
        INSERT INTO app_settings (key, value)
        VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(key, value);
  },

  setMany(entries: { key: string; value: string }[]): void {
    if (entries.length === 0) return;
    const stmt = database.prepare(
      `
      INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `
    );
    database.exec('BEGIN');
    try {
      for (const entry of entries) {
        stmt.run(entry.key, entry.value);
      }
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },

  remove(key: string): void {
    database.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }
};

/**
 * A cheap fingerprint of everything that can change what the library returns.
 *
 * Reels has to rank the whole video catalogue before it can answer a page, which costs
 * hundreds of milliseconds on this library. Caching that work needs a key that is far
 * cheaper than the work itself and still changes on every scan, edit, deletion or scan
 * selection change, which is exactly what these five values cover.
 */
export const libraryStateRepository = {
  getSignature(): string {
    const row = database
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM posts) AS postCount,
          (SELECT COALESCE(MAX(id), 0) FROM posts) AS maxPostId,
          (SELECT COALESCE(MAX(updated_at), '') FROM posts) AS maxPostUpdatedAt,
          (SELECT COALESCE(MAX(id), 0) FROM scan_runs) AS maxScanRunId,
          (SELECT COALESCE(value, '') FROM app_settings WHERE key = '${SCAN_FOLDERS_SETTING_KEY}') AS scanScope
        `
      )
      .get() as {
        postCount: number;
        maxPostId: number;
        maxPostUpdatedAt: string;
        maxScanRunId: number;
        scanScope: string;
      };

    return [row.postCount, row.maxPostId, row.maxPostUpdatedAt, row.maxScanRunId, row.scanScope].join('|');
  }
};

export const maintenanceRepository = {
  resetLibraryIndex(): void {
    database.exec(`
      BEGIN;
      UPDATE folders SET avatar_image_id = NULL;
      DELETE FROM likes;
      DELETE FROM collection_items;
      DELETE FROM collections WHERE is_default = 0;
      DELETE FROM folder_share_passwords;
      DELETE FROM folder_share_links;
      DELETE FROM post_items;
      DELETE FROM posts;
      DELETE FROM images;
      DELETE FROM folders;
      DELETE FROM folder_scan_state;
      DELETE FROM scan_runs;
      DELETE FROM app_settings WHERE key = '${SHARE_SESSION_SECRET_SETTING_KEY}';
      DELETE FROM sqlite_sequence WHERE name IN ('folders', 'images', 'posts', 'scan_runs');
      COMMIT;
    `);
  }
};

