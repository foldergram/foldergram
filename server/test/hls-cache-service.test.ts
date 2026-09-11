import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type HlsCacheServiceModule = typeof import('../src/services/hls-cache-service.js');

describe.sequential('HLS cache cleanup', () => {
  let tempRoot = '';
  let service: HlsCacheServiceModule;
  let cacheDir = '';

  async function writeGroup(mediaId: string, quality: string, size: number, accessMs: number): Promise<string> {
    const groupPath = path.join(cacheDir, mediaId, quality);
    await fs.mkdir(groupPath, { recursive: true });
    await fs.writeFile(path.join(groupPath, 'segment-0.ts'), Buffer.alloc(size));
    await fs.utimes(groupPath, accessMs / 1000, accessMs / 1000);
    return groupPath;
  }

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-hls-cache-'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
    vi.stubEnv('HLS_CACHE_DIR', path.join(tempRoot, 'hls-cache'));
    vi.stubEnv('HLS_CACHE_MAX_AGE_DAYS', '7');
    vi.stubEnv('HLS_CACHE_MAX_BYTES', '10');
    vi.resetModules();
    service = await import('../src/services/hls-cache-service.js');
    cacheDir = path.join(tempRoot, 'hls-cache');
  });

  beforeEach(async () => {
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('removes a cache group unused for more than seven days', async () => {
    const now = Date.parse('2026-09-10T00:00:00.000Z');
    const expired = await writeGroup('1', '480p', 8, now - 8 * 24 * 60 * 60 * 1000);
    const retained = await writeGroup('2', '480p', 8, now - 24 * 60 * 60 * 1000);

    const summary = await service.cleanupHlsCache(now);

    expect(summary.expiredGroups).toBe(1);
    await expect(fs.stat(expired)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(retained)).resolves.toBeDefined();
  });

  it('evicts the least-recently-used group when the cache exceeds its byte limit', async () => {
    const now = Date.parse('2026-09-10T00:00:00.000Z');
    const oldest = await writeGroup('1', '480p', 8, now - 2 * 24 * 60 * 60 * 1000);
    const newest = await writeGroup('2', '480p', 8, now - 24 * 60 * 60 * 1000);

    const summary = await service.cleanupHlsCache(now);

    expect(summary.capacityGroups).toBe(1);
    expect(summary.remainingBytes).toBe(8);
    await expect(fs.stat(oldest)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(newest)).resolves.toBeDefined();
  });

  it('does not evict a group held by an in-progress transcode', async () => {
    const now = Date.parse('2026-09-10T00:00:00.000Z');
    const active = await writeGroup('1', '480p', 16, now - 8 * 24 * 60 * 60 * 1000);
    const release = service.acquireHlsCacheGroup(active);

    const summary = await service.cleanupHlsCache(now);

    expect(summary.deletedGroups).toBe(0);
    await expect(fs.stat(active)).resolves.toBeDefined();
    release();
  });
});
