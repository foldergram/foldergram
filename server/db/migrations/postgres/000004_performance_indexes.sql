-- migrate:up

-- Covers _fallback_av CTE: DISTINCT ON (folder_id) ORDER BY folder_id, sort_timestamp DESC, id DESC
-- Without this, PostgreSQL does an Incremental Sort over all visible images (~23k+ rows at scale),
-- adding ~5s per folder-list request at 14k folders.
CREATE INDEX IF NOT EXISTS idx_images_folder_avatar
  ON images (folder_id, sort_timestamp DESC, id DESC)
  WHERE is_deleted = false AND is_trashed = false;

-- Covers recent feed: ORDER BY sort_timestamp DESC, id DESC over all visible images.
-- Avoids full table scan + sort for /api/feed?mode=recent at large scale.
CREATE INDEX IF NOT EXISTS idx_images_visible_sort
  ON images (sort_timestamp DESC, id DESC)
  WHERE is_deleted = false AND is_trashed = false;

-- migrate:down
DROP INDEX IF EXISTS idx_images_folder_avatar;
DROP INDEX IF EXISTS idx_images_visible_sort;
