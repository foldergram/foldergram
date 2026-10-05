import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const run = promisify(execFile);
const binariesAvailable = await Promise.all(['ffmpeg', 'ffprobe'].map(async (binary) => {
  try {
    await run(binary, ['-version']);
    return true;
  } catch {
    return false;
  }
}));

// Generated fixtures only: no private media is needed. These tests are skipped
// on environments without the production FFmpeg/FFprobe prerequisites.
describe.skipIf(binariesAvailable.includes(false)).sequential('real video preview recovery', () => {
  let tempRoot = '';
  let appConfig: typeof import('../src/config/env.js')['appConfig'];
  let scannerService: typeof import('../src/services/scanner-service.js')['scannerService'];
  let imageRepository: typeof import('../src/db/repositories.js')['imageRepository'];
  let writeVideoPreview: typeof import('../src/services/derivative-service.js')['writeVideoPreview'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-real-video-'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DERIVATIVE_MODE', 'eager');
    vi.stubEnv('SCAN_MEDIA_ERROR_MODE', 'skip');
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db',
      THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) vi.stubEnv(key, path.join(tempRoot, directory));
    vi.resetModules();
    ({ appConfig } = await import('../src/config/env.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository } = await import('../src/db/repositories.js'));
    ({ writeVideoPreview } = await import('../src/services/derivative-service.js'));
    await fs.mkdir(path.join(appConfig.galleryRoot, 'album'), { recursive: true });
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function createMovie(filePath: string, supportedSecondAudio: boolean): Promise<void> {
    await run('ffmpeg', [
      '-y', '-v', 'error',
      '-f', 'lavfi', '-i', 'color=c=blue:s=96x64:r=10:d=0.5',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5',
      '-map', '0:v', '-map', '1:a',
      ...(supportedSecondAudio ? ['-map', '1:a'] : []),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
      '-c:a:0', 'pcm_s16le',
      ...(supportedSecondAudio ? ['-c:a:1', 'aac'] : []),
      filePath
    ]);
    // Replace the PCM sample-entry tag with an unrecognized codec tag. This
    // reproduces an undecodable first track without relying on APAC support
    // remaining absent from newer FFmpeg builds.
    const movie = await fs.readFile(filePath);
    const tagOffset = movie.indexOf(Buffer.from('sowt'));
    expect(tagOffset).toBeGreaterThan(0);
    movie.write('zzzz', tagOffset, 'ascii');
    await fs.writeFile(filePath, movie);
  }

  async function probe(filePath: string) {
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', filePath]);
    return JSON.parse(stdout).streams as Array<{ index: number; codec_type: string; codec_name?: string; width?: number; height?: number }>;
  }

  it('recovers an empty preview on eager rescan, retains audio, and exposes the item in feed and Reels', async () => {
    const source = path.join(appConfig.galleryRoot, 'album', 'two-tracks.mov');
    await createMovie(source, true);
    const inputStreams = await probe(source);
    expect(inputStreams.find((stream) => stream.index === 1)?.codec_name).toBeUndefined();
    expect(inputStreams.find((stream) => stream.index === 2)?.codec_name).toBe('aac');

    const firstScan = await scannerService.scanAll('manual');
    expect(firstScan?.status).toBe('completed');
    const image = imageRepository.getByRelativePath('album/two-tracks.mov')!;
    const preview = path.join(appConfig.previewsDir, image.preview_path);
    await fs.writeFile(preview, '');
    const repairScan = await scannerService.scanAll('manual');
    expect(repairScan?.status).toBe('completed');
    expect((await fs.stat(preview)).size).toBeGreaterThan(0);
    const outputStreams = await probe(preview);
    expect(outputStreams.map((stream) => stream.codec_name)).toEqual(['h264', 'aac']);
    expect(outputStreams[0]).toMatchObject({ width: 96, height: 64 });
    await run('ffmpeg', ['-v', 'error', '-xerror', '-i', preview, '-map', '0:v', '-map', '0:a', '-f', 'null', '-']);
    const outputBytes = await fs.readFile(preview);
    expect(outputBytes.indexOf(Buffer.from('moov'))).toBeLessThan(outputBytes.indexOf(Buffer.from('mdat')));
    expect(imageRepository.listFeed(1, 20).some((entry) => entry.id === image.id)).toBe(true);
    expect(imageRepository.listVisibleVideoCandidates().some((entry) => entry.id === image.id)).toBe(true);
    const publishedMtime = (await fs.stat(preview)).mtimeMs;
    const reuseScan = await scannerService.scanAll('manual');
    expect(reuseScan?.status).toBe('completed');
    expect((await fs.stat(preview)).mtimeMs).toBe(publishedMtime);
  });

  it('reports no-decodable-audio failures on initial scan and repair rescan', async () => {
    const source = path.join(appConfig.galleryRoot, 'album', 'unsupported.mov');
    await createMovie(source, false);
    const scan = await scannerService.scanAll('manual');
    expect(scan?.status).toBe('completed_with_errors');
    expect(scan?.error_text).toContain('No audio track');
    const image = imageRepository.getByRelativePath('album/unsupported.mov')!;
    const preview = path.join(appConfig.previewsDir, image.preview_path);
    await expect(fs.stat(preview)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.mkdir(path.dirname(preview), { recursive: true });
    await fs.writeFile(preview, '');
    const rescan = await scannerService.scanAll('manual');
    expect(rescan?.status).toBe('completed_with_errors');
    expect(rescan?.error_text).toContain('No audio track');
  });

  it('produces a decodable silent preview for a genuinely silent movie', async () => {
    const source = path.join(tempRoot, 'silent.mov');
    const preview = path.join(tempRoot, 'silent.mp4');
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x96:r=10:d=0.5', '-c:v', 'libx264', source]);
    await writeVideoPreview(source, preview);
    expect((await probe(preview)).map((stream) => stream.codec_name)).toEqual(['h264']);
    await run('ffmpeg', ['-v', 'error', '-xerror', '-i', preview, '-f', 'null', '-']);
  });
});
