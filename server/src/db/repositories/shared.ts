import { databaseManager } from '../database.js';
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

import type { DatabaseSync } from 'node:sqlite';

export const database = new Proxy({} as DatabaseSync, {
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
/**
 * Folder ids inside the current scan selection.
 *
 * Resolving the selection to ids once lets the post scope below test an indexed
 * `images.folder_id` instead of running a `LIKE` against every candidate's path for
 * every selected prefix. On the live library that is what took the feed query from
 * ~370 ms down to ~140 ms, which is most of the wait before the first card renders.
 */
const SELECTED_SCAN_FOLDER_ID_SUBQUERY_SQL =
  `SELECT scope_folders.id FROM folders scope_folders ` +
  `INNER JOIN app_settings scan_scope ON scan_scope.key = '${SCAN_FOLDERS_SETTING_KEY}' ` +
  `CROSS JOIN json_each(scan_scope.value) selected ` +
  `WHERE scope_folders.folder_path = selected.value OR scope_folders.folder_path LIKE selected.value || '/%'`;

const SELECTED_SCAN_POST_SCOPE_SQL =
  `(NOT EXISTS (SELECT 1 FROM app_settings WHERE key = '${SCAN_FOLDERS_SETTING_KEY}') OR EXISTS (` +
  `SELECT 1 FROM post_items scope_items ` +
  `INNER JOIN images scope_images ON scope_images.id = scope_items.image_id ` +
  `WHERE scope_items.post_id = posts.id ` +
  `AND scope_images.folder_id IN (${SELECTED_SCAN_FOLDER_ID_SUBQUERY_SQL})))`;

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
    images.file_size AS fileSize,
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


export {
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
  MediaSearchSql,
  nowIso,
  serializeAnimatedFlag,
  normalizeSearchQuery,
  escapeLikePattern,
  isValidJson,
  buildMediaSearchSql
};
