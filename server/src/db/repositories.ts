import { databaseManager } from './database.js';
import type { IDbDriver } from './driver/types.js';
import { normalizePath, safeJoin } from '../utils/path-utils.js';
import { resolveUniqueSlug, slugifyFolderName } from '../utils/slug.js';
import type {
  AppSettingRecord,
  CollectionMembershipRecord,
  CollectionRecord,
  CollectionSummaryRecord,
  FeedImage,
  FolderAvatarSource,
  FolderImageOrder,
  FolderRole,
  FolderScanStateRecord,
  ImageDetail,
  ImageRecord,
  LikeRecord,
  MediaType,
  PlaceKind,
  PlaceRecord,
  PlaybackStrategy,
  ReelCandidate,
  FolderRecord,
  FolderSummaryRecord,
  ScanRunRecord,
  TrashImage,
  TakenAtSource
} from '../types/models.js';

// ---------------------------------------------------------------------------
// Driver access
// ---------------------------------------------------------------------------

let _driver: IDbDriver | null = null;

export async function initRepositories(): Promise<void> {
  _driver = await databaseManager.getConnection();
  initDialectFragments(_driver.dialect);
}

function getDriver(): IDbDriver {
  if (!_driver) {
    throw new Error('Repositories not initialized. Call initRepositories() first.');
  }
  return _driver;
}

// ---------------------------------------------------------------------------
// Dialect fragments — set once by initDialectFragments()
// ---------------------------------------------------------------------------

let BOOL_TRUE: string;
let BOOL_FALSE: string;
let COLLATE_NOCASE: string;
let GROUP_CONCAT_FN: (expr: string) => string;
let STRFTIME_MONTH_DAY: (expr: string) => string;
let STRFTIME_YEAR: (expr: string) => string;
let JSON_EXTRACT_FN: (col: string, path: string) => string;
let INSERT_OR_IGNORE: string;
let INSERT_OR_IGNORE_SUFFIX: string;
let IS_POSTGRES = false;
let RANDOM_HASH_ORDER_SQL: string;

function initDialectFragments(dialect: 'sqlite' | 'postgres'): void {
  IS_POSTGRES = dialect === 'postgres';
  if (dialect === 'sqlite') {
    BOOL_TRUE = '1';
    BOOL_FALSE = '0';
    COLLATE_NOCASE = 'COLLATE NOCASE';
    GROUP_CONCAT_FN = (e) => `GROUP_CONCAT(${e})`;
    STRFTIME_MONTH_DAY = (e) => `strftime('%m-%d', ${e}/1000, 'unixepoch', 'localtime')`;
    STRFTIME_YEAR = (e) => `CAST(strftime('%Y', ${e}/1000, 'unixepoch', 'localtime') AS INTEGER)`;
    JSON_EXTRACT_FN = (col, p) => `CASE WHEN json_valid(${col}) THEN json_extract(${col}, '${p}') END`;
    INSERT_OR_IGNORE = 'INSERT OR IGNORE';
    INSERT_OR_IGNORE_SUFFIX = '';
    // SQLite integers are 64-bit; no overflow risk
    RANDOM_HASH_ORDER_SQL = 'ABS(((images.id * 1103515245) + (? * 1013904223)) % 2147483647)';
  } else {
    BOOL_TRUE = 'true';
    BOOL_FALSE = 'false';
    COLLATE_NOCASE = '';
    GROUP_CONCAT_FN = (e) => `STRING_AGG(${e}::text, ',')`;
    STRFTIME_MONTH_DAY = (e) => `to_char(to_timestamp(${e}/1000.0), 'MM-DD')`;
    STRFTIME_YEAR = (e) => `EXTRACT(YEAR FROM to_timestamp(${e}/1000.0))::int`;
    JSON_EXTRACT_FN = (col, p) => `(${col}::jsonb->>'${p.replace('$.', '')}')`;
    INSERT_OR_IGNORE = 'INSERT';
    INSERT_OR_IGNORE_SUFFIX = ' ON CONFLICT DO NOTHING';
    // Cast to bigint before multiplication to avoid INT4 overflow in PostgreSQL
    RANDOM_HASH_ORDER_SQL = 'ABS(((images.id::bigint * 1103515245) + (?::bigint * 1013904223)) % 2147483647)';
  }
}

// Initialise with SQLite defaults so the constants are defined even if
// initRepositories() hasn't been called yet (e.g. in early boot or tests
// that stub the module before calling init).
initDialectFragments('sqlite');

// ---------------------------------------------------------------------------
// Static SQL fragments (dialect-independent)
// ---------------------------------------------------------------------------

const EFFECTIVE_FEED_TIME_SQL = 'COALESCE(images.taken_at, images.sort_timestamp)';
const DEFAULT_COLLECTION_SLUG = 'saved';
const DEFAULT_COLLECTION_NAME = 'Saved';
const COVER_FILENAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif'] as const;
const COVER_FILENAME_SQL = COVER_FILENAMES.map((name) => `'${name}'`).join(', ');
const NORMAL_FOLDER_ROLE_SQL = "folders.role = 'normal'";
const NORMAL_FOLDER_ID_SUBQUERY_SQL = "SELECT id FROM folders WHERE role = 'normal'";
const VISIBLE_IMAGE_WHERE_SQL =
  `images.is_deleted = 0 AND images.is_trashed = 0 AND LOWER(images.filename) NOT IN (${COVER_FILENAME_SQL}) AND ${NORMAL_FOLDER_ROLE_SQL}`;
const VISIBLE_IMAGE_WHERE_UNSCOPED_SQL =
  `is_deleted = 0 AND is_trashed = 0 AND LOWER(filename) NOT IN (${COVER_FILENAME_SQL}) AND folder_id IN (${NORMAL_FOLDER_ID_SUBQUERY_SQL})`;
const STORY_IMAGE_WHERE_SQL = 'images.is_deleted = 0 AND images.is_trashed = 0';
const STORY_IMAGE_WHERE_UNSCOPED_SQL = 'is_deleted = 0 AND is_trashed = 0';
const HAS_AVATAR_STORY_SQL = `
  EXISTS (
    SELECT 1
    FROM folders AS story_folders
    INNER JOIN images AS story_images ON story_images.folder_id = story_folders.id
    WHERE story_folders.story_owner_folder_id = folders.id
      AND story_folders.role IN ('story_root', 'story_capsule')
      AND story_images.is_deleted = 0
      AND story_images.is_trashed = 0
    LIMIT 1
  )
`;
const ACTIVE_FOLDER_AVATAR_IMAGE_ID_SQL = `
  SELECT avatar_images.id
  FROM images AS avatar_images
  WHERE avatar_images.id = folders.avatar_image_id
    AND avatar_images.folder_id = folders.id
    AND avatar_images.is_deleted = 0
    AND avatar_images.is_trashed = 0
  LIMIT 1
`;
const FALLBACK_FOLDER_AVATAR_IMAGE_ID_SQL = `
  SELECT fallback_images.id
  FROM images AS fallback_images
  WHERE fallback_images.folder_id = folders.id
    AND fallback_images.is_deleted = 0
    AND fallback_images.is_trashed = 0
    AND LOWER(fallback_images.filename) NOT IN (${COVER_FILENAME_SQL})
  ORDER BY fallback_images.sort_timestamp DESC, fallback_images.id DESC
  LIMIT 1
`;
const FOLDER_SUMMARY_AVATAR_IMAGE_ID_SQL = `
  COALESCE(
    (${ACTIVE_FOLDER_AVATAR_IMAGE_ID_SQL}),
    (${FALLBACK_FOLDER_AVATAR_IMAGE_ID_SQL})
  )
`;
const FOLDER_SUMMARY_AVATAR_THUMBNAIL_PATH_SQL = `
  COALESCE(
    (
      SELECT avatar_images.thumbnail_path
      FROM images AS avatar_images
      WHERE avatar_images.id = folders.avatar_image_id
        AND avatar_images.folder_id = folders.id
        AND avatar_images.is_deleted = 0
        AND avatar_images.is_trashed = 0
      LIMIT 1
    ),
    (
      SELECT fallback_images.thumbnail_path
      FROM images AS fallback_images
      WHERE fallback_images.folder_id = folders.id
        AND fallback_images.is_deleted = 0
        AND fallback_images.is_trashed = 0
        AND LOWER(fallback_images.filename) NOT IN (${COVER_FILENAME_SQL})
      ORDER BY fallback_images.sort_timestamp DESC, fallback_images.id DESC
      LIMIT 1
    )
  )
`;

function getFolderSummarySql(): string {
  if (IS_POSTGRES) {
    return `
WITH
_fallback_av AS (
  SELECT DISTINCT ON (images.folder_id)
    images.folder_id,
    images.id,
    images.thumbnail_path
  FROM images
  INNER JOIN folders AS _avf ON _avf.id = images.folder_id AND _avf.role = 'normal'
  WHERE images.is_deleted = 0
    AND images.is_trashed = 0
    AND LOWER(images.filename) NOT IN (${COVER_FILENAME_SQL})
  ORDER BY images.folder_id, images.sort_timestamp DESC, images.id DESC
)
SELECT
  folders.*,
  MAX(CASE WHEN _sc.story_owner_folder_id IS NOT NULL THEN 1 ELSE 0 END) AS has_avatar_story,
  MAX(COALESCE(_eav.id, _fav.id)) AS summary_avatar_image_id,
  MAX(COALESCE(_eav.thumbnail_path, _fav.thumbnail_path)) AS summary_avatar_thumbnail_path
FROM folders
LEFT JOIN images AS _eav ON _eav.id = folders.avatar_image_id
  AND _eav.folder_id = folders.id
  AND _eav.is_deleted = 0
  AND _eav.is_trashed = 0
LEFT JOIN _fallback_av _fav ON _fav.folder_id = folders.id
LEFT JOIN (
  SELECT DISTINCT story_owner_folder_id
  FROM folders AS _sf
  WHERE _sf.role IN ('story_root', 'story_capsule')
    AND _sf.story_owner_folder_id IS NOT NULL
) _sc ON _sc.story_owner_folder_id = folders.id
`;
  }
  return `
  SELECT
    folders.*,
    CASE WHEN ${HAS_AVATAR_STORY_SQL} THEN 1 ELSE 0 END AS has_avatar_story,
    ${FOLDER_SUMMARY_AVATAR_IMAGE_ID_SQL} AS summary_avatar_image_id,
    ${FOLDER_SUMMARY_AVATAR_THUMBNAIL_PATH_SQL} AS summary_avatar_thumbnail_path
  FROM folders
`;
}

