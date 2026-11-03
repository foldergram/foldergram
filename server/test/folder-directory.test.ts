import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestTestApp } from './http-test-utils.js';
import { seedDirectory } from './helpers/folder-directory-library.js';

let databaseManager: typeof import('../src/db/database.js')['databaseManager'];

vi.mock('../src/services/storage-service.js', () => ({
  storageService: { getDatabasePath: () => ':memory:', getState: () => ({ libraryAvailable: true }) }
}));

const legacySql = `SELECT * FROM (${fs.readFileSync(new URL('./fixtures/folder-summary-legacy.sql', import.meta.url), 'utf8')})
  WHERE post_count > 0 OR summary_avatar_image_id IS NOT NULL
  ORDER BY latest_image_mtime_ms DESC, name COLLATE NOCASE ASC, folder_path COLLATE NOCASE ASC, id ASC`;
const sorts = ['recent-desc', 'images-desc', 'name-asc', 'name-desc', 'path-asc'] as const;

async function modules() {
  const { folderRepository } = await import('../src/db/repositories.js');
  const { galleryService } = await import('../src/services/gallery-service.js');
  return { folderRepository, galleryService };
}

let tempRoot = '';
beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'folder-directory-'));
  vi.stubEnv('NODE_ENV', 'test');
  for (const [key, directory] of Object.entries({ DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews' })) {
    const target = path.join(tempRoot, directory);
    fs.mkdirSync(target, { recursive: true });
    vi.stubEnv(key, target);
  }
});
beforeEach(async () => {
  vi.resetModules();
  ({ databaseManager } = await import('../src/db/database.js'));
  databaseManager.close();
});
afterAll(() => {
  databaseManager.close();
  vi.unstubAllEnvs();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('folder directory', () => {
  it('matches legacy counts, covers, stories, fallback ordering, and role visibility', async () => {
    seedDirectory(databaseManager.connection, 14, 56);
    const db = databaseManager.connection;
    db.exec(`
      UPDATE folders SET avatar_image_id = (SELECT MIN(id) FROM images WHERE folder_id = folders.id) WHERE id IN (1, 2, 3);
      UPDATE images SET is_deleted = 1 WHERE folder_id = 2;
      UPDATE posts SET is_deleted = 1 WHERE folder_id = 2;
      UPDATE images SET is_trashed = 1 WHERE folder_id = 3;
      UPDATE posts SET is_trashed = 1 WHERE folder_id = 3;
      UPDATE images SET filename = CASE WHEN id = 4 THEN 'COVER.PNG' ELSE 'cover.jpg' END WHERE folder_id = 4;
      UPDATE images SET filename = 'cover.webp', thumbnail_path = '' WHERE folder_id = 5;
      UPDATE folders SET role = 'story_root', story_owner_folder_id = 1 WHERE id = 6;
      UPDATE folders SET role = 'story_capsule', story_owner_folder_id = 1 WHERE id = 7;
      UPDATE folders SET role = 'carousel_source', carousel_owner_folder_id = 8 WHERE id = 9;
      UPDATE folders SET avatar_image_id = 9 WHERE id = 8;
      UPDATE folders SET avatar_image_id = 10 WHERE id = 11; -- Unrelated stored avatar is invalid.
      UPDATE posts SET post_type = 'carousel' WHERE folder_id = 8;
      DELETE FROM post_items WHERE image_id = 9;
      INSERT INTO post_items (post_id, image_id, position) VALUES (8, 9, 2);
      UPDATE images SET mtime_ms = 1800000000000 WHERE id = 9;
      UPDATE images SET is_deleted = 1 WHERE folder_id = 10;
      UPDATE posts SET is_deleted = 1 WHERE folder_id = 10;
      DELETE FROM post_items WHERE image_id = 14;
    `);
    const { folderRepository } = await modules();
    const prepare = vi.spyOn(db, 'prepare');
    expect(folderRepository.getAllSummaries()).toEqual(db.prepare(legacySql).all());
    const summarySql = prepare.mock.calls.find(([sql]) => sql.includes('WITH folder_candidates'))![0];
    prepare.mockRestore();
    const storyPlan = db.prepare(`EXPLAIN QUERY PLAN ${summarySql}`).all() as Array<{ detail: string }>;
    expect(storyPlan.find((row) => row.detail.includes('SEARCH story_images'))?.detail).toContain('folder_id=?');
    const selected = folderRepository.getSummaryBySlug('album-0');
    expect(selected).toEqual(folderRepository.getAllSummaries().find((folder) => folder.slug === 'album-0'));
    expect(selected?.has_avatar_story).toBe(1);
    expect(folderRepository.getSummaryBySlug('album-5')).toBeUndefined();
  });

  it.each(sorts)('pages %s without gaps or duplicates at ties', async (sort) => {
    seedDirectory(databaseManager.connection, 63, 126);
    const { folderRepository } = await modules();
    const all = folderRepository.listSummariesPage({ page: 1, limit: 200, sort });
    const pages = [1, 2, 3, 4].flatMap((page) => folderRepository.listSummariesPage({ page, limit: 20, sort }).items);
    expect(pages).toEqual(all.items);
    expect(new Set(pages.map((item) => item.id)).size).toBe(63);
    expect(all.total).toBe(63);
    expect(folderRepository.listSummariesPage({ page: 10, limit: 20, sort })).toEqual({ items: [], total: 63 });
  });

  it('searches beyond the first page, tokens across fields, breadcrumbs, and literal wildcards', async () => {
    seedDirectory(databaseManager.connection, 75, 75);
    const { folderRepository } = await modules();
    const page = (search: string) => folderRepository.listSummariesPage({ page: 1, limit: 5, sort: 'name-asc', search });
    expect(page('ALBUM 00074').items.map((item) => item.slug)).toEqual(['album-74']);
    expect(page('archive / 74').items.map((item) => item.slug)).toEqual(['album-74']);
    expect(page('00074 archive').total).toBe(1);
    databaseManager.connection.prepare('UPDATE folders SET name = ? WHERE id = 75').run('Été 旅');
    expect(page('ÉTÉ 旅').items.map((item) => item.slug)).toEqual(['album-74']);
    folderRepository.upsert({ name: 'Custom Parent', slug: 'archive', folderPath: 'archive' });
    expect(page('custom 旅').items.map((item) => item.slug)).toEqual(['album-74']);
    expect(page('%').total).toBe(0);
    expect(page('_').total).toBe(0);
    expect(page("' OR 1=1 --").total).toBe(0);
    expect(folderRepository.listSummariesPage({ page: 1, limit: 1, sort: 'name-asc', pathPrefix: 'archive/7' }).total).toBe(6);
  });

  it('batches parent display names and embeds feed folder metadata outside the bootstrap page', async () => {
    seedDirectory(databaseManager.connection, 70, 70);
    const { folderRepository, galleryService } = await modules();
    const parent = folderRepository.upsert({ name: 'Custom Archive', slug: 'archive', folderPath: 'archive' });
    const prepare = vi.spyOn(databaseManager.connection, 'prepare');
    const payload = galleryService.listFolderDirectory({ page: 1, limit: 50, sort: 'name-asc' });
    expect(payload.total).toBe(70);
    expect(payload.items.every((item) => item.parentFolderName === 'Custom Archive')).toBe(true);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('folder_path = ?'))).toHaveLength(0);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('json_each'))).toHaveLength(1);
    expect(prepare).toHaveBeenCalledTimes(3);
    expect(parent.name).toBe('Custom Archive');
    prepare.mockRestore();
    const feed = galleryService.getFeed(1, 24, 'recent');
    expect(feed.items.every((item) => Object.hasOwn(item, 'folderAvatarUrl') && Object.hasOwn(item, 'folderHasAvatarStory'))).toBe(true);
  });

  it('keeps the legacy HTTP shape and validates paginated requests', async () => {
    seedDirectory(databaseManager.connection, 65, 65);
    const { createApp } = await import('../src/app.js');
    const app = createApp();
    const legacy = await requestTestApp(app, 'GET', '/api/folders');
    expect(legacy.status).toBe(200);
    expect(Object.keys(legacy.body)).toEqual(['items']);
    expect(legacy.body.items).toHaveLength(65);
    const page = await requestTestApp(app, 'GET', '/api/folders?page=2&limit=24&sort=name-asc');
    expect(page.status).toBe(200);
    expect(page.body).toMatchObject({ page: 2, limit: 24, total: 65, hasMore: true });
    expect(page.body.items).toHaveLength(24);
    for (const query of ['page=0', 'page=1.5', 'limit=201', 'limit=0', 'sort=oops', 'q=' + 'x'.repeat(161), 'q=a&q=b', 'page=1e100']) {
      expect((await requestTestApp(app, 'GET', `/api/folders?${query}`)).status).toBe(400);
    }
  });
});

