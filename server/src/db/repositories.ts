import { databaseManager } from './database.js';
import { SCAN_FOLDERS_SETTING_KEY, SHARE_SESSION_SECRET_SETTING_KEY } from '../constants/app-setting-keys.js';
import { normalizePath, safeJoin } from '../utils/path-utils.js';
import { resolveUniqueSlug, slugifyFolderName } from '../utils/slug.js';
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
} from '../types/models.js';

import type { DatabaseSync } from 'node:sqlite';

const database = new Proxy({} as DatabaseSync, {
  get(_target, prop) {
    const conn = databaseManager.connection as any;
    const value = conn[prop];
    return typeof value === 'function' ? value.bind(conn) : value;
  }
});

const EFFECTIVE_FEED_TIME_SQL = 'COALESCE(posts.taken_at, posts.sort_timestamp)';
const EFFECTIVE_IMAGE_FEED_TIME_SQL = 'COALESCE(images.taken_at, images.sort_timestamp)';
const DEFAULT_COLLECTION_SLUG = 'saved';
const DEFAULT_COLLECTION_NAME = 'Saved';
const COVER_FILENAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif'] as const;
const COVER_FILENAME_SQL = COVER_FILENAMES.map((name) => `'${name}'`).join(', ');
const NORMAL_FOLDER_ROLE_SQL = "folders.role = 'normal'";
const NORMAL_FOLDER_ID_SUBQUERY_SQL = "SELECT id FROM folders WHERE role = 'normal'";

// Scan selection is a visibility scope, not a deletion operation. Keeping this in
// SQL means old indexed rows stay reusable when a folder is selected again, while
// every feed/search/collection count hides rows outside the current selection.
const SELECTED_SCAN_IMAGE_SCOPE_SQL =
  `(NOT EXISTS (SELECT 1 FROM app_settings WHERE key = '${SCAN_FOLDERS_SETTING_KEY}') OR EXISTS (` +
  `SELECT 1 FROM app_settings scan_scope, json_each(scan_scope.value) selected ` +
  `WHERE scan_scope.key = '${SCAN_FOLDERS_SETTING_KEY}' ` +
  `AND (images.relative_path = selected.value OR images.relative_path LIKE selected.value || '/%')))`;
const SELECTED_SCAN_FOLDER_SCOPE_SQL =
  `(NOT EXISTS (SELECT 1 FROM app_settings WHERE key = '${SCAN_FOLDERS_SETTING_KEY}') OR EXISTS (` +
  `SELECT 1 FROM app_settings scan_scope, json_each(scan_scope.value) selected ` +
  `WHERE scan_scope.key = '${SCAN_FOLDERS_SETTING_KEY}' ` +
  `AND (folders.folder_path = selected.value OR folders.folder_path LIKE selected.value || '/%')))`;
const SELECTED_SCAN_POST_SCOPE_SQL =
  `(NOT EXISTS (SELECT 1 FROM app_settings WHERE key = '${SCAN_FOLDERS_SETTING_KEY}') OR EXISTS (` +
  `SELECT 1 FROM post_items scope_items ` +
  `INNER JOIN images scope_images ON scope_images.id = scope_items.image_id ` +
  `INNER JOIN app_settings scan_scope ON scan_scope.key = '${SCAN_FOLDERS_SETTING_KEY}' ` +
  `CROSS JOIN json_each(scan_scope.value) selected ` +
  `WHERE scope_items.post_id = posts.id ` +
  `AND (scope_images.relative_path = selected.value OR scope_images.relative_path LIKE selected.value || '/%')))`;

const VISIBLE_IMAGE_WHERE_SQL =
  `images.is_deleted = 0 AND images.is_trashed = 0 AND LOWER(images.filename) NOT IN (${COVER_FILENAME_SQL}) AND ${NORMAL_FOLDER_ROLE_SQL} AND ${SELECTED_SCAN_IMAGE_SCOPE_SQL}`;
const VISIBLE_IMAGE_WHERE_UNSCOPED_SQL =
  `is_deleted = 0 AND is_trashed = 0 AND LOWER(filename) NOT IN (${COVER_FILENAME_SQL}) AND folder_id IN (${NORMAL_FOLDER_ID_SUBQUERY_SQL}) AND ${SELECTED_SCAN_IMAGE_SCOPE_SQL}`;

const NOT_EXPLICIT_FOLDER_COVER_SQL =
  `NOT EXISTS (` +
  `SELECT 1 FROM post_items AS cover_items ` +
  `INNER JOIN images AS cover_images ON cover_images.id = cover_items.image_id ` +
  `WHERE cover_items.post_id = posts.id ` +
  `AND cover_items.position = 1 ` +
  `AND cover_images.folder_id = posts.folder_id ` +
  `AND LOWER(cover_images.filename) IN (${COVER_FILENAME_SQL})` +
  `)`;

const VISIBLE_POST_WHERE_SQL =
  `posts.is_deleted = 0 AND posts.is_trashed = 0 AND ${NORMAL_FOLDER_ROLE_SQL} AND ${NOT_EXPLICIT_FOLDER_COVER_SQL} AND ${SELECTED_SCAN_POST_SCOPE_SQL}`;
const VISIBLE_POST_WHERE_UNSCOPED_SQL =
  `is_deleted = 0 AND is_trashed = 0 AND folder_id IN (${NORMAL_FOLDER_ID_SUBQUERY_SQL}) AND ${NOT_EXPLICIT_FOLDER_COVER_SQL} AND ${SELECTED_SCAN_POST_SCOPE_SQL}`;

/**
 * A post whose cover image has no thumbnail yet cannot be drawn: the feed would show a
 * blank card and, for a video, a player pointed at a derivative that does not exist.
 * Scanning fills thumbnails in gradually, so the feed filters on this instead of going
 * empty-looking while a scan runs.
 */
const RENDERABLE_COVER_WHERE_SQL = "images.thumbnail_path IS NOT NULL AND images.thumbnail_path != ''";

/**
 * Pull-to-refresh asks for content the viewer has not seen yet. The caller caps the id
 * list, so this only ever builds a bounded `NOT IN (...)`.
 */
function buildExcludedPostIdsClause(excludeIds: number[] | undefined): { sql: string; params: number[] } {
  const ids = (excludeIds ?? []).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) {
    return { sql: '', params: [] };
  }

  return {
    sql: ` AND posts.id NOT IN (${ids.map(() => '?').join(',')})`,
    params: ids
  };
}

const STORY_IMAGE_WHERE_SQL = 'images.is_deleted = 0 AND images.is_trashed = 0';
const STORY_IMAGE_WHERE_UNSCOPED_SQL = 'is_deleted = 0 AND is_trashed = 0';

// Nested EXISTS instead of a JOIN: it forces SQLite to drive from
// idx_folders_story_owner_role. With a JOIN and no ANALYZE stats the planner
// picks images as the outer loop and rescans the whole table per folder,
// which measured 15.4s for 1769 folders versus 10ms here.
const HAS_AVATAR_STORY_SQL = `
  EXISTS (
    SELECT 1
    FROM folders AS story_folders
    WHERE story_folders.story_owner_folder_id = folders.id
      AND story_folders.role IN ('story_root', 'story_capsule')
      AND EXISTS (
        SELECT 1
        FROM images AS story_images
        WHERE story_images.folder_id = story_folders.id
          AND story_images.is_deleted = 0
          AND story_images.is_trashed = 0
      )
  )
`;

const ACTIVE_FOLDER_AVATAR_IMAGE_ID_SQL = `
  SELECT avatar_images.id
  FROM images AS avatar_images
  WHERE avatar_images.id = folders.avatar_image_id
    AND (
      avatar_images.folder_id = folders.id
      OR EXISTS (
        SELECT 1
        FROM folders AS avatar_source_folders
        WHERE avatar_source_folders.id = avatar_images.folder_id
          AND avatar_source_folders.role = 'carousel_source'
          AND avatar_source_folders.carousel_owner_folder_id = folders.id
      )
    )
    AND avatar_images.is_deleted = 0
    AND avatar_images.is_trashed = 0
  LIMIT 1
`;

const EXPLICIT_FOLDER_COVER_IMAGE_ID_SQL = `
  SELECT cover_images.id
  FROM images AS cover_images
  WHERE cover_images.folder_id = folders.id
    AND cover_images.is_deleted = 0
    AND cover_images.is_trashed = 0
    AND LOWER(cover_images.filename) IN (${COVER_FILENAME_SQL})
  ORDER BY
    CASE LOWER(cover_images.filename)
      WHEN 'cover.jpg' THEN 1
      WHEN 'cover.jpeg' THEN 2
      WHEN 'cover.png' THEN 3
      WHEN 'cover.webp' THEN 4
      WHEN 'cover.avif' THEN 5
      WHEN 'cover.gif' THEN 6
      ELSE 7
    END,
    cover_images.id ASC
  LIMIT 1
`;

const NEWEST_POST_AVATAR_IMAGE_ID_SQL = `
  SELECT pi.image_id
  FROM posts AS p
  JOIN post_items AS pi ON pi.post_id = p.id AND pi.position = 1
  JOIN images AS fallback_images ON fallback_images.id = pi.image_id
  WHERE p.folder_id = folders.id
    AND p.is_deleted = 0
    AND p.is_trashed = 0
  ORDER BY p.sort_timestamp DESC, p.id DESC
  LIMIT 1
`;

const FOLDER_SUMMARY_AVATAR_IMAGE_ID_SQL = `
  COALESCE(
    (${ACTIVE_FOLDER_AVATAR_IMAGE_ID_SQL}),
    (${EXPLICIT_FOLDER_COVER_IMAGE_ID_SQL}),
    (${NEWEST_POST_AVATAR_IMAGE_ID_SQL})
  )
`;

const FOLDER_SUMMARY_AVATAR_THUMBNAIL_PATH_SQL = `
  (
    SELECT thumbnail_path
    FROM images
    WHERE id = (${FOLDER_SUMMARY_AVATAR_IMAGE_ID_SQL})
    LIMIT 1
  )
`;

function getQualifiedFolderPostOrderSql(order: FolderImageOrder): string {
  return order === 'oldest'
    ? 'posts.sort_timestamp ASC, posts.id ASC'
    : 'posts.sort_timestamp DESC, posts.id DESC';
}

function getUnscopedFolderPostOrderSql(order: FolderImageOrder): string {
  return order === 'oldest'
    ? 'sort_timestamp ASC, id ASC'
    : 'sort_timestamp DESC, id DESC';
}

const POST_CAPTION_SEARCH_SQL = 'LOWER(COALESCE(posts.caption, \'\'))';
const IMAGE_FILENAME_SEARCH_SQL = 'LOWER(images.filename)';
const FOLDER_NAME_SEARCH_SQL = 'LOWER(folders.name)';
const FOLDER_SLUG_SEARCH_SQL = 'LOWER(folders.slug)';
const FOLDER_PATH_SEARCH_SQL = 'LOWER(folders.folder_path)';
const POST_SOURCE_PATH_SEARCH_SQL = 'LOWER(posts.source_path)';
const EXIF_CAMERA_MAKE_SEARCH_SQL =
  "LOWER(COALESCE(CASE WHEN json_valid(images.exif_json) THEN json_extract(images.exif_json, '$.cameraMake') END, ''))";
const EXIF_CAMERA_MODEL_SEARCH_SQL =
  "LOWER(COALESCE(CASE WHEN json_valid(images.exif_json) THEN json_extract(images.exif_json, '$.cameraModel') END, ''))";
const EXIF_LENS_MODEL_SEARCH_SQL =
  "LOWER(COALESCE(CASE WHEN json_valid(images.exif_json) THEN json_extract(images.exif_json, '$.lensModel') END, ''))";

const MEDIA_SEARCH_FIELD_SQL = [
  POST_CAPTION_SEARCH_SQL,
  IMAGE_FILENAME_SEARCH_SQL,
  FOLDER_NAME_SEARCH_SQL,
  FOLDER_SLUG_SEARCH_SQL,
  FOLDER_PATH_SEARCH_SQL,
  POST_SOURCE_PATH_SEARCH_SQL,
  EXIF_CAMERA_MAKE_SEARCH_SQL,
  EXIF_CAMERA_MODEL_SEARCH_SQL,
  EXIF_LENS_MODEL_SEARCH_SQL
] as const;

const POST_SAVED_SELECT_SQL = `
  CASE WHEN EXISTS (
    SELECT 1
    FROM collections
    INNER JOIN collection_items ON collection_items.collection_id = collections.id
    WHERE collections.is_default = 1
      AND collection_items.post_id = posts.id
  ) THEN 1 ELSE 0 END AS isSaved
`;

const BASE_POST_SELECT_SQL = `
  SELECT
    posts.id,
    posts.folder_id AS folderId,
    folders.slug AS folderSlug,
    folders.name AS folderName,
    folders.folder_path AS folderPath,
    images.filename,
    posts.caption AS caption,
    posts.post_type AS postType,
    posts.source_path AS sourcePath,
    images.width,
    images.height,
    images.media_type AS mediaType,
    images.duration_ms AS durationMs,
    images.is_animated AS isAnimated,
    images.thumbnail_path AS thumbnailUrl,
    images.preview_path AS previewUrl,
    images.playback_strategy AS playbackStrategy,
    posts.sort_timestamp AS sortTimestamp,
    posts.taken_at AS takenAt,
    ${POST_SAVED_SELECT_SQL},
    places.id AS placeId,
    places.slug AS placeSlug,
    places.display_name AS placeName,
    places.kind AS placeKind,
    places.is_approximate AS placeIsApproximate
  FROM posts
  INNER JOIN folders ON folders.id = posts.folder_id
  JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
  JOIN images ON images.id = post_items.image_id
  LEFT JOIN places ON places.id = posts.place_id
`;

const FOLDER_SUMMARY_SELECT_SQL = `
  SELECT
    folders.*,
    (
      SELECT COUNT(*)
      FROM posts
      WHERE posts.folder_id = folders.id
        AND posts.is_deleted = 0
        AND posts.is_trashed = 0
    ) AS post_count,
    (
      SELECT COUNT(*)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id AND pi.position = 1
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
        AND NOT (
          img.folder_id = p.folder_id
          AND LOWER(img.filename) IN (${COVER_FILENAME_SQL})
        )
    ) AS image_count,
    (
      SELECT COUNT(*)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id AND pi.position = 1
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
        AND p.post_type = 'carousel'
        AND NOT (
          img.folder_id = p.folder_id
          AND LOWER(img.filename) IN (${COVER_FILENAME_SQL})
        )
    ) AS carousel_count,
    (
      SELECT COUNT(*)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id AND pi.position = 1
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
        AND p.post_type = 'single'
        AND img.media_type = 'video'
    ) AS video_count,
    (
      SELECT MAX(img.mtime_ms)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
    ) AS latest_image_mtime_ms,
    CASE WHEN ${HAS_AVATAR_STORY_SQL} THEN 1 ELSE 0 END AS has_avatar_story,
    ${FOLDER_SUMMARY_AVATAR_IMAGE_ID_SQL} AS summary_avatar_image_id,
    ${FOLDER_SUMMARY_AVATAR_THUMBNAIL_PATH_SQL} AS summary_avatar_thumbnail_path
  FROM folders
`;

