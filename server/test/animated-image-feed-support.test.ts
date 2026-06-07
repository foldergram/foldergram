import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type DatabaseModule = typeof import('../src/db/database.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

describe.sequential('animated image feed support', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let galleryService: GalleryServiceModule['galleryService'];
  let databaseManager: DatabaseModule['databaseManager'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-animated-feed-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ databaseManager } = await import('../src/db/database.js'));
    ({maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await maintenanceRepository.resetLibraryIndex();
    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('marks animated images for feed consumers and backfills the flag on a later scan', async () => {
    const relativePath = 'albums/animated-post.webp';
    const sourcePath = path.join(appConfig.galleryRoot, relativePath);

    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await createAnimatedWebp(sourcePath);

    await scannerService.scanAll('manual');

    const firstFeedItem = (await galleryService.getFeed(1, 10, 'recent')).items[0];
    expect(firstFeedItem?.isAnimated).toBe(true);
    expect(firstFeedItem?.previewUrl).toMatch(/^\/previews\/[a-f0-9]{2}\/[a-f0-9]{32}\.webp\?v=\d+$/);

    const firstDetail = firstFeedItem ? await galleryService.getImageDetail(firstFeedItem.id, 'image') : null;
    expect(firstDetail?.isAnimated).toBe(true);

    await (await databaseManager.getConnection()).exec('UPDATE images SET is_animated = NULL');

    await scannerService.scanAll('manual');

    const refreshedFeedItem = (await galleryService.getFeed(1, 10, 'recent')).items[0];
    expect(refreshedFeedItem?.isAnimated).toBe(true);
  });
});

async function createAnimatedWebp(filePath: string): Promise<void> {
  const firstFrame = await sharp({
    create: {
      width: 24,
      height: 12,
      channels: 4,
      background: { r: 255, g: 88, b: 88, alpha: 1 }
    }
  })
    .png()
    .toBuffer();
  const secondFrame = await sharp({
    create: {
      width: 24,
      height: 12,
      channels: 4,
      background: { r: 88, g: 128, b: 255, alpha: 1 }
    }
  })
    .png()
    .toBuffer();

  await sharp([firstFrame, secondFrame], { join: { animated: true } })
    .webp({ effort: 4, delay: [120, 120], loop: 0 })
    .toFile(filePath);
}
