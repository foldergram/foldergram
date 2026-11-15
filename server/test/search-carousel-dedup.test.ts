import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type RepositoriesModule = typeof import('../src/db/repositories.js');
type DatabaseModule = typeof import('../src/db/database.js');

describe.sequential('search carousel deduplication (Issue 11)', () => {
  let tempRoot = '';
  let folderRepository: RepositoriesModule['folderRepository'];
  let postRepository: RepositoriesModule['postRepository'];
  let databaseManager: DatabaseModule['databaseManager'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-search-dedup-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    databaseManager?.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();

    ({ folderRepository, postRepository } = await import('../src/db/repositories.js'));
    ({ databaseManager } = await import('../src/db/database.js'));
  });

  afterAll(async () => {
    databaseManager?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('returns a carousel post only once when multiple slides match the search query', () => {
    const db = databaseManager.connection;
    const folder = folderRepository.upsert({
      name: 'Wild Animals',
      slug: 'wild-animals',
      folderPath: 'wild-animals',
      folderRole: 'general'
    });

    const carouselFolder = folderRepository.upsert({
      name: 'Lions',
      slug: 'wild-animals-carousels-lions',
      folderPath: 'wild-animals/carousels/Lions',
      folderRole: 'carousel_source',
      carouselOwnerFolderId: folder.id
    });

    const img1 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, '01-safari-lion.jpg', 'wild-animals/carousels/Lions/01-safari-lion.jpg', 1000, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp1', '2026-01-01', 't1', 'p1', 'jpg', '/abs/1')
      RETURNING id
    `).get(carouselFolder.id) as { id: number };

    const img2 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, '02-safari-cub.jpg', 'wild-animals/carousels/Lions/02-safari-cub.jpg', 1200, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp2', '2026-01-01', 't2', 'p2', 'jpg', '/abs/2')
      RETURNING id
    `).get(carouselFolder.id) as { id: number };

    const img3 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, '03-safari-hunt.jpg', 'wild-animals/carousels/Lions/03-safari-hunt.jpg', 1100, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp3', '2026-01-01', 't3', 'p3', 'jpg', '/abs/3')
      RETURNING id
    `).get(carouselFolder.id) as { id: number };

    const post = db.prepare(`
      INSERT INTO posts (source_id, folder_id, post_type, source_path, sort_timestamp, taken_at)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'carousel', 'wild-animals/carousels/Lions', 1000, '2026-01-01')
      RETURNING id
    `).get(folder.id) as { id: number };

    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`).run(post.id, img1.id);
    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 2)`).run(post.id, img2.id);
    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 3)`).run(post.id, img3.id);

    const count = postRepository.countVisibleSearch('safari');
    expect(count).toBe(1);

    const results = postRepository.listVisibleSearch('safari', 1, 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(post.id);
    expect(results[0].filename).toBe('01-safari-lion.jpg');
    expect(results[0].mediaItems).toHaveLength(3);

    const titleResults = postRepository.listVisibleSearch('Lions', 1, 10);
    expect(postRepository.countVisibleSearch('Lions')).toBe(1);
    expect(titleResults).toHaveLength(1);
    expect(titleResults[0].id).toBe(post.id);
  });

  it('matches a carousel when only a non-representative slide matches the search query', () => {
    const db = databaseManager.connection;
    const folder = folderRepository.upsert({
      name: 'Vacation',
      slug: 'vacation',
      folderPath: 'vacation',
      folderRole: 'general'
    });

    const carouselFolder = folderRepository.upsert({
      name: 'Beach',
      slug: 'vacation-carousels-beach',
      folderPath: 'vacation/carousels/Beach',
      folderRole: 'carousel_source',
      carouselOwnerFolderId: folder.id
    });

    const img1 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, '01-arrival.jpg', 'vacation/carousels/Beach/01-arrival.jpg', 1000, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp1', '2026-01-01', 't1', 'p1', 'jpg', '/abs/1')
      RETURNING id
    `).get(carouselFolder.id) as { id: number };

    const img2 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, '02-sunset-dolphin.jpg', 'vacation/carousels/Beach/02-sunset-dolphin.jpg', 1200, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp2', '2026-01-01', 't2', 'p2', 'jpg', '/abs/2')
      RETURNING id
    `).get(carouselFolder.id) as { id: number };

    const post = db.prepare(`
      INSERT INTO posts (source_id, folder_id, post_type, source_path, sort_timestamp, taken_at)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'carousel', 'vacation/carousels/Beach', 1000, '2026-01-01')
      RETURNING id
    `).get(folder.id) as { id: number };

    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`).run(post.id, img1.id);
    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 2)`).run(post.id, img2.id);

    const count = postRepository.countVisibleSearch('dolphin');
    expect(count).toBe(1);

    const results = postRepository.listVisibleSearch('dolphin', 1, 10);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(post.id);
    expect(results[0].filename).toBe('01-arrival.jpg');
  });

  it('paginates multi-slide carousels across page boundaries without duplicate or missing items', () => {
    const db = databaseManager.connection;
    const folder = folderRepository.upsert({
      name: 'Nature',
      slug: 'nature',
      folderPath: 'nature',
      folderRole: 'general'
    });

    for (let i = 1; i <= 3; i++) {
      const cFolder = folderRepository.upsert({
        name: `Nature Set ${i}`,
        slug: `nature-carousels-set-${i}`,
        folderPath: `nature/carousels/Set${i}`,
        folderRole: 'carousel_source',
        carouselOwnerFolderId: folder.id
      });

      const imgA = db.prepare(`
        INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
        VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'forest-a.jpg', ?, 1000, 1000, 'image', 'image/jpeg', 1080, 1080, ?, '2026-01-01', ?, '2026-01-01', 'ta', 'pa', 'jpg', '/abs/a')
        RETURNING id
      `).get(cFolder.id, `nature/carousels/Set${i}/forest-a.jpg`, i * 1000, `fpa${i}`) as { id: number };

      const imgB = db.prepare(`
        INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
        VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'forest-b.jpg', ?, 1000, 1000, 'image', 'image/jpeg', 1080, 1080, ?, '2026-01-01', ?, '2026-01-01', 'tb', 'pb', 'jpg', '/abs/b')
        RETURNING id
      `).get(cFolder.id, `nature/carousels/Set${i}/forest-b.jpg`, i * 1000, `fpb${i}`) as { id: number };

      const post = db.prepare(`
        INSERT INTO posts (source_id, folder_id, post_type, source_path, sort_timestamp, taken_at)
        VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'carousel', ?, ?, '2026-01-01')
        RETURNING id
      `).get(folder.id, `nature/carousels/Set${i}`, i * 1000) as { id: number };

      db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`).run(post.id, imgA.id);
      db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 2)`).run(post.id, imgB.id);
    }

    const total = postRepository.countVisibleSearch('forest');
    expect(total).toBe(3);

    const page1 = postRepository.listVisibleSearch('forest', 1, 2);
    expect(page1).toHaveLength(2);

    const page2 = postRepository.listVisibleSearch('forest', 2, 2);
    expect(page2).toHaveLength(1);

    const allIds = [...page1.map((p) => p.id), ...page2.map((p) => p.id)];
    expect(new Set(allIds).size).toBe(3);
  });

  it('breaks equal search ranks with sortTimestamp DESC, id DESC', () => {
    const db = databaseManager.connection;
    const folder = folderRepository.upsert({
      name: 'Landscape',
      slug: 'landscape',
      folderPath: 'landscape',
      folderRole: 'general'
    });

    const cFolder1 = folderRepository.upsert({
      name: 'Mountains 1',
      slug: 'landscape-carousels-mountains-1',
      folderPath: 'landscape/carousels/Mountains1',
      folderRole: 'carousel_source',
      carouselOwnerFolderId: folder.id
    });

    const cFolder2 = folderRepository.upsert({
      name: 'Mountains 2',
      slug: 'landscape-carousels-mountains-2',
      folderPath: 'landscape/carousels/Mountains2',
      folderRole: 'carousel_source',
      carouselOwnerFolderId: folder.id
    });

    const img1 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'mountain-peak.jpg', 'landscape/carousels/Mountains1/mountain-peak.jpg', 1000, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp1', '2026-01-01', 't1', 'p1', 'jpg', '/abs/1')
      RETURNING id
    `).get(cFolder1.id) as { id: number };

    const img2 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'mountain-peak.jpg', 'landscape/carousels/Mountains2/mountain-peak.jpg', 1000, 1000, 'image', 'image/jpeg', 1080, 1080, 2000, '2026-01-01', 'fp2', '2026-01-01', 't2', 'p2', 'jpg', '/abs/2')
      RETURNING id
    `).get(cFolder2.id) as { id: number };

    const post1 = db.prepare(`
      INSERT INTO posts (source_id, folder_id, post_type, source_path, sort_timestamp, taken_at)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'carousel', 'landscape/carousels/Mountains1', 1000, '2026-01-01')
      RETURNING id
    `).get(folder.id) as { id: number };

    const post2 = db.prepare(`
      INSERT INTO posts (source_id, folder_id, post_type, source_path, sort_timestamp, taken_at)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'carousel', 'landscape/carousels/Mountains2', 2000, '2026-01-01')
      RETURNING id
    `).get(folder.id) as { id: number };

    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`).run(post1.id, img1.id);
    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`).run(post2.id, img2.id);

    const results = postRepository.listVisibleSearch('mountain', 1, 10);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe(post2.id); // higher sortTimestamp first
    expect(results[1].id).toBe(post1.id);
  });

  it('ranks a carousel above another post when its non-representative slide has a higher search rank', () => {
    const db = databaseManager.connection;
    const folder = folderRepository.upsert({
      name: 'Animals',
      slug: 'animals',
      folderPath: 'animals',
      folderRole: 'general'
    });

    const carouselFolder = folderRepository.upsert({
      name: 'Wildlife',
      slug: 'animals-carousels-wildlife',
      folderPath: 'animals/carousels/Wildlife',
      folderRole: 'carousel_source',
      carouselOwnerFolderId: folder.id
    });

    // Single post (matches query "animals" on folder name only -> searchRank = 1)
    const singleImg = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'photo-zoo.jpg', 'animals/photo-zoo.jpg', 1000, 1000, 'image', 'image/jpeg', 1080, 1080, 2000, '2026-01-01', 'fp-single', '2026-01-01', 't-s', 'p-s', 'jpg', '/abs/s')
      RETURNING id
    `).get(folder.id) as { id: number };

    const singlePost = db.prepare(`
      INSERT INTO posts (source_id, folder_id, post_type, source_path, sort_timestamp, taken_at)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'single', 'animals/photo-zoo.jpg', 2000, '2026-01-01')
      RETURNING id
    `).get(folder.id) as { id: number };
    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`).run(singlePost.id, singleImg.id);

    // Carousel post with slide 1 (neutral filename) and slide 2 (exact filename match on "animals-tiger" -> searchRank = 100)
    const cImg1 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, '01-grass.jpg', 'animals/carousels/Wildlife/01-grass.jpg', 1000, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp-c1', '2026-01-01', 't-c1', 'p-c1', 'jpg', '/abs/c1')
      RETURNING id
    `).get(carouselFolder.id) as { id: number };

    const cImg2 = db.prepare(`
      INSERT INTO images (source_id, folder_id, filename, relative_path, file_size, mtime_ms, media_type, mime_type, width, height, sort_timestamp, taken_at, checksum_or_fingerprint, first_seen_at, thumbnail_path, preview_path, extension, absolute_path)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, '02-animals-tiger.jpg', 'animals/carousels/Wildlife/02-animals-tiger.jpg', 1000, 1000, 'image', 'image/jpeg', 1080, 1080, 1000, '2026-01-01', 'fp-c2', '2026-01-01', 't-c2', 'p-c2', 'jpg', '/abs/c2')
      RETURNING id
    `).get(carouselFolder.id) as { id: number };

    const carouselPost = db.prepare(`
      INSERT INTO posts (source_id, folder_id, post_type, source_path, sort_timestamp, taken_at)
      VALUES ((SELECT id FROM media_sources WHERE kind = 'local' AND managed_by = 'environment'), ?, 'carousel', 'animals/carousels/Wildlife', 1000, '2026-01-01')
      RETURNING id
    `).get(folder.id) as { id: number };
    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 1)`).run(carouselPost.id, cImg1.id);
    db.prepare(`INSERT INTO post_items (post_id, image_id, position) VALUES (?, ?, 2)`).run(carouselPost.id, cImg2.id);

    // Searching "animals" matches singlePost (score 1 for folder match) and carouselPost (score 100 for slide 2 filename match).
    const results = postRepository.listVisibleSearch('animals', 1, 10);
    expect(results).toHaveLength(2);
    // Carousel post has lower sortTimestamp (1000 vs 2000), but higher searchRank (100 vs 1) due to slide 2
    expect(results[0].id).toBe(carouselPost.id);
    expect(results[0].filename).toBe('01-grass.jpg'); // canonical cover is position 1
    expect(results[1].id).toBe(singlePost.id);
  });
});
