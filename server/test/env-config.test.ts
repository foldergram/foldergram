import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type EnvModule = typeof import('../src/config/env.js');

describe.sequential('derivative mode env config', () => {
  let tempRoot = '';

  async function stubBaseEnv() {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  }

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-env-config-'));
  });

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('uses preview and eager defaults when the new env vars are unset', async () => {
    await stubBaseEnv();
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn()
      }
    }));

    const { appConfig } = await import('../src/config/env.js') as EnvModule;

    expect(appConfig.imageDetailSource).toBe('preview');
    expect(appConfig.derivativeMode).toBe('eager');
    expect(appConfig.scanMediaErrorMode).toBe('skip');
    expect(appConfig.scanErrorReportDir).toBe(path.join(tempRoot, 'data', 'scan-errors'));
    expect(appConfig.hlsCacheDir).toBe(path.join(tempRoot, 'data', 'hls-cache'));
    expect(appConfig.hlsCacheMaxAgeDays).toBe(7);
    expect(appConfig.hlsCacheMaxBytes).toBe(100 * 1024 * 1024 * 1024);
    expect(appConfig.galleryExcludedFolders).toEqual([]);
  });

  it('allows strict scan failure on media errors when requested', async () => {
    await stubBaseEnv();
    vi.stubEnv('SCAN_MEDIA_ERROR_MODE', 'fail');
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn()
      }
    }));

    const { appConfig } = await import('../src/config/env.js') as EnvModule;

    expect(appConfig.scanMediaErrorMode).toBe('fail');
  });

  it('parses excluded folder env rules with trimming and dedupe', async () => {
    await stubBaseEnv();
    vi.stubEnv('GALLERY_EXCLUDED_FOLDERS', ' @eaDir , thumbnails , Archive/cache , @eaDir ');
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn()
      }
    }));

    const { appConfig } = await import('../src/config/env.js') as EnvModule;

    expect(appConfig.galleryExcludedFolders).toEqual(['@eaDir', 'thumbnails', 'Archive/cache']);
  });

  it('rejects invalid enum values for derivative-related env vars', async () => {
    await stubBaseEnv();
    vi.stubEnv('IMAGE_DETAIL_SOURCE', 'fullres');
    vi.stubEnv('DERIVATIVE_MODE', 'background');
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn()
      }
    }));

    await expect(import('../src/config/env.js')).rejects.toThrow();
  });

  it('rejects invalid excluded folder env rules', async () => {
    await stubBaseEnv();
    vi.stubEnv('GALLERY_EXCLUDED_FOLDERS', '../outside,*/cache');
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn()
      }
    }));

    await expect(import('../src/config/env.js')).rejects.toThrow();
  });

  it('rejects an HLS cache directory that overlaps media derivatives', async () => {
    await stubBaseEnv();
    vi.stubEnv('HLS_CACHE_DIR', path.join(tempRoot, 'thumbnails'));
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn()
      }
    }));

    await expect(import('../src/config/env.js')).rejects.toThrow(/HLS_CACHE_DIR.*overlap/i);
  });

  it('rejects derivative directories that overlap scan error reports', async () => {
    await stubBaseEnv();
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'data'));
    vi.doMock('dotenv', () => ({
      default: {
        config: vi.fn()
      }
    }));

    await expect(import('../src/config/env.js')).rejects.toThrow(/scan error reports/i);
  });
});
