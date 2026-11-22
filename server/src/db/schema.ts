export const schemaSql = `
PRAGMA foreign_keys = ON;

CREATE TABLE local_hls_windows (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  image_id INTEGER NOT NULL,
  revision TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  reserved_bytes INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('encoding', 'ready')),
  accessed_at INTEGER NOT NULL,
  UNIQUE (root, cache_key)
);
CREATE INDEX idx_hls_windows_access ON local_hls_windows (root, accessed_at);

CREATE TABLE video_preview_reclamation (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_video_preview_reclamation_created ON video_preview_reclamation (created_at);

CREATE TABLE video_preview_reclamation_items (
  job_id TEXT NOT NULL REFERENCES video_preview_reclamation(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL,
  revision TEXT NOT NULL,
  preview_path TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  reason TEXT,
  pending_bytes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, image_id)
);


CREATE TABLE media_sources (
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
CREATE UNIQUE INDEX idx_sources_environment ON media_sources(kind) WHERE managed_by = 'environment';

CREATE TABLE IF NOT EXISTS folders (
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

CREATE TABLE IF NOT EXISTS images (
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
  video_delivery_policy TEXT CHECK (video_delivery_policy IN ('legacy', 'streaming', 'previews')),
  video_metadata_json TEXT,
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

CREATE TABLE IF NOT EXISTS posts (
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

CREATE TABLE IF NOT EXISTS post_items (
  post_id INTEGER NOT NULL,
  image_id INTEGER NOT NULL UNIQUE,
  position INTEGER NOT NULL,
  PRIMARY KEY (post_id, position),
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
  CHECK (position >= 1 AND position <= 20)
);

CREATE TABLE IF NOT EXISTS places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  source_confidence REAL NULL,
  provider TEXT NULL,
  provider_place_id TEXT NULL,
  latitude REAL NULL,
  longitude REAL NULL,
  city_name TEXT NULL,
  admin1_name TEXT NULL,
  country_name TEXT NULL,
  country_code TEXT NULL,
  geonames_id INTEGER NULL,
  is_approximate INTEGER NOT NULL DEFAULT 1,
  name_override TEXT NULL,
  description TEXT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT NULL,
  status TEXT NOT NULL,
  scanned_files INTEGER NOT NULL DEFAULT 0,
  new_files INTEGER NOT NULL DEFAULT 0,
  updated_files INTEGER NOT NULL DEFAULT 0,
  removed_files INTEGER NOT NULL DEFAULT 0,
  error_text TEXT NULL,
  warning_count INTEGER NOT NULL DEFAULT 0,
  warning_text TEXT NULL,
  source_id INTEGER REFERENCES media_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folder_scan_state (
  folder_path TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES media_sources(id) ON DELETE CASCADE,
  signature TEXT NOT NULL,
  file_count INTEGER NOT NULL,
  max_mtime_ms REAL NOT NULL,
  total_size INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (source_id, folder_path)
);

CREATE TABLE IF NOT EXISTS likes (
  post_id INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL,
  post_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection_id, post_id),
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
  FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folder_share_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  folder_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NULL,
  expires_at TEXT NULL,
  revoked_at TEXT NULL,
  allow_original_downloads INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at TEXT NULL,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS folder_share_passwords (
  folder_id INTEGER PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_post_items_image_id ON post_items(image_id);
CREATE INDEX IF NOT EXISTS idx_post_items_post_id ON post_items(post_id, position);

CREATE INDEX IF NOT EXISTS idx_places_slug ON places(slug);
CREATE INDEX IF NOT EXISTS idx_places_display_name ON places(display_name);
CREATE INDEX IF NOT EXISTS idx_places_geonames_id ON places(geonames_id);
CREATE INDEX IF NOT EXISTS idx_folder_scan_state_updated_at ON folder_scan_state(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_likes_created_at ON likes(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_single_default ON collections(is_default) WHERE is_default = 1;
CREATE INDEX IF NOT EXISTS idx_collections_updated_at ON collections(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_collection_items_post ON collection_items(post_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_created ON collection_items(collection_id, created_at DESC, post_id DESC);
CREATE INDEX IF NOT EXISTS idx_folder_share_links_folder_id ON folder_share_links(folder_id);
CREATE INDEX IF NOT EXISTS idx_folder_share_links_expires_at ON folder_share_links(expires_at);

CREATE UNIQUE INDEX idx_images_remote_identity ON images(source_id, external_asset_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX idx_folders_remote_identity ON folders(source_id, external_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_posts_source ON posts(source_id);
CREATE INDEX idx_images_source ON images(source_id);
CREATE INDEX idx_images_thumbnail_path ON images(thumbnail_path);
CREATE INDEX idx_images_preview_path ON images(preview_path);
CREATE TABLE folder_media_memberships (
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(folder_id, image_id)
);
CREATE INDEX idx_memberships_image ON folder_media_memberships(image_id, folder_id);

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
`;
