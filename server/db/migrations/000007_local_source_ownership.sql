-- migrate:up
-- LOCAL_MULTI_LOCATION_GALLERIES_PLAN.md §4.3 requires a transactional constraint rebuild.
-- Verified on disposable fresh, pre-Immich, and mixed-source SQLite fixtures,
-- including rollback and retry after simulated interruption. This file is not a database invocation.
-- The migration connection disables foreign-key enforcement for table rebuilds.
PRAGMA legacy_alter_table = ON;

CREATE TEMP TABLE foldergram_source_sequences AS
SELECT name, seq FROM sqlite_sequence WHERE name IN ('media_sources', 'folders', 'images', 'posts');

CREATE TABLE new_media_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'immich' CHECK (kind IN ('local', 'immich')),
  server_url TEXT,
  api_key_ciphertext TEXT,
  managed_by TEXT NOT NULL DEFAULT 'settings',
  enabled INTEGER NOT NULL DEFAULT 1,
  config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',
  last_error TEXT,
  last_success TEXT,
  progress INTEGER NOT NULL DEFAULT 0,
  asset_count INTEGER NOT NULL DEFAULT 0,
  folder_count INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((kind = 'local' AND server_url IS NULL AND api_key_ciphertext IS NULL)
      OR (kind = 'immich' AND server_url IS NOT NULL AND api_key_ciphertext IS NOT NULL))
);
INSERT INTO new_media_sources (
  id, name, kind, server_url, api_key_ciphertext, managed_by, enabled, config_json, status,
  last_error, last_success, progress, asset_count, folder_count, generation, updated_at
)
SELECT id, name, 'immich', server_url, api_key_ciphertext, managed_by, enabled, config_json, status,
  last_error, last_success, progress, asset_count, folder_count, generation, updated_at
FROM media_sources;
-- Preserve the largest previous ID even if the highest source was removed.
UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM foldergram_source_sequences WHERE name = 'media_sources'), 0))
WHERE name = 'new_media_sources';
INSERT INTO sqlite_sequence(name, seq)
SELECT 'new_media_sources', seq FROM foldergram_source_sequences WHERE name = 'media_sources'
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'new_media_sources');
INSERT INTO new_media_sources (name, kind, managed_by, config_json)
VALUES ('Primary gallery', 'local', 'environment', '{}');

CREATE TABLE new_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  folder_path TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES media_sources(id),
  external_id TEXT,
  remote_visible INTEGER NOT NULL DEFAULT 1,
  metadata_override INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'normal',
  story_owner_folder_id INTEGER NULL,
  carousel_owner_folder_id INTEGER NULL,
  description TEXT NULL,
  avatar_image_id INTEGER NULL,
  avatar_source TEXT NOT NULL DEFAULT 'auto',
  share_password_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, folder_path),
  FOREIGN KEY (avatar_image_id) REFERENCES images(id),
  FOREIGN KEY (story_owner_folder_id) REFERENCES folders(id) ON DELETE SET NULL,
  FOREIGN KEY (carousel_owner_folder_id) REFERENCES folders(id) ON DELETE SET NULL
);
INSERT INTO new_folders (id, slug, name, folder_path, source_id, external_id, remote_visible, metadata_override, role, story_owner_folder_id, carousel_owner_folder_id, description, avatar_image_id, avatar_source, share_password_version, created_at, updated_at)
SELECT id, slug, name, folder_path, COALESCE(source_id, (SELECT id FROM new_media_sources WHERE kind = 'local' AND managed_by = 'environment')), external_id, remote_visible, metadata_override, role, story_owner_folder_id, carousel_owner_folder_id, description, avatar_image_id, avatar_source, share_password_version, created_at, updated_at
FROM folders;

CREATE TABLE new_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL,
  place_id INTEGER NULL,
  asset_key TEXT NULL,
  filename TEXT NOT NULL,
  extension TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES media_sources(id),
  external_asset_id TEXT,
  remote_version TEXT,
  sync_generation INTEGER,
  absolute_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  display_orientation INTEGER NULL,
  media_type TEXT NOT NULL DEFAULT 'image',
  mime_type TEXT NOT NULL,
  duration_ms REAL NULL,
  is_animated INTEGER NULL,
  checksum_or_fingerprint TEXT NOT NULL,
  mtime_ms REAL NOT NULL,
  first_seen_at TEXT NOT NULL,
  sort_timestamp INTEGER NOT NULL,
  taken_at INTEGER NULL,
  taken_at_source TEXT NULL,
  caption TEXT NULL,
  exif_json TEXT NULL,
  thumbnail_path TEXT NOT NULL,
  preview_path TEXT NOT NULL,
  playback_strategy TEXT NOT NULL DEFAULT 'preview',
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NULL,
  is_trashed INTEGER NOT NULL DEFAULT 0,
  trashed_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, relative_path),
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL
);
INSERT INTO new_images (id, folder_id, place_id, asset_key, filename, extension, relative_path, source_id, external_asset_id, remote_version, sync_generation, absolute_path, file_size, width, height, display_orientation, media_type, mime_type, duration_ms, is_animated, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp, taken_at, taken_at_source, caption, exif_json, thumbnail_path, preview_path, playback_strategy, is_deleted, deleted_at, is_trashed, trashed_at, created_at, updated_at)
SELECT id, folder_id, place_id, asset_key, filename, extension, relative_path, COALESCE(source_id, (SELECT id FROM new_media_sources WHERE kind = 'local' AND managed_by = 'environment')), external_asset_id, remote_version, sync_generation, absolute_path, file_size, width, height, display_orientation, media_type, mime_type, duration_ms, is_animated, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp, taken_at, taken_at_source, caption, exif_json, thumbnail_path, preview_path, playback_strategy, is_deleted, deleted_at, is_trashed, trashed_at, created_at, updated_at
FROM images;