// Opt-in measurements are evidence, not hardware-dependent latency assertions.
describe.skipIf(process.env.FOLDER_DIRECTORY_BENCHMARK !== '1')('folder directory benchmark', () => {
  it.each([1500, 5000, 10000])('measures %i folders and 77,000 media records', async (folders) => {
    const { folderRepository, galleryService } = await modules();
    seedDirectory(databaseManager.connection, folders, 77000);
    const db = databaseManager.connection;
    db.exec('ANALYZE');
    const prepare = vi.spyOn(db, 'prepare');
    folderRepository.getAllSummaries();
    const summarySql = prepare.mock.calls.find(([sql]) => sql.includes('WITH folder_candidates'))![0];
    prepare.mockRestore();
    const measure = (label: string, operation: () => unknown) => {
      const times: number[] = [];
      let payload: unknown;
      for (let iteration = 0; iteration < 4; iteration++) {
        const start = performance.now();
        payload = operation();
        times.push(performance.now() - start);
      }
      const start = performance.now();
      const json = JSON.stringify(payload);
      return { label, firstRunMs: +times[0].toFixed(2), warmMedianMs: +times.slice(1).sort((a,b) => a-b)[1].toFixed(2),
        serializationMs: +(performance.now() - start).toFixed(2), bytes: Buffer.byteLength(json), rowsReturned: Array.isArray(payload) ? payload.length : (payload as {items: unknown[]}).items.length };
    };
    console.info('[folder-directory-benchmark]', JSON.stringify({ folders, media: 77000,
      results: [measure('legacy SQL', () => db.prepare(legacySql).all()), measure('summary SQL', () => folderRepository.getAllSummaries()),
        measure('unpaginated response', () => ({ items: galleryService.listFolders() })),
        measure('bootstrap response', () => galleryService.listFolderDirectory({ page: 1, limit: 24, sort: 'recent-desc' })),
        measure('search response', () => galleryService.listFolderDirectory({ page: 1, limit: 50, sort: 'name-asc', search: 'Album 00074' }))],
      legacyPlan: db.prepare(`EXPLAIN QUERY PLAN ${legacySql}`).all(),
      summaryPlan: db.prepare(`EXPLAIN QUERY PLAN ${summarySql}`).all()
    }));
    expect(folderRepository.listSummariesPage({ page: 1, limit: 24, sort: 'recent-desc' }).items).toHaveLength(24);
  }, 120000);
});
