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

import { postRepository } from './media.js';

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
        images.file_size AS fileSize,
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
        images.file_size AS fileSize,
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
        images.file_size AS fileSize,
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
        images.file_size AS fileSize,
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
