export const immichSchemaSql = `
CREATE TABLE media_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  server_url TEXT NOT NULL,
  api_key_ciphertext TEXT NOT NULL,
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
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_sources_environment ON media_sources(managed_by) WHERE managed_by = 'environment';
ALTER TABLE folders ADD COLUMN source_id INTEGER REFERENCES media_sources(id);
ALTER TABLE folders ADD COLUMN external_id TEXT;
ALTER TABLE folders ADD COLUMN remote_visible INTEGER NOT NULL DEFAULT 1;
ALTER TABLE folders ADD COLUMN metadata_override INTEGER NOT NULL DEFAULT 0;
ALTER TABLE images ADD COLUMN source_id INTEGER REFERENCES media_sources(id);
ALTER TABLE images ADD COLUMN external_asset_id TEXT;
ALTER TABLE images ADD COLUMN remote_version TEXT;
ALTER TABLE images ADD COLUMN sync_generation INTEGER;
ALTER TABLE posts ADD COLUMN source_id INTEGER REFERENCES media_sources(id);
CREATE UNIQUE INDEX idx_images_remote_identity ON images(source_id, external_asset_id) WHERE source_id IS NOT NULL;
CREATE UNIQUE INDEX idx_folders_remote_identity ON folders(source_id, external_id) WHERE source_id IS NOT NULL;
CREATE INDEX idx_posts_source ON posts(source_id);
CREATE INDEX idx_images_source ON images(source_id);
CREATE TABLE folder_media_memberships (
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  image_id INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(folder_id, image_id)
);
CREATE INDEX idx_memberships_image ON folder_media_memberships(image_id, folder_id);

`;
