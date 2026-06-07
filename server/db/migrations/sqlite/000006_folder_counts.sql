-- migrate:up
ALTER TABLE folders ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN video_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN latest_image_mtime_ms INTEGER NULL DEFAULT NULL;

UPDATE folders
SET
  image_count = (
    SELECT COUNT(*) FROM images
    WHERE images.folder_id = folders.id
      AND images.is_deleted = 0
      AND images.is_trashed = 0
      AND LOWER(images.filename) NOT IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  ),
  video_count = (
    SELECT COUNT(*) FROM images
    WHERE images.folder_id = folders.id
      AND images.media_type = 'video'
      AND images.is_deleted = 0
      AND images.is_trashed = 0
      AND LOWER(images.filename) NOT IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  ),
  latest_image_mtime_ms = (
    SELECT MAX(images.mtime_ms) FROM images
    WHERE images.folder_id = folders.id
      AND images.is_deleted = 0
      AND images.is_trashed = 0
      AND LOWER(images.filename) NOT IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  );

-- migrate:down
-- SQLite does not support DROP COLUMN in all versions; columns left in place on rollback.
