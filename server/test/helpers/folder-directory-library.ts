import type { DatabaseSync } from 'node:sqlite';

export function seedDirectory(db: DatabaseSync, folderCount: number, mediaCount: number) {
  const folder = db.prepare(`INSERT INTO folders (source_id, slug, name, folder_path) VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, ?, ?)`);
  const image = db.prepare(`INSERT INTO images (source_id,
    folder_id, filename, extension, relative_path, absolute_path, file_size, width, height,
    media_type, mime_type, checksum_or_fingerprint, mtime_ms, first_seen_at, sort_timestamp,
    thumbnail_path, preview_path
  ) VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, ?, '.jpg', ?, ?, 1024, 800, 600, ?, 'image/jpeg', ?, ?, '2026-01-01', ?, ?, ?)`);
  const post = db.prepare(`INSERT INTO posts (source_id, folder_id, source_path, post_type, sort_timestamp)
    VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, ?, 'single', ?)`);
  const item = db.prepare('INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)');
  db.exec('BEGIN');
  try {
    const ids: number[] = [];
    for (let index = 0; index < folderCount; index++) {
      const name = `Album ${String(index).padStart(5, '0')}`;
      ids.push(Number(folder.run(`album-${index}`, name, `archive/${index}`).lastInsertRowid));
    }
    for (let index = 0; index < mediaCount; index++) {
      const folderId = ids[index % folderCount];
      const relativePath = `archive/${index % folderCount}/${index}.jpg`;
      const timestamp = 1_770_000_000_000 + (index % 7); // Deliberate ties.
      const imageId = Number(image.run(folderId, `${index}.jpg`, relativePath, `/gallery/${relativePath}`,
        index % 5 === 0 ? 'video' : 'image', String(index), timestamp, timestamp,
        `${relativePath}.webp`, `${relativePath}.webp`).lastInsertRowid);
      const postId = Number(post.run(folderId, relativePath, timestamp).lastInsertRowid);
      item.run(postId, imageId);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
