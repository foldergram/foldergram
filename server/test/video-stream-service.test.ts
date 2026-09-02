import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

type VideoStreamServiceModule = typeof import('../src/services/video-stream-service.js');

describe.sequential('video stream service playlists', () => {
  let tempRoot = '';
  let service: VideoStreamServiceModule;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-video-stream-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));

    vi.resetModules();
    service = await import('../src/services/video-stream-service.js');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('derives the segment count from the indexed duration alone', () => {
    expect(service.getSegmentCount(null)).toBe(0);
    expect(service.getSegmentCount(0)).toBe(0);
    expect(service.getSegmentCount(1_000)).toBe(1);
    expect(service.getSegmentCount(16_000)).toBe(8);
    expect(service.getSegmentCount(16_400)).toBe(9);
  });

  it('builds a VOD media playlist whose final segment carries the remainder', () => {
    const playlist = service.buildMediaPlaylist(10_500);
    const lines = playlist.trim().split('\n');

    expect(lines[0]).toBe('#EXTM3U');
    expect(lines).toContain('#EXT-X-PLAYLIST-TYPE:VOD');
    expect(lines).toContain(`#EXT-X-TARGETDURATION:${service.HLS_SEGMENT_SECONDS}`);
    expect(lines.filter((line) => line.startsWith('segment-'))).toEqual([
      'segment-0.ts',
      'segment-1.ts',
      'segment-2.ts',
      'segment-3.ts',
      'segment-4.ts',
      'segment-5.ts'
    ]);
    expect(lines).toContain('#EXTINF:2.000,');
    expect(lines).toContain('#EXTINF:0.500,');
    expect(lines.at(-1)).toBe('#EXT-X-ENDLIST');
  });

  it('emits an empty but valid playlist when the duration is unknown', () => {
    const playlist = service.buildMediaPlaylist(null);
    expect(playlist).toContain('#EXTM3U');
    expect(playlist).not.toContain('segment-0.ts');
    expect(playlist.trim().endsWith('#EXT-X-ENDLIST')).toBe(true);
  });

  it('scales by the short edge and keeps dimensions even', () => {
    expect(service.resolveTargetDimensions(1920, 1080, '480p')).toEqual({ width: 852, height: 480 });
    expect(service.resolveTargetDimensions(1920, 1080, '720p')).toEqual({ width: 1280, height: 720 });
    expect(service.resolveTargetDimensions(1080, 1920, '720p')).toEqual({ width: 720, height: 1280 });
    expect(service.resolveTargetDimensions(3840, 2160, '1080p')).toEqual({ width: 1920, height: 1080 });
    // 1440x1080 -> odd width after scaling, so it rounds down to stay yuv420p safe.
    expect(service.resolveTargetDimensions(1442, 1080, '720p')).toEqual({ width: 960, height: 720 });
  });

  it('leaves sources smaller than the target untouched', () => {
    expect(service.resolveTargetDimensions(480, 852, '480p')).toEqual({ width: 480, height: 852 });
    expect(service.resolveTargetDimensions(1280, 720, '720p')).toEqual({ width: 1280, height: 720 });
  });

  it('only offers qualities that do not upscale, always keeping one entry', () => {
    expect(service.resolveOfferedQualities(3840, 2160)).toEqual(['480p', '720p', '1080p']);
    expect(service.resolveOfferedQualities(1920, 1080)).toEqual(['480p', '720p']);
    expect(service.resolveOfferedQualities(480, 852)).toEqual(['480p']);
  });

  it('lists each offered quality in the master playlist with its scaled resolution', () => {
    const master = service.buildMasterPlaylist(42, 2160, 3840, service.resolveOfferedQualities(2160, 3840));

    expect(master).toContain('RESOLUTION=480x852');
    expect(master).toContain('/api/videos/42/hls/480p/index.m3u8');
    expect(master).toContain('RESOLUTION=720x1280');
    expect(master).toContain('/api/videos/42/hls/720p/index.m3u8');
  });

  it('recognises only the transcodable qualities as stream qualities', () => {
    expect(service.isStreamQuality('480p')).toBe(true);
    expect(service.isStreamQuality('720p')).toBe(true);
    expect(service.isStreamQuality('1080p')).toBe(true);
    expect(service.isStreamQuality('original')).toBe(false);
    expect(service.isStreamQuality('auto')).toBe(false);
  });

  it('removes all cached HLS segments for permanently deleted media', async () => {
    const cacheDirectory = path.join(tempRoot, 'data', 'hls-cache', '42', '720p');
    const siblingDirectory = path.join(tempRoot, 'data', 'hls-cache', '43', '720p');
    await fs.mkdir(cacheDirectory, { recursive: true });
    await fs.mkdir(siblingDirectory, { recursive: true });
    await fs.writeFile(path.join(cacheDirectory, 'segment-0.ts'), 'stale');
    await fs.writeFile(path.join(siblingDirectory, 'segment-0.ts'), 'keep');

    await service.invalidateVideoStreamCache([42, 42]);

    await expect(fs.stat(path.join(tempRoot, 'data', 'hls-cache', '42'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.readFile(path.join(siblingDirectory, 'segment-0.ts'), 'utf8')).resolves.toBe('keep');
  });
});