CREATE TABLE new_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL,
  place_id INTEGER NULL,
  source_path TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES media_sources(id),
  post_type TEXT NOT NULL DEFAULT 'single',
  caption TEXT NULL,
  sort_timestamp INTEGER NOT NULL,
  taken_at INTEGER NULL,
  taken_at_source TEXT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT NULL,
  is_trashed INTEGER NOT NULL DEFAULT 0,
  trashed_at TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (source_id, source_path),
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE,
  FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE SET NULL,
  CHECK (post_type IN ('single', 'carousel'))
);
INSERT INTO new_posts (id, folder_id, place_id, source_path, source_id, post_type, caption, sort_timestamp, taken_at, taken_at_source, is_deleted, deleted_at, is_trashed, trashed_at, created_at, updated_at)
SELECT id, folder_id, place_id, source_path, COALESCE(source_id, (SELECT id FROM new_media_sources WHERE kind = 'local' AND managed_by = 'environment')), post_type, caption, sort_timestamp, taken_at, taken_at_source, is_deleted, deleted_at, is_trashed, trashed_at, created_at, updated_at
FROM posts;

CREATE TABLE new_folder_scan_state (
  folder_path TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  max_mtime_ms REAL NOT NULL,
  total_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, folder_path)
);
INSERT INTO new_folder_scan_state (folder_path, source_id, signature, file_count, max_mtime_ms, total_size, updated_at)
SELECT folder_path, (SELECT id FROM new_media_sources WHERE kind = 'local' AND managed_by = 'environment'), signature, file_count, max_mtime_ms, total_size, updated_at
FROM folder_scan_state;

DROP TABLE folder_scan_state;
DROP TABLE posts;
DROP TABLE images;
DROP TABLE folders;
DROP TABLE media_sources;
ALTER TABLE new_media_sources RENAME TO media_sources;
ALTER TABLE new_folders RENAME TO folders;
ALTER TABLE new_images RENAME TO images;
ALTER TABLE new_posts RENAME TO posts;
ALTER TABLE new_folder_scan_state RENAME TO folder_scan_state;
ALTER TABLE scan_runs ADD COLUMN source_id INTEGER REFERENCES media_sources(id) ON DELETE SET NULL;
UPDATE scan_runs SET source_id = (SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment');

UPDATE sqlite_sequence SET seq = MAX(seq, COALESCE((SELECT seq FROM foldergram_source_sequences WHERE name = sqlite_sequence.name), 0))
WHERE name IN ('folders', 'images', 'posts');
INSERT INTO sqlite_sequence(name, seq)
SELECT old.name, old.seq FROM foldergram_source_sequences AS old
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = old.name);
DROP TABLE foldergram_source_sequences;

