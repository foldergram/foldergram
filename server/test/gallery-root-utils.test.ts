import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { countSupportedRootMediaFiles } from '../src/utils/gallery-root-utils.js';

describe('gallery root media detection', () => {
  let tempRoot = '';

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-gallery-root-utils-'));
  });

  afterAll(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('counts supported media directly in the gallery root and ignores nested or hidden entries', async () => {
    await fs.mkdir(path.join(tempRoot, 'album-one'), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(tempRoot, 'photo-1.jpg'), 'a'),
      fs.writeFile(path.join(tempRoot, 'clip-1.mp4'), 'b'),
      fs.writeFile(path.join(tempRoot, 'notes.txt'), 'c'),
      fs.writeFile(path.join(tempRoot, '.hidden.jpg'), 'd'),
      fs.writeFile(path.join(tempRoot, 'album-one', 'nested-photo.jpg'), 'e')
    ]);

    expect(countSupportedRootMediaFiles(tempRoot)).toBe(2);
  });

  it('returns zero when the gallery root does not exist', async () => {
    expect(countSupportedRootMediaFiles(path.join(tempRoot, 'missing-root'))).toBe(0);
  });
});
