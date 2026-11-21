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