interface MediaSearchSql {
  whereSql: string;
  whereParams: string[];
  rankSql: string;
  rankParams: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function serializeAnimatedFlag(isAnimated: boolean | null | undefined): number {
  return isAnimated ? 1 : 0;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export function resolvePostIdByImageId(imageId: number): number | undefined {
  const itemRow = database.prepare('SELECT post_id FROM post_items WHERE image_id = ?').get(imageId) as { post_id: number } | undefined;
  return itemRow?.post_id;
}

export function resolveImageId(id: number): number {
  const imgRow = database.prepare('SELECT id FROM images WHERE id = ?').get(id) as { id: number } | undefined;
  if (imgRow) {
    return imgRow.id;
  }
  const itemRow = database.prepare('SELECT image_id FROM post_items WHERE post_id = ? ORDER BY position ASC LIMIT 1').get(id) as { image_id: number } | undefined;
  if (itemRow) {
    return itemRow.image_id;
  }
  return id;
}

function buildMediaSearchSql(query: string): MediaSearchSql | null {
  const normalizedQuery = normalizeSearchQuery(query);
  if (normalizedQuery.length === 0) {
    return null;
  }

  const normalizedTokens = [...new Set(normalizedQuery.split(' ').filter(Boolean))];
  const tokenClauseSql = `(${MEDIA_SEARCH_FIELD_SQL.map((fieldSql) => `${fieldSql} LIKE ? ESCAPE '\\'`).join(' OR ')})`;
  const whereSql = normalizedTokens.map(() => tokenClauseSql).join(' AND ');
  const whereParams = normalizedTokens.flatMap((token) =>
    MEDIA_SEARCH_FIELD_SQL.map(() => `%${escapeLikePattern(token)}%`)
  );
  const queryContainsPattern = `%${escapeLikePattern(normalizedQuery)}%`;
  const queryPrefixPattern = `${escapeLikePattern(normalizedQuery)}%`;

  const rankSqlParts = [
    `CASE
      WHEN ${POST_CAPTION_SEARCH_SQL} = ? THEN 250
      WHEN ${POST_CAPTION_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 190
      WHEN ${POST_CAPTION_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 150
      ELSE 0
    END`,
    `CASE
      WHEN ${IMAGE_FILENAME_SEARCH_SQL} = ? THEN 240
      WHEN ${IMAGE_FILENAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 180
      WHEN ${IMAGE_FILENAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 140
      ELSE 0
    END`,
    `CASE
      WHEN ${FOLDER_NAME_SEARCH_SQL} = ? THEN 120
      WHEN ${FOLDER_NAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 84
      WHEN ${FOLDER_NAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 56
      ELSE 0
    END`,
    `CASE
      WHEN ${FOLDER_SLUG_SEARCH_SQL} = ? THEN 76
      WHEN ${FOLDER_SLUG_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 52
      WHEN ${FOLDER_SLUG_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 36
      ELSE 0
    END`,
    `CASE WHEN ${FOLDER_PATH_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 32 ELSE 0 END`,
    `CASE WHEN ${POST_SOURCE_PATH_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 32 ELSE 0 END`,
    `CASE WHEN ${EXIF_CAMERA_MAKE_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`,
    `CASE WHEN ${EXIF_CAMERA_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`,
    `CASE WHEN ${EXIF_LENS_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 18 ELSE 0 END`
  ];
  const rankParams: string[] = [
    normalizedQuery,
    queryPrefixPattern,
    queryContainsPattern,
    normalizedQuery,
    queryPrefixPattern,
    queryContainsPattern,
    normalizedQuery,
    queryPrefixPattern,
    queryContainsPattern,
    normalizedQuery,
    queryPrefixPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern
  ];

  for (const token of normalizedTokens) {
    const tokenPattern = `%${escapeLikePattern(token)}%`;
    rankSqlParts.push(
      `CASE WHEN ${POST_CAPTION_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`,
      `CASE WHEN ${IMAGE_FILENAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 18 ELSE 0 END`,
      `CASE WHEN ${FOLDER_NAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 12 ELSE 0 END`,
      `CASE WHEN ${FOLDER_SLUG_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`,
      `CASE WHEN ${FOLDER_PATH_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`,
      `CASE WHEN ${POST_SOURCE_PATH_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`,
      `CASE WHEN ${EXIF_CAMERA_MAKE_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`,
      `CASE WHEN ${EXIF_CAMERA_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`,
      `CASE WHEN ${EXIF_LENS_MODEL_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`
    );
    rankParams.push(
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern,
      tokenPattern
    );
  }

  return {
    whereSql,
    whereParams,
    rankSql: rankSqlParts.join(' + '),
    rankParams
  };
}

export interface UpsertFolderInput {
  slug: string;
  name: string;
  folderPath: string;
  role?: FolderRole;
  storyOwnerFolderId?: number | null;
  carouselOwnerFolderId?: number | null;
}

export interface SaveFolderResult {
  folder: FolderRecord;
  wrote: boolean;
}

export interface CreateFolderShareLinkInput {
  folderId: number;
  tokenHash: string;
  tokenPrefix: string;
  expiresAt: string | null;
}

export interface CreatePostShareLinkInput {
  postId: number;
  tokenHash: string;
  tokenPrefix: string;
  expiresAt: string | null;
}

export interface UpsertFolderSharePasswordInput {
  folderId: number;
  passwordHash: string;
  passwordSalt: string;
}

export interface UpsertPostInput {
  existingPostId?: number;
  id?: number;
  folderId: number;
  placeId?: number | null;
  sourcePath: string;
  postType: PostType;
  caption?: string | null;
  sortTimestamp: number;
  takenAt?: number | null;
  takenAtSource?: TakenAtSource | null;
  isDeleted?: number;
  isTrashed?: number;
}

export interface UpsertImageInput {
  folderId: number;
  placeId?: number | null;
  assetKey?: string | null;
  filename: string;
  extension: string;
  relativePath: string;
  absolutePath: string;
  fileSize: number;
  width: number;
  height: number;
  displayOrientation?: number | null;
  mediaType: MediaType;
  mimeType: string;
  durationMs: number | null;
  isAnimated?: boolean | null;
  fingerprint: string;
  mtimeMs: number;
  firstSeenAt: string;
  sortTimestamp: number;
  takenAt: number;
  takenAtSource: TakenAtSource;
  exifJson: string | null;
  thumbnailPath: string;
  previewPath: string;
  playbackStrategy?: PlaybackStrategy | null;
}

export interface RefreshIndexedImageInput {
  folderId: number;
  placeId?: number | null;
  assetKey?: string | null;
  filename: string;
  extension: string;
  relativePath: string;
  absolutePath: string;
  fileSize: number;
  width: number;
  height: number;
  displayOrientation?: number | null;
  mediaType: MediaType;
  mimeType: string;
  durationMs: number | null;
  isAnimated?: boolean | null;
  fingerprint: string;
  mtimeMs: number;
  takenAt: number;
  takenAtSource: TakenAtSource;
  exifJson: string | null;
  thumbnailPath: string;
  previewPath: string;
  playbackStrategy?: PlaybackStrategy | null;
}

export interface ReconcileImageMoveInput {
  id: number;
  folderId: number;
  placeId?: number | null;
  filename: string;
  extension: string;
  relativePath: string;
  absolutePath: string;
  fileSize: number;
  width: number;
  height: number;
  displayOrientation?: number | null;
  mediaType: MediaType;
  mimeType: string;
  durationMs: number | null;
  isAnimated?: boolean | null;
  fingerprint: string;
  mtimeMs: number;
  takenAt: number;
  takenAtSource: TakenAtSource;
  exifJson: string | null;
  playbackStrategy?: PlaybackStrategy | null;
}

export interface UpsertFolderScanStateInput {
  folderPath: string;
  signature: string;
  fileCount: number;
  maxMtimeMs: number;
  totalSize: number;
}

export interface UpsertCityPlaceInput {
  geonamesId: number;
  displayName: string;
  slug: string;
  latitude: number;
  longitude: number;
  cityName: string;
  admin1Name?: string | null;
  countryName?: string | null;
  countryCode?: string | null;
  confidence?: number | null;
}

export const folderRepository = {
  getAll(): FolderRecord[] {
    return database.prepare('SELECT * FROM folders ORDER BY folder_path COLLATE NOCASE ASC').all() as unknown as FolderRecord[];
  },

  getNormalBySlug(slug: string): FolderRecord | undefined {
    return database.prepare("SELECT * FROM folders WHERE slug = ? AND role = 'normal'").get(slug) as FolderRecord | undefined;
  },

  // One round trip instead of one lookup per folder while naming parents.
  listPathNames(): Array<{ folder_path: string; name: string }> {
    return database.prepare('SELECT folder_path, name FROM folders').all() as unknown as Array<{
      folder_path: string;
      name: string;
    }>;
  },

  getAllSummaries(): FolderSummaryRecord[] {
    return database
      .prepare(
        `
        SELECT * FROM (
          ${FOLDER_SUMMARY_SELECT_SQL}
          WHERE folders.role = 'normal' AND ${SELECTED_SCAN_FOLDER_SCOPE_SQL}
        ) AS summaries
        WHERE post_count > 0 OR summary_avatar_image_id IS NOT NULL
        ORDER BY latest_image_mtime_ms DESC, name COLLATE NOCASE ASC, folder_path COLLATE NOCASE ASC
        `
      )
      .all() as unknown as FolderSummaryRecord[];
  },

  getBySlug(slug: string): FolderRecord | undefined {
    return database.prepare('SELECT * FROM folders WHERE slug = ?').get(slug) as FolderRecord | undefined;
  },

  getById(id: number): FolderRecord | undefined {
    return database.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRecord | undefined;
  },

  getByFolderPath(folderPath: string): FolderRecord | undefined {
    return database
      .prepare('SELECT * FROM folders WHERE folder_path = ?')
      .get(normalizePath(folderPath)) as FolderRecord | undefined;
  },

  getSummaryBySlug(slug: string): FolderSummaryRecord | undefined {
    return database
      .prepare(
        `
        ${FOLDER_SUMMARY_SELECT_SQL}
        WHERE folders.slug = ? AND folders.role = 'normal' AND ${SELECTED_SCAN_FOLDER_SCOPE_SQL}
        `
      )
      .get(slug) as FolderSummaryRecord | undefined;
  },

  upsert(input: UpsertFolderInput): FolderRecord {
    const normalizedFolderPath = normalizePath(input.folderPath);
    const role = input.role ?? 'normal';
    const storyOwnerFolderId = input.storyOwnerFolderId ?? null;
    const carouselOwnerFolderId = input.carouselOwnerFolderId ?? null;
    database.prepare(
      `
      INSERT INTO folders (slug, name, folder_path, role, story_owner_folder_id, carousel_owner_folder_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_path) DO UPDATE SET
        slug = excluded.slug,
        name = excluded.name,
        role = excluded.role,
        story_owner_folder_id = excluded.story_owner_folder_id,
        carousel_owner_folder_id = excluded.carousel_owner_folder_id,
        updated_at = excluded.updated_at
      `
    ).run(input.slug, input.name, normalizedFolderPath, role, storyOwnerFolderId, carouselOwnerFolderId, nowIso());

    return this.getByFolderPath(normalizedFolderPath) as FolderRecord;
  },

  save(input: UpsertFolderInput): SaveFolderResult {
    const normalizedFolderPath = normalizePath(input.folderPath);
    const existing = this.getByFolderPath(normalizedFolderPath);
    const role = input.role ?? 'normal';
    const storyOwnerFolderId = input.storyOwnerFolderId ?? null;
    const carouselOwnerFolderId = input.carouselOwnerFolderId ?? null;

    if (
      existing &&
      existing.slug === input.slug &&
      existing.role === role &&
      existing.story_owner_folder_id === storyOwnerFolderId &&
      existing.carousel_owner_folder_id === carouselOwnerFolderId
    ) {
      return {
        folder: existing,
        wrote: false
      };
    }

    if (existing) {
      database
        .prepare('UPDATE folders SET slug = ?, role = ?, story_owner_folder_id = ?, carousel_owner_folder_id = ?, updated_at = ? WHERE id = ?')
        .run(input.slug, role, storyOwnerFolderId, carouselOwnerFolderId, nowIso(), existing.id);

      return {
        folder: this.getById(existing.id) as FolderRecord,
        wrote: true
      };
    }

    return {
      folder: this.upsert({
        ...input,
        folderPath: normalizedFolderPath
      }),
      wrote: true
    };
  },

  count(): number {
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM folders
            WHERE folders.role = 'normal'
              AND ${SELECTED_SCAN_FOLDER_SCOPE_SQL}
              AND (
                EXISTS (
                  SELECT 1
                  FROM posts
                  WHERE posts.folder_id = folders.id AND posts.is_deleted = 0 AND posts.is_trashed = 0
                )
                OR EXISTS (
                  SELECT 1
                  FROM images
                  WHERE images.folder_id = folders.id AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}
                )
              )
            `
          )
          .get() as { count: number }
      ).count
    );
  },

  setAvatar(folderId: number, imageId: number | null, source: FolderAvatarSource = 'auto'): void {
    database.prepare(
      'UPDATE folders SET avatar_image_id = ?, avatar_source = ?, updated_at = ? WHERE id = ? AND (avatar_image_id IS NOT ? OR avatar_source != ?)'
    ).run(
      imageId,
      source,
      nowIso(),
      folderId,
      imageId,
      source
    );
  },

  updateMetadata(slug: string, name: string, description: string | null): FolderRecord | undefined {
    database.prepare("UPDATE folders SET name = ?, description = ?, updated_at = ? WHERE slug = ? AND role = 'normal'").run(
      name,
      description,
      nowIso(),
      slug
    );
    return this.getNormalBySlug(slug);
  },

  delete(id: number): void {
    database.prepare('DELETE FROM folders WHERE id = ?').run(id);
  },

  resolveAvatarSelection(folderId: number): { imageId: number | null; source: FolderAvatarSource } | null {
    const folder = this.getById(folderId);
    if (!folder) {
      return null;
    }

    if (folder.avatar_source === 'manual' && folder.avatar_image_id !== null) {
      const manualImage = imageRepository.getById(folder.avatar_image_id);
      const manualImageFolder = manualImage ? this.getById(manualImage.folder_id) : undefined;
      const belongsToFolder = manualImage?.folder_id === folderId || (
        manualImageFolder?.role === 'carousel_source' &&
        manualImageFolder.carousel_owner_folder_id === folderId
      );
      if (
        manualImage &&
        belongsToFolder &&
        manualImage.is_deleted === 0 &&
        manualImage.is_trashed === 0
      ) {
        return {
          imageId: manualImage.id,
          source: 'manual'
        };
      }
    }

    const explicitCoverImageId = imageRepository.getExplicitCoverImageId(folderId);
    if (explicitCoverImageId !== null) {
      return {
        imageId: explicitCoverImageId,
        source: 'cover'
      };
    }

    return {
      imageId: imageRepository.getLatestFolderImageId(folderId),
      source: 'auto'
    };
  },

  syncAvatarSelection(folderId: number): void {
    const nextSelection = this.resolveAvatarSelection(folderId);
    if (!nextSelection) {
      return;
    }

    this.setAvatar(folderId, nextSelection.imageId, nextSelection.source);
  },

  listOwnedStoryFolders(ownerFolderId: number): FolderRecord[] {
    return database
      .prepare(
        `
        SELECT *
        FROM folders
        WHERE story_owner_folder_id = ?
          AND role IN ('story_root', 'story_capsule')
        ORDER BY
          CASE role
            WHEN 'story_root' THEN 0
            ELSE 1
          END,
          name COLLATE NOCASE ASC,
          folder_path COLLATE NOCASE ASC
        `
      )
      .all(ownerFolderId) as unknown as FolderRecord[];
  },

  getOwnedStoryFolderBySlug(ownerFolderId: number, slug: string): FolderRecord | undefined {
    return database
      .prepare(
        `
        SELECT *
        FROM folders
        WHERE story_owner_folder_id = ?
          AND slug = ?
          AND role IN ('story_root', 'story_capsule')
        `
      )
      .get(ownerFolderId, slug) as FolderRecord | undefined;
  },

  hasLegacyStoriesCandidates(): boolean {
    const row = database
      .prepare(
        `
        SELECT 1 AS found
        FROM folders
        WHERE
          LOWER(folder_path) = 'stories'
          OR LOWER(folder_path) LIKE '%/stories'
          OR LOWER(folder_path) LIKE 'stories/%'
          OR LOWER(folder_path) LIKE '%/stories/%'
        LIMIT 1
        `
      )
      .get() as { found: number } | undefined;

    return row?.found === 1;
  },

  hasLegacyCarouselsCandidates(): boolean {
    const row = database
      .prepare(
        `
        SELECT 1 AS found
        FROM folders
        WHERE
          LOWER(folder_path) = 'carousels'
          OR LOWER(folder_path) LIKE '%/carousels'
          OR LOWER(folder_path) LIKE 'carousels/%'
          OR LOWER(folder_path) LIKE '%/carousels/%'
        LIMIT 1
        `
      )
      .get() as { found: number } | undefined;

    return row?.found === 1;
  }
};

export const placeRepository = {
  list(): Array<PlaceRecord & { post_count: number }> {
    return database
      .prepare(
        `
        SELECT places.*, COUNT(posts.id) AS post_count
        FROM places
        INNER JOIN posts ON posts.place_id = places.id
        INNER JOIN folders ON folders.id = posts.folder_id
        WHERE ${VISIBLE_POST_WHERE_SQL}
        GROUP BY places.id
        ORDER BY post_count DESC, places.display_name COLLATE NOCASE ASC
        `
      )
      .all() as unknown as Array<PlaceRecord & { post_count: number }>;
  },

  getBySlug(slug: string): PlaceRecord | undefined {
    return database.prepare('SELECT * FROM places WHERE slug = ?').get(slug) as PlaceRecord | undefined;
  },

  getByGeonamesId(geonamesId: number): PlaceRecord | undefined {
    return database.prepare('SELECT * FROM places WHERE geonames_id = ? LIMIT 1').get(geonamesId) as PlaceRecord | undefined;
  },

  getAllSlugs(): string[] {
    return (database.prepare('SELECT slug FROM places').all() as Array<{ slug: string }>).map((row) => row.slug);
  },

  upsertCity(input: UpsertCityPlaceInput): PlaceRecord {
    const existing = this.getByGeonamesId(input.geonamesId);
    if (existing) {
      database
        .prepare(
          `
          UPDATE places
          SET
            display_name = ?,
            source_confidence = ?,
            latitude = ?,
            longitude = ?,
            city_name = ?,
            admin1_name = ?,
            country_name = ?,
            country_code = ?,
            updated_at = ?
          WHERE id = ?
          `
        )
        .run(
          input.displayName,
          input.confidence ?? null,
          input.latitude,
          input.longitude,
          input.cityName,
          input.admin1Name ?? null,
          input.countryName ?? input.countryCode ?? null,
          input.countryCode ?? null,
          nowIso(),
          existing.id
        );

      return this.getById(existing.id) as PlaceRecord;
    }

    database
      .prepare(
        `
        INSERT INTO places (
          slug, display_name, kind, source, source_confidence, provider, provider_place_id,
          latitude, longitude, city_name, admin1_name, country_name, country_code,
          geonames_id, is_approximate, updated_at
        )
        VALUES (?, ?, 'city', 'offline_city', ?, 'geonames', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `
      )
      .run(
        input.slug,
        input.displayName,
        input.confidence ?? null,
        String(input.geonamesId),
        input.latitude,
        input.longitude,
        input.cityName,
        input.admin1Name ?? null,
        input.countryName ?? input.countryCode ?? null,
        input.countryCode ?? null,
        input.geonamesId,
        nowIso()
      );

    return this.getByGeonamesId(input.geonamesId) as PlaceRecord;
  },

  getById(id: number): PlaceRecord | undefined {
    return database.prepare('SELECT * FROM places WHERE id = ?').get(id) as PlaceRecord | undefined;
  },

  countVisibleImages(placeId: number, mediaType?: MediaType): number {
    if (mediaType) {
      return Number(
        (
          database
            .prepare(
              `
              SELECT COUNT(DISTINCT posts.id) AS count
              FROM posts
              INNER JOIN folders ON folders.id = posts.folder_id
              INNER JOIN post_items pi ON pi.post_id = posts.id
              INNER JOIN images ON images.id = pi.image_id
              WHERE posts.place_id = ? AND ${VISIBLE_POST_WHERE_SQL} AND images.media_type = ?
              `
            )
            .get(placeId, mediaType) as { count: number }
        ).count
      );
    }
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM posts
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE posts.place_id = ? AND ${VISIBLE_POST_WHERE_SQL}
            `
          )
          .get(placeId) as { count: number }
      ).count
    );
  }
};

