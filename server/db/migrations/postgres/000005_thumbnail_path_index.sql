-- migrate:up
CREATE INDEX IF NOT EXISTS idx_images_thumbnail_path ON images(thumbnail_path) WHERE is_deleted = false;

-- migrate:down
DROP INDEX IF EXISTS idx_images_thumbnail_path;
