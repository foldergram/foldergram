import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { appConfig } from '../src/config/env.js';
import { readMediaMetadata } from '../src/services/derivative-service.js';
import { derivativeWorkLimit, processHeicSource } from '../src/services/heic/service.js';

import { heicFixture as fixture } from './fixtures/heic.js';

describe('local HEIC worker', () => {
  let root: string;
  let original: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-heic-test-'));
    original = path.join(root, 'PHOTO.HEIF');
    await fs.writeFile(original, fixture);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('inspects the primary still and renders both WebP sizes without changing the original', async () => {
    const { mtimeMs } = await fs.stat(original);
    const thumbnail = path.join(root, 'thumbnail.webp');
    const preview = path.join(root, 'preview.webp');

    await expect(readMediaMetadata(original, 'image')).resolves.toMatchObject({
      width: 96, height: 64, displayOrientation: 1, isAnimated: false, takenAt: null, exif: null
    });
    expect(await fs.readdir(root)).toEqual(['PHOTO.HEIF']);

    await expect(processHeicSource(original, [
      { kind: 'thumbnail', path: thumbnail },
      { kind: 'preview', path: preview }
    ])).resolves.toMatchObject({ width: 96, height: 64 });

    for (const output of [thumbnail, preview]) {
      const decoded = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(decoded.info).toMatchObject({ width: 96, height: 64, channels: 3 });
      const pixel = (x: number, y: number) => decoded.data.subarray((y * 96 + x) * 3, (y * 96 + x) * 3 + 3);
      expect(pixel(10, 10)[0]).toBeGreaterThan(200);
      expect(pixel(10, 50)[2]).toBeGreaterThan(200);
      expect(pixel(75, 50)[0]).toBeGreaterThan(200);
      expect(pixel(75, 50)[1]).toBeGreaterThan(200);
    }
    expect(await fs.readFile(original)).toEqual(fixture);
    expect((await fs.stat(original)).mtimeMs).toBe(mtimeMs);
  }, 15_000);

  it('uses the primary container rotation exactly once', async () => {
    const rotated = Buffer.from('AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAUxtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAFwAAEAAAAAAAAA7gAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGh2YzEAAAAAzGlwcnAAAACtaXBjbwAAAHhodmNDAQNwAAAAAAAAAAAAHvAA/P34+AAADwMgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQCEAAQArQgEBA3AAAAMAkAAAAwAAAwAeoDCBBZbqSSmubgIaDAgAAAMACAAAAwAIQCIAAQAHRAHBcrAiQAAAABRpc3BlAAAAAAAAAGAAAABAAAAAEHBpeGkAAAAAAwgICAAAAAlpcm90AwAAABdpcG1hAAAAAAAAAAEAAQSBAgOEAAAA9m1kYXQAAADqKAGvBjha/P03+Z3v///K9d6H+9gcLvlalUEG+DD//vKf4nO1wLQwNyb9zH6VxM1SC9/KuQkf9B+ejf0yw3//j7EFPSL8AO7CuHlhOlkkypKcjkJXmJHTtvhr+Sq/3eLWIZn9782H9myH//PxS+c6uVkMURgavJPb3GHnp/+3DVGJa42wTYBKjQYF+/T0v/mwFH/XN+piwYdk3fij7kw8kFH/Cc6bqJXWL2XZEjYsh2nGbyJG6/tljiph3cm6FhoQe30RpW5+2igwDuzlDDUbBpRB5+sha7gQe45EkbNYzya+JvhAhlmP83Zv', 'base64');
    await fs.writeFile(original, rotated);
    const output = path.join(root, 'rotated.webp');
    await expect(processHeicSource(original, [{ kind: 'preview', path: output }]))
      .resolves.toMatchObject({ width: 64, height: 96, displayOrientation: 6 });
    const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 64, height: 96 });
    const topLeft = (10 * 64 + 10) * 3;
    const topRight = (10 * 64 + 54) * 3;
    expect(data[topLeft + 2]).toBeGreaterThan(200);
    expect(data[topRight]).toBeGreaterThan(200);
  }, 15_000);

  it('rejects corrupt files, sequences, and configured byte and pixel limits', async () => {
    const truncated = path.join(root, 'short.heic');
    await fs.writeFile(truncated, fixture.subarray(0, 22));
    await expect(processHeicSource(truncated)).rejects.toMatchObject({ kind: 'media' });
    const sequence = path.join(root, 'sequence.heic');
    const sequenceHeader = Buffer.from(fixture);
    sequenceHeader.write('hevc', 8, 'ascii');
    await fs.writeFile(sequence, sequenceHeader);
    await expect(processHeicSource(sequence)).rejects.toThrow(/sequences/);
    const maxPixels = appConfig.heicMaxPixels;
    const maxBytes = appConfig.heicMaxInputBytes;
    try {
      appConfig.heicMaxPixels = 2_000;
      await expect(processHeicSource(original)).rejects.toMatchObject({ kind: 'media' });
      appConfig.heicMaxInputBytes = 40;
      await expect(processHeicSource(original)).rejects.toThrow(/byte limit/);
    } finally {
      appConfig.heicMaxPixels = maxPixels;
      appConfig.heicMaxInputBytes = maxBytes;
    }
  }, 15_000);

  it('deduplicates concurrent requests and caps admitted jobs while the global work budget is occupied', async () => {
    const previousLimit = derivativeWorkLimit.concurrency;
    const previousPending = appConfig.heicDecodeQueueLimit;
    derivativeWorkLimit.concurrency = 1;
    appConfig.heicDecodeQueueLimit = 1;
    let release!: () => void;
    const blocker = derivativeWorkLimit(() => new Promise<void>(resolve => { release = resolve; }));
    const jobs: Array<Promise<unknown>> = [];
    const files = [original, path.join(root, 'second.heic'), path.join(root, 'third.heic')];
    try {
      await Promise.all(files.slice(1).map(file => fs.writeFile(file, fixture)));
      const first = processHeicSource(files[0]);
      const duplicate = processHeicSource(files[0]);
      const second = processHeicSource(files[1]);
      jobs.push(first, duplicate, second);
      await vi.waitFor(() => expect(derivativeWorkLimit.pendingCount).toBe(1));
      await expect(processHeicSource(files[2])).rejects.toMatchObject({ kind: 'busy' });
      expect(derivativeWorkLimit.pendingCount).toBe(1);
      release();
      expect(await first).toEqual(await duplicate);
      await expect(second).resolves.toMatchObject({ width: 96, height: 64 });
    } finally {
      release?.();
      await Promise.allSettled([blocker, ...jobs]);
      derivativeWorkLimit.concurrency = previousLimit;
      appConfig.heicDecodeQueueLimit = previousPending;
    }
  }, 15_000);

  it('expires a job waiting for a derivative slot and recovers after saturation', async () => {
    const previousLimit = derivativeWorkLimit.concurrency;
    const previousTimeout = appConfig.heicJobTimeoutMs;
    derivativeWorkLimit.concurrency = 1;
    appConfig.heicJobTimeoutMs = 100;
    let release!: () => void;
    const blocker = derivativeWorkLimit(() => new Promise<void>(resolve => { release = resolve; }));
    try {
      await expect(processHeicSource(original)).rejects.toMatchObject({ kind: 'busy' });
      release();
      await blocker;
      appConfig.heicJobTimeoutMs = previousTimeout;
      await expect(processHeicSource(original)).resolves.toMatchObject({ width: 96, height: 64 });
    } finally {
      release?.();
      await blocker;
      derivativeWorkLimit.concurrency = previousLimit;
      appConfig.heicJobTimeoutMs = previousTimeout;
    }
  }, 15_000);

  it('preserves a cached WebP if the indexed source becomes stale during processing', async () => {
    const output = path.join(root, 'cached.webp');
    await fs.writeFile(output, 'old cache');
    let checks = 0;
    await expect(processHeicSource(original, [{ kind: 'preview', path: output }], {
      key: 'stale-test',
      isCurrent: () => ++checks === 1
    })).rejects.toMatchObject({ kind: 'stale' });
    expect(await fs.readFile(output, 'utf8')).toBe('old cache');
    expect((await fs.readdir(root)).sort()).toEqual(['PHOTO.HEIF', 'cached.webp'].sort());
  }, 15_000);
});