function getQualifiedFolderImageOrderSql(order: FolderImageOrder): string {
  return order === 'oldest'
    ? 'images.sort_timestamp ASC, images.id ASC'
    : 'images.sort_timestamp DESC, images.id DESC';
}

function getUnscopedFolderImageOrderSql(order: FolderImageOrder): string {
  return order === 'oldest'
    ? 'sort_timestamp ASC, id ASC'
    : 'sort_timestamp DESC, id DESC';
}

const IMAGE_FILENAME_SEARCH_SQL = 'LOWER(images.filename)';
const FOLDER_NAME_SEARCH_SQL = 'LOWER(folders.name)';
const FOLDER_SLUG_SEARCH_SQL = 'LOWER(folders.slug)';
const FOLDER_PATH_SEARCH_SQL = 'LOWER(folders.folder_path)';

function getExifCameraMakeSearchSql(): string {
  return `LOWER(COALESCE(${JSON_EXTRACT_FN('images.exif_json', '$.cameraMake')}, ''))`;
}
function getExifCameraModelSearchSql(): string {
  return `LOWER(COALESCE(${JSON_EXTRACT_FN('images.exif_json', '$.cameraModel')}, ''))`;
}
function getExifLensModelSearchSql(): string {
  return `LOWER(COALESCE(${JSON_EXTRACT_FN('images.exif_json', '$.lensModel')}, ''))`;
}

function getImageSavedSelectSql(): string {
  return `
    CASE WHEN EXISTS (
      SELECT 1
      FROM collections
      INNER JOIN collection_items ON collection_items.collection_id = collections.id
      WHERE collections.is_default = ${BOOL_TRUE}
        AND collection_items.image_id = images.id
    ) THEN 1 ELSE 0 END AS isSaved
`;
}

function getFeedImageSelectSql(): string {
  return `
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
    ${getImageSavedSelectSql()},
    places.id AS placeId,
    places.slug AS placeSlug,
    places.display_name AS placeName,
    places.kind AS placeKind,
    places.is_approximate AS placeIsApproximate
  FROM images
  INNER JOIN folders ON folders.id = images.folder_id
  LEFT JOIN places ON places.id = images.place_id
`;
}

