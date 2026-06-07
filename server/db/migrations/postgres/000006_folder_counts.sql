-- migrate:up
ALTER TABLE folders ADD COLUMN IF NOT EXISTS image_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS video_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN IF NOT EXISTS latest_image_mtime_ms BIGINT NULL DEFAULT NULL;

UPDATE folders
SET
  image_count = (
    SELECT COUNT(*) FROM images
    WHERE images.folder_id = folders.id
      AND images.is_deleted = false
      AND images.is_trashed = false
      AND LOWER(images.filename) NOT IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  ),
  video_count = (
    SELECT COUNT(*) FROM images
    WHERE images.folder_id = folders.id
      AND images.media_type = 'video'
      AND images.is_deleted = false
      AND images.is_trashed = false
      AND LOWER(images.filename) NOT IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  ),
  latest_image_mtime_ms = (
    SELECT MAX(images.mtime_ms) FROM images
    WHERE images.folder_id = folders.id
      AND images.is_deleted = false
      AND images.is_trashed = false
      AND LOWER(images.filename) NOT IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  );

-- migrate:down
ALTER TABLE folders DROP COLUMN IF EXISTS image_count;
ALTER TABLE folders DROP COLUMN IF EXISTS video_count;
ALTER TABLE folders DROP COLUMN IF EXISTS latest_image_mtime_ms;
