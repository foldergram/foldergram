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