interface MediaSearchSql {
  whereSql: string;
  whereParams: string[];
  rankSql: string;
  rankParams: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function serializeAnimatedFlag(isAnimated: boolean | null | undefined): number | boolean {
  if (getDriver().dialect === 'postgres') return !!isAnimated;
  return isAnimated ? 1 : 0;
}

function normalizeSearchQuery(query: string): string {
  return query.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function buildMediaSearchSql(query: string): MediaSearchSql | null {
  const normalizedQuery = normalizeSearchQuery(query);
  if (normalizedQuery.length === 0) {
    return null;
  }

  const exifCameraMakeSql = getExifCameraMakeSearchSql();
  const exifCameraModelSql = getExifCameraModelSearchSql();
  const exifLensModelSql = getExifLensModelSearchSql();

  const MEDIA_SEARCH_FIELD_SQL = [
    IMAGE_FILENAME_SEARCH_SQL,
    FOLDER_NAME_SEARCH_SQL,
    FOLDER_SLUG_SEARCH_SQL,
    FOLDER_PATH_SEARCH_SQL,
    exifCameraMakeSql,
    exifCameraModelSql,
    exifLensModelSql
  ] as const;

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
    `CASE WHEN ${exifCameraMakeSql} LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`,
    `CASE WHEN ${exifCameraModelSql} LIKE ? ESCAPE '\\' THEN 20 ELSE 0 END`,
    `CASE WHEN ${exifLensModelSql} LIKE ? ESCAPE '\\' THEN 18 ELSE 0 END`
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
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern,
    queryContainsPattern
  ];

  for (const token of normalizedTokens) {
    const tokenPattern = `%${escapeLikePattern(token)}%`;
    rankSqlParts.push(
      `CASE WHEN ${IMAGE_FILENAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 18 ELSE 0 END`,
      `CASE WHEN ${FOLDER_NAME_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 12 ELSE 0 END`,
      `CASE WHEN ${FOLDER_SLUG_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`,
      `CASE WHEN ${FOLDER_PATH_SEARCH_SQL} LIKE ? ESCAPE '\\' THEN 8 ELSE 0 END`,
      `CASE WHEN ${exifCameraMakeSql} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`,
      `CASE WHEN ${exifCameraModelSql} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`,
      `CASE WHEN ${exifLensModelSql} LIKE ? ESCAPE '\\' THEN 6 ELSE 0 END`
    );
    rankParams.push(
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

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

export interface UpsertFolderInput {
  slug: string;
  name: string;
  folderPath: string;
  role?: FolderRole;
  storyOwnerFolderId?: number | null;
}

export interface SaveFolderResult {
  folder: FolderRecord;
  wrote: boolean;
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

// ---------------------------------------------------------------------------
// folderRepository
// ---------------------------------------------------------------------------

export const folderRepository = {
  async getAll(): Promise<FolderRecord[]> {
    const driver = getDriver();
    const orderBy = COLLATE_NOCASE ? `folder_path ${COLLATE_NOCASE} ASC` : 'folder_path ASC';
    const { rows } = await driver.query<FolderRecord>(`SELECT * FROM folders ORDER BY ${orderBy}`);
    return rows;
  },

  async getNormalBySlug(slug: string): Promise<FolderRecord | undefined> {
    return getDriver().queryOne<FolderRecord>("SELECT * FROM folders WHERE slug = ? AND role = 'normal'", [slug]);
  },

  async countNormal(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM folders WHERE role = 'normal'"
    );
    return Number(row?.count ?? 0);
  },

  async getAllSummaries(): Promise<FolderSummaryRecord[]> {
    const driver = getDriver();
    const nameOrder = COLLATE_NOCASE
      ? `folders.name ${COLLATE_NOCASE} ASC`
      : 'folders.name ASC';
    const pathOrder = COLLATE_NOCASE
      ? `folders.folder_path ${COLLATE_NOCASE} ASC`
      : 'folders.folder_path ASC';
    const { rows } = await driver.query<FolderSummaryRecord>(
      `${getFolderSummarySql()}
      WHERE folders.role = 'normal'
      GROUP BY folders.id
      ORDER BY folders.latest_image_mtime_ms DESC, ${nameOrder}, ${pathOrder}`
    );
    return rows;
  },

  async getSummaryPage(offset: number, limit: number): Promise<FolderSummaryRecord[]> {
    const driver = getDriver();
    const nameOrder = COLLATE_NOCASE
      ? `folders.name ${COLLATE_NOCASE} ASC`
      : 'folders.name ASC';
    const pathOrder = COLLATE_NOCASE
      ? `folders.folder_path ${COLLATE_NOCASE} ASC`
      : 'folders.folder_path ASC';
    const { rows } = await driver.query<FolderSummaryRecord>(
      `${getFolderSummarySql()}
      WHERE folders.role = 'normal'
      GROUP BY folders.id
      ORDER BY folders.latest_image_mtime_ms DESC, ${nameOrder}, ${pathOrder}
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows;
  },

  async getBySlug(slug: string): Promise<FolderRecord | undefined> {
    return getDriver().queryOne<FolderRecord>('SELECT * FROM folders WHERE slug = ?', [slug]);
  },

  async getById(id: number): Promise<FolderRecord | undefined> {
    return getDriver().queryOne<FolderRecord>('SELECT * FROM folders WHERE id = ?', [id]);
  },

  async getByFolderPath(folderPath: string): Promise<FolderRecord | undefined> {
    return getDriver().queryOne<FolderRecord>(
      'SELECT * FROM folders WHERE folder_path = ?',
      [normalizePath(folderPath)]
    );
  },

  async getByFolderPaths(folderPaths: string[]): Promise<FolderRecord[]> {
    if (folderPaths.length === 0) return [];
    const normalized = folderPaths.map(normalizePath);
    const placeholders = normalized.map(() => '?').join(', ');
    const { rows } = await getDriver().query<FolderRecord>(
      `SELECT * FROM folders WHERE folder_path IN (${placeholders})`,
      normalized
    );
    return rows;
  },

  async getSummaryBySlug(slug: string): Promise<FolderSummaryRecord | undefined> {
    return getDriver().queryOne<FolderSummaryRecord>(
      `${getFolderSummarySql()}
      WHERE folders.slug = ? AND folders.role = 'normal'
      GROUP BY folders.id
      LIMIT 1`,
      [slug]
    );
  },

  async upsert(input: UpsertFolderInput): Promise<FolderRecord> {
    const normalizedFolderPath = normalizePath(input.folderPath);
    const role = input.role ?? 'normal';
    const storyOwnerFolderId = input.storyOwnerFolderId ?? null;
    await getDriver().execute(
      `INSERT INTO folders (slug, name, folder_path, role, story_owner_folder_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_path) DO UPDATE SET
        slug = excluded.slug,
        name = excluded.name,
        role = excluded.role,
        story_owner_folder_id = excluded.story_owner_folder_id,
        updated_at = excluded.updated_at`,
      [input.slug, input.name, normalizedFolderPath, role, storyOwnerFolderId, nowIso()]
    );
    return (await this.getByFolderPath(normalizedFolderPath)) as FolderRecord;
  },

  async save(input: UpsertFolderInput): Promise<SaveFolderResult> {
    const normalizedFolderPath = normalizePath(input.folderPath);
    const existing = await this.getByFolderPath(normalizedFolderPath);
    const role = input.role ?? 'normal';
    const storyOwnerFolderId = input.storyOwnerFolderId ?? null;

    if (
      existing &&
      existing.slug === input.slug &&
      existing.role === role &&
      existing.story_owner_folder_id === storyOwnerFolderId
    ) {
      return { folder: existing, wrote: false };
    }

    if (existing) {
      await getDriver().execute(
        'UPDATE folders SET slug = ?, role = ?, story_owner_folder_id = ?, updated_at = ? WHERE id = ?',
        [input.slug, role, storyOwnerFolderId, nowIso(), existing.id]
      );
      return { folder: (await this.getById(existing.id)) as FolderRecord, wrote: true };
    }

    return {
      folder: await this.upsert({ ...input, folderPath: normalizedFolderPath }),
      wrote: true
    };
  },

  async count(): Promise<number> {
    return statsRepository.getFolderCount();
  },

  async setAvatar(folderId: number, imageId: number | null, source: FolderAvatarSource = 'auto'): Promise<void> {
    const driver = getDriver();
    const isNotSql = driver.dialect === 'postgres' ? 'IS DISTINCT FROM' : 'IS NOT';
    await driver.execute(
      `UPDATE folders SET avatar_image_id = ?, avatar_source = ?, updated_at = ? WHERE id = ? AND (avatar_image_id ${isNotSql} ? OR avatar_source != ?)`,
      [imageId, source, nowIso(), folderId, imageId, source]
    );
  },

  async updateMetadata(slug: string, name: string, description: string | null): Promise<FolderRecord | undefined> {
    await getDriver().execute(
      "UPDATE folders SET name = ?, description = ?, updated_at = ? WHERE slug = ? AND role = 'normal'",
      [name, description, nowIso(), slug]
    );
    return this.getNormalBySlug(slug);
  },

  async delete(id: number): Promise<void> {
    await getDriver().execute('DELETE FROM folders WHERE id = ?', [id]);
  },

  async resolveAvatarSelection(folderId: number): Promise<{ imageId: number | null; source: FolderAvatarSource } | null> {
    const folder = await this.getById(folderId);
    if (!folder) {
      return null;
    }

    const explicitCoverImageId = await imageRepository.getExplicitCoverImageId(folderId);
    if (explicitCoverImageId !== null) {
      return { imageId: explicitCoverImageId, source: 'cover' };
    }

    if (folder.avatar_source === 'manual' && folder.avatar_image_id !== null) {
      const manualImage = await imageRepository.getById(folder.avatar_image_id);
      if (
        manualImage &&
        manualImage.folder_id === folderId &&
        manualImage.is_deleted === 0 &&
        manualImage.is_trashed === 0
      ) {
        return { imageId: manualImage.id, source: 'manual' };
      }
    }

    return {
      imageId: await imageRepository.getLatestFolderImageId(folderId),
      source: 'auto'
    };
  },

  async syncAvatarSelection(folderId: number): Promise<void> {
    const nextSelection = await this.resolveAvatarSelection(folderId);
    if (!nextSelection) {
      return;
    }
    await this.setAvatar(folderId, nextSelection.imageId, nextSelection.source);
  },

  async updateCounts(folderId: number): Promise<void> {
    await getDriver().execute(
      `UPDATE folders
      SET
        image_count = (
          SELECT COUNT(*) FROM images
          WHERE folder_id = ? AND is_deleted = 0 AND is_trashed = 0
          AND LOWER(filename) NOT IN (${COVER_FILENAME_SQL})
        ),
        video_count = (
          SELECT COUNT(*) FROM images
          WHERE folder_id = ? AND media_type = 'video' AND is_deleted = 0 AND is_trashed = 0
          AND LOWER(filename) NOT IN (${COVER_FILENAME_SQL})
        ),
        latest_image_mtime_ms = (
          SELECT MAX(mtime_ms) FROM images
          WHERE folder_id = ? AND is_deleted = 0 AND is_trashed = 0
          AND LOWER(filename) NOT IN (${COVER_FILENAME_SQL})
        )
      WHERE id = ?`,
      [folderId, folderId, folderId, folderId]
    );
  },

  async listOwnedStoryFolders(ownerFolderId: number): Promise<FolderRecord[]> {
    const nameOrder = COLLATE_NOCASE ? `name ${COLLATE_NOCASE} ASC` : 'name ASC';
    const pathOrder = COLLATE_NOCASE ? `folder_path ${COLLATE_NOCASE} ASC` : 'folder_path ASC';
    const { rows } = await getDriver().query<FolderRecord>(
      `SELECT *
      FROM folders
      WHERE story_owner_folder_id = ?
        AND role IN ('story_root', 'story_capsule')
      ORDER BY
        CASE role
          WHEN 'story_root' THEN 0
          ELSE 1
        END,
        ${nameOrder},
        ${pathOrder}`,
      [ownerFolderId]
    );
    return rows;
  },

  async getOwnedStoryFolderBySlug(ownerFolderId: number, slug: string): Promise<FolderRecord | undefined> {
    return getDriver().queryOne<FolderRecord>(
      `SELECT *
      FROM folders
      WHERE story_owner_folder_id = ?
        AND slug = ?
        AND role IN ('story_root', 'story_capsule')`,
      [ownerFolderId, slug]
    );
  },

  async hasLegacyStoriesCandidates(): Promise<boolean> {
    const row = await getDriver().queryOne<{ found: number }>(
      `SELECT 1 AS found
      FROM folders
      WHERE
        LOWER(folder_path) = 'stories'
        OR LOWER(folder_path) LIKE '%/stories'
        OR LOWER(folder_path) LIKE 'stories/%'
        OR LOWER(folder_path) LIKE '%/stories/%'
      LIMIT 1`
    );
    return row?.found === 1;
  }
};

// ---------------------------------------------------------------------------
// placeRepository
// ---------------------------------------------------------------------------

export const placeRepository = {
  async list(): Promise<Array<PlaceRecord & { post_count: number }>> {
    const nameOrder = COLLATE_NOCASE ? `places.display_name ${COLLATE_NOCASE} ASC` : 'places.display_name ASC';
    const { rows } = await getDriver().query<PlaceRecord & { post_count: number }>(
      `SELECT places.*, COUNT(images.id)::int AS post_count
      FROM places
      INNER JOIN images ON images.place_id = places.id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      GROUP BY places.id
      ORDER BY post_count DESC, ${nameOrder}`
    );
    return rows;
  },

  async getBySlug(slug: string): Promise<PlaceRecord | undefined> {
    return getDriver().queryOne<PlaceRecord>('SELECT * FROM places WHERE slug = ?', [slug]);
  },

  async getByGeonamesId(geonamesId: number): Promise<PlaceRecord | undefined> {
    return getDriver().queryOne<PlaceRecord>('SELECT * FROM places WHERE geonames_id = ? LIMIT 1', [geonamesId]);
  },

  async getAllSlugs(): Promise<string[]> {
    const { rows } = await getDriver().query<{ slug: string }>('SELECT slug FROM places');
    return rows.map((row) => row.slug);
  },

  async upsertCity(input: UpsertCityPlaceInput): Promise<PlaceRecord> {
    const existing = await this.getByGeonamesId(input.geonamesId);
    if (existing) {
      await getDriver().execute(
        `UPDATE places
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
        WHERE id = ?`,
        [
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
        ]
      );
      return (await this.getById(existing.id)) as PlaceRecord;
    }

    await getDriver().execute(
      `INSERT INTO places (
        slug, display_name, kind, source, source_confidence, provider, provider_place_id,
        latitude, longitude, city_name, admin1_name, country_name, country_code,
        geonames_id, is_approximate, updated_at
      )
      VALUES (?, ?, 'city', 'offline_city', ?, 'geonames', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [
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
      ]
    );
    return (await this.getByGeonamesId(input.geonamesId)) as PlaceRecord;
  },

  async getById(id: number): Promise<PlaceRecord | undefined> {
    return getDriver().queryOne<PlaceRecord>('SELECT * FROM places WHERE id = ?', [id]);
  },

  async countVisibleImages(placeId: number, mediaType?: MediaType): Promise<number> {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    const params = mediaType ? [placeId, mediaType] : [placeId];
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE images.place_id = ? AND ${VISIBLE_IMAGE_WHERE_SQL}${mediaTypeClause}`,
      params
    );
    return Number(row?.count ?? 0);
  }
};

// ---------------------------------------------------------------------------
// imageRepository
// ---------------------------------------------------------------------------

export const imageRepository = {
  async getByRelativePath(relativePath: string): Promise<ImageRecord | undefined> {
    return getDriver().queryOne<ImageRecord>('SELECT * FROM images WHERE relative_path = ?', [relativePath]);
  },

  async getById(id: number): Promise<ImageRecord | undefined> {
    return getDriver().queryOne<ImageRecord>('SELECT * FROM images WHERE id = ?', [id]);
  },

  async upsert(input: UpsertImageInput): Promise<ImageRecord> {
    const driver = getDriver();
    const isPostgres = driver.dialect === 'postgres';
    const sql = isPostgres
      ? `INSERT INTO images (
          folder_id, asset_key, filename, extension, relative_path, absolute_path, file_size, width, height, display_orientation,
          media_type, mime_type, duration_ms, is_animated, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp, taken_at, taken_at_source, exif_json,
          thumbnail_path, preview_path, playback_strategy, is_deleted, deleted_at, is_trashed, trashed_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false, NULL, false, NULL, ?)
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
          updated_at = excluded.updated_at`
      : `INSERT INTO images (
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
          updated_at = excluded.updated_at`;

    await driver.execute(sql, [
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
    ]);
    return (await this.getByRelativePath(input.relativePath)) as ImageRecord;
  },

  async refreshIndexed(input: RefreshIndexedImageInput): Promise<ImageRecord> {
    await getDriver().execute(
      `UPDATE images
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
      WHERE relative_path = ?`,
      [
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
      ]
    );
    return (await this.getByRelativePath(input.relativePath)) as ImageRecord;
  },

  async markDeleted(relativePath: string): Promise<void> {
    const deletedAt = nowIso();
    await getDriver().execute(
      'UPDATE images SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE relative_path = ?',
      [deletedAt, deletedAt, relativePath]
    );
  },

  async markFolderImagesDeleted(folderId: number, activeRelativePaths: string[]): Promise<number> {
    const { rows } = await getDriver().query<{ relative_path: string }>(
      'SELECT relative_path FROM images WHERE folder_id = ? AND is_deleted = 0',
      [folderId]
    );
    const active = new Set(activeRelativePaths);
    let removedCount = 0;

    for (const row of rows) {
      if (!active.has(row.relative_path)) {
        await this.markDeleted(row.relative_path);
        removedCount += 1;
      }
    }

    return removedCount;
  },

  async markAllDeletedByFolder(folderId: number): Promise<number> {
    const deletedAt = nowIso();
    const result = await getDriver().execute(
      'UPDATE images SET is_deleted = 1, deleted_at = COALESCE(deleted_at, ?), updated_at = ? WHERE folder_id = ? AND is_deleted = 0',
      [deletedAt, deletedAt, folderId]
    );
    return result.rowCount;
  },

  async reactivate(relativePath: string): Promise<void> {
    await getDriver().execute(
      'UPDATE images SET is_deleted = 0, deleted_at = NULL, updated_at = ? WHERE relative_path = ?',
      [nowIso(), relativePath]
    );
  },

  async updateAssetKey(id: number, assetKey: string): Promise<void> {
    await getDriver().execute(
      'UPDATE images SET asset_key = ?, updated_at = ? WHERE id = ?',
      [assetKey, nowIso(), id]
    );
  },

  async updateDerivativePaths(id: number, thumbnailPath: string, previewPath: string): Promise<void> {
    await getDriver().execute(
      'UPDATE images SET thumbnail_path = ?, preview_path = ?, updated_at = ? WHERE id = ?',
      [thumbnailPath, previewPath, nowIso(), id]
    );
  },

  async updateCaption(id: number, caption: string | null): Promise<void> {
    await getDriver().execute(
      'UPDATE images SET caption = ?, updated_at = ? WHERE id = ?',
      [caption, nowIso(), id]
    );
  },

  async assignPlace(id: number, placeId: number | null): Promise<void> {
    await getDriver().execute(
      'UPDATE images SET place_id = ?, updated_at = ? WHERE id = ?',
      [placeId, nowIso(), id]
    );
  },

  async reconcileMove(input: ReconcileImageMoveInput): Promise<ImageRecord> {
    await getDriver().execute(
      `UPDATE images
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
      WHERE id = ?`,
      [
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
      ]
    );
    return (await this.getById(input.id)) as ImageRecord;
  },

  async moveToTrash(id: number, trashedAt = nowIso()): Promise<boolean> {
    const result = await getDriver().execute(
      `UPDATE images
      SET is_trashed = 1, trashed_at = ?, updated_at = ?
      WHERE id = ? AND is_deleted = 0 AND is_trashed = 0`,
      [trashedAt, nowIso(), id]
    );
    return result.rowCount > 0;
  },

  async restoreFromTrash(id: number): Promise<boolean> {
    const result = await getDriver().execute(
      `UPDATE images
      SET is_trashed = 0, trashed_at = NULL, updated_at = ?
      WHERE id = ? AND is_deleted = 0 AND is_trashed = 1`,
      [nowIso(), id]
    );
    return result.rowCount > 0;
  },

  async deleteById(id: number): Promise<boolean> {
    const result = await getDriver().execute('DELETE FROM images WHERE id = ?', [id]);
    return result.rowCount > 0;
  },

  async listFeed(offset: number, limit: number): Promise<FeedImage[]> {
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows;
  },

  async countFeed(): Promise<number> {
    return statsRepository.getMediaCount();
  },

  async countVisibleSearch(query: string): Promise<number> {
    const mediaSearch = buildMediaSearchSql(query);
    if (!mediaSearch) {
      return 0;
    }
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${mediaSearch.whereSql}`,
      mediaSearch.whereParams
    );
    return Number(row?.count ?? 0);
  },

  async listRecentCandidates(offset: number, limit: number): Promise<FeedImage[]> {
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows;
  },

  async countRediscover(cutoffTimestamp: number): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?`,
      [cutoffTimestamp]
    );
    return Number(row?.count ?? 0);
  },

  async listRediscoverCandidates(offset: number, limit: number, cutoffTimestamp: number): Promise<FeedImage[]> {
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      LEFT JOIN likes ON likes.image_id = images.id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
      ORDER BY
        CASE WHEN likes.image_id IS NULL THEN 0 ELSE 1 END DESC,
        ${EFFECTIVE_FEED_TIME_SQL} DESC,
        images.sort_timestamp DESC,
        images.id DESC
      LIMIT ? OFFSET ?`,
      [cutoffTimestamp, limit, offset]
    );
    return rows;
  },

  async listRandom(offset: number, limit: number, seed: number): Promise<FeedImage[]> {
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY ${RANDOM_HASH_ORDER_SQL}, images.id DESC
      LIMIT ? OFFSET ?`,
      [seed, limit, offset]
    );
    return rows;
  },

  async countVisibleVideos(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images
       INNER JOIN folders ON folders.id = images.folder_id
       WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND images.media_type = 'video'`
    );
    return Number(row?.count ?? 0);
  },

  async listVisibleVideoCandidates(limit: number): Promise<ReelCandidate[]> {
    const { rows } = await getDriver().query<ReelCandidate>(
      `SELECT
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
        ${getImageSavedSelectSql()},
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate,
        likes.created_at AS likedAt
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      LEFT JOIN places ON places.id = images.place_id
      LEFT JOIN likes ON likes.image_id = images.id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND images.media_type = 'video'
      ORDER BY images.sort_timestamp DESC, images.id DESC
      LIMIT ?`,
      [limit]
    );
    return rows;
  },

  async listVisibleSearch(query: string, offset: number, limit: number): Promise<FeedImage[]> {
    const mediaSearch = buildMediaSearchSql(query);
    if (!mediaSearch) {
      return [];
    }
    const { rows } = await getDriver().query<FeedImage>(
      `SELECT
        search_results.id,
        search_results.folderId,
        search_results.folderSlug,
        search_results.folderName,
        search_results.folderPath,
        search_results.filename,
        search_results.caption,
        search_results.width,
        search_results.height,
        search_results.mediaType,
        search_results.durationMs,
        search_results.isAnimated,
        search_results.thumbnailUrl,
        search_results.previewUrl,
        search_results.playbackStrategy,
        search_results.sortTimestamp,
        search_results.takenAt,
        search_results.isSaved,
        search_results.placeId,
        search_results.placeSlug,
        search_results.placeName,
        search_results.placeKind,
        search_results.placeIsApproximate
      FROM (
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
          ${getImageSavedSelectSql()},
          places.id AS placeId,
          places.slug AS placeSlug,
          places.display_name AS placeName,
          places.kind AS placeKind,
          places.is_approximate AS placeIsApproximate,
          (${mediaSearch.rankSql}) AS searchRank
        FROM images
        INNER JOIN folders ON folders.id = images.folder_id
        LEFT JOIN places ON places.id = images.place_id
        WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${mediaSearch.whereSql}
      ) AS search_results
      ORDER BY search_results.searchRank DESC, search_results.sortTimestamp DESC, search_results.id DESC
      LIMIT ? OFFSET ?`,
      [...mediaSearch.rankParams, ...mediaSearch.whereParams, limit, offset]
    );
    return rows;
  },

  async countByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number): Promise<number> {
    if (monthDayKeys.length === 0) {
      return 0;
    }
    const placeholders = monthDayKeys.map(() => '?').join(', ');
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM images
      WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}
        AND ${STRFTIME_MONTH_DAY(EFFECTIVE_FEED_TIME_SQL)} IN (${placeholders})
        AND ${STRFTIME_YEAR(EFFECTIVE_FEED_TIME_SQL)} < ?`,
      [...monthDayKeys, maxYearExclusive]
    );
    return Number(row?.count ?? 0);
  },

  async listByMonthDayKeys(monthDayKeys: string[], maxYearExclusive: number, offset: number, limit: number): Promise<FeedImage[]> {
    if (monthDayKeys.length === 0) {
      return [];
    }
    const placeholders = monthDayKeys.map(() => '?').join(', ');
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
        AND ${STRFTIME_MONTH_DAY(EFFECTIVE_FEED_TIME_SQL)} IN (${placeholders})
        AND ${STRFTIME_YEAR(EFFECTIVE_FEED_TIME_SQL)} < ?
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      [...monthDayKeys, maxYearExclusive, limit, offset]
    );
    return rows;
  },

  async countByEffectiveTimeRange(startTimestamp: number, endTimestamp: number): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM images
      WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}
        AND ${EFFECTIVE_FEED_TIME_SQL} BETWEEN ? AND ?`,
      [startTimestamp, endTimestamp]
    );
    return Number(row?.count ?? 0);
  },

  async listByEffectiveTimeRange(startTimestamp: number, endTimestamp: number, offset: number, limit: number): Promise<FeedImage[]> {
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
        AND ${EFFECTIVE_FEED_TIME_SQL} BETWEEN ? AND ?
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      [startTimestamp, endTimestamp, limit, offset]
    );
    return rows;
  },

  async listFolderImages(
    folderId: number,
    offset: number,
    limit: number,
    mediaType?: MediaType,
    order: FolderImageOrder = 'newest'
  ): Promise<FeedImage[]> {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    const orderBySql = getQualifiedFolderImageOrderSql(order);
    const params = mediaType ? [folderId, mediaType, limit, offset] : [folderId, limit, offset];
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE images.folder_id = ? AND ${VISIBLE_IMAGE_WHERE_SQL}${mediaTypeClause}
      ORDER BY ${orderBySql}
      LIMIT ? OFFSET ?`,
      params
    );
    return rows;
  },

  async listPlaceImages(placeId: number, offset: number, limit: number, mediaType?: MediaType): Promise<FeedImage[]> {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    const params = mediaType ? [placeId, mediaType, limit, offset] : [placeId, limit, offset];
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE images.place_id = ? AND ${VISIBLE_IMAGE_WHERE_SQL}${mediaTypeClause}
      ORDER BY images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      params
    );
    return rows;
  },

  async listStoryFolderImages(folderId: number, offset: number, limit: number, mediaType?: MediaType): Promise<FeedImage[]> {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    const params = mediaType ? [folderId, mediaType, limit, offset] : [folderId, limit, offset];
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE images.folder_id = ? AND ${STORY_IMAGE_WHERE_SQL}${mediaTypeClause}
      ORDER BY images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      params
    );
    return rows;
  },

  async listStoryCapsuleImagesByOwnerFolder(ownerFolderId: number, offset: number, limit: number, mediaType?: MediaType): Promise<FeedImage[]> {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    const params = mediaType ? [ownerFolderId, mediaType, limit, offset] : [ownerFolderId, limit, offset];
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      WHERE folders.story_owner_folder_id = ?
        AND folders.role = 'story_capsule'
        AND ${STORY_IMAGE_WHERE_SQL}${mediaTypeClause}
      ORDER BY ${EFFECTIVE_FEED_TIME_SQL} DESC, images.sort_timestamp DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      params
    );
    return rows;
  },

  async listTrashed(offset: number, limit: number): Promise<TrashImage[]> {
    const { rows } = await getDriver().query<TrashImage>(
      `SELECT
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
        ${getImageSavedSelectSql()},
        images.trashed_at AS trashedAt,
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      LEFT JOIN places ON places.id = images.place_id
      WHERE images.is_deleted = 0 AND images.is_trashed = 1
      ORDER BY images.trashed_at DESC, images.id DESC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows;
  },

  async countTrashed(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM images WHERE is_deleted = 0 AND is_trashed = 1'
    );
    return Number(row?.count ?? 0);
  },

  async countByFolder(folderId: number, mediaType?: MediaType): Promise<number> {
    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    const params = mediaType ? [folderId, mediaType] : [folderId];
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0${mediaTypeClause}`,
      params
    );
    return Number(row?.count ?? 0);
  },

  async countVisibleByFolder(folderId: number, mediaType?: MediaType): Promise<number> {
    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    const params = mediaType ? [folderId, mediaType] : [folderId];
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}${mediaTypeClause}`,
      params
    );
    return Number(row?.count ?? 0);
  },

  async countStoryMediaByFolder(folderId: number, mediaType?: MediaType): Promise<number> {
    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    const params = mediaType ? [folderId, mediaType] : [folderId];
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND ${STORY_IMAGE_WHERE_UNSCOPED_SQL}${mediaTypeClause}`,
      params
    );
    return Number(row?.count ?? 0);
  },

  async countStoryCapsuleMediaByOwnerFolder(ownerFolderId: number, mediaType?: MediaType): Promise<number> {
    const mediaTypeClause = mediaType ? ' AND images.media_type = ?' : '';
    const params = mediaType ? [ownerFolderId, mediaType] : [ownerFolderId];
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE folders.story_owner_folder_id = ?
        AND folders.role = 'story_capsule'
        AND ${STORY_IMAGE_WHERE_SQL}${mediaTypeClause}`,
      params
    );
    return Number(row?.count ?? 0);
  },

  async listActiveByFolder(folderId: number): Promise<ImageRecord[]> {
    const { rows } = await getDriver().query<ImageRecord>(
      'SELECT * FROM images WHERE folder_id = ? AND is_deleted = 0 ORDER BY id ASC',
      [folderId]
    );
    return rows;
  },

  async listActive(): Promise<ImageRecord[]> {
    const { rows } = await getDriver().query<ImageRecord>(
      'SELECT * FROM images WHERE is_deleted = 0 ORDER BY folder_id ASC, sort_timestamp DESC, id DESC'
    );
    return rows;
  },

  async refreshAbsolutePathsForGalleryRoot(galleryRoot: string): Promise<number> {
    const { rows } = await getDriver().query<Pick<ImageRecord, 'id' | 'relative_path' | 'absolute_path'>>(
      'SELECT id, relative_path, absolute_path FROM images WHERE is_deleted = 0 ORDER BY id ASC'
    );
    const updatedAt = nowIso();
    let refreshed = 0;

    for (const row of rows) {
      const nextAbsolutePath = safeJoin(galleryRoot, row.relative_path);
      if (normalizePath(row.absolute_path) === normalizePath(nextAbsolutePath)) {
        continue;
      }
      const result = await getDriver().execute(
        'UPDATE images SET absolute_path = ?, updated_at = ? WHERE id = ?',
        [nextAbsolutePath, updatedAt, row.id]
      );
      refreshed += result.rowCount;
    }

    return refreshed;
  },

  async listByIdRange(afterId: number, limit: number): Promise<ImageRecord[]> {
    const { rows } = await getDriver().query<ImageRecord>(
      'SELECT * FROM images WHERE id > ? ORDER BY id ASC LIMIT ?',
      [afterId, limit]
    );
    return rows;
  },

  async listWithExifForPlaceRebuild(afterId: number, limit: number): Promise<ImageRecord[]> {
    const { rows } = await getDriver().query<ImageRecord>(
      `SELECT *
      FROM images
      WHERE id > ? AND is_deleted = 0 AND exif_json IS NOT NULL
      ORDER BY id ASC
      LIMIT ?`,
      [afterId, limit]
    );
    return rows;
  },

  async countAll(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM images');
    return Number(row?.count ?? 0);
  },

  async countUpToId(id: number): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM images WHERE id <= ?',
      [id]
    );
    return Number(row?.count ?? 0);
  },

  async countMissingAssetKeys(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM images WHERE asset_key IS NULL OR asset_key = ''"
    );
    return Number(row?.count ?? 0);
  },

  async countPendingDerivativeMigrationRows(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM images
      WHERE asset_key IS NULL
        OR TRIM(asset_key) = ''
        OR LOWER(thumbnail_path) != LOWER(SUBSTR(TRIM(asset_key), 1, 2) || '/' || LOWER(TRIM(asset_key)) || '.webp')
        OR LOWER(preview_path) != LOWER(
          SUBSTR(TRIM(asset_key), 1, 2)
          || '/'
          || LOWER(TRIM(asset_key))
          || CASE WHEN media_type = 'video' THEN '.mp4' ELSE '.webp' END
        )`
    );
    return Number(row?.count ?? 0);
  },

  async countMissingTimestampMetadataByFolder(folderId: number): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0 AND (taken_at IS NULL OR taken_at_source IS NULL)',
      [folderId]
    );
    return Number(row?.count ?? 0);
  },

  async countMissingPlaybackStrategyByFolder(folderId: number): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      "SELECT COUNT(*) AS count FROM images WHERE folder_id = ? AND is_deleted = 0 AND media_type = 'video' AND (playback_strategy IS NULL OR playback_strategy = '')",
      [folderId]
    );
    return Number(row?.count ?? 0);
  },

  async countByTakenAtSource(source: TakenAtSource): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND taken_at_source = ?`,
      [source]
    );
    return Number(row?.count ?? 0);
  },

  async getLatestFolderImageId(folderId: number): Promise<number | null> {
    const row = await getDriver().queryOne<{ id: number }>(
      `SELECT id FROM images WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} ORDER BY sort_timestamp DESC, id DESC LIMIT 1`,
      [folderId]
    );
    return row?.id ?? null;
  },

  async getLatestStoryImageId(folderId: number): Promise<number | null> {
    const row = await getDriver().queryOne<{ id: number }>(
      `SELECT id FROM images WHERE folder_id = ? AND ${STORY_IMAGE_WHERE_UNSCOPED_SQL} ORDER BY sort_timestamp DESC, id DESC LIMIT 1`,
      [folderId]
    );
    return row?.id ?? null;
  },

  async getLatestEffectiveTimestampByFolder(folderId: number): Promise<number | null> {
    const row = await getDriver().queryOne<{ latestTimestamp: number | null }>(
      `SELECT MAX(COALESCE(taken_at, sort_timestamp)) AS latestTimestamp FROM images WHERE folder_id = ? AND ${STORY_IMAGE_WHERE_UNSCOPED_SQL}`,
      [folderId]
    );
    return row?.latestTimestamp ?? null;
  },

  async getExplicitCoverImageId(folderId: number): Promise<number | null> {
    const row = await getDriver().queryOne<{ id: number }>(
      `SELECT id
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
      LIMIT 1`,
      [folderId]
    );
    return row?.id ?? null;
  },

  async getImageDetail(
    id: number,
    mediaType?: MediaType,
    allowHiddenCover = false,
    folderImageOrder: FolderImageOrder = 'newest'
  ): Promise<ImageDetail | undefined> {
    const driver = getDriver();
    const whereClause = allowHiddenCover ? 'images.is_deleted = 0 AND images.is_trashed = 0' : VISIBLE_IMAGE_WHERE_SQL;
    const nextComparisonSql = folderImageOrder === 'oldest'
      ? '(sort_timestamp > ? OR (sort_timestamp = ? AND id > ?))'
      : '(sort_timestamp < ? OR (sort_timestamp = ? AND id < ?))';
    const previousComparisonSql = folderImageOrder === 'oldest'
      ? '(sort_timestamp < ? OR (sort_timestamp = ? AND id < ?))'
      : '(sort_timestamp > ? OR (sort_timestamp = ? AND id > ?))';
    const nextOrderSql = getUnscopedFolderImageOrderSql(folderImageOrder);
    const previousOrderSql = getUnscopedFolderImageOrderSql(folderImageOrder === 'oldest' ? 'newest' : 'oldest');

    const detail = await driver.queryOne<Omit<ImageDetail, 'nextImageId' | 'previousImageId' | 'exif'> & { originalUrl: string; exifJson: string | null }>(
      `SELECT
        images.id,
        images.folder_id AS folderId,
        folders.slug AS folderSlug,
        folders.name AS folderName,
        folders.folder_path AS folderPath,
        folders.avatar_image_id AS folderAvatarImageId,
        images.filename,
        images.caption AS caption,
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
        images.sort_timestamp AS sortTimestamp,
        images.taken_at AS takenAt,
        ${getImageSavedSelectSql()},
        places.id AS placeId,
        places.slug AS placeSlug,
        places.display_name AS placeName,
        places.kind AS placeKind,
        places.is_approximate AS placeIsApproximate
      FROM images
      INNER JOIN folders ON folders.id = images.folder_id
      LEFT JOIN places ON places.id = images.place_id
      WHERE images.id = ? AND ${whereClause}`,
      [id]
    );

    if (!detail || (mediaType && detail.mediaType !== mediaType)) {
      return undefined;
    }

    const mediaTypeClause = mediaType ? ' AND media_type = ?' : '';
    const nextParams = mediaType
      ? [detail.folderId, mediaType, detail.sortTimestamp, detail.sortTimestamp, detail.id]
      : [detail.folderId, detail.sortTimestamp, detail.sortTimestamp, detail.id];
    const prevParams = mediaType
      ? [detail.folderId, mediaType, detail.sortTimestamp, detail.sortTimestamp, detail.id]
      : [detail.folderId, detail.sortTimestamp, detail.sortTimestamp, detail.id];

    const [next, previous] = await Promise.all([
      driver.queryOne<{ id: number }>(
        `SELECT id
        FROM images
        WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}
          ${mediaTypeClause}
          AND ${nextComparisonSql}
        ORDER BY ${nextOrderSql}
        LIMIT 1`,
        nextParams
      ),
      driver.queryOne<{ id: number }>(
        `SELECT id
        FROM images
        WHERE folder_id = ? AND ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL}
          ${mediaTypeClause}
          AND ${previousComparisonSql}
        ORDER BY ${previousOrderSql}
        LIMIT 1`,
        prevParams
      )
    ]);

    return {
      ...detail,
      exif: null,
      nextImageId: next?.id ?? null,
      previousImageId: previous?.id ?? null
    };
  },

  async countDeleted(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      'SELECT COUNT(*) AS count FROM images WHERE is_deleted = 1'
    );
    return Number(row?.count ?? 0);
  },

  async listMoveCandidates(fileSize: number, mtimeMs: number, extension: string): Promise<ImageRecord[]> {
    const { rows } = await getDriver().query<ImageRecord>(
      `SELECT *
      FROM images
      WHERE file_size = ?
        AND ROUND(mtime_ms) = ?
        AND LOWER(extension) = LOWER(?)
        AND is_deleted = 0
        AND is_trashed = 0
      ORDER BY id ASC`,
      [fileSize, Math.round(mtimeMs), extension]
    );
    return rows;
  },

  async listSoftDeletedDerivativeCandidates(cutoffIso: string): Promise<Array<Pick<ImageRecord, 'id' | 'thumbnail_path' | 'preview_path'>>> {
    const { rows } = await getDriver().query<Pick<ImageRecord, 'id' | 'thumbnail_path' | 'preview_path'>>(
      `SELECT id, thumbnail_path, preview_path
      FROM images
      WHERE is_deleted = 1
        AND deleted_at IS NOT NULL
        AND deleted_at <= ?
      ORDER BY id ASC`,
      [cutoffIso]
    );
    return rows;
  },

  async listAllDerivativePaths(): Promise<Array<Pick<ImageRecord, 'thumbnail_path' | 'preview_path'>>> {
    const { rows } = await getDriver().query<Pick<ImageRecord, 'thumbnail_path' | 'preview_path'>>(
      'SELECT thumbnail_path, preview_path FROM images'
    );
    return rows;
  },

  async listDerivativeReferences(): Promise<Array<Pick<ImageRecord, 'thumbnail_path' | 'preview_path' | 'is_deleted' | 'deleted_at'>>> {
    const { rows } = await getDriver().query<Pick<ImageRecord, 'thumbnail_path' | 'preview_path' | 'is_deleted' | 'deleted_at'>>(
      'SELECT thumbnail_path, preview_path, is_deleted, deleted_at FROM images'
    );
    return rows;
  },

  async countByMediaType(mediaType: MediaType): Promise<number> {
    return mediaType === 'video'
      ? statsRepository.getVideoCount()
      : statsRepository.getMediaCount();
  },

  async countWithThumbnail(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND thumbnail_path IS NOT NULL`
    );
    return Number(row?.count ?? 0);
  },

  async countWithPreview(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count FROM images WHERE ${VISIBLE_IMAGE_WHERE_UNSCOPED_SQL} AND preview_path IS NOT NULL`
    );
    return Number(row?.count ?? 0);
  },

  async getByThumbnailPath(thumbnailPath: string): Promise<ImageRecord | undefined> {
    return getDriver().queryOne<ImageRecord>(
      'SELECT * FROM images WHERE thumbnail_path = ? AND is_deleted = 0 LIMIT 1',
      [thumbnailPath]
    );
  },

  async getByPreviewPath(previewPath: string): Promise<ImageRecord | undefined> {
    return getDriver().queryOne<ImageRecord>(
      'SELECT * FROM images WHERE preview_path = ? AND is_deleted = 0 LIMIT 1',
      [previewPath]
    );
  }
};