CREATE UNIQUE INDEX idx_sources_environment ON media_sources(kind) WHERE managed_by = 'environment';
CREATE INDEX IF NOT EXISTS idx_folders_slug ON folders(slug);
CREATE INDEX IF NOT EXISTS idx_folders_role ON folders(role);
CREATE INDEX IF NOT EXISTS idx_folders_story_owner_role ON folders(story_owner_folder_id, role, folder_path COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_folders_carousel_owner ON folders(carousel_owner_folder_id);
CREATE INDEX IF NOT EXISTS idx_images_folder_id ON images(folder_id);
CREATE INDEX IF NOT EXISTS idx_images_place_id ON images(place_id);
CREATE INDEX IF NOT EXISTS idx_images_sort_timestamp ON images(sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_images_taken_at ON images(taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_taken_at_source ON images(is_deleted, taken_at_source);
CREATE INDEX IF NOT EXISTS idx_images_folder_sort ON images(folder_id, is_deleted, sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_images_folder_media_sort ON images(folder_id, media_type, is_deleted, sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_images_is_deleted ON images(is_deleted);
CREATE INDEX IF NOT EXISTS idx_images_media_type ON images(media_type, is_deleted, sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_images_visibility_flags ON images(is_deleted, is_trashed);
CREATE INDEX IF NOT EXISTS idx_images_taken_at_source_visibility ON images(is_deleted, is_trashed, taken_at_source);
CREATE INDEX IF NOT EXISTS idx_images_folder_visible_sort ON images(folder_id, is_deleted, is_trashed, sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_images_folder_media_visible_sort ON images(folder_id, media_type, is_deleted, is_trashed, sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_images_media_visible_sort ON images(media_type, is_deleted, is_trashed, sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_images_trashed_listing ON images(is_trashed, is_deleted, trashed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_images_relative_path ON images(relative_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_images_asset_key ON images(asset_key) WHERE asset_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_images_deleted_at ON images(deleted_at);
CREATE INDEX IF NOT EXISTS idx_posts_folder_visible_sort ON posts(folder_id, is_deleted, is_trashed, sort_timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_visible_sort ON posts(is_deleted, is_trashed, sort_timestamp DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_type_visibility ON posts(post_type, is_deleted, is_trashed);
CREATE INDEX IF NOT EXISTS idx_posts_place_visibility ON posts(place_id, is_deleted, is_trashed, sort_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_posts_source_path ON posts(source_path);
CREATE INDEX IF NOT EXISTS idx_posts_trashed_listing ON posts(is_trashed, is_deleted, trashed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_folder_scan_state_updated_at ON folder_scan_state(updated_at DESC);
CREATE UNIQUE INDEX idx_images_remote_identity ON images(source_id, external_asset_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX idx_folders_remote_identity ON folders(source_id, external_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_posts_source ON posts(source_id);
CREATE INDEX idx_images_source ON images(source_id);
CREATE INDEX idx_images_thumbnail_path ON images(thumbnail_path);
CREATE INDEX idx_images_preview_path ON images(preview_path);

CREATE TRIGGER folders_source_immutable BEFORE UPDATE OF source_id ON folders
WHEN NEW.source_id <> OLD.source_id
BEGIN SELECT RAISE(ABORT, 'Cannot change folder source'); END;

CREATE TRIGGER images_source_insert BEFORE INSERT ON images
WHEN NEW.source_id IS NOT (SELECT source_id FROM folders WHERE id = NEW.folder_id)
BEGIN SELECT RAISE(ABORT, 'Image source must match folder source'); END;

CREATE TRIGGER images_source_update BEFORE UPDATE OF folder_id, source_id ON images
WHEN NEW.source_id <> OLD.source_id OR NEW.source_id IS NOT (SELECT source_id FROM folders WHERE id = NEW.folder_id)
BEGIN SELECT RAISE(ABORT, 'Image source must match folder source'); END;

CREATE TRIGGER posts_source_insert BEFORE INSERT ON posts
WHEN NEW.source_id IS NOT (SELECT source_id FROM folders WHERE id = NEW.folder_id)
BEGIN SELECT RAISE(ABORT, 'Post source must match folder source'); END;

CREATE TRIGGER posts_source_update BEFORE UPDATE OF folder_id, source_id ON posts
WHEN NEW.source_id <> OLD.source_id OR NEW.source_id IS NOT (SELECT source_id FROM folders WHERE id = NEW.folder_id)
BEGIN SELECT RAISE(ABORT, 'Post source must match folder source'); END;

CREATE TRIGGER post_items_source_insert BEFORE INSERT ON post_items
WHEN (SELECT source_id FROM posts WHERE id = NEW.post_id) IS NOT (SELECT source_id FROM images WHERE id = NEW.image_id)
BEGIN SELECT RAISE(ABORT, 'Post and image must share a source'); END;

CREATE TRIGGER post_items_source_update BEFORE UPDATE OF post_id, image_id ON post_items
WHEN (SELECT source_id FROM posts WHERE id = NEW.post_id) IS NOT (SELECT source_id FROM images WHERE id = NEW.image_id)
BEGIN SELECT RAISE(ABORT, 'Post and image must share a source'); END;

CREATE TEMP TABLE foldergram_source_integrity(valid INTEGER CHECK (valid = 1));
INSERT INTO foldergram_source_integrity
SELECT CASE WHEN
  NOT EXISTS (SELECT 1 FROM pragma_foreign_key_check)
  AND NOT EXISTS (SELECT 1 FROM images JOIN folders ON folders.id = images.folder_id WHERE images.source_id <> folders.source_id)
  AND NOT EXISTS (SELECT 1 FROM posts JOIN folders ON folders.id = posts.folder_id WHERE posts.source_id <> folders.source_id)
  AND NOT EXISTS (SELECT 1 FROM post_items JOIN images ON images.id = post_items.image_id JOIN posts ON posts.id = post_items.post_id WHERE images.source_id <> posts.source_id)
THEN 1 ELSE 0 END;
DROP TABLE foldergram_source_integrity;
PRAGMA legacy_alter_table = OFF;

-- migrate:down
-- Restore the pre-upgrade database with its matching application version.
SELECT source_ownership_requires_backup_restore();
