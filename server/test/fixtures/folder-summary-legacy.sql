-- Frozen pre-Phase-5 query for result parity and repeatable before/after measurements.

  SELECT
    folders.*,
    (
      SELECT COUNT(*)
      FROM posts
      WHERE posts.folder_id = folders.id
        AND posts.is_deleted = 0
        AND posts.is_trashed = 0
    ) AS post_count,
    (
      SELECT COUNT(*)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id AND pi.position = 1
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
        AND NOT (
          img.folder_id = p.folder_id
          AND LOWER(img.filename) IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
        )
    ) AS image_count,
    (
      SELECT COUNT(*)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id AND pi.position = 1
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
        AND p.post_type = 'carousel'
        AND NOT (
          img.folder_id = p.folder_id
          AND LOWER(img.filename) IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
        )
    ) AS carousel_count,
    (
      SELECT COUNT(*)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id AND pi.position = 1
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
        AND p.post_type = 'single'
        AND img.media_type = 'video'
    ) AS video_count,
    (
      SELECT MAX(img.mtime_ms)
      FROM posts p
      JOIN post_items pi ON pi.post_id = p.id
      JOIN images img ON img.id = pi.image_id
      WHERE p.folder_id = folders.id
        AND p.is_deleted = 0
        AND p.is_trashed = 0
    ) AS latest_image_mtime_ms,
    CASE WHEN 
  EXISTS (
    SELECT 1
    FROM folders AS story_folders
    INNER JOIN images AS story_images ON story_images.folder_id = story_folders.id
    WHERE story_folders.story_owner_folder_id = folders.id
      AND story_folders.role IN ('story_root', 'story_capsule')
      AND story_images.is_deleted = 0
      AND story_images.is_trashed = 0
    LIMIT 1
  )
 THEN 1 ELSE 0 END AS has_avatar_story,
    
  COALESCE(
    (
  SELECT avatar_images.id
  FROM images AS avatar_images
  WHERE avatar_images.id = folders.avatar_image_id
    AND (
      avatar_images.folder_id = folders.id
      OR EXISTS (
        SELECT 1
        FROM folders AS avatar_source_folders
        WHERE avatar_source_folders.id = avatar_images.folder_id
          AND avatar_source_folders.role = 'carousel_source'
          AND avatar_source_folders.carousel_owner_folder_id = folders.id
      )
    )
    AND avatar_images.is_deleted = 0
    AND avatar_images.is_trashed = 0
  LIMIT 1
),
    (
  SELECT cover_images.id
  FROM images AS cover_images
  WHERE cover_images.folder_id = folders.id
    AND cover_images.is_deleted = 0
    AND cover_images.is_trashed = 0
    AND LOWER(cover_images.filename) IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  ORDER BY
    CASE LOWER(cover_images.filename)
      WHEN 'cover.jpg' THEN 1
      WHEN 'cover.jpeg' THEN 2
      WHEN 'cover.png' THEN 3
      WHEN 'cover.webp' THEN 4
      WHEN 'cover.avif' THEN 5
      WHEN 'cover.gif' THEN 6
      ELSE 7
    END,
    cover_images.id ASC
  LIMIT 1
),
    (
  SELECT pi.image_id
  FROM posts AS p
  JOIN post_items AS pi ON pi.post_id = p.id AND pi.position = 1
  JOIN images AS fallback_images ON fallback_images.id = pi.image_id
  WHERE p.folder_id = folders.id
    AND p.is_deleted = 0
    AND p.is_trashed = 0
  ORDER BY p.sort_timestamp DESC, p.id DESC
  LIMIT 1
)
  )
 AS summary_avatar_image_id,
    
  (
    SELECT thumbnail_path
    FROM images
    WHERE id = (
  COALESCE(
    (
  SELECT avatar_images.id
  FROM images AS avatar_images
  WHERE avatar_images.id = folders.avatar_image_id
    AND (
      avatar_images.folder_id = folders.id
      OR EXISTS (
        SELECT 1
        FROM folders AS avatar_source_folders
        WHERE avatar_source_folders.id = avatar_images.folder_id
          AND avatar_source_folders.role = 'carousel_source'
          AND avatar_source_folders.carousel_owner_folder_id = folders.id
      )
    )
    AND avatar_images.is_deleted = 0
    AND avatar_images.is_trashed = 0
  LIMIT 1
),
    (
  SELECT cover_images.id
  FROM images AS cover_images
  WHERE cover_images.folder_id = folders.id
    AND cover_images.is_deleted = 0
    AND cover_images.is_trashed = 0
    AND LOWER(cover_images.filename) IN ('cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp', 'cover.avif', 'cover.gif')
  ORDER BY
    CASE LOWER(cover_images.filename)
      WHEN 'cover.jpg' THEN 1
      WHEN 'cover.jpeg' THEN 2
      WHEN 'cover.png' THEN 3
      WHEN 'cover.webp' THEN 4
      WHEN 'cover.avif' THEN 5
      WHEN 'cover.gif' THEN 6
      ELSE 7
    END,
    cover_images.id ASC
  LIMIT 1
),
    (
  SELECT pi.image_id
  FROM posts AS p
  JOIN post_items AS pi ON pi.post_id = p.id AND pi.position = 1
  JOIN images AS fallback_images ON fallback_images.id = pi.image_id
  WHERE p.folder_id = folders.id
    AND p.is_deleted = 0
    AND p.is_trashed = 0
  ORDER BY p.sort_timestamp DESC, p.id DESC
  LIMIT 1
)
  )
)
    LIMIT 1
  )
 AS summary_avatar_thumbnail_path
  FROM folders

WHERE folders.role = 'normal'