// ---------------------------------------------------------------------------
// likeRepository
// ---------------------------------------------------------------------------

export const likeRepository = {
  async getByImageId(imageId: number): Promise<LikeRecord | undefined> {
    return getDriver().queryOne<LikeRecord>('SELECT * FROM likes WHERE image_id = ?', [imageId]);
  },

  async listLikedIds(): Promise<number[]> {
    const { rows } = await getDriver().query<{ image_id: number }>(
      'SELECT image_id FROM likes ORDER BY created_at DESC'
    );
    return rows.map((r) => r.image_id);
  },

  async countLiked(): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM likes
       INNER JOIN images ON images.id = likes.image_id
       INNER JOIN folders ON folders.id = images.folder_id
       WHERE ${VISIBLE_IMAGE_WHERE_SQL}`
    );
    return Number(row?.count ?? 0);
  },

  async listLikedImages(offset: number, limit: number): Promise<FeedImage[]> {
    const { rows } = await getDriver().query<FeedImage>(
      `SELECT
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
        ${getImageSavedSelectSql()}
      FROM likes
      INNER JOIN images ON images.id = likes.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY likes.created_at DESC, likes.image_id DESC
      LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    return rows;
  },

  async countLikedOlderThan(cutoffTimestamp: number): Promise<number> {
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM likes
      INNER JOIN images ON images.id = likes.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?`,
      [cutoffTimestamp]
    );
    return Number(row?.count ?? 0);
  },

  async listLikedOlderThan(offset: number, limit: number, cutoffTimestamp: number): Promise<FeedImage[]> {
    const { rows } = await getDriver().query<FeedImage>(
      `SELECT
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
        ${getImageSavedSelectSql()}
      FROM likes
      INNER JOIN images ON images.id = likes.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE ${VISIBLE_IMAGE_WHERE_SQL} AND ${EFFECTIVE_FEED_TIME_SQL} <= ?
      ORDER BY likes.created_at DESC, likes.image_id DESC
      LIMIT ? OFFSET ?`,
      [cutoffTimestamp, limit, offset]
    );
    return rows;
  },

  async upsert(imageId: number): Promise<LikeRecord> {
    await getDriver().execute(
      `INSERT INTO likes (image_id, created_at)
      VALUES (?, ?)
      ON CONFLICT(image_id) DO UPDATE SET
        created_at = excluded.created_at`,
      [imageId, nowIso()]
    );
    return (await this.getByImageId(imageId)) as LikeRecord;
  },

  async remove(imageId: number): Promise<boolean> {
    const result = await getDriver().execute('DELETE FROM likes WHERE image_id = ?', [imageId]);
    return result.rowCount > 0;
  },

  async removeByFolder(folderId: number): Promise<number> {
    const result = await getDriver().execute(
      'DELETE FROM likes WHERE image_id IN (SELECT id FROM images WHERE folder_id = ?)',
      [folderId]
    );
    return result.rowCount;
  }
};

// ---------------------------------------------------------------------------
// collectionRepository
// ---------------------------------------------------------------------------

function getCollectionSummarySelectSql(): string {
  return `
  SELECT
    collections.*,
    (
      SELECT COUNT(*)
      FROM collection_items
      INNER JOIN images ON images.id = collection_items.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE collection_items.collection_id = collections.id AND ${VISIBLE_IMAGE_WHERE_SQL}
    ) AS item_count,
    (
      SELECT images.id
      FROM collection_items
      INNER JOIN images ON images.id = collection_items.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE collection_items.collection_id = collections.id AND ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY collection_items.created_at DESC, collection_items.image_id DESC
      LIMIT 1
    ) AS cover_image_id,
    (
      SELECT images.thumbnail_path
      FROM collection_items
      INNER JOIN images ON images.id = collection_items.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE collection_items.collection_id = collections.id AND ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY collection_items.created_at DESC, collection_items.image_id DESC
      LIMIT 1
    ) AS cover_thumbnail_path,
    (
      SELECT ${GROUP_CONCAT_FN('preview_images.image_id')}
      FROM (
        SELECT collection_items.image_id
        FROM collection_items
        INNER JOIN images ON images.id = collection_items.image_id
        INNER JOIN folders ON folders.id = images.folder_id
        WHERE collection_items.collection_id = collections.id AND ${VISIBLE_IMAGE_WHERE_SQL}
        ORDER BY collection_items.created_at DESC, collection_items.image_id DESC
        LIMIT 4
      ) AS preview_images
    ) AS preview_image_ids
`;
}

export const collectionRepository = {
  async ensureDefaultCollection(): Promise<CollectionRecord> {
    const driver = getDriver();
    const existingDefault = await driver.queryOne<CollectionRecord>(
      `SELECT * FROM collections WHERE is_default = ${BOOL_TRUE} LIMIT 1`
    );
    if (existingDefault) {
      if (existingDefault.name !== DEFAULT_COLLECTION_NAME) {
        await driver.execute(
          'UPDATE collections SET name = ?, updated_at = ? WHERE id = ?',
          [DEFAULT_COLLECTION_NAME, nowIso(), existingDefault.id]
        );
      }
      return (await this.getById(existingDefault.id)) as CollectionRecord;
    }

    const savedCollection = await this.getBySlug(DEFAULT_COLLECTION_SLUG);
    if (savedCollection) {
      await driver.execute(
        `UPDATE collections SET name = ?, is_default = ${BOOL_TRUE}, updated_at = ? WHERE id = ?`,
        [DEFAULT_COLLECTION_NAME, nowIso(), savedCollection.id]
      );
      return (await this.getById(savedCollection.id)) as CollectionRecord;
    }

    await driver.execute(
      `INSERT INTO collections (slug, name, is_default, created_at, updated_at) VALUES (?, ?, ${BOOL_TRUE}, ?, ?)`,
      [DEFAULT_COLLECTION_SLUG, DEFAULT_COLLECTION_NAME, nowIso(), nowIso()]
    );
    return (await this.getBySlug(DEFAULT_COLLECTION_SLUG)) as CollectionRecord;
  },

  async getById(id: number): Promise<CollectionRecord | undefined> {
    return getDriver().queryOne<CollectionRecord>('SELECT * FROM collections WHERE id = ?', [id]);
  },

  async getDefaultCollection(): Promise<CollectionRecord> {
    return this.ensureDefaultCollection();
  },

  async repairDefaultMemberships(): Promise<number> {
    const defaultCollection = await this.ensureDefaultCollection();
    const driver = getDriver();
    const timestamp = nowIso();
    const result = await driver.execute(
      `${INSERT_OR_IGNORE} INTO collection_items (collection_id, image_id, created_at)
      SELECT ?, custom_items.image_id, ?
      FROM collection_items AS custom_items
      INNER JOIN collections AS custom_collections ON custom_collections.id = custom_items.collection_id
      LEFT JOIN collection_items AS default_items
        ON default_items.collection_id = ? AND default_items.image_id = custom_items.image_id
      WHERE custom_collections.is_default = ${BOOL_FALSE}
        AND default_items.image_id IS NULL${INSERT_OR_IGNORE_SUFFIX}`,
      [defaultCollection.id, timestamp, defaultCollection.id]
    );
    const repairedCount = result.rowCount;
    if (repairedCount > 0) {
      await driver.execute(
        'UPDATE collections SET updated_at = ? WHERE id = ?',
        [timestamp, defaultCollection.id]
      );
    }
    return repairedCount;
  },

  async getBySlug(slug: string): Promise<CollectionRecord | undefined> {
    return getDriver().queryOne<CollectionRecord>('SELECT * FROM collections WHERE slug = ?', [slug]);
  },

  async create(name: string): Promise<CollectionRecord> {
    await this.ensureDefaultCollection();
    const driver = getDriver();
    const normalizedName = name.trim().toLocaleLowerCase();
    const existingName = await driver.queryOne<{ id: number }>(
      'SELECT id FROM collections WHERE LOWER(name) = ? LIMIT 1',
      [normalizedName]
    );
    if (existingName) {
      throw new Error('Collection name already exists.');
    }

    const { rows: slugRows } = await driver.query<{ slug: string }>('SELECT slug FROM collections');
    const existingSlugs = new Set(slugRows.map((row) => row.slug));
    const slug = resolveUniqueSlug(name, existingSlugs, slugifyFolderName);
    const timestamp = nowIso();

    await driver.execute(
      `INSERT INTO collections (slug, name, is_default, created_at, updated_at) VALUES (?, ?, ${BOOL_FALSE}, ?, ?)`,
      [slug, name, timestamp, timestamp]
    );
    return (await this.getBySlug(slug)) as CollectionRecord;
  },

  async updateName(slug: string, name: string): Promise<CollectionRecord | undefined> {
    await this.ensureDefaultCollection();
    const driver = getDriver();
    const collection = await this.getBySlug(slug);
    if (!collection || collection.is_default === 1) {
      return undefined;
    }

    const normalizedName = name.trim().toLocaleLowerCase();
    const existingName = await driver.queryOne<{ id: number }>(
      'SELECT id FROM collections WHERE LOWER(name) = ? AND id != ? LIMIT 1',
      [normalizedName, collection.id]
    );
    if (existingName) {
      throw new Error('Collection name already exists.');
    }

    await driver.execute(
      'UPDATE collections SET name = ?, updated_at = ? WHERE id = ?',
      [name.trim(), nowIso(), collection.id]
    );
    return this.getById(collection.id);
  },

  async delete(slug: string): Promise<CollectionRecord | undefined> {
    const collection = await this.getBySlug(slug);
    if (!collection || collection.is_default === 1) {
      return undefined;
    }
    await getDriver().execute('DELETE FROM collections WHERE id = ?', [collection.id]);
    return collection;
  },

  async listSummaries(): Promise<CollectionSummaryRecord[]> {
    await this.ensureDefaultCollection();
    const { rows } = await getDriver().query<CollectionSummaryRecord>(
      `${getCollectionSummarySelectSql()}
      FROM collections
      ORDER BY collections.is_default DESC, collections.updated_at DESC, collections.id DESC`
    );
    return rows;
  },

  async listMembershipsForImage(imageId: number): Promise<CollectionMembershipRecord[]> {
    await this.ensureDefaultCollection();
    const { rows } = await getDriver().query<CollectionMembershipRecord>(
      `${getCollectionSummarySelectSql()},
      CASE WHEN EXISTS (
        SELECT 1
        FROM collection_items
        WHERE collection_items.collection_id = collections.id
          AND collection_items.image_id = ?
      ) THEN 1 ELSE 0 END AS contains_image
      FROM collections
      ORDER BY collections.is_default DESC, collections.updated_at DESC, collections.id DESC`,
      [imageId]
    );
    return rows;
  },

  async listImages(slug: string, offset: number, limit: number): Promise<FeedImage[]> {
    await this.ensureDefaultCollection();
    const { rows } = await getDriver().query<FeedImage>(
      `${getFeedImageSelectSql()}
      INNER JOIN collection_items ON collection_items.image_id = images.id
      INNER JOIN collections ON collections.id = collection_items.collection_id
      WHERE collections.slug = ? AND ${VISIBLE_IMAGE_WHERE_SQL}
      ORDER BY collection_items.created_at DESC, collection_items.image_id DESC
      LIMIT ? OFFSET ?`,
      [slug, limit, offset]
    );
    return rows;
  },

  async countImages(slug: string): Promise<number> {
    await this.ensureDefaultCollection();
    const row = await getDriver().queryOne<{ count: number }>(
      `SELECT COUNT(*) AS count
      FROM collection_items
      INNER JOIN collections ON collections.id = collection_items.collection_id
      INNER JOIN images ON images.id = collection_items.image_id
      INNER JOIN folders ON folders.id = images.folder_id
      WHERE collections.slug = ? AND ${VISIBLE_IMAGE_WHERE_SQL}`,
      [slug]
    );
    return Number(row?.count ?? 0);
  },

  async isImageSaved(imageId: number): Promise<boolean> {
    await this.ensureDefaultCollection();
    const row = await getDriver().queryOne<{ found: number }>(
      `SELECT 1 AS found
      FROM collection_items
      INNER JOIN collections ON collections.id = collection_items.collection_id
      WHERE collections.is_default = ${BOOL_TRUE} AND collection_items.image_id = ?
      LIMIT 1`,
      [imageId]
    );
    return row?.found === 1;
  },

  async saveToDefault(imageId: number): Promise<CollectionRecord> {
    const defaultCollection = await this.ensureDefaultCollection();
    const driver = getDriver();
    const timestamp = nowIso();
    await driver.execute(
      `INSERT INTO collection_items (collection_id, image_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(collection_id, image_id) DO UPDATE SET
        created_at = excluded.created_at`,
      [defaultCollection.id, imageId, timestamp]
    );
    await driver.execute(
      'UPDATE collections SET updated_at = ? WHERE id = ?',
      [timestamp, defaultCollection.id]
    );
    return (await this.getById(defaultCollection.id)) as CollectionRecord;
  },

  async unsaveEverywhere(imageId: number): Promise<void> {
    const driver = getDriver();
    const timestamp = nowIso();
    await driver.execute(
      `UPDATE collections
      SET updated_at = ?
      WHERE id IN (
        SELECT collection_id
        FROM collection_items
        WHERE image_id = ?
      )`,
      [timestamp, imageId]
    );
    await driver.execute('DELETE FROM collection_items WHERE image_id = ?', [imageId]);
  },

  async addImage(collectionSlug: string, imageId: number): Promise<CollectionRecord | undefined> {
    const defaultCollection = await this.ensureDefaultCollection();
    const collection = await this.getBySlug(collectionSlug);
    if (!collection) {
      return undefined;
    }

    const driver = getDriver();
    const timestamp = nowIso();

    if (collection.id !== defaultCollection.id) {
      const defaultInsertResult = await driver.execute(
        `${INSERT_OR_IGNORE} INTO collection_items (collection_id, image_id, created_at)
        VALUES (?, ?, ?)${INSERT_OR_IGNORE_SUFFIX}`,
        [defaultCollection.id, imageId, timestamp]
      );
      if (defaultInsertResult.rowCount > 0) {
        await driver.execute(
          'UPDATE collections SET updated_at = ? WHERE id = ?',
          [timestamp, defaultCollection.id]
        );
      }
    }

    await driver.execute(
      `INSERT INTO collection_items (collection_id, image_id, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(collection_id, image_id) DO UPDATE SET
        created_at = excluded.created_at`,
      [collection.id, imageId, timestamp]
    );
    await driver.execute(
      'UPDATE collections SET updated_at = ? WHERE id = ?',
      [timestamp, collection.id]
    );
    return this.getById(collection.id);
  },

  async removeImage(collectionSlug: string, imageId: number): Promise<CollectionRecord | undefined> {
    await this.ensureDefaultCollection();
    const collection = await this.getBySlug(collectionSlug);
    if (!collection) {
      return undefined;
    }
    const driver = getDriver();
    await driver.execute(
      'DELETE FROM collection_items WHERE collection_id = ? AND image_id = ?',
      [collection.id, imageId]
    );
    await driver.execute(
      'UPDATE collections SET updated_at = ? WHERE id = ?',
      [nowIso(), collection.id]
    );
    return this.getById(collection.id);
  },

  async removeByFolder(folderId: number): Promise<number> {
    const result = await getDriver().execute(
      'DELETE FROM collection_items WHERE image_id IN (SELECT id FROM images WHERE folder_id = ?)',
      [folderId]
    );
    return result.rowCount;
  }
};

export const collectionConstants = {
  defaultCollectionSlug: DEFAULT_COLLECTION_SLUG,
  defaultCollectionName: DEFAULT_COLLECTION_NAME
} as const;

// ---------------------------------------------------------------------------
// appSettingsRepository
// ---------------------------------------------------------------------------

export const statsRepository = {
  async refresh(): Promise<void> {
    const driver = getDriver();
    const isPostgres = driver.dialect === 'postgres';
    const cast = isPostgres ? '::text' : '';
    await driver.execute(
      `INSERT INTO app_settings (key, value)
      VALUES
        ('stat.media_count', (SELECT COALESCE(SUM(image_count), 0)${cast} FROM folders WHERE role = 'normal')),
        ('stat.video_count', (SELECT COALESCE(SUM(video_count), 0)${cast} FROM folders WHERE role = 'normal')),
        ('stat.folder_count', (SELECT COUNT(*)${cast} FROM folders WHERE role = 'normal'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    );
  },

  async getMediaCount(): Promise<number> {
    const row = await getDriver().queryOne<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'stat.media_count'`
    );
    return row ? Number(row.value) : 0;
  },

  async getVideoCount(): Promise<number> {
    const row = await getDriver().queryOne<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'stat.video_count'`
    );
    return row ? Number(row.value) : 0;
  },

  async getFolderCount(): Promise<number> {
    const row = await getDriver().queryOne<{ value: string }>(
      `SELECT value FROM app_settings WHERE key = 'stat.folder_count'`
    );
    return row ? Number(row.value) : 0;
  }
};

export const appSettingsRepository = {
  async get(key: string): Promise<string | null> {
    const row = await getDriver().queryOne<Pick<AppSettingRecord, 'value'>>(
      'SELECT value FROM app_settings WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  },

  async set(key: string, value: string): Promise<void> {
    await getDriver().execute(
      `INSERT INTO app_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  },

  async remove(key: string): Promise<void> {
    await getDriver().execute('DELETE FROM app_settings WHERE key = ?', [key]);
  }
};

// ---------------------------------------------------------------------------
// maintenanceRepository
// ---------------------------------------------------------------------------

export const maintenanceRepository = {
  async resetLibraryIndex(): Promise<void> {
    const driver = getDriver();
    await driver.transaction(async (tx) => {
      await tx.execute('UPDATE folders SET avatar_image_id = NULL');
      await tx.execute('DELETE FROM likes');
      await tx.execute('DELETE FROM images');
      await tx.execute('DELETE FROM folders');
      await tx.execute('DELETE FROM folder_scan_state');
      await tx.execute('DELETE FROM scan_runs');
      if (tx.dialect === 'sqlite') {
        await tx.execute("DELETE FROM sqlite_sequence WHERE name IN ('folders', 'images', 'scan_runs')");
      } else {
        await tx.execute('ALTER SEQUENCE folders_id_seq RESTART');
        await tx.execute('ALTER SEQUENCE images_id_seq RESTART');
        await tx.execute('ALTER SEQUENCE scan_runs_id_seq RESTART');
      }
    });
  }
};

// ---------------------------------------------------------------------------
// folderScanStateRepository
// ---------------------------------------------------------------------------

export const folderScanStateRepository = {
  async getAll(): Promise<FolderScanStateRecord[]> {
    const { rows } = await getDriver().query<FolderScanStateRecord>(
      'SELECT * FROM folder_scan_state ORDER BY folder_path ASC'
    );
    return rows;
  },

  async upsert(input: UpsertFolderScanStateInput): Promise<void> {
    const normalizedFolderPath = normalizePath(input.folderPath);
    await getDriver().execute(
      `INSERT INTO folder_scan_state (folder_path, signature, file_count, max_mtime_ms, total_size, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(folder_path) DO UPDATE SET
        signature = excluded.signature,
        file_count = excluded.file_count,
        max_mtime_ms = excluded.max_mtime_ms,
        total_size = excluded.total_size,
        updated_at = excluded.updated_at`,
      [normalizedFolderPath, input.signature, input.fileCount, input.maxMtimeMs, input.totalSize, nowIso()]
    );
  },

  async delete(folderPath: string): Promise<number> {
    const result = await getDriver().execute(
      'DELETE FROM folder_scan_state WHERE folder_path = ?',
      [normalizePath(folderPath)]
    );
    return result.rowCount;
  },

  async deleteTree(folderPath: string): Promise<number> {
    const normalizedFolderPath = normalizePath(folderPath);
    const result = await getDriver().execute(
      'DELETE FROM folder_scan_state WHERE folder_path = ? OR folder_path LIKE ?',
      [normalizedFolderPath, `${normalizedFolderPath}/%`]
    );
    return result.rowCount;
  },

  async deleteMissing(activeFolderPaths: string[]): Promise<number> {
    if (activeFolderPaths.length === 0) {
      const result = await getDriver().execute('DELETE FROM folder_scan_state');
      return result.rowCount;
    }

    const normalizedFolderPaths = activeFolderPaths.map((folderPath) => normalizePath(folderPath));
    const placeholders = normalizedFolderPaths.map(() => '?').join(', ');
    const result = await getDriver().execute(
      `DELETE FROM folder_scan_state WHERE folder_path NOT IN (${placeholders})`,
      normalizedFolderPaths
    );
    return result.rowCount;
  }
};

// ---------------------------------------------------------------------------
// scanRunRepository
// ---------------------------------------------------------------------------

export const scanRunRepository = {
  async start(): Promise<number> {
    const driver = getDriver();
    const startedAt = nowIso();
    if (driver.dialect === 'postgres') {
      const result = await driver.execute(
        'INSERT INTO scan_runs (started_at, status, scanned_files, new_files, updated_files, removed_files) VALUES (?, ?, 0, 0, 0, 0) RETURNING id',
        [startedAt, 'running']
      );
      return Number(result.rows[0].id);
    }
    const result = await driver.execute(
      'INSERT INTO scan_runs (started_at, status, scanned_files, new_files, updated_files, removed_files) VALUES (?, ?, 0, 0, 0, 0)',
      [startedAt, 'running']
    );
    return Number(result.lastInsertId);
  },

  async finish(runId: number, input: Omit<ScanRunRecord, 'id' | 'started_at'>): Promise<void> {
    await getDriver().execute(
      `UPDATE scan_runs
      SET finished_at = ?, status = ?, scanned_files = ?, new_files = ?, updated_files = ?, removed_files = ?, error_text = ?
      WHERE id = ?`,
      [input.finished_at, input.status, input.scanned_files, input.new_files, input.updated_files, input.removed_files, input.error_text, runId]
    );
  },

  async latest(): Promise<ScanRunRecord | undefined> {
    return getDriver().queryOne<ScanRunRecord>('SELECT * FROM scan_runs ORDER BY id DESC LIMIT 1');
  },

  async latestCompleted(): Promise<ScanRunRecord | undefined> {
    return getDriver().queryOne<ScanRunRecord>(
      'SELECT * FROM scan_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1'
    );
  }
};
