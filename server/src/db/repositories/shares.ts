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

