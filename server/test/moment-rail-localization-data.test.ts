import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];

describe.sequential('moment rail localization data', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-moment-rail-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({folderRepository, imageRepository, maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await maintenanceRepository.resetLibraryIndex();
    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
  });

  it('returns structured date metadata for date-driven moment capsules and feeds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-31T12:00:00.000Z'));

    try {
      await createExifIndexedFolder(
        'memories',
        Array.from({ length: 30 }, (_, index) => new Date(2025, 4, 31, 12, index).getTime())
      );

      const rail = await galleryService.listMoments();

      expect(rail.railKind).toBe('moments');
      expect(rail.items.find((capsule) => capsule.id === 'on-this-day')).toMatchObject({
        momentDate: {
          type: 'on-this-day',
          date: {
            year: 2026,
            month: 5,
            day: 31
          }
        }
      });
      expect(rail.items.find((capsule) => capsule.id === 'this-week-previous-years')).toMatchObject({
        momentDate: {
          type: 'this-week-previous-years',
          startDate: {
            year: 2026,
            month: 5,
            day: 24
          },
          endDate: {
            year: 2026,
            month: 6,
            day: 7
          }
        }
      });

      const fromLastYear = {
        type: 'from-last-year' as const,
        referenceDate: {
          year: 2025,
          month: 5,
          day: 31
        },
        startDate: {
          year: 2025,
          month: 4,
          day: 16
        },
        endDate: {
          year: 2025,
          month: 7,
          day: 15
        }
      };

      expect(rail.items.find((capsule) => capsule.id === 'from-last-year')).toMatchObject({
        momentDate: fromLastYear
      });
      expect((await galleryService.getMomentFeed('from-last-year', 1, 10))?.moment).toMatchObject({
        momentDate: fromLastYear
      });
    } finally {
      vi.useRealTimers();
    }
  });

  async function createExifIndexedFolder(relativeFolderPath: string, timestamps: number[]): Promise<{
    folder: FolderRecord;
  }> {
    const slug = relativeFolderPath.replaceAll('/', '-');
    const folderName = path.posix.basename(relativeFolderPath);
    const folder = await folderRepository.upsert({
      slug,
      name: folderName,
      folderPath: relativeFolderPath
    });

    for (const [index, capturedAt] of timestamps.entries()) {
      const filename = `photo-${String(index + 1).padStart(2, '0')}.jpg`;
      const relativePath = `${relativeFolderPath}/${filename}`;
      const absolutePath = path.join(appConfig.galleryRoot, relativePath);
      const extension = path.extname(filename).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);
      const thumbnailRelativePath = getThumbnailRelativePath(relativePath);
      const previewRelativePath = getPreviewRelativePath(relativePath, mediaType);
      const fileSize = 1_000 + index;

      const image = await imageRepository.upsert({
        folderId: folder.id,
        filename,
        extension,
        relativePath,
        absolutePath,
        fileSize,
        width: 1200,
        height: 800,
        mediaType,
        mimeType: getMimeTypeFromExtension(extension),
        durationMs: null,
        fingerprint: createFingerprint(relativePath, fileSize, capturedAt),
        mtimeMs: capturedAt,
        firstSeenAt: '2026-03-01T00:00:00.000Z',
        sortTimestamp: capturedAt,
        takenAt: capturedAt,
        takenAtSource: 'exif',
        exifJson: '{}',
        thumbnailPath: thumbnailRelativePath,
        previewPath: previewRelativePath
      });

      if (index === 0) {
        await folderRepository.setAvatar(folder.id, image.id);
      }
    }

    return { folder };
  }
});
