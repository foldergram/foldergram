import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('scan media error mode', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-scan-media-errors-'));
  });

  beforeEach(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    generateThumbnailDerivativeMock.mockReset();
    generateDerivativesMock.mockReset();
    readMediaMetadataMock.mockReset();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SCAN_MEDIA_ERROR_MODE', 'fail');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);
    await maintenanceRepository.resetLibraryIndex();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('stops same-folder indexing after the first media error in strict mode', async () => {
    await fs.mkdir(path.join(appConfig.galleryRoot, 'album'), { recursive: true });
    await fs.writeFile(path.join(appConfig.galleryRoot, 'album', 'a-broken.jpg'), 'broken');
    await fs.writeFile(path.join(appConfig.galleryRoot, 'album', 'z-also-broken.jpg'), 'also-broken');
    readMediaMetadataMock.mockRejectedValue(new Error('metadata failed'));

    const lastScan = await scannerService.scanAll('manual', {
      repairUnchangedDerivatives: false
    });

    expect(lastScan?.status).toBe('failed');
    expect(lastScan?.error_text).toContain('metadata failed');
    expect(lastScan?.error_text).toContain('Full error report:');
    expect(readMediaMetadataMock).toHaveBeenCalledTimes(1);
    expect(generateDerivativesMock).not.toHaveBeenCalled();
  });
});