export const postRepository = {
  upsertPost(input: UpsertPostInput): PostRecord {
    const isDeleted = input.isDeleted ?? 0;
    const isTrashed = input.isTrashed ?? 0;
    const updatedAt = nowIso();

    const existingByMembership = input.existingPostId !== undefined ? this.findById(input.existingPostId) : undefined;
    const existingBySource = this.findBySourcePath(input.sourcePath);
    const targetPost = existingByMembership ?? existingBySource;

    if (targetPost) {
      database.prepare(
        `
        UPDATE posts
        SET folder_id = ?,
            place_id = ?,
            source_path = ?,
            post_type = ?,
            caption = COALESCE(caption, ?),
            sort_timestamp = ?,
            taken_at = ?,
            taken_at_source = ?,
            is_deleted = ?,
            deleted_at = CASE WHEN ? = 1 THEN ? ELSE NULL END,
            updated_at = ?
        WHERE id = ?
        `
      ).run(
        input.folderId,
        input.placeId ?? null,
        input.sourcePath,
        input.postType,
        input.caption ?? null,
        input.sortTimestamp,
        input.takenAt ?? null,
        input.takenAtSource ?? null,
        isDeleted,
        isDeleted,
        updatedAt,
        updatedAt,
        targetPost.id
      );
      return this.findById(targetPost.id)!;
    }

    const preferredIdAvailable = input.id !== undefined && !this.findById(input.id);
    if (preferredIdAvailable) {
      database.prepare(
        `
        INSERT INTO posts (
          id, folder_id, place_id, source_path, post_type, caption, sort_timestamp, taken_at, taken_at_source,
          is_deleted, deleted_at, is_trashed, trashed_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN ? ELSE NULL END, ?, CASE WHEN ? = 1 THEN ? ELSE NULL END, ?)
        ON CONFLICT(source_path) DO UPDATE SET
          folder_id = excluded.folder_id,
          place_id = excluded.place_id,
          post_type = excluded.post_type,
          caption = COALESCE(posts.caption, excluded.caption),
          sort_timestamp = excluded.sort_timestamp,
          taken_at = excluded.taken_at,
          taken_at_source = excluded.taken_at_source,
          is_deleted = excluded.is_deleted,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
        `
      ).run(
        input.id!,
        input.folderId,
        input.placeId ?? null,
        input.sourcePath,
        input.postType,
        input.caption ?? null,
        input.sortTimestamp,
        input.takenAt ?? null,
        input.takenAtSource ?? null,
        isDeleted,
        isDeleted,
        updatedAt,
        isTrashed,
        isTrashed,
        updatedAt,
        updatedAt
      );
    } else {
      database.prepare(
        `
        INSERT INTO posts (
          folder_id, place_id, source_path, post_type, caption, sort_timestamp, taken_at, taken_at_source,
          is_deleted, deleted_at, is_trashed, trashed_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 1 THEN ? ELSE NULL END, ?, CASE WHEN ? = 1 THEN ? ELSE NULL END, ?)
        ON CONFLICT(source_path) DO UPDATE SET
          folder_id = excluded.folder_id,
          place_id = excluded.place_id,
          post_type = excluded.post_type,
          caption = COALESCE(posts.caption, excluded.caption),
          sort_timestamp = excluded.sort_timestamp,
          taken_at = excluded.taken_at,
          taken_at_source = excluded.taken_at_source,
          is_deleted = excluded.is_deleted,
          deleted_at = excluded.deleted_at,
          updated_at = excluded.updated_at
        `
      ).run(
        input.folderId,
        input.placeId ?? null,
        input.sourcePath,
        input.postType,
        input.caption ?? null,
        input.sortTimestamp,
        input.takenAt ?? null,
        input.takenAtSource ?? null,
        isDeleted,
        isDeleted,
        updatedAt,
        isTrashed,
        isTrashed,
        updatedAt,
        updatedAt
      );
    }

    return this.findBySourcePath(input.sourcePath) as PostRecord;
  },

  setPostItems(postId: number, items: Array<{ imageId: number; position: number }>): void {
    database.exec('BEGIN IMMEDIATE');
    try {
      this.replacePostItems(postId, items);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },

  upsertPostWithItems(input: UpsertPostInput, items: Array<{ imageId: number; position: number }>): PostRecord {
    database.exec('BEGIN IMMEDIATE');
    try {
      const post = this.upsertPost(input);
      this.replacePostItems(post.id, items);
      database.exec('COMMIT');
      return post;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },

  replacePostItems(postId: number, items: Array<{ imageId: number; position: number }>): void {
    database.prepare('DELETE FROM post_items WHERE post_id = ?').run(postId);
    const statement = database.prepare('INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, ?)');
    for (const item of items) {
      statement.run(postId, item.imageId, item.position);
    }
  },

  syncRepresentativePlaces(): number {
    const updatedAt = nowIso();
    const result = database.prepare(
      `
      UPDATE posts
      SET
        place_id = (
          SELECT images.place_id
          FROM post_items
          INNER JOIN images ON images.id = post_items.image_id
          WHERE post_items.post_id = posts.id AND post_items.position = 1
        ),
        updated_at = ?
      WHERE EXISTS (
        SELECT 1
        FROM post_items
        WHERE post_items.post_id = posts.id AND post_items.position = 1
      )
        AND place_id IS NOT (
          SELECT images.place_id
          FROM post_items
          INNER JOIN images ON images.id = post_items.image_id
          WHERE post_items.post_id = posts.id AND post_items.position = 1
        )
      `
    ).run(updatedAt);
    return Number(result.changes ?? 0);
  },

  findById(id: number): PostRecord | undefined {
    return database.prepare('SELECT * FROM posts WHERE id = ?').get(id) as PostRecord | undefined;
  },

  findBySourcePath(sourcePath: string): PostRecord | undefined {
    return database.prepare('SELECT * FROM posts WHERE source_path = ?').get(sourcePath) as PostRecord | undefined;
  },

  findByImageId(imageId: number): PostRecord | undefined {
    const row = database.prepare('SELECT post_id FROM post_items WHERE image_id = ? LIMIT 1').get(imageId) as { post_id: number } | undefined;
    return row ? this.findById(row.post_id) : undefined;
  },

  findByExactImageIds(imageIds: number[]): PostRecord | undefined {
    if (imageIds.length === 0) return undefined;
    const uniqueImageIds = [...new Set(imageIds)];
    if (uniqueImageIds.length !== imageIds.length) return undefined;
    const placeholders = uniqueImageIds.map(() => '?').join(',');
    const matchingPosts = database
      .prepare(
        `
        SELECT post_id
        FROM post_items
        GROUP BY post_id
        HAVING COUNT(*) = ?
          AND SUM(CASE WHEN image_id IN (${placeholders}) THEN 1 ELSE 0 END) = ?
        LIMIT 2
        `
      )
      .all(uniqueImageIds.length, ...uniqueImageIds, uniqueImageIds.length) as Array<{ post_id: number }>;

    if (matchingPosts.length === 1) {
      return this.findById(matchingPosts[0].post_id);
    }
    return undefined;
  },

  isExplicitFolderCover(postId: number): boolean {
    const row = database
      .prepare(
        `
        SELECT 1 AS found
        FROM posts
        INNER JOIN folders ON folders.id = posts.folder_id
        INNER JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
        INNER JOIN images ON images.id = post_items.image_id
        WHERE posts.id = ?
          AND folders.role = 'normal'
          AND images.folder_id = posts.folder_id
          AND LOWER(images.filename) IN (${COVER_FILENAME_SQL})
        LIMIT 1
        `
      )
      .get(postId) as { found: number } | undefined;
    return row?.found === 1;
  },

  listImageRecords(postId: number): ImageRecord[] {
    return database.prepare(
      `SELECT images.*
       FROM post_items
       INNER JOIN images ON images.id = post_items.image_id
       WHERE post_items.post_id = ?
       ORDER BY post_items.position ASC`
    ).all(postId) as unknown as ImageRecord[];
  },

  deletePostAndImages(postId: number): { id: number; folderSlug: string } | undefined {
    database.exec('BEGIN IMMEDIATE');
    try {
      const post = this.findById(postId);
      if (!post) {
        database.exec('ROLLBACK');
        return undefined;
      }

      const folder = folderRepository.getById(post.folder_id);
      const imageIds = this.listImageRecords(post.id).map((image) => image.id);
      const affectedAvatarFolderIds = new Set<number>([post.folder_id]);

      if (imageIds.length > 0) {
        const placeholders = imageIds.map(() => '?').join(', ');
        const avatarRows = database
          .prepare(`SELECT id FROM folders WHERE avatar_image_id IN (${placeholders})`)
          .all(...imageIds) as Array<{ id: number }>;
        for (const avatarRow of avatarRows) {
          affectedAvatarFolderIds.add(avatarRow.id);
        }

        database
          .prepare(`UPDATE folders SET avatar_image_id = NULL, avatar_source = 'auto', updated_at = ? WHERE avatar_image_id IN (${placeholders})`)
          .run(nowIso(), ...imageIds);
      }

      database.prepare('DELETE FROM likes WHERE post_id = ?').run(post.id);
      database.prepare('DELETE FROM collection_items WHERE post_id = ?').run(post.id);
      database.prepare('DELETE FROM post_items WHERE post_id = ?').run(post.id);
      database.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
      const deleteImage = database.prepare('DELETE FROM images WHERE id = ?');
      for (const imageId of imageIds) {
        deleteImage.run(imageId);
      }

      for (const folderId of affectedAvatarFolderIds) {
        folderRepository.syncAvatarSelection(folderId);
      }

      database.exec('COMMIT');
      return { id: post.id, folderSlug: folder?.slug ?? '' };
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },

  hydratePostItems(posts: FeedPost[]): FeedPost[] {
    if (posts.length === 0) {
      return posts;
    }

    const postIds = posts.map((p) => p.id);
    const placeholders = postIds.map(() => '?').join(', ');
    const rows = database
      .prepare(
        `
        SELECT
          pi.post_id AS postId,
          pi.position,
          img.id AS imageId,
          img.filename,
          img.width,
          img.height,
          img.media_type AS mediaType,
          img.duration_ms AS durationMs,
          img.is_animated AS isAnimated,
          img.thumbnail_path AS thumbnailUrl,
          img.preview_path AS previewUrl,
          img.relative_path AS relativePath,
          img.mime_type AS mimeType,
          img.file_size AS fileSize,
          img.playback_strategy AS playbackStrategy,
          img.exif_json AS exifJson
        FROM post_items pi
        JOIN images img ON pi.image_id = img.id
        WHERE pi.post_id IN (${placeholders})
        ORDER BY pi.post_id, pi.position ASC
        `
      )
      .all(...postIds) as Array<{
        postId: number;
        position: number;
        imageId: number;
        filename: string;
        width: number;
        height: number;
        mediaType: MediaType;
        durationMs: number | null;
        isAnimated: number | null;
        thumbnailUrl: string;
        previewUrl: string;
        relativePath: string;
        mimeType: string;
        fileSize: number;
        playbackStrategy: PlaybackStrategy | null;
        exifJson: string | null;
      }>;

    const itemsByPostId = new Map<number, PostMediaItem[]>();
    for (const row of rows) {
      if (!itemsByPostId.has(row.postId)) {
        itemsByPostId.set(row.postId, []);
      }
      itemsByPostId.get(row.postId)!.push({
        imageId: row.imageId,
        position: row.position,
        filename: row.filename,
        width: row.width,
        height: row.height,
        mediaType: row.mediaType,
        durationMs: row.durationMs,
        isAnimated: row.isAnimated === 1,
        thumbnailUrl: row.thumbnailUrl,
        previewUrl: row.previewUrl,
        originalUrl: `/api/originals/${row.imageId}`,
        playbackStrategy: row.playbackStrategy,
        mimeType: row.mimeType,
        fileSize: row.fileSize,
        relativePath: row.relativePath,
        exif: row.exifJson && isValidJson(row.exifJson) ? JSON.parse(row.exifJson) : null
      });
    }

    for (const post of posts) {
      const items = itemsByPostId.get(post.id) ?? [];
      post.mediaItems = items;
      post.itemCount = items.length;
      post.postType = items.length > 1 ? 'carousel' : (post.postType || 'single');

      if (items.length > 0) {
        const first = items[0];
        post.filename = first.filename;
        post.width = first.width;
        post.height = first.height;
        post.mediaType = first.mediaType;
        post.durationMs = first.durationMs;
        post.isAnimated = first.isAnimated;
        post.thumbnailUrl = first.thumbnailUrl;
        post.previewUrl = first.previewUrl;
      }
    }

    return posts;
  },

  listFeed(page: number, limit: number): FeedPost[] {
    const offset = (page - 1) * limit;
    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      WHERE ${VISIBLE_POST_WHERE_SQL} AND ${RENDERABLE_COVER_WHERE_SQL}
      ORDER BY posts.sort_timestamp DESC, posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  countFeed(): number {
    return Number(
      (database.prepare(`SELECT COUNT(*) AS count FROM posts WHERE ${VISIBLE_POST_WHERE_UNSCOPED_SQL}`).get() as { count: number }).count
    );
  },

  /**
   * Feed pagination total. Kept separate from `countFeed` so the library statistics keep
   * reporting everything that is indexed while the feed only promises what it can draw.
   */
  countRenderableFeed(): number {
    return Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM posts
             INNER JOIN folders ON folders.id = posts.folder_id
             JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
             JOIN images ON images.id = post_items.image_id
             WHERE ${VISIBLE_POST_WHERE_SQL} AND ${RENDERABLE_COVER_WHERE_SQL}`
          )
          .get() as { count: number }
      ).count
    );
  },

  countVisibleMediaAssets(): number {
    return Number((database.prepare(
      `SELECT COUNT(*) AS count
       FROM post_items
       INNER JOIN posts ON posts.id = post_items.post_id
       INNER JOIN folders ON folders.id = posts.folder_id
       INNER JOIN images ON images.id = post_items.image_id
       WHERE ${VISIBLE_POST_WHERE_SQL}
         AND ${SELECTED_SCAN_IMAGE_SCOPE_SQL}`
    ).get() as { count: number }).count);
  },

  countVisibleCarousels(): number {
    return Number((database.prepare(
      `SELECT COUNT(*) AS count FROM posts WHERE ${VISIBLE_POST_WHERE_UNSCOPED_SQL} AND post_type = 'carousel'`
    ).get() as { count: number }).count);
  },

  countVisibleSingleVideos(): number {
    return Number((database.prepare(
      `SELECT COUNT(*) AS count
       FROM posts
       INNER JOIN folders ON folders.id = posts.folder_id
       INNER JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
       INNER JOIN images ON images.id = post_items.image_id
       WHERE ${VISIBLE_POST_WHERE_SQL}
         AND posts.post_type = 'single'
         AND images.media_type = 'video'`
    ).get() as { count: number }).count);
  },

  listVisibleByFolder(
    folderId: number,
    page: number,
    limit: number,
    order: FolderImageOrder = 'newest',
    mediaType?: MediaType
  ): FeedPost[] {
    const offset = (page - 1) * limit;
    const orderBySql = getQualifiedFolderPostOrderSql(order);
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      WHERE posts.folder_id = ? AND ${VISIBLE_POST_WHERE_SQL}${mediaTypeClause}
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?
      `
    ).all(...(mediaType ? [folderId, mediaType, limit, offset] : [folderId, limit, offset])) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  countVisibleByFolder(folderId: number, mediaType?: MediaType): number {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM posts
            INNER JOIN folders ON folders.id = posts.folder_id
            JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
            JOIN images ON images.id = post_items.image_id
            WHERE posts.folder_id = ? AND ${VISIBLE_POST_WHERE_SQL}${mediaTypeClause}
            `
          )
          .get(...(mediaType ? [folderId, mediaType] : [folderId])) as { count: number }
      ).count
    );
  },

  listRecentCandidates(offset: number, limit: number, excludeIds?: number[]): FeedPost[] {
    const excluded = buildExcludedPostIdsClause(excludeIds);
    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      WHERE ${VISIBLE_POST_WHERE_SQL} AND ${RENDERABLE_COVER_WHERE_SQL}${excluded.sql}
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, posts.sort_timestamp DESC, posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...excluded.params, limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  countRediscover(cutoffTimestamp: number): number {
    return Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count
             FROM posts
             INNER JOIN folders ON folders.id = posts.folder_id
             JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
             JOIN images ON images.id = post_items.image_id
             WHERE ${VISIBLE_POST_WHERE_SQL} AND ${RENDERABLE_COVER_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?`
          )
          .get(cutoffTimestamp) as { count: number }
      ).count
    );
  },

  listRediscoverCandidates(offset: number, limit: number, cutoffTimestamp: number): FeedPost[] {
    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      LEFT JOIN likes ON likes.post_id = posts.id
      WHERE ${VISIBLE_POST_WHERE_SQL} AND ${RENDERABLE_COVER_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
      ORDER BY
        CASE WHEN likes.post_id IS NULL THEN 0 ELSE 1 END DESC,
        ${EFFECTIVE_FEED_TIME_SQL} DESC,
        posts.sort_timestamp DESC,
        posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(cutoffTimestamp, limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  listRandom(page: number, limit: number, seed: number, excludeIds?: number[]): FeedPost[] {
    const offset = (page - 1) * limit;
    const excluded = buildExcludedPostIdsClause(excludeIds);
    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      WHERE ${VISIBLE_POST_WHERE_SQL} AND ${RENDERABLE_COVER_WHERE_SQL}${excluded.sql}
      ORDER BY ABS(((posts.id * 1103515245) + (? * 1013904223)) % 2147483647), posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...excluded.params, seed, limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  listVisibleVideoCandidates(): ReelCandidate[] {
    const posts = database.prepare(
      `
      SELECT
        posts.id,
        posts.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        posts.caption AS caption,
        posts.post_type AS postType,
        posts.source_path AS sourcePath,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        posts.sort_timestamp AS sortTimestamp,
        posts.taken_at AS takenAt,
        ${POST_SAVED_SELECT_SQL},
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate,
        likes.created_at AS likedAt
      FROM posts
      INNER JOIN folders ON folders.id = posts.folder_id
      JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
      JOIN images ON images.id = post_items.image_id
      LEFT JOIN places ON places.id = posts.place_id
      LEFT JOIN likes ON likes.post_id = posts.id
      WHERE ${VISIBLE_POST_WHERE_SQL}
        AND ${RENDERABLE_COVER_WHERE_SQL}
        AND posts.post_type = 'single'
        AND images.media_type = 'video'
        AND LOWER(images.filename) NOT IN (${COVER_FILENAME_SQL})
      ORDER BY posts.sort_timestamp DESC, posts.id DESC
      `
    ).all() as unknown as ReelCandidate[];

    return this.hydratePostItems(posts) as ReelCandidate[];
  },

  listVisibleSearch(query: string, page: number, limit: number): FeedPost[] {
    const mediaSearch = buildMediaSearchSql(query);
    if (!mediaSearch) {
      return [];
    }

    const offset = (page - 1) * limit;
    const posts = database.prepare(
      `
      SELECT
        base_posts.*
      FROM (
        SELECT
          posts.id AS postId,
          MAX(${mediaSearch.rankSql}) AS searchRank
        FROM posts
        INNER JOIN folders ON folders.id = posts.folder_id
        JOIN post_items ON post_items.post_id = posts.id
        JOIN images ON images.id = post_items.image_id
        WHERE ${VISIBLE_POST_WHERE_SQL} AND ${mediaSearch.whereSql}
        GROUP BY posts.id
      ) AS search_matches
      JOIN (
        ${BASE_POST_SELECT_SQL}
      ) AS base_posts ON base_posts.id = search_matches.postId
      ORDER BY search_matches.searchRank DESC, base_posts.sortTimestamp DESC, base_posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...mediaSearch.rankParams, ...mediaSearch.whereParams, limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  countVisibleSearch(query: string): number {
    const mediaSearch = buildMediaSearchSql(query);
    if (!mediaSearch) {
      return 0;
    }

    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(DISTINCT posts.id) AS count
            FROM posts
            INNER JOIN folders ON folders.id = posts.folder_id
            JOIN post_items ON post_items.post_id = posts.id
            JOIN images ON images.id = post_items.image_id
            WHERE ${VISIBLE_POST_WHERE_SQL} AND ${mediaSearch.whereSql}
            `
          )
          .get(...mediaSearch.whereParams) as { count: number }
      ).count
    );
  },

  countByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number): number {
    if (monthDayKeys.length === 0) {
      return 0;
    }

    const placeholders = monthDayKeys.map(() => '?').join(', ');
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM posts
            WHERE ${VISIBLE_POST_WHERE_UNSCOPED_SQL}
              AND strftime('%m-%d', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') IN (${placeholders})
              AND CAST(strftime('%Y', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') AS INTEGER) < ?
            `
          )
          .get(...monthDayKeys, maxYearExclusive) as { count: number }
      ).count
    );
  },

  listByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number, page: number, limit: number): FeedPost[] {
    if (monthDayKeys.length === 0) {
      return [];
    }

    const offset = (page - 1) * limit;
    const placeholders = monthDayKeys.map(() => '?').join(', ');

    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      WHERE ${VISIBLE_POST_WHERE_SQL}
        AND strftime('%m-%d', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') IN (${placeholders})
        AND CAST(strftime('%Y', ${EFFECTIVE_FEED_TIME_SQL} / 1000, 'unixepoch', 'localtime') AS INTEGER) < ?
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, posts.sort_timestamp DESC, posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...monthDayKeys, maxYearExclusive, limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  countByEffectiveTimeRange(startTimestamp: number, endTimestamp: number): number {
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM posts
            WHERE ${VISIBLE_POST_WHERE_UNSCOPED_SQL}
              AND ${EFFECTIVE_FEED_TIME_SQL} BETWEEN ? AND ?
            `
          )
          .get(startTimestamp, endTimestamp) as { count: number }
      ).count
    );
  },

  listByEffectiveTimeRange(startTimestamp: number, endTimestamp: number, page: number, limit: number): FeedPost[] {
    const offset = (page - 1) * limit;

    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      WHERE ${VISIBLE_POST_WHERE_SQL}
        AND ${EFFECTIVE_FEED_TIME_SQL} BETWEEN ? AND ?
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, posts.sort_timestamp DESC, posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(startTimestamp, endTimestamp, limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  listPlacePosts(placeId: number, page: number, limit: number): FeedPost[] {
    const offset = (page - 1) * limit;
    const posts = database.prepare(
      `
      ${BASE_POST_SELECT_SQL}
      WHERE posts.place_id = ? AND ${VISIBLE_POST_WHERE_SQL}
      ORDER BY posts.sort_timestamp DESC, posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(placeId, limit, offset) as unknown as FeedPost[];

    return this.hydratePostItems(posts);
  },

  listTrashed(page: number, limit: number): TrashPost[] {
    const offset = (page - 1) * limit;
    const posts = database.prepare(
      `
      SELECT
        posts.id,
        posts.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        posts.caption AS caption,
        posts.post_type AS postType,
        posts.source_path AS sourcePath,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        posts.sort_timestamp AS sortTimestamp,
        posts.taken_at AS takenAt,
        ${POST_SAVED_SELECT_SQL},
        posts.trashed_at AS trashedAt,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM posts
      INNER JOIN folders ON folders.id = posts.folder_id
      JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
      JOIN images ON images.id = post_items.image_id
      LEFT JOIN places ON places.id = posts.place_id
      WHERE posts.is_deleted = 0 AND posts.is_trashed = 1
      ORDER BY posts.trashed_at DESC, posts.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(limit, offset) as unknown as TrashPost[];

    return this.hydratePostItems(posts) as TrashPost[];
  },

  countTrashed(): number {
    return Number(
      (database.prepare('SELECT COUNT(*) AS count FROM posts WHERE is_deleted = 0 AND is_trashed = 1').get() as { count: number }).count
    );
  },

  getPostDetail(
    id: number,
    folderImageOrder: FolderImageOrder = 'newest'
  ): PostDetail | undefined {
    const resolvedId = id;
    const nextComparisonSql = folderImageOrder === 'oldest'
      ? '(sort_timestamp > ? OR (sort_timestamp = ? AND id > ?))'
      : '(sort_timestamp < ? OR (sort_timestamp = ? AND id < ?))';
    const previousComparisonSql = folderImageOrder === 'oldest'
      ? '(sort_timestamp < ? OR (sort_timestamp = ? AND id < ?))'
      : '(sort_timestamp > ? OR (sort_timestamp = ? AND id > ?))';
    const nextOrderSql = getUnscopedFolderPostOrderSql(folderImageOrder);
    const previousOrderSql = getUnscopedFolderPostOrderSql(folderImageOrder === 'oldest' ? 'newest' : 'oldest');

    const detailRow = database.prepare(
      `
      SELECT
        posts.id,
        posts.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        folders.avatar_image_id AS folderAvatarImageId,
        images.filename,
        posts.caption AS caption,
        posts.post_type AS postType,
        posts.source_path AS sourcePath,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.relative_path AS relativePath,
        images.mime_type AS mimeType,
        images.file_size AS fileSize,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        images.exif_json AS exifJson,
        images.absolute_path AS originalUrl,
        posts.sort_timestamp AS sortTimestamp,
        posts.taken_at AS takenAt,
        ${POST_SAVED_SELECT_SQL},
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM posts
      INNER JOIN folders ON folders.id = posts.folder_id
      JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
      JOIN images ON images.id = post_items.image_id
      LEFT JOIN places ON places.id = posts.place_id
      WHERE posts.id = ? AND posts.is_deleted = 0 AND posts.is_trashed = 0 AND ${NORMAL_FOLDER_ROLE_SQL}
        AND ${SELECTED_SCAN_POST_SCOPE_SQL}
      `
    ).get(resolvedId) as (Omit<PostDetail, 'nextPostId' | 'previousPostId' | 'nextImageId' | 'previousImageId' | 'exif' | 'mediaItems' | 'itemCount'> & { originalUrl: string; exifJson: string | null }) | undefined;

    if (!detailRow) {
      return undefined;
    }

    const hydratedPosts = this.hydratePostItems([detailRow as unknown as FeedPost]);
    const hydratedPost = hydratedPosts[0];

    const next = database.prepare(
      `
      SELECT id
      FROM posts
      WHERE folder_id = ? AND ${VISIBLE_POST_WHERE_UNSCOPED_SQL}
        AND ${nextComparisonSql}
      ORDER BY ${nextOrderSql}
      LIMIT 1
      `
    ).get(hydratedPost.folderId, hydratedPost.sortTimestamp, hydratedPost.sortTimestamp, hydratedPost.id) as { id: number } | undefined;

    const previous = database.prepare(
      `
      SELECT id
      FROM posts
      WHERE folder_id = ? AND ${VISIBLE_POST_WHERE_UNSCOPED_SQL}
        AND ${previousComparisonSql}
      ORDER BY ${previousOrderSql}
      LIMIT 1
      `
    ).get(hydratedPost.folderId, hydratedPost.sortTimestamp, hydratedPost.sortTimestamp, hydratedPost.id) as { id: number } | undefined;

    const nextPostId = next?.id ?? null;
    const previousPostId = previous?.id ?? null;

    return {
      ...hydratedPost,
      folderAvatarImageId: detailRow.folderAvatarImageId,
      relativePath: detailRow.relativePath,
      mimeType: detailRow.mimeType,
      fileSize: detailRow.fileSize,
      exif: detailRow.exifJson && isValidJson(detailRow.exifJson) ? JSON.parse(detailRow.exifJson) : null,
      originalUrl: detailRow.originalUrl,
      playbackStrategy: detailRow.playbackStrategy,
      nextPostId,
      previousPostId,
      nextImageId: nextPostId,
      previousImageId: previousPostId
    } as PostDetail;
  },

  updateCaption(id: number, caption: string | null): PostDetail | undefined {
    const resolvedId = id;
    database.prepare('UPDATE posts SET caption = ?, updated_at = ? WHERE id = ?').run(caption, nowIso(), resolvedId);
    return this.getPostDetail(resolvedId);
  },

  softDeletePost(id: number): void {
    const deletedAt = nowIso();
    database.prepare('UPDATE posts SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE id = ?').run(deletedAt, deletedAt, id);
  },

  softDeleteMissingByFolder(folderId: number, activeSourcePaths: string[], postType?: PostType): number {
    const rows = postType
      ? (database.prepare('SELECT source_path FROM posts WHERE folder_id = ? AND post_type = ? AND is_deleted = 0').all(folderId, postType) as Array<{ source_path: string }>)
      : (database.prepare('SELECT source_path FROM posts WHERE folder_id = ? AND is_deleted = 0').all(folderId) as Array<{ source_path: string }>);
    const active = new Set(activeSourcePaths);
    let removedCount = 0;

    for (const row of rows) {
      if (!active.has(row.source_path)) {
        this.softDeletePostBySourcePath(row.source_path);
        removedCount += 1;
      }
    }

    return removedCount;
  },

  softDeleteMissingReservedCarousels(folderId: number, carouselsRootPath: string, activeSourcePaths: string[]): number {
    const normalizedPrefix = `${normalizePath(carouselsRootPath)}/`;
    const rows = database
      .prepare('SELECT source_path FROM posts WHERE folder_id = ? AND is_deleted = 0 AND source_path LIKE ?')
      .all(folderId, `${normalizedPrefix}%`) as Array<{ source_path: string }>;
    const active = new Set(activeSourcePaths.map((sourcePath) => normalizePath(sourcePath)));
    let removedCount = 0;

    for (const row of rows) {
      if (!active.has(normalizePath(row.source_path))) {
        this.softDeletePostBySourcePath(row.source_path);
        removedCount += 1;
      }
    }

    return removedCount;
  },

  softDeleteReservedCarouselsForLegacyMode(): number {
    const deletedAt = nowIso();
    const result = database.prepare(`
      UPDATE posts
      SET is_deleted = 1,
          deleted_at = COALESCE(deleted_at, ?),
          updated_at = ?
      WHERE is_deleted = 0
        AND EXISTS (
          SELECT 1
          FROM folders
          WHERE folders.id = posts.folder_id
            AND LOWER(posts.source_path) LIKE LOWER(folders.folder_path || '/carousels/%')
        )
    `).run(deletedAt, deletedAt);

    return Number(result.changes ?? 0);
  },

  softDeletePostBySourcePath(sourcePath: string): void {
    const deletedAt = nowIso();
    database.prepare('UPDATE posts SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE source_path = ?').run(deletedAt, deletedAt, sourcePath);
  },

  restorePost(id: number): void {
    database.prepare('UPDATE posts SET is_deleted = 0, deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), id);
  },

  trashPost(id: number, trashedAt = nowIso()): boolean {
    const resolvedId = id;
    const now = nowIso();
    const result = database
      .prepare(
        `
        UPDATE posts
        SET is_trashed = 1, trashed_at = ?, updated_at = ?
        WHERE id = ? AND is_deleted = 0 AND is_trashed = 0
        `
      )
      .run(trashedAt, now, resolvedId);

    if (Number(result.changes ?? 0) > 0) {
      database.prepare(
        `
        UPDATE images
        SET is_trashed = 1, trashed_at = ?, updated_at = ?
        WHERE id IN (SELECT image_id FROM post_items WHERE post_id = ?)
        `
      ).run(trashedAt, now, resolvedId);
      return true;
    }
    return false;
  },

  restoreTrashedPost(id: number): boolean {
    const resolvedId = id;
    const now = nowIso();
    const result = database
      .prepare(
        `
        UPDATE posts
        SET is_trashed = 0, trashed_at = NULL, updated_at = ?
        WHERE id = ? AND is_deleted = 0 AND is_trashed = 1
        `
      )
      .run(now, resolvedId);

    if (Number(result.changes ?? 0) > 0) {
      database.prepare(
        `
        UPDATE images
        SET is_trashed = 0, trashed_at = NULL, updated_at = ?
        WHERE id IN (SELECT image_id FROM post_items WHERE post_id = ?)
        `
      ).run(now, resolvedId);
      return true;
    }
    return false;
  },

  deletePost(id: number): { id: number; folderSlug: string } | undefined {
    const post = this.findById(id);
    if (!post) {
      return undefined;
    }

    const folder = folderRepository.getById(post.folder_id);
    database.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
    return {
      id: post.id,
      folderSlug: folder?.slug ?? ''
    };
  },

  countAll(): number {
    return Number((database.prepare('SELECT COUNT(*) AS count FROM posts').get() as { count: number }).count);
  },

  countCarousels(): number {
    return Number((database.prepare("SELECT COUNT(*) AS count FROM posts WHERE post_type = 'carousel' AND is_deleted = 0 AND is_trashed = 0").get() as { count: number }).count);
  }
};

export const imageRepository = {
  getByRelativePath(relativePath: string): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE relative_path = ?').get(relativePath) as ImageRecord | undefined;
  },

  getById(id: number): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE id = ?').get(id) as ImageRecord | undefined;
  },

  getByThumbnailPath(thumbnailPath: string): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE thumbnail_path = ?').get(thumbnailPath) as ImageRecord | undefined;
  },

  getByPreviewPath(previewPath: string): ImageRecord | undefined {
    return database.prepare('SELECT * FROM images WHERE preview_path = ?').get(previewPath) as ImageRecord | undefined;
  },

  listDerivativeReferences(): Array<Pick<ImageRecord, 'thumbnail_path' | 'preview_path' | 'is_deleted' | 'deleted_at'>> {
    return database
      .prepare('SELECT thumbnail_path, preview_path, is_deleted, deleted_at FROM images')
      .all() as Array<Pick<ImageRecord, 'thumbnail_path' | 'preview_path' | 'is_deleted' | 'deleted_at'>>;
  },

  upsert(input: UpsertImageInput): ImageRecord {
    database.prepare(
      `
      INSERT INTO images (
        folder_id, asset_key, filename, extension, relative_path, absolute_path, file_size, width, height, display_orientation,
        media_type, mime_type, duration_ms, is_animated, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp, taken_at, taken_at_source, exif_json,
        thumbnail_path, preview_path, playback_strategy, is_deleted, deleted_at, is_trashed, trashed_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL, ?)
      ON CONFLICT(relative_path) DO UPDATE SET
        folder_id = excluded.folder_id,
        asset_key = COALESCE(images.asset_key, excluded.asset_key),
        filename = excluded.filename,
        extension = excluded.extension,
        absolute_path = excluded.absolute_path,
        file_size = excluded.file_size,
        width = excluded.width,
        height = excluded.height,
        display_orientation = excluded.display_orientation,
        media_type = excluded.media_type,
        mime_type = excluded.mime_type,
        duration_ms = excluded.duration_ms,
        is_animated = excluded.is_animated,
        checksum_or_fingerprint = excluded.checksum_or_fingerprint,
        mtime_ms = excluded.mtime_ms,
        taken_at = excluded.taken_at,
        taken_at_source = excluded.taken_at_source,
        exif_json = excluded.exif_json,
        thumbnail_path = excluded.thumbnail_path,
        preview_path = excluded.preview_path,
        playback_strategy = excluded.playback_strategy,
        is_deleted = 0,
        deleted_at = NULL,
        updated_at = excluded.updated_at
      `
    ).run(
      input.folderId,
      input.assetKey ?? null,
      input.filename,
      input.extension,
      input.relativePath,
      input.absolutePath,
      input.fileSize,
      input.width,
      input.height,
      input.displayOrientation ?? null,
      input.mediaType,
      input.mimeType,
      input.durationMs,
      serializeAnimatedFlag(input.isAnimated),
      input.fingerprint,
      input.mtimeMs,
      input.firstSeenAt,
      input.sortTimestamp,
      input.takenAt,
      input.takenAtSource,
      input.exifJson,
      input.thumbnailPath,
      input.previewPath,
      input.playbackStrategy ?? 'preview',
      nowIso()
    );

    const folder = folderRepository.getById(input.folderId);
    const isNormalPostAsset = folder?.role === 'normal' && !COVER_FILENAMES.includes(input.filename.toLocaleLowerCase() as typeof COVER_FILENAMES[number]);

    const record = this.getByRelativePath(input.relativePath) as ImageRecord;
    if (record && isNormalPostAsset) {
      const existingPost = postRepository.findByImageId(record.id) ?? postRepository.findBySourcePath(input.relativePath);
      postRepository.upsertPostWithItems({
        existingPostId: existingPost?.id,
        id: existingPost ? undefined : record.id,
        folderId: input.folderId,
        placeId: record.place_id,
        postType: 'single',
        sourcePath: input.relativePath,
        caption: null,
        takenAt: input.takenAt ?? null,
        sortTimestamp: input.sortTimestamp,
        isDeleted: 0,
        isTrashed: 0
      }, [{ imageId: record.id, position: 1 }]);
    }

    return record;
  },

  refreshIndexed(input: RefreshIndexedImageInput): ImageRecord {
    database.prepare(
      `
      UPDATE images
      SET
        folder_id = ?,
        asset_key = COALESCE(asset_key, ?),
        filename = ?,
        extension = ?,
        absolute_path = ?,
        file_size = ?,
        width = ?,
        height = ?,
        display_orientation = ?,
        media_type = ?,
        mime_type = ?,
        duration_ms = ?,
        is_animated = ?,
        checksum_or_fingerprint = ?,
        mtime_ms = ?,
        taken_at = ?,
        taken_at_source = ?,
        exif_json = ?,
        thumbnail_path = ?,
        preview_path = ?,
        playback_strategy = ?,
        is_deleted = 0,
        deleted_at = NULL,
        updated_at = ?
      WHERE relative_path = ?
      `
    ).run(
      input.folderId,
      input.assetKey ?? null,
      input.filename,
      input.extension,
      input.absolutePath,
      input.fileSize,
      input.width,
      input.height,
      input.displayOrientation ?? null,
      input.mediaType,
      input.mimeType,
      input.durationMs,
      serializeAnimatedFlag(input.isAnimated),
      input.fingerprint,
      input.mtimeMs,
      input.takenAt,
      input.takenAtSource,
      input.exifJson,
      input.thumbnailPath,
      input.previewPath,
      input.playbackStrategy ?? 'preview',
      nowIso(),
      input.relativePath
    );

    const folder = folderRepository.getById(input.folderId);
    const isNormalPostAsset = folder?.role === 'normal' && !COVER_FILENAMES.includes(input.filename.toLocaleLowerCase() as typeof COVER_FILENAMES[number]);

    const record = this.getByRelativePath(input.relativePath) as ImageRecord;
    if (record && isNormalPostAsset) {
      const existingPost = postRepository.findByImageId(record.id) ?? postRepository.findBySourcePath(input.relativePath);
      postRepository.upsertPostWithItems({
        existingPostId: existingPost?.id,
        id: existingPost ? undefined : record.id,
        folderId: input.folderId,
        placeId: record.place_id,
        postType: 'single',
        sourcePath: input.relativePath,
        caption: null,
        takenAt: input.takenAt ?? null,
        sortTimestamp: record.sort_timestamp,
        isDeleted: 0,
        isTrashed: 0
      }, [{ imageId: record.id, position: 1 }]);
    }

    return record;
  },

  markDeleted(relativePath: string): void {
    const deletedAt = nowIso();
    database
      .prepare('UPDATE images SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE relative_path = ?')
      .run(deletedAt, deletedAt, relativePath);
    database
      .prepare('UPDATE posts SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE source_path = ?')
      .run(deletedAt, deletedAt, relativePath);
  },

  markFolderImagesDeleted(folderId: number, activeRelativePaths: string[]): number {
    const rows = database.prepare('SELECT relative_path FROM images WHERE folder_id = ? AND is_deleted = 0').all(folderId) as Array<{ relative_path: string }>;
    const active = new Set(activeRelativePaths);
    let removedCount = 0;

    for (const row of rows) {
      if (!active.has(row.relative_path)) {
        this.markDeleted(row.relative_path);
        removedCount += 1;
      }
    }

    return removedCount;
  },

  /**
   * Lists every indexed file the API would still serve, so a caller can verify
   * the originals are actually on disk. Discovery only walks folders it finds,
   * so a source directory that disappeared as a whole leaves rows behind that no
   * per-folder cleanup ever touches.
   */
  listAliveRelativePaths(): Array<{ id: number; relative_path: string }> {
    return database
      .prepare('SELECT id, relative_path FROM images WHERE is_deleted = 0 AND is_trashed = 0')
      .all() as Array<{ id: number; relative_path: string }>;
  },

  markAllDeletedByFolder(folderId: number, postType?: PostType): number {
    const deletedAt = nowIso();
    const result = database
      .prepare('UPDATE images SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE folder_id = ? AND is_deleted = 0')
      .run(deletedAt, deletedAt, folderId);
    if (postType) {
      database
        .prepare('UPDATE posts SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE folder_id = ? AND post_type = ? AND is_deleted = 0')
        .run(deletedAt, deletedAt, folderId, postType);
    } else {
      database
        .prepare('UPDATE posts SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE folder_id = ? AND is_deleted = 0')
        .run(deletedAt, deletedAt, folderId);
    }
    return Number(result.changes ?? 0);
  },

  reactivate(relativePath: string): void {
    const timestamp = nowIso();
    database.prepare('UPDATE images SET is_deleted = 0, deleted_at = NULL, updated_at = ? WHERE relative_path = ?').run(timestamp, relativePath);
    database.prepare('UPDATE posts SET is_deleted = 0, deleted_at = NULL, updated_at = ? WHERE source_path = ?').run(timestamp, relativePath);
  },

  countByMediaType(mediaType?: MediaType): number {
    if (mediaType) {
      return Number(
        (
          database
            .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND media_type = ?`)
            .get(mediaType) as { count: number }
        ).count
      );
    }
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}`)
          .get() as { count: number }
      ).count
    );
  },

  updateAssetKey(id: number, assetKey: string): void {
    database.prepare('UPDATE images SET asset_key = ?, updated_at = ? WHERE id = ?').run(assetKey, nowIso(), id);
  },

  updateDerivativePaths(id: number, thumbnailPath: string, previewPath: string): void {
    database
      .prepare('UPDATE images SET thumbnail_path = ?, preview_path = ?, updated_at = ? WHERE id = ?')
      .run(thumbnailPath, previewPath, nowIso(), id);
  },

  updateCaption(id: number, caption: string | null): void {
    database.prepare('UPDATE images SET caption = ?, updated_at = ? WHERE id = ?').run(caption, nowIso(), id);
    const post = postRepository.findByImageId(id);
    if (post) {
      postRepository.updateCaption(post.id, caption);
    }
  },

  assignPlace(id: number, placeId: number | null): void {
    const updatedAt = nowIso();
    database.exec('BEGIN IMMEDIATE');
    try {
      database.prepare('UPDATE images SET place_id = ?, updated_at = ? WHERE id = ?').run(placeId, updatedAt, id);
      database.prepare(
        `
        UPDATE posts
        SET place_id = ?, updated_at = ?
        WHERE id IN (
          SELECT post_id
          FROM post_items
          WHERE image_id = ? AND position = 1
        )
        `
      ).run(placeId, updatedAt, id);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },

  reconcileMove(input: ReconcileImageMoveInput): ImageRecord {
    database.prepare(
      `
      UPDATE images
      SET
        folder_id = ?,
        filename = ?,
        extension = ?,
        relative_path = ?,
        absolute_path = ?,
        file_size = ?,
        width = ?,
        height = ?,
        display_orientation = ?,
        media_type = ?,
        mime_type = ?,
        duration_ms = ?,
        is_animated = ?,
        checksum_or_fingerprint = ?,
        mtime_ms = ?,
        taken_at = ?,
        taken_at_source = ?,
        exif_json = ?,
        playback_strategy = ?,
        is_deleted = 0,
        deleted_at = NULL,
        updated_at = ?
      WHERE id = ?
      `
    ).run(
      input.folderId,
      input.filename,
      input.extension,
      input.relativePath,
      input.absolutePath,
      input.fileSize,
      input.width,
      input.height,
      input.displayOrientation ?? null,
      input.mediaType,
      input.mimeType,
      input.durationMs,
      serializeAnimatedFlag(input.isAnimated),
      input.fingerprint,
      input.mtimeMs,
      input.takenAt,
      input.takenAtSource,
      input.exifJson,
      input.playbackStrategy ?? 'preview',
      nowIso(),
      input.id
    );

    const record = this.getById(input.id) as ImageRecord;
    const folder = folderRepository.getById(input.folderId);
    const isNormalPostAsset =
      folder?.role === 'normal' &&
      !COVER_FILENAMES.includes(input.filename.toLocaleLowerCase() as typeof COVER_FILENAMES[number]);
    if (isNormalPostAsset) {
      const existingPost = postRepository.findByImageId(record.id) ?? postRepository.findBySourcePath(input.relativePath);
      postRepository.upsertPostWithItems({
        existingPostId: existingPost?.id,
        id: existingPost ? undefined : record.id,
        folderId: input.folderId,
        placeId: record.place_id,
        postType: 'single',
        sourcePath: input.relativePath,
        caption: existingPost?.caption ?? null,
        takenAt: input.takenAt,
        takenAtSource: input.takenAtSource,
        sortTimestamp: existingPost?.sort_timestamp ?? record.sort_timestamp,
        isDeleted: 0,
        isTrashed: existingPost?.is_trashed ?? 0
      }, [{ imageId: record.id, position: 1 }]);
    }

    return record;
  },

  moveToTrash(id: number, trashedAt = nowIso()): boolean {
    return postRepository.trashPost(id, trashedAt);
  },

  restoreFromTrash(id: number): boolean {
    return postRepository.restoreTrashedPost(id);
  },

  deleteById(id: number): boolean {
    const postRes = postRepository.deletePost(id);
    const result = database.prepare('DELETE FROM images WHERE id = ?').run(id);
    return Number(result.changes ?? 0) > 0 || postRes !== undefined;
  },

  listFeed(page: number, limit: number): FeedImage[] {
    return postRepository.listFeed(page, limit);
  },

  countFeed(): number {
    return postRepository.countFeed();
  },

  countVisibleMediaAssets(): number {
    return postRepository.countVisibleMediaAssets();
  },

  countVisibleCarousels(): number {
    return postRepository.countVisibleCarousels();
  },

  countVisibleSingleVideos(): number {
    return postRepository.countVisibleSingleVideos();
  },

  countVisibleSearch(query: string): number {
    return postRepository.countVisibleSearch(query);
  },

  listRecentCandidates(offset: number, limit: number, excludeIds?: number[]): FeedImage[] {
    return postRepository.listRecentCandidates(offset, limit, excludeIds);
  },

  countRenderableFeed(): number {
    return postRepository.countRenderableFeed();
  },

  countRediscover(cutoffTimestamp: number): number {
    return postRepository.countRediscover(cutoffTimestamp);
  },

  listRediscoverCandidates(offset: number, limit: number, cutoffTimestamp: number): FeedImage[] {
    return postRepository.listRediscoverCandidates(offset, limit, cutoffTimestamp);
  },

  listRandom(page: number, limit: number, seed: number, excludeIds?: number[]): FeedImage[] {
    return postRepository.listRandom(page, limit, seed, excludeIds);
  },

  listVisibleVideoCandidates(): ReelCandidate[] {
    return postRepository.listVisibleVideoCandidates();
  },

  listVisibleSearch(query: string, page: number, limit: number): FeedImage[] {
    return postRepository.listVisibleSearch(query, page, limit);
  },

  countByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number): number {
    return postRepository.countByMonthDayKeys(monthDayKeys, maxYearExclusive);
  },

  listByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number, page: number, limit: number): FeedImage[] {
    return postRepository.listByMonthDayKeys(monthDayKeys, maxYearExclusive, page, limit);
  },

  countByEffectiveTimeRange(startTimestamp: number, endTimestamp: number): number {
    return postRepository.countByEffectiveTimeRange(startTimestamp, endTimestamp);
  },

  listByEffectiveTimeRange(startTimestamp: number, endTimestamp: number, page: number, limit: number): FeedImage[] {
    return postRepository.listByEffectiveTimeRange(startTimestamp, endTimestamp, page, limit);
  },

  listFolderImages(
    folderId: number,
    page: number,
    limit: number,
    mediaType?: MediaType,
    order: FolderImageOrder = 'newest'
  ): FeedImage[] {
    return postRepository.listVisibleByFolder(folderId, page, limit, order, mediaType);
  },

  listPlaceImages(placeId: number, page: number, limit: number, mediaType?: MediaType): FeedImage[] {
    const posts = postRepository.listPlacePosts(placeId, page, limit);
    if (mediaType) {
      return posts.filter((p) => p.mediaType === mediaType);
    }
    return posts;
  },

  listStoryFolderImages(folderId: number, page: number, limit: number, mediaType?: MediaType): FeedImage[] {
    const offset = (page - 1) * limit;
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    return database.prepare(
      `
      SELECT
        images.id,
        images.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        images.caption AS caption,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        images.sort_timestamp AS sortTimestamp,
        images.taken_at AS takenAt,
        0 AS isSaved,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      LEFT JOIN places ON places.id = images.place_id
      WHERE images.folder_id = ? AND ${STORY_IMAGE_WHERE_SQL}${mediaTypeClause}
      ORDER BY images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...(mediaType ? [folderId, mediaType, limit, offset] : [folderId, limit, offset])) as unknown as FeedImage[];
  },

  listStoryCapsuleImagesByOwnerFolder(ownerFolderId: number, page: number, limit: number, mediaType?: MediaType): FeedImage[] {
    const offset = (page - 1) * limit;
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    return database.prepare(
      `
      SELECT
        images.id,
        images.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        images.caption AS caption,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        images.sort_timestamp AS sortTimestamp,
        images.taken_at AS takenAt,
        0 AS isSaved,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      LEFT JOIN places ON places.id = images.place_id
      WHERE folders.story_owner_folder_id = ?
        AND folders.role = 'story_capsule'
        AND ${STORY_IMAGE_WHERE_SQL}${mediaTypeClause}
      ORDER BY ${EFFECTIVE_IMAGE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?
      `
    ).all(...(mediaType ? [ownerFolderId, mediaType, limit, offset] : [ownerFolderId, limit, offset])) as unknown as FeedImage[];
  },

  listTrashed(page: number, limit: number): TrashImage[] {
    return postRepository.listTrashed(page, limit);
  },

  countTrashed(): number {
    return postRepository.countTrashed();
  },

  countByFolder(folderId: number, mediaType?: MediaType): number {
    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0${mediaTypeClause}`)
          .get(...(mediaType ? [folderId, mediaType] : [folderId])) as { count: number }
      ).count
    );
  },

  countVisibleByFolder(folderId: number, mediaType?: MediaType): number {
    return postRepository.countVisibleByFolder(folderId, mediaType);
  },

  countStoryMediaByFolder(folderId: number, mediaType?: MediaType): number {
    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND ${STORY_IMAGE_WHERE_UNSCOPED_SQL}${mediaTypeClause}`)
          .get(...(mediaType ? [folderId, mediaType] : [folderId])) as { count: number }
      ).count
    );
  },

  countStoryCapsuleMediaByOwnerFolder(ownerFolderId: number, mediaType?: MediaType): number {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM images
            INNER JOIN folders ON folders.id = images.folder_id
            WHERE folders.story_owner_folder_id = ?
              AND folders.role = 'story_capsule'
              AND ${STORY_IMAGE_WHERE_SQL}${mediaTypeClause}
            `
          )
          .get(...(mediaType ? [ownerFolderId, mediaType] : [ownerFolderId])) as { count: number }
      ).count
    );
  },

  listActiveByFolder(folderId: number): ImageRecord[] {
    return database
      .prepare('SELECT * FROM images WHERE folder_id = ? AND is_deleted = 0 ORDER BY id ASC')
      .all(folderId) as unknown as ImageRecord[];
  },

  listForFolderDeletion(folderId: number): ImageRecord[] {
    return database
      .prepare('SELECT * FROM images WHERE folder_id = ? ORDER BY id ASC')
      .all(folderId) as unknown as ImageRecord[];
  },

  listActive(): ImageRecord[] {
    return database
      .prepare('SELECT * FROM images WHERE is_deleted = 0 ORDER BY folder_id ASC, sort_timestamp DESC, id DESC')
      .all() as unknown as ImageRecord[];
  },

  refreshAbsolutePathsForGalleryRoot(galleryRoot: string): number {
    const rows = database
      .prepare('SELECT id, relative_path, absolute_path FROM images WHERE is_deleted = 0 ORDER BY id ASC')
      .all() as Array<Pick<ImageRecord, 'id' | 'relative_path' | 'absolute_path'>>;
    const update = database.prepare('UPDATE images SET absolute_path = ?, updated_at = ? WHERE id = ?');
    const updatedAt = nowIso();
    let refreshed = 0;

    for (const row of rows) {
      const nextAbsolutePath = safeJoin(galleryRoot, row.relative_path);

      if (normalizePath(row.absolute_path) === normalizePath(nextAbsolutePath)) {
        continue;
      }

      const result = update.run(nextAbsolutePath, updatedAt, row.id);
      refreshed += Number(result.changes ?? 0);
    }

    return refreshed;
  },

  listByIdRange(afterId: number, limit: number): ImageRecord[] {
    return database
      .prepare('SELECT * FROM images WHERE id > ? ORDER BY id ASC LIMIT ?')
      .all(afterId, limit) as unknown as ImageRecord[];
  },

  listWithExifForPlaceRebuild(afterId: number, limit: number): ImageRecord[] {
    return database
      .prepare(
        `
        SELECT *
        FROM images
        WHERE id > ? AND is_deleted = 0 AND exif_json IS NOT NULL
        ORDER BY id ASC
        LIMIT ?
        `
      )
      .all(afterId, limit) as unknown as ImageRecord[];
  },

  countAll(): number {
    return Number((database.prepare('SELECT COUNT(*) AS count FROM images').get() as { count: number }).count);
  },

  countUpToId(id: number): number {
    return Number((database.prepare('SELECT COUNT(*) AS count FROM images WHERE id <= ?').get(id) as { count: number }).count);
  },

  countMissingAssetKeys(): number {
    return Number(
      (database.prepare('SELECT COUNT(*) AS count FROM images WHERE asset_key IS NULL OR asset_key = \'\'').get() as { count: number }).count
    );
  },

  countPendingDerivativeMigrationRows(): number {
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM images
            WHERE asset_key IS NULL
              OR TRIM(asset_key) = ''
              OR LOWER(thumbnail_path) != LOWER(SUBSTR(TRIM(asset_key), 1, 2) || '/' || LOWER(TRIM(asset_key)) || '.webp')
              OR LOWER(preview_path) != LOWER(
                SUBSTR(TRIM(asset_key), 1, 2)
                || '/'
                || LOWER(TRIM(asset_key))
                || CASE WHEN media_type = 'video' THEN '.mp4' ELSE '.webp' END
              )
            `
          )
          .get() as { count: number }
      ).count
    );
  },

  countMissingTimestampMetadataByFolder(folderId: number): number {
    return Number(
      (
        database
          .prepare(
            'SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0 AND (taken_at IS NULL OR taken_at_source IS NULL)'
          )
          .get(folderId) as { count: number }
      ).count
    );
  },

  countMissingPlaybackStrategyByFolder(folderId: number): number {
    return Number(
      (
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0 AND media_type = 'video' AND (playback_strategy IS NULL OR playback_strategy = '')"
          )
          .get(folderId) as { count: number }
      ).count
    );
  },

  countByTakenAtSource(source: TakenAtSource): number {
    return Number(
      (
        database
          .prepare(`SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND taken_at_source = ?`)
          .get(source) as { count: number }
      ).count
    );
  },

  getLatestFolderImageId(folderId: number): number | null {
    const row = database.prepare(
      `SELECT pi.image_id
       FROM posts p
       JOIN post_items pi ON pi.post_id = p.id AND pi.position = 1
       WHERE p.folder_id = ? AND p.is_deleted = 0 AND p.is_trashed = 0
       ORDER BY p.sort_timestamp DESC, p.id DESC LIMIT 1`
    ).get(folderId) as { image_id: number } | undefined;
    if (row) return row.image_id;

    const imgRow = database.prepare(
      `SELECT id FROM images WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} ORDER BY sort_timestamp DESC, id DESC LIMIT 1`
    ).get(folderId) as { id: number } | undefined;
    return imgRow?.id ?? null;
  },

  getLatestStoryImageId(folderId: number): number | null {
    const row = database.prepare(
      `SELECT id FROM images WHERE folder_id = ? AND ${STORY_IMAGE_WHERE_UNSCOPED_SQL} ORDER BY sort_timestamp DESC, id DESC LIMIT 1`
    ).get(folderId) as { id: number } | undefined;
    return row?.id ?? null;
  },

  getLatestEffectiveTimestampByFolder(folderId: number): number | null {
    const row = database.prepare(
      `SELECT MAX(COALESCE(taken_at, sort_timestamp)) AS latestTimestamp FROM images WHERE folder_id = ? AND ${STORY_IMAGE_WHERE_UNSCOPED_SQL}`
    ).get(folderId) as { latestTimestamp: number | null } | undefined;
    return row?.latestTimestamp ?? null;
  },

  getExplicitCoverImageId(folderId: number): number | null {
    const row = database.prepare(
      `
      SELECT id
      FROM images
      WHERE folder_id = ?
        AND is_deleted = 0
        AND is_trashed = 0
        AND LOWER(filename) IN (${COVER_FILENAME_SQL})
      ORDER BY
        CASE LOWER(filename)
          WHEN 'cover.jpg' THEN 1
          WHEN 'cover.jpeg' THEN 2
          WHEN 'cover.png' THEN 3
          WHEN 'cover.webp' THEN 4
          WHEN 'cover.avif' THEN 5
          WHEN 'cover.gif' THEN 6
          ELSE 7
        END,
        id ASC
      LIMIT 1
      `
    ).get(folderId) as { id: number } | undefined;

    return row?.id ?? null;
  },

  getImageDetail(
    id: number,
    mediaType?: MediaType,
    allowHiddenCover = false,
    folderImageOrder: FolderImageOrder = 'newest'
  ): ImageDetail | undefined {
    return postRepository.getPostDetail(id, folderImageOrder) as ImageDetail | undefined;
  },

  countDeleted(): number {
    return Number((database.prepare('SELECT COUNT(*) AS count FROM images WHERE is_deleted = 1').get() as { count: number }).count);
  },

  listMoveCandidates(fileSize: number, mtimeMs: number, extension: string): ImageRecord[] {
    return database.prepare(
      `
      SELECT *
      FROM images
      WHERE file_size = ?
        AND ROUND(mtime_ms) = ?
        AND LOWER(extension) = LOWER(?)
        AND is_deleted = 0
        AND is_trashed = 0
      ORDER BY id ASC
      `
    ).all(fileSize, Math.round(mtimeMs), extension) as unknown as ImageRecord[];
  },

  listSoftDeletedDerivativeCandidates(cutoffIso: string): Array<Pick<ImageRecord, 'id' | 'thumbnail_path' | 'preview_path'>> {
    return database.prepare(
      `
      SELECT id, thumbnail_path, preview_path
      FROM images
      WHERE is_deleted = 1
        AND deleted_at IS NOT NULL
        AND deleted_at <= ?
      ORDER BY id ASC
      `
    ).all(cutoffIso) as Array<Pick<ImageRecord, 'id' | 'thumbnail_path' | 'preview_path'>>;
  }
};

export const likeRepository = {
  listAll(): LikeRecord[] {
    return database.prepare('SELECT post_id, post_id AS image_id, created_at FROM likes ORDER BY created_at DESC, post_id DESC').all() as unknown as LikeRecord[];
  },

  listAllLikes(): LikeRecord[] {
    return this.listAll();
  },

  getByImageId(imageId: number): LikeRecord | undefined {
    const postId = resolvePostIdByImageId(imageId);
    if (!postId) return undefined;
    return database.prepare('SELECT post_id, post_id AS image_id, created_at FROM likes WHERE post_id = ?').get(postId) as LikeRecord | undefined;
  },

  getByPostId(postId: number): LikeRecord | undefined {
    return database.prepare('SELECT post_id, post_id AS image_id, created_at FROM likes WHERE post_id = ?').get(postId) as LikeRecord | undefined;
  },

  count(): number {
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM likes
            INNER JOIN posts ON posts.id = likes.post_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE ${VISIBLE_POST_WHERE_SQL}
            `
          )
          .get() as { count: number }
      ).count
    );
  },

  listLikedImages(page: number = 1, limit: number = 1000): FeedImage[] {
    const offset = (page - 1) * limit;
    const posts = database.prepare(
      `
      SELECT
        posts.id,
        posts.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        posts.caption AS caption,
        posts.post_type AS postType,
        posts.source_path AS sourcePath,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        posts.sort_timestamp AS sortTimestamp,
        posts.taken_at AS takenAt,
        1 AS isSaved,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM likes
      INNER JOIN posts ON posts.id = likes.post_id
      INNER JOIN folders ON folders.id = posts.folder_id
      JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
      JOIN images ON images.id = post_items.image_id
      LEFT JOIN places ON places.id = posts.place_id
      WHERE ${VISIBLE_POST_WHERE_SQL}
      ORDER BY likes.created_at DESC, likes.post_id DESC
      LIMIT ? OFFSET ?
      `
    ).all(limit, offset) as unknown as FeedPost[];

    return postRepository.hydratePostItems(posts);
  },

  listLikedOlderThan(page: number, limit: number, cutoffTimestamp: number): FeedImage[] {
    const offset = (page - 1) * limit;
    const posts = database.prepare(
      `
      SELECT
        posts.id,
        posts.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        posts.caption AS caption,
        posts.post_type AS postType,
        posts.source_path AS sourcePath,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        posts.sort_timestamp AS sortTimestamp,
        posts.taken_at AS takenAt,
        1 AS isSaved,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM likes
      INNER JOIN posts ON posts.id = likes.post_id
      INNER JOIN folders ON folders.id = posts.folder_id
      JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
      JOIN images ON images.id = post_items.image_id
      LEFT JOIN places ON places.id = posts.place_id
      WHERE ${VISIBLE_POST_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
      ORDER BY likes.created_at DESC, likes.post_id DESC
      LIMIT ? OFFSET ?
      `
    ).all(cutoffTimestamp, limit, offset) as unknown as FeedPost[];

    return postRepository.hydratePostItems(posts);
  },

  listRecentCandidates(offset: number, limit: number, cutoffTimestamp: number): FeedImage[] {
    const posts = database.prepare(
      `
      SELECT
        posts.id,
        posts.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        posts.caption AS caption,
        posts.post_type AS postType,
        posts.source_path AS sourcePath,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        posts.sort_timestamp AS sortTimestamp,
        posts.taken_at AS takenAt,
        1 AS isSaved,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM likes
      INNER JOIN posts ON posts.id = likes.post_id
      INNER JOIN folders ON folders.id = posts.folder_id
      JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
      JOIN images ON images.id = post_items.image_id
      LEFT JOIN places ON places.id = posts.place_id
      WHERE ${VISIBLE_POST_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
      ORDER BY likes.created_at DESC, likes.post_id DESC
      LIMIT ? OFFSET ?
      `
    ).all(cutoffTimestamp, limit, offset) as unknown as FeedPost[];

    return postRepository.hydratePostItems(posts);
  },

  upsert(postId: number): LikeRecord {
    const createdAt = nowIso();
    database.prepare(
      `
      INSERT INTO likes (post_id, created_at)
      VALUES (?, ?)
      ON CONFLICT(post_id) DO UPDATE SET
        created_at = excluded.created_at
      `
    ).run(postId, createdAt);

    return (this.getByPostId(postId) ?? { post_id: postId, image_id: postId, created_at: createdAt }) as LikeRecord;
  },

  remove(postId: number): boolean {
    const result = database.prepare('DELETE FROM likes WHERE post_id = ?').run(postId);
    return Number(result.changes ?? 0) > 0;
  },

  removeByFolder(folderId: number): number {
    const result = database.prepare(
      'DELETE FROM likes WHERE post_id IN (SELECT id FROM posts WHERE folder_id = ?)'
    ).run(folderId);
    return Number(result.changes ?? 0);
  }
};

