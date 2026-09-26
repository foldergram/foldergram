import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

class FakeChild extends EventEmitter {
  killed = false;
  exitCode: number | null = null;
  stderr = new EventEmitter();
  stdout = new EventEmitter();

  kill(signal?: NodeJS.Signals): boolean {
    this.killed = true;
    this.exitCode = null;
    queueMicrotask(() => this.emit('close', null, signal ?? 'SIGKILL'));
    return true;
  }
}

const spawnMock = vi.fn((_command: string, _args: string[]) => new FakeChild());

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    spawn: spawnMock
  };
});

describe('HLS transcode abort on seek', () => {
  let tempRoot = '';
  let service: typeof import('../src/services/video-stream-service.js');

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-video-abort-'));
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
    vi.stubEnv('VIDEO_HWACCEL', 'none');

    await fs.mkdir(path.join(tempRoot, 'gallery'), { recursive: true });
    service = await import('../src/services/video-stream-service.js');
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('kills the previous ffmpeg window when the same video seeks far away', async () => {
    const sourcePath = path.join(tempRoot, 'gallery', 'clip.mp4');
    await fs.writeFile(sourcePath, 'clip');
    spawnMock.mockClear();

    const first = service.getSegmentWindow({
      imageId: 42,
      sourcePath,
      durationMs: 120_000,
      width: 1920,
      height: 1080,
      quality: '480p',
      index: 0
    }, 4);
    const firstResult = first.then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error })
    );

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledTimes(1));
    const firstChild = spawnMock.mock.results[0]?.value as FakeChild;
    expect(firstChild.killed).toBe(false);

    const second = service.getSegmentWindow({
      imageId: 42,
      sourcePath,
      durationMs: 120_000,
      width: 1920,
      height: 1080,
      quality: '480p',
      index: 20
    }, 4);
    void second.catch(() => undefined);

    await vi.waitFor(() => expect(firstChild.killed).toBe(true));
    const settled = await firstResult;
    expect(settled.ok).toBe(false);
    expect(String(settled.ok === false ? settled.error : '')).toMatch(/aborted|ffmpeg/);
  });
});
