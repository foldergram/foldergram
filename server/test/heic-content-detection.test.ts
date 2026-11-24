import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { heicFixture } from './fixtures/heic.js';
import { requestTestApp } from './http-test-utils.js';

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

function ftyp(major: string, compatible: string[]): Buffer {
  const size = 16 + compatible.length * 4;
  const box = Buffer.alloc(size + 8);
  box.writeUInt32BE(size, 0);
  box.write('ftyp', 4, 'latin1');
  box.write(major, 8, 'latin1');
  compatible.forEach((brand, index) => box.write(brand, 16 + index * 4, 'latin1'));
  return box;
}

describe('HEIC header detection', () => {
  it('recognizes HEIC brands and rejects AVIF, sequences, and malformed boxes', async () => {
    const { isHeicHeader, readFtypBrands } = await import('../src/utils/image-utils.js');
    expect(readFtypBrands(heicFixture)).toEqual(['heic', 'mif1', 'heic', 'miaf']);
    expect(isHeicHeader(heicFixture)).toBe(true);
    expect(isHeicHeader(ftyp('mif1', ['mif1', 'heic']))).toBe(true);
    expect(isHeicHeader(ftyp('heix', ['mif1']))).toBe(true);

    expect(isHeicHeader(ftyp('avif', ['mif1', 'miaf']))).toBe(false);
    expect(isHeicHeader(ftyp('mif1', ['mif1', 'miaf']))).toBe(false);
    expect(isHeicHeader(ftyp('mif1', ['avif', 'mif1']))).toBe(false);
    expect(isHeicHeader(ftyp('msf1', ['msf1', 'heic']))).toBe(false);
    expect(isHeicHeader(ftyp('hevc', ['hevc', 'heic']))).toBe(false);

    const jpeg = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).jpeg().toBuffer();
    expect(isHeicHeader(jpeg)).toBe(false);
    expect(isHeicHeader(heicFixture.subarray(0, 12))).toBe(false);
    const tooSmall = Buffer.from(heicFixture);
    tooSmall.writeUInt32BE(8, 0);
    expect(isHeicHeader(tooSmall)).toBe(false);
    const largeSize = Buffer.from(heicFixture);
    largeSize.writeUInt32BE(1, 0);
    expect(isHeicHeader(largeSize)).toBe(false);
    // A brand past the declared box size belongs to the next box.
    const shortBox = ftyp('mif1', ['mif1', 'heic']);
    shortBox.writeUInt32BE(20, 0);
    expect(isHeicHeader(shortBox)).toBe(false);
    const oversized = ftyp('heic', ['mif1']);
    oversized.writeUInt32BE(4096, 0);
    expect(isHeicHeader(oversized)).toBe(false);
    const unaligned = ftyp('heic', ['mif1']);
    unaligned.writeUInt32BE(21, 0);
    expect(isHeicHeader(unaligned)).toBe(false);
    const beyondWorkerLimit = Buffer.alloc(4100);
    beyondWorkerLimit.writeUInt32BE(4100, 0);
    beyondWorkerLimit.write('ftypheic', 4, 'ascii');
    expect(isHeicHeader(beyondWorkerLimit)).toBe(false);
  });

  it('reads only a bounded header and reports unreadable files as not HEIC', async () => {
    const { hasHeicContent } = await import('../src/utils/image-utils.js');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-heic-header-'));
    try {
      const heic = path.join(directory, 'IMG_0001.HEIC.jpeg');
      await fs.writeFile(heic, heicFixture);
      expect(await hasHeicContent(heic)).toBe(true);
      expect(await hasHeicContent(path.join(directory, 'missing.jpeg'))).toBe(false);
      const empty = path.join(directory, 'empty.jpeg');
      await fs.writeFile(empty, '');
      expect(await hasHeicContent(empty)).toBe(false);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  it('reads a complete 4096-byte file type box and rejects a truncated one', async () => {
    const { hasHeicContent } = await import('../src/utils/image-utils.js');
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-heic-header-limit-'));
    try {
      const original = path.join(directory, 'photo.jpeg');
      const brands = Array.from({ length: 1020 }, (_, index) => index === 1019 ? 'heic' : 'zzzz');
      const header = ftyp('mif1', brands).subarray(0, 4096);
      await fs.writeFile(original, header);
      expect(await hasHeicContent(original)).toBe(true);

      await fs.writeFile(original, header.subarray(0, 4092));
      expect(await hasHeicContent(original)).toBe(false);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

describe('HEIC content behind a JPEG extension', () => {
  let root: string;
  let gallery: string;
  let app: ReturnType<typeof import('../src/app.js')['createApp']>;
  let scanner: typeof import('../src/services/scanner-service.js')['scannerService'];
  let db: typeof import('../src/db/database.js')['databaseManager'];
  const request = (method: string, url: string) => requestTestApp(app, method, url, { 'x-foldergram-intent': '1' });

  async function start(mode: 'eager' | 'lazy', heicImports: boolean) {
    vi.stubEnv('DERIVATIVE_MODE', mode);
    vi.resetModules();
    ({ databaseManager: db } = await import('../src/db/database.js'));
    ({ scannerService: scanner } = await import('../src/services/scanner-service.js'));
    const { appConfig } = await import('../src/config/env.js');
    appConfig.heicEnabledOverride = heicImports;
    appConfig.imageDetailSource = 'original';
    app = (await import('../src/app.js')).createApp();
    return appConfig;
  }

  type Row = { id: number; filename: string; mime_type: string; width: number; height: number; thumbnail_path: string; preview_path: string };
  const rowByFilename = (filename: string) =>
    db.connection.prepare('SELECT * FROM images WHERE filename = ?').get(filename) as Row | undefined;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-heic-content-'));
    gallery = path.join(root, 'gallery');
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(root, 'data'));
    vi.stubEnv('GALLERY_ROOT', gallery);
    vi.stubEnv('DB_DIR', path.join(root, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(root, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(root, 'previews'));
    vi.stubEnv('HEIC_ENABLED', undefined);
    await fs.mkdir(path.join(gallery, 'Phone'), { recursive: true });
    await fs.writeFile(path.join(gallery, 'Phone', 'IMG_0001.HEIC.jpeg'), heicFixture);
    await sharp({ create: { width: 16, height: 12, channels: 3, background: '#123456' } })
      .jpeg()
      .toFile(path.join(gallery, 'Phone', 'IMG_0002.HEIC.jpeg'));
  });

  afterEach(async () => {
    db?.close();
    vi.unstubAllEnvs();
    await fs.rm(root, { recursive: true, force: true });
  });

  for (const mode of ['eager', 'lazy'] as const) {
    it(`indexes, renders, and downloads it as HEIC in ${mode} mode`, async () => {
      const appConfig = await start(mode, true);
      expect(await scanner.scanAll('fixture')).toMatchObject({ status: 'completed' });

      const heic = rowByFilename('IMG_0001.HEIC.jpeg')!;
      const jpeg = rowByFilename('IMG_0002.HEIC.jpeg')!;
      expect(heic).toMatchObject({ mime_type: 'image/heic', width: 96, height: 64 });
      expect(jpeg).toMatchObject({ mime_type: 'image/jpeg', width: 16, height: 12 });
      expect(await fs.readFile(path.join(gallery, 'Phone', 'IMG_0001.HEIC.jpeg'))).toEqual(heicFixture);

      const preview = path.join(appConfig.previewsDir, heic.preview_path);
      if (mode === 'lazy') await expect(fs.stat(preview)).rejects.toMatchObject({ code: 'ENOENT' });
      else expect((await fs.stat(preview)).size).toBeGreaterThan(0);

      const detail = await request('GET', `/api/images/${heic.id}`);
      expect(detail.status).toBe(200);
      const item = detail.body as { previewUrl: string; originalUrl: string; mimeType: string };
      expect(item.mimeType).toBe('image/heic');
      // IMAGE_DETAIL_SOURCE=original still views HEIC through the WebP preview.
      expect(item.previewUrl).toContain('/previews/');
      const rendered = await request('GET', item.previewUrl);
      expect(rendered.status).toBe(200);
      expect(await sharp(rendered.rawBody).metadata()).toMatchObject({ format: 'webp', width: 96, height: 64 });
      expect((await request('GET', `/api/images/${jpeg.id}`)).body).toMatchObject({ previewUrl: `/api/originals/${jpeg.id}` });

      const download = await request('GET', `${item.originalUrl}?download=1`);
      expect(download.status).toBe(200);
      expect(download.headers.get('content-type')).toBe('image/heic');
      expect(download.headers.get('content-disposition')).toContain('IMG_0001.HEIC.jpeg');
      expect(download.rawBody).toEqual(heicFixture);

      // A missing derivative is regenerated after a restart, and a rescan keeps the row.
      const thumbnail = path.join(appConfig.thumbnailsDir, heic.thumbnail_path);
      await fs.rm(thumbnail, { force: true });
      db.close();
      await start(mode, true);
      const regenerated = await request('GET', `/thumbnails/${heic.thumbnail_path}`);
      expect(regenerated.status).toBe(200);
      expect(await sharp(regenerated.rawBody).metadata()).toMatchObject({ format: 'webp', width: 96, height: 64 });
      expect(await scanner.scanAll('fixture')).toMatchObject({ status: 'completed' });
      expect(rowByFilename('IMG_0001.HEIC.jpeg')).toMatchObject({ id: heic.id, mime_type: 'image/heic' });
      expect(rowByFilename('IMG_0002.HEIC.jpeg')).toMatchObject({ id: jpeg.id, mime_type: 'image/jpeg' });
    }, 30_000);

    it(`indexes and renders HEIC with a 260-byte file type box in ${mode} mode`, async () => {
      const boxSize = 260;
      const originalBoxSize = heicFixture.readUInt32BE(0);
      const paddingSize = boxSize - originalBoxSize;
      const compatibleBrands = Buffer.alloc(paddingSize);
      for (let offset = 0; offset < paddingSize; offset += 4) {
        compatibleBrands.write('zzzz', offset, 'ascii');
      }
      const file = Buffer.concat([
        heicFixture.subarray(0, originalBoxSize),
        compatibleBrands,
        heicFixture.subarray(originalBoxSize)
      ]);
      file.writeUInt32BE(boxSize, 0);
      // This fixture has one iloc v0 item with a four-byte absolute base offset.
      // Move that offset with the image data when extending the file type box.
      const itemLocation = heicFixture.indexOf(Buffer.from('iloc'));
      file.writeUInt32BE(
        heicFixture.readUInt32BE(itemLocation + 16) + paddingSize,
        itemLocation + paddingSize + 16
      );
      const originalPath = path.join(gallery, 'Phone', 'IMG_0001.HEIC.jpeg');
      await fs.writeFile(originalPath, file);
      const { hasHeicContent } = await import('../src/utils/image-utils.js');
      expect(await hasHeicContent(originalPath)).toBe(true);

      await start(mode, true);
      expect((await scanner.scanAll('fixture'))?.status).toBe('completed');
      const heic = rowByFilename('IMG_0001.HEIC.jpeg')!;
      expect(heic).toMatchObject({ mime_type: 'image/heic', width: 96, height: 64 });
      const detail = await request('GET', `/api/images/${heic.id}`);
      expect(detail.status).toBe(200);
      const rendered = await request('GET', detail.body.previewUrl);
      expect(rendered.status).toBe(200);
      expect(await sharp(rendered.rawBody).metadata()).toMatchObject({ format: 'webp', width: 96, height: 64 });
      expect(await fs.readFile(originalPath)).toEqual(file);
    }, 30_000);
  }

  it('follows the HEIC import setting and keeps indexed photos when it is turned off', async () => {
    await start('eager', false);
    expect(await scanner.scanAll('fixture')).toMatchObject({ status: 'completed', error_text: null });
    expect(rowByFilename('IMG_0001.HEIC.jpeg')).toBeUndefined();
    expect(rowByFilename('IMG_0002.HEIC.jpeg')).toMatchObject({ mime_type: 'image/jpeg' });

    db.close();
    await start('eager', true);
    expect(await scanner.scanAll('fixture')).toMatchObject({ status: 'completed' });
    const heic = rowByFilename('IMG_0001.HEIC.jpeg')!;
    expect(heic).toMatchObject({ mime_type: 'image/heic' });

    db.close();
    await start('eager', false);
    expect(await scanner.scanAll('fixture')).toMatchObject({ status: 'completed' });
    expect(rowByFilename('IMG_0001.HEIC.jpeg')).toMatchObject({ id: heic.id, mime_type: 'image/heic' });
    expect(db.connection.prepare('SELECT is_deleted FROM images WHERE id = ?').get(heic.id)).toMatchObject({ is_deleted: 0 });
    expect((await request('GET', `/api/images/${heic.id}`)).status).toBe(200);
  }, 30_000);

  it.each(['eager', 'lazy'] as const)('repairs legacy JPEG-classified HEIC without replacing its identity in %s mode', async (mode) => {
    const appConfig = await start(mode, true);
    expect((await scanner.scanAll('fixture'))?.status).toBe('completed');
    const original = rowByFilename('IMG_0001.HEIC.jpeg')!;
    // Model an existing pre-fix database, including the old MIME and cache paths.
    db.connection.prepare("UPDATE images SET mime_type = 'image/jpeg' WHERE id = ?").run(original.id);
    const { HEIC_CONTENT_REPAIR_VERSION_SETTING_KEY } = await import('../src/constants/app-setting-keys.js');
    const { appSettingsRepository } = await import('../src/db/repositories.js');
    const sourceId = (db.connection.prepare('SELECT source_id FROM images WHERE id = ?').get(original.id) as { source_id: number }).source_id;
    appSettingsRepository.remove(`${HEIC_CONTENT_REPAIR_VERSION_SETTING_KEY}.${sourceId}`);

    expect((await scanner.scanAll('upgrade', { repairUnchangedDerivatives: false }))?.status).toBe('completed');
    const repaired = rowByFilename('IMG_0001.HEIC.jpeg')!;
    expect(repaired).toMatchObject({ id: original.id, mime_type: 'image/heic', width: 96, height: 64 });
    expect((await request('GET', `/api/images/${original.id}`)).body).toMatchObject({ mimeType: 'image/heic' });
    const previewUrl = (await request('GET', `/api/images/${original.id}`)).body as { previewUrl: string };
    expect((await request('GET', previewUrl.previewUrl)).status).toBe(200);
    expect(await sharp((await request('GET', previewUrl.previewUrl)).rawBody).metadata()).toMatchObject({ format: 'webp' });
    expect(appSettingsRepository.get(`${HEIC_CONTENT_REPAIR_VERSION_SETTING_KEY}.${sourceId}`)).toBe('1');
    expect((await scanner.scanAll('routine', { repairUnchangedDerivatives: false }))?.status).toBe('completed');
    expect(rowByFilename('IMG_0001.HEIC.jpeg')?.id).toBe(original.id);
  }, 30_000);

  it.each(['IMG_0001.HEIC.jpeg', 'photo.heic'] as const)('keeps %s identity after moving it with imports disabled', async (filename) => {
    if (filename === 'photo.heic') await fs.writeFile(path.join(gallery, 'Phone', filename), heicFixture);
    await start('eager', true);
    expect((await scanner.scanAll('fixture'))?.status).toBe('completed');
    const original = rowByFilename(filename)!;
    const { appConfig } = await import('../src/config/env.js');
    appConfig.heicEnabledOverride = false;
    await fs.mkdir(path.join(gallery, 'Moved'));
    await fs.rename(path.join(gallery, 'Phone', filename), path.join(gallery, 'Moved', filename));
    expect((await scanner.scanAll('move'))?.status).toBe('completed');
    const moved = db.connection.prepare('SELECT id, relative_path, is_deleted, mime_type FROM images WHERE id = ?').get(original.id);
    expect(moved).toMatchObject({ id: original.id, relative_path: `Moved/${filename}`, is_deleted: 0 });
    expect((await request('GET', `/api/images/${original.id}`)).status).toBe(200);
  }, 30_000);

  for (const scanKind of ['full', 'incremental'] as const) {
    it.each(['ignored.heic', 'ignored.HEIC.jpeg'])(`does not change story ownership for %s during ${scanKind} scanning with imports disabled`, async (filename) => {
      await fs.mkdir(path.join(gallery, 'Album', 'stories'), { recursive: true });
      await fs.copyFile(
        path.join(gallery, 'Phone', 'IMG_0002.HEIC.jpeg'),
        path.join(gallery, 'Album', 'stories', 'story.jpg')
      );
      await start('eager', false);
      const { galleryService } = await import('../src/services/gallery-service.js');
      expect((await scanner.scanAll('fixture'))?.status).toBe('completed');
      const original = galleryService.getFeed(1, 20, 'recent').items.find(item => item.filename === 'story.jpg');
      expect(original).toMatchObject({ folderPath: 'Album/stories' });

      const relativePath = `Album/${filename}`;
      await fs.writeFile(path.join(gallery, relativePath), heicFixture);
      const scan = scanKind === 'full'
        ? await scanner.scanAll('fixture')
        : await scanner.scanChangedPaths([relativePath], 'watcher');
      expect(scan?.status).toBe('completed');
      expect(rowByFilename(filename)).toBeUndefined();
      expect(galleryService.getFeed(1, 20, 'recent').items.find(item => item.filename === 'story.jpg'))
        .toMatchObject({ id: original!.id, folderPath: 'Album/stories' });
      expect(db.connection.prepare('SELECT role, story_owner_folder_id FROM folders WHERE folder_path = ?').get('Album/stories'))
        .toMatchObject({ role: 'normal', story_owner_folder_id: null });

      expect((await scanner.scanAll('routine', { repairUnchangedDerivatives: false }))?.status).toBe('completed');
      expect(galleryService.getFeed(1, 20, 'recent').items.find(item => item.filename === 'story.jpg')?.id).toBe(original!.id);
    }, 30_000);
  }

  it('keeps stories reserved for an indexed HEIC owner after imports are disabled', async () => {
    await fs.mkdir(path.join(gallery, 'Album', 'stories'), { recursive: true });
    await fs.copyFile(
      path.join(gallery, 'Phone', 'IMG_0002.HEIC.jpeg'),
      path.join(gallery, 'Album', 'stories', 'story.jpg')
    );
    await fs.writeFile(path.join(gallery, 'Album', 'photo.heic'), heicFixture);
    const appConfig = await start('eager', true);
    expect((await scanner.scanAll('fixture'))?.status).toBe('completed');
    const original = rowByFilename('photo.heic')!;
    appConfig.heicEnabledOverride = false;

    expect((await scanner.scanAll('fixture'))?.status).toBe('completed');
    const { galleryService } = await import('../src/services/gallery-service.js');
    expect(rowByFilename('photo.heic')).toMatchObject({ id: original.id });
    expect(galleryService.getFeed(1, 20, 'recent').items.some(item => item.filename === 'story.jpg')).toBe(false);
    expect(db.connection.prepare('SELECT role, story_owner_folder_id FROM folders WHERE folder_path = ?').get('Album/stories'))
      .toMatchObject({ role: 'story_root', story_owner_folder_id: expect.any(Number) });
  }, 30_000);

  it('does not confuse JPEG APP metadata with an invalid ftyp header', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#abcdef' } }).jpeg().toBuffer();
    const appLength = 0x6674;
    const app = Buffer.alloc(2 + appLength);
    app[0] = 0xff;
    app[1] = 0xef;
    app.writeUInt16BE(appLength, 2);
    app.write('ypheic', 4, 'ascii');
    const file = Buffer.concat([jpeg.subarray(0, 2), app, jpeg.subarray(2)]);
    expect((await sharp(file).metadata()).format).toBe('jpeg');
    await fs.writeFile(path.join(gallery, 'Phone', 'genuine.jpeg'), file);
    await start('eager', false);
    expect((await scanner.scanAll('fixture'))?.status).toBe('completed');
    expect(rowByFilename('genuine.jpeg')).toMatchObject({ mime_type: 'image/jpeg', width: 8, height: 8 });
  }, 30_000);

  it('does not treat an AVIF behind a JPEG extension as HEIC', async () => {
    await fs.rm(path.join(gallery, 'Phone', 'IMG_0001.HEIC.jpeg'));
    await sharp({ create: { width: 20, height: 10, channels: 3, background: '#654321' } })
      .avif()
      .toFile(path.join(gallery, 'Phone', 'IMG_0003.HEIC.jpeg'));
    await start('eager', true);
    await scanner.scanAll('fixture');
    expect(rowByFilename('IMG_0003.HEIC.jpeg')?.mime_type).not.toBe('image/heic');
  }, 30_000);
});