export const collectionRepository = {
  ensureDefaultCollection(): CollectionRecord {
    const existingDefault = database.prepare('SELECT * FROM collections WHERE is_default = 1 LIMIT 1').get() as CollectionRecord | undefined;
    if (existingDefault) {
      if (existingDefault.name !== DEFAULT_COLLECTION_NAME) {
        database.prepare('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?').run(DEFAULT_COLLECTION_NAME, nowIso(), existingDefault.id);
      }

      return this.getById(existingDefault.id) as CollectionRecord;
    }

    const savedCollection = this.getBySlug(DEFAULT_COLLECTION_SLUG);
    if (savedCollection) {
      database
        .prepare('UPDATE collections SET name = ?, is_default = 1, updated_at = ? WHERE id = ?')
        .run(DEFAULT_COLLECTION_NAME, nowIso(), savedCollection.id);
      return this.getById(savedCollection.id) as CollectionRecord;
    }

    database
      .prepare('INSERT INTO collections (slug, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)')
      .run(DEFAULT_COLLECTION_SLUG, DEFAULT_COLLECTION_NAME, nowIso(), nowIso());

    return this.getBySlug(DEFAULT_COLLECTION_SLUG) as CollectionRecord;
  },

  getById(id: number): CollectionRecord | undefined {
    return database.prepare('SELECT * FROM collections WHERE id = ?').get(id) as CollectionRecord | undefined;
  },

  getDefaultCollection(): CollectionRecord {
    return this.ensureDefaultCollection();
  },

  repairDefaultMemberships(): number {
    const defaultCollection = this.ensureDefaultCollection();
    const timestamp = nowIso();
    const result = database
      .prepare(
        `
        INSERT OR IGNORE INTO collection_items (collection_id, post_id, created_at)
        SELECT ?, custom_items.post_id, ?
        FROM collection_items AS custom_items
        INNER JOIN collections AS custom_collections ON custom_collections.id = custom_items.collection_id
        LEFT JOIN collection_items AS default_items
          ON default_items.collection_id = ? AND default_items.post_id = custom_items.post_id
        WHERE custom_collections.is_default = 0
          AND default_items.post_id IS NULL
        `
      )
      .run(defaultCollection.id, timestamp, defaultCollection.id);

    const repairedCount = Number(result.changes ?? 0);
    if (repairedCount > 0) {
      database.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(timestamp, defaultCollection.id);
    }

    return repairedCount;
  },

  getBySlug(slug: string): CollectionRecord | undefined {
    return database.prepare('SELECT * FROM collections WHERE slug = ?').get(slug) as CollectionRecord | undefined;
  },

  create(name: string): CollectionRecord {
    this.ensureDefaultCollection();
    const normalizedName = name.trim().toLocaleLowerCase();
    const existingName = database
      .prepare('SELECT id FROM collections WHERE LOWER(name) = ? LIMIT 1')
      .get(normalizedName) as { id: number } | undefined;
    if (existingName) {
      throw new Error('Collection name already exists.');
    }

    const existingSlugs = new Set((database.prepare('SELECT slug FROM collections').all() as Array<{ slug: string }>).map((row) => row.slug));
    const slug = resolveUniqueSlug(name, existingSlugs, slugifyFolderName);
    const timestamp = nowIso();

    database
      .prepare('INSERT INTO collections (slug, name, is_default, created_at, updated_at) VALUES (?, ?, 0, ?, ?)')
      .run(slug, name, timestamp, timestamp);

    return this.getBySlug(slug) as CollectionRecord;
  },

  updateName(slug: string, name: string): CollectionRecord | undefined {
    this.ensureDefaultCollection();
    const collection = this.getBySlug(slug);
    if (!collection || collection.is_default === 1) {
      return undefined;
    }

    const normalizedName = name.trim().toLocaleLowerCase();
    const existingName = database
      .prepare('SELECT id FROM collections WHERE LOWER(name) = ? AND id != ? LIMIT 1')
      .get(normalizedName, collection.id) as { id: number } | undefined;
    if (existingName) {
      throw new Error('Collection name already exists.');
    }

    database
      .prepare('UPDATE collections SET name = ?, updated_at = ? WHERE id = ?')
      .run(name.trim(), nowIso(), collection.id);

    return this.getById(collection.id);
  },

  delete(slug: string): CollectionRecord | undefined {
    const collection = this.getBySlug(slug);
    if (!collection || collection.is_default === 1) {
      return undefined;
    }

    database.prepare('DELETE FROM collections WHERE id = ?').run(collection.id);

    return collection;
  },

  listSummaries(): CollectionSummaryRecord[] {
    this.ensureDefaultCollection();
    return database
      .prepare(
        `
        SELECT
          collections.*,
          (
            SELECT COUNT(*)
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
          ) AS item_count,
          (
            SELECT pi.image_id
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
            ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
            LIMIT 1
          ) AS cover_image_id,
          (
            SELECT images.thumbnail_path
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
            ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
            LIMIT 1
          ) AS cover_thumbnail_path,
          (
            SELECT GROUP_CONCAT(preview_images.image_id)
            FROM (
              SELECT pi.image_id
              FROM collection_items
              INNER JOIN posts ON posts.id = collection_items.post_id
              JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
              JOIN images ON images.id = pi.image_id
              INNER JOIN folders ON folders.id = posts.folder_id
              WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
              ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
              LIMIT 4
            ) AS preview_images
          ) AS preview_image_ids,
          (
            SELECT collection_items.post_id
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
            ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
            LIMIT 1
          ) AS cover_post_id
        FROM collections
        ORDER BY collections.is_default DESC, collections.updated_at DESC, collections.id DESC
        `
      )
      .all() as unknown as CollectionSummaryRecord[];
  },

  listMembershipsForImage(postId: number): CollectionMembershipRecord[] {
    this.ensureDefaultCollection();
    return database
      .prepare(
        `
        SELECT
          collections.*,
          (
            SELECT COUNT(*)
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
          ) AS item_count,
          (
            SELECT pi.image_id
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
            ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
            LIMIT 1
          ) AS cover_image_id,
          (
            SELECT images.thumbnail_path
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
            ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
            LIMIT 1
          ) AS cover_thumbnail_path,
          (
            SELECT GROUP_CONCAT(preview_images.image_id)
            FROM (
              SELECT pi.image_id
              FROM collection_items
              INNER JOIN posts ON posts.id = collection_items.post_id
              JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
              JOIN images ON images.id = pi.image_id
              INNER JOIN folders ON folders.id = posts.folder_id
              WHERE collection_items.collection_id = collections.id AND ${VISIBLE_POST_WHERE_SQL}
              ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
              LIMIT 4
            ) AS preview_images
          ) AS preview_image_ids,
          (
            CASE WHEN EXISTS (
              SELECT 1
              FROM collection_items
              WHERE collection_items.collection_id = collections.id
                AND collection_items.post_id = ?
            ) THEN 1 ELSE 0 END
          ) AS contains_image,
          (
            CASE WHEN EXISTS (
              SELECT 1
              FROM collection_items
              WHERE collection_items.collection_id = collections.id
                AND collection_items.post_id = ?
            ) THEN 1 ELSE 0 END
          ) AS contains_post
        FROM collections
        ORDER BY collections.is_default DESC, collections.updated_at DESC, collections.id DESC
        `
      )
      .all(postId, postId) as unknown as CollectionMembershipRecord[];
  },

  getSummaryBySlug(slug: string): CollectionSummaryRecord | undefined {
    return this.listSummaries().find((item) => item.slug === slug);
  },

  countImages(slug: string): number {
    const collection = this.getBySlug(slug);
    if (!collection) {
      return 0;
    }
    return Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM collection_items
            INNER JOIN posts ON posts.id = collection_items.post_id
            JOIN post_items pi ON pi.post_id = posts.id AND pi.position = 1
            JOIN images ON images.id = pi.image_id
            INNER JOIN folders ON folders.id = posts.folder_id
            WHERE collection_items.collection_id = ? AND ${VISIBLE_POST_WHERE_SQL}
            `
          )
          .get(collection.id) as { count: number }
      ).count
    );
  },

  listCollectionImages(slug: string, page: number, limit: number): FeedPost[] {
    const collection = this.getBySlug(slug);
    if (!collection) {
      return [];
    }

    const offset = (page - 1) * limit;
    const posts = database.prepare(
      `
      SELECT
        posts.id,
        posts.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        images.filename,
        posts.caption AS caption,
        posts.post_type AS postType,
        posts.source_path AS sourcePath,
        images.width,
        images.height,
        images.media_type AS mediaType,
        images.duration_ms AS durationMs,
        images.is_animated AS isAnimated,
        images.thumbnail_path AS thumbnailUrl,
        images.preview_path AS previewUrl,
        images.playback_strategy AS playbackStrategy,
        posts.sort_timestamp AS sortTimestamp,
        posts.taken_at AS takenAt,
        1 AS isSaved,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM collection_items
      INNER JOIN posts ON posts.id = collection_items.post_id
      INNER JOIN folders ON folders.id = posts.folder_id
      JOIN post_items ON post_items.post_id = posts.id AND post_items.position = 1
      JOIN images ON images.id = post_items.image_id
      LEFT JOIN places ON places.id = posts.place_id
      WHERE collection_items.collection_id = ? AND ${VISIBLE_POST_WHERE_SQL}
      ORDER BY collection_items.created_at DESC, collection_items.post_id DESC
      LIMIT ? OFFSET ?
      `
    ).all(collection.id, limit, offset) as unknown as FeedPost[];

    return postRepository.hydratePostItems(posts);
  },

  listImages(slug: string, page: number, limit: number): FeedPost[] {
    return this.listCollectionImages(slug, page, limit);
  },

  isImageSaved(postId: number): boolean {
    const defaultCollection = this.ensureDefaultCollection();
    return Number(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM collection_items WHERE collection_id = ? AND post_id = ?')
          .get(defaultCollection.id, postId) as { count: number }
      ).count
    ) > 0;
  },

  saveToDefault(postId: number): CollectionRecord {
    const defaultCollection = this.ensureDefaultCollection();
    this.addItem(defaultCollection.id, postId);
    return defaultCollection;
  },

  unsaveEverywhere(postId: number): void {
    database.prepare('DELETE FROM collection_items WHERE post_id = ?').run(postId);
  },

  addImage(slug: string, postId: number): CollectionRecord | undefined {
    const collection = this.getBySlug(slug);
    if (!collection) {
      return undefined;
    }
    this.addItem(collection.id, postId);
    return collection;
  },

  removeImage(slug: string, postId: number): CollectionRecord {
    const collection = this.getBySlug(slug);
    if (!collection) {
      throw new Error(`Collection not found: ${slug}`);
    }
    this.removeItem(collection.id, postId);
    return collection;
  },

  addItem(collectionId: number, postId: number): boolean {
    const collection = this.getById(collectionId);
    if (!collection) {
      return false;
    }

    const timestamp = nowIso();
    database.prepare('INSERT OR IGNORE INTO collection_items (collection_id, post_id, created_at) VALUES (?, ?, ?)').run(
      collectionId,
      postId,
      timestamp
    );

    if (collection.is_default === 0) {
      this.repairDefaultMemberships();
    }

    database.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(timestamp, collectionId);
    return true;
  },

  removeItem(collectionId: number, postId: number): boolean {
    const collection = this.getById(collectionId);
    if (!collection) {
      return false;
    }

    const timestamp = nowIso();
    database.prepare('DELETE FROM collection_items WHERE collection_id = ? AND post_id = ?').run(collectionId, postId);

    database.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(timestamp, collectionId);
    return true;
  },

  toggleDefaultMembership(postId: number): boolean {
    const defaultCollection = this.ensureDefaultCollection();
    const isCurrentlySaved = Number(
      (
        database
          .prepare('SELECT COUNT(*) AS count FROM collection_items WHERE collection_id = ? AND post_id = ?')
          .get(defaultCollection.id, postId) as { count: number }
      ).count
    ) > 0;

    if (isCurrentlySaved) {
      this.removeItem(defaultCollection.id, postId);
      return false;
    }

    this.addItem(defaultCollection.id, postId);
    return true;
  }
};

export const folderShareLinkRepository = {
  create(input: CreateFolderShareLinkInput): FolderShareLinkRecord {
    return this.createLink(input);
  },

  createLink(input: CreateFolderShareLinkInput): FolderShareLinkRecord {
    database
      .prepare(
        `
        INSERT INTO folder_share_links (
          folder_id, token_hash, token_prefix, expires_at, revoked_at, allow_original_downloads, created_at
        )
        VALUES (?, ?, ?, ?, NULL, 0, ?)
        `
      )
      .run(input.folderId, input.tokenHash, input.tokenPrefix, input.expiresAt, nowIso());

    return database
      .prepare('SELECT * FROM folder_share_links WHERE token_hash = ?')
      .get(input.tokenHash) as unknown as FolderShareLinkRecord;
  },

  getById(id: number): FolderShareLinkRecord | undefined {
    return database.prepare('SELECT * FROM folder_share_links WHERE id = ?').get(id) as FolderShareLinkRecord | undefined;
  },

  getByTokenHash(tokenHash: string): FolderShareLinkRecord | undefined {
    return database.prepare('SELECT * FROM folder_share_links WHERE token_hash = ?').get(tokenHash) as FolderShareLinkRecord | undefined;
  },

  listByFolder(folderId: number): FolderShareLinkRecord[] {
    return database
      .prepare('SELECT * FROM folder_share_links WHERE folder_id = ? ORDER BY created_at DESC, id DESC')
      .all(folderId) as unknown as FolderShareLinkRecord[];
  },

  revoke(id: number, folderId: number): FolderShareLinkRecord | undefined {
    return this.revokeLink(folderId, id);
  },

  revokeLink(folderId: number, id: number): FolderShareLinkRecord | undefined {
    const revokedAt = nowIso();
    database
      .prepare(
        `
        UPDATE folder_share_links
        SET revoked_at = ?
        WHERE id = ? AND folder_id = ? AND revoked_at IS NULL
        `
      )
      .run(revokedAt, id, folderId);

    return this.getById(id);
  },

  touchLastUsed(id: number): void {
    database.prepare('UPDATE folder_share_links SET last_used_at = ? WHERE id = ?').run(nowIso(), id);
  }
};

export const folderShareRepository = folderShareLinkRepository;

/**
 * Post-level share links. Separate from folder shares on purpose: a folder token
 * unlocks a whole album, while these only ever unlock the single post they were
 * minted for, which is what the "share this clip" button needs.
 */
export const postShareLinkRepository = {
  create(input: CreatePostShareLinkInput): PostShareLinkRecord {
    database
      .prepare(
        `
        INSERT INTO post_share_links (
          post_id, token_hash, token_prefix, expires_at, revoked_at, created_at
        )
        VALUES (?, ?, ?, ?, NULL, ?)
        `
      )
      .run(input.postId, input.tokenHash, input.tokenPrefix, input.expiresAt, nowIso());

    return database
      .prepare('SELECT * FROM post_share_links WHERE token_hash = ?')
      .get(input.tokenHash) as unknown as PostShareLinkRecord;
  },

  getById(id: number): PostShareLinkRecord | undefined {
    return database.prepare('SELECT * FROM post_share_links WHERE id = ?').get(id) as PostShareLinkRecord | undefined;
  },

  getByTokenHash(tokenHash: string): PostShareLinkRecord | undefined {
    return database
      .prepare('SELECT * FROM post_share_links WHERE token_hash = ?')
      .get(tokenHash) as PostShareLinkRecord | undefined;
  },

  listByPost(postId: number): PostShareLinkRecord[] {
    return database
      .prepare('SELECT * FROM post_share_links WHERE post_id = ? ORDER BY created_at DESC, id DESC')
      .all(postId) as unknown as PostShareLinkRecord[];
  },

  revoke(id: number, postId: number): PostShareLinkRecord | undefined {
    database
      .prepare(
        `
        UPDATE post_share_links
        SET revoked_at = ?
        WHERE id = ? AND post_id = ? AND revoked_at IS NULL
        `
      )
      .run(nowIso(), id, postId);

    return this.getById(id);
  },

  touchLastUsed(id: number): void {
    database.prepare('UPDATE post_share_links SET last_used_at = ? WHERE id = ?').run(nowIso(), id);
  }
};

export const folderSharePasswordRepository = {
  get(folderId: number): FolderSharePasswordRecord | undefined {
    return database
      .prepare('SELECT * FROM folder_share_passwords WHERE folder_id = ?')
      .get(folderId) as FolderSharePasswordRecord | undefined;
  },

  upsert(input: UpsertFolderSharePasswordInput): FolderSharePasswordRecord {
    database.exec('BEGIN TRANSACTION;');
    try {
      database.prepare('UPDATE folders SET share_password_version = share_password_version + 1 WHERE id = ?').run(input.folderId);
      const folder = database.prepare('SELECT share_password_version FROM folders WHERE id = ?').get(input.folderId) as { share_password_version: number } | undefined;
      const version = folder ? folder.share_password_version : 1;

      database
        .prepare(
          `
          INSERT INTO folder_share_passwords (
            folder_id,
            password_hash,
            password_salt,
            version,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(folder_id) DO UPDATE SET
            password_hash = excluded.password_hash,
            password_salt = excluded.password_salt,
            version = excluded.version,
            updated_at = excluded.updated_at
          `
        )
        .run(input.folderId, input.passwordHash, input.passwordSalt, version, nowIso());

      database.exec('COMMIT;');
      return this.get(input.folderId) as FolderSharePasswordRecord;
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  },

  remove(folderId: number): boolean {
    database.exec('BEGIN TRANSACTION;');
    try {
      database.prepare('UPDATE folders SET share_password_version = share_password_version + 1 WHERE id = ?').run(folderId);
      const result = database.prepare('DELETE FROM folder_share_passwords WHERE folder_id = ?').run(folderId);
      database.exec('COMMIT;');
      return Number(result.changes ?? 0) > 0;
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  }
};

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

export const folderScanStateRepository = {
  getAll(): FolderScanStateRecord[] {
    return database.prepare('SELECT * FROM folder_scan_state ORDER BY folder_path ASC').all() as unknown as FolderScanStateRecord[];
  },

  upsert(input: UpsertFolderScanStateInput): void {
    const normalizedFolderPath = normalizePath(input.folderPath);
    database
      .prepare(
        `
        INSERT INTO folder_scan_state (folder_path, signature, file_count, max_mtime_ms, total_size, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(folder_path) DO UPDATE SET
          signature = excluded.signature,
          file_count = excluded.file_count,
          max_mtime_ms = excluded.max_mtime_ms,
          total_size = excluded.total_size,
          updated_at = excluded.updated_at
        `
      )
      .run(normalizedFolderPath, input.signature, input.fileCount, input.maxMtimeMs, input.totalSize, nowIso());
  },

  delete(folderPath: string): number {
    const result = database.prepare('DELETE FROM folder_scan_state WHERE folder_path = ?').run(normalizePath(folderPath));
    return Number(result.changes ?? 0);
  },

  deleteTree(folderPath: string): number {
    const normalizedFolderPath = normalizePath(folderPath);
    const result = database
      .prepare('DELETE FROM folder_scan_state WHERE folder_path = ? OR folder_path LIKE ?')
      .run(normalizedFolderPath, `${normalizedFolderPath}/%`);
    return Number(result.changes ?? 0);
  },

  deleteMissing(activeFolderPaths: string[]): number {
    if (activeFolderPaths.length === 0) {
      const result = database.prepare('DELETE FROM folder_scan_state').run();
      return Number(result.changes ?? 0);
    }

    const normalizedFolderPaths = activeFolderPaths.map((folderPath) => normalizePath(folderPath));
    const placeholders = normalizedFolderPaths.map(() => '?').join(', ');
    const statement = database.prepare(`DELETE FROM folder_scan_state WHERE folder_path NOT IN (${placeholders})`);
    const result = statement.run(...normalizedFolderPaths);
    return Number(result.changes ?? 0);
  },

  deleteMissingWithin(activeFolderPaths: string[], scopeRoots: string[]): number {
    if (scopeRoots.length === 0) return 0;

    const active = activeFolderPaths.map((folderPath) => normalizePath(folderPath));
    const activeClause = active.length > 0 ? `AND folder_path NOT IN (${active.map(() => '?').join(', ')})` : '';
    const scopeClause = scopeRoots.map(() => '(folder_path = ? OR folder_path LIKE ?)').join(' OR ');
    const params = [
      ...scopeRoots.flatMap((root) => {
        const normalized = normalizePath(root);
        return [normalized, `${normalized}/%`];
      }),
      ...active
    ];
    const result = database.prepare(`DELETE FROM folder_scan_state WHERE (${scopeClause}) ${activeClause}`).run(...params);
    return Number(result.changes ?? 0);
  }
};

export const scanRunRepository = {
  start(): number {
    const startedAt = nowIso();
    const result = database
      .prepare('INSERT INTO scan_runs (started_at, status, scanned_files, new_files, updated_files, removed_files) VALUES (?, ?, 0, 0, 0, 0)')
      .run(startedAt, 'running');

    return Number(result.lastInsertRowid);
  },

  finish(runId: number, input: Omit<ScanRunRecord, 'id' | 'started_at'>): void {
    database.prepare(
      `
      UPDATE scan_runs
      SET finished_at = ?, status = ?, scanned_files = ?, new_files = ?, updated_files = ?, removed_files = ?, error_text = ?, warning_count = ?, warning_text = ?
      WHERE id = ?
      `
    ).run(
      input.finished_at,
      input.status,
      input.scanned_files,
      input.new_files,
      input.updated_files,
      input.removed_files,
      input.error_text,
      input.warning_count ?? 0,
      input.warning_text ?? null,
      runId
    );
  },

  latest(): ScanRunRecord | undefined {
    return database.prepare('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1').get() as ScanRunRecord | undefined;
  },

  latestCompleted(): ScanRunRecord | undefined {
    return database
      .prepare('SELECT * FROM scan_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1')
      .get() as ScanRunRecord | undefined;
  },

  completedSummaryBetween(startIso: string, endIso: string): ScanChangesSummary {
    const row = database
      .prepare(
        `
        SELECT
          COALESCE(SUM(scanned_files), 0) AS scanned_files,
          COALESCE(SUM(new_files), 0) AS new_files,
          COALESCE(SUM(updated_files), 0) AS updated_files,
          COALESCE(SUM(removed_files), 0) AS removed_files,
          COUNT(*) AS scan_count,
          MAX(finished_at) AS latest_finished_at
        FROM scan_runs
        WHERE finished_at IS NOT NULL
          AND finished_at >= ?
          AND finished_at < ?
        `
      )
      .get(startIso, endIso) as Partial<ScanChangesSummary>;

    return {
      scanned_files: Number(row.scanned_files ?? 0),
      new_files: Number(row.new_files ?? 0),
      updated_files: Number(row.updated_files ?? 0),
      removed_files: Number(row.removed_files ?? 0),
      scan_count: Number(row.scan_count ?? 0),
      latest_finished_at: row.latest_finished_at ?? null
    };
  }
};
