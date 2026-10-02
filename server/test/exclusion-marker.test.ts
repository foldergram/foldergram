import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasAncestorExclusionMarker, readExclusionMarkerState } from '../src/utils/exclusion-marker.js';

describe('ancestor marker filesystem boundaries', () => {
  let tempRoot: string;
  let galleryRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-marker-paths-'));
    galleryRoot = path.join(tempRoot, 'gallery');
    await fs.mkdir(galleryRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it.each(['Linked', 'Album/Linked'])('does not read external marker metadata through %s', async (relativeFolder) => {
    const external = path.join(tempRoot, 'external');
    await fs.mkdir(external);
    await fs.writeFile(path.join(external, '.nofoldergram'), '');
    await fs.mkdir(path.dirname(path.join(galleryRoot, relativeFolder)), { recursive: true });
    await fs.symlink(external, path.join(galleryRoot, relativeFolder), 'dir');
    const lstat = vi.spyOn(fs, 'lstat');

    expect(await hasAncestorExclusionMarker(galleryRoot, relativeFolder)).toBeNull();
    expect(await readExclusionMarkerState(galleryRoot, relativeFolder)).toBeNull();
    expect(lstat.mock.calls.some(([target]) => String(target) === path.join(galleryRoot, relativeFolder, '.nofoldergram'))).toBe(false);
  });

  it('also rejects a directory symlink targeting another folder within the gallery', async () => {
    await fs.mkdir(path.join(galleryRoot, 'Actual'));
    await fs.writeFile(path.join(galleryRoot, 'Actual/.nofoldergram'), '');
    await fs.symlink(path.join(galleryRoot, 'Actual'), path.join(galleryRoot, 'Linked'), 'dir');
    expect(await hasAncestorExclusionMarker(galleryRoot, 'Linked')).toBeNull();
    expect(await hasAncestorExclusionMarker(galleryRoot, 'Actual')).toBe(true);
  });

  it('permits the configured gallery root itself to be a symlink', async () => {
    const rootLink = path.join(tempRoot, 'root-link');
    await fs.symlink(galleryRoot, rootLink, 'dir');
    await fs.mkdir(path.join(galleryRoot, 'Album'));
    await fs.writeFile(path.join(galleryRoot, 'Album/.nofoldergram'), '');
    expect(await hasAncestorExclusionMarker(rootLink, 'Album')).toBe(true);
    expect(await readExclusionMarkerState(rootLink, 'Album')).toBe(true);
  });

  it('rejects a component resolved outside the gallery after its directory type check', async () => {
    await fs.mkdir(path.join(galleryRoot, 'Album'));
    const originalRealpath = fs.realpath;
    vi.spyOn(fs, 'realpath').mockImplementation(async (target) => {
      if (String(target) === path.join(galleryRoot, 'Album')) return path.join(tempRoot, 'external');
      return originalRealpath(target);
    });
    const lstat = vi.spyOn(fs, 'lstat');
    expect(await hasAncestorExclusionMarker(galleryRoot, 'Album')).toBeNull();
    expect(lstat.mock.calls.some(([target]) => String(target).endsWith('.nofoldergram'))).toBe(false);
  });

  it('propagates permission failures instead of treating them as missing markers', async () => {
    await fs.mkdir(path.join(galleryRoot, 'Album'));
    vi.spyOn(fs, 'lstat').mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    await expect(hasAncestorExclusionMarker(galleryRoot, 'Album')).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('rejects lexical traversal before any filesystem access', async () => {
    const realpath = vi.spyOn(fs, 'realpath');
    await expect(hasAncestorExclusionMarker(galleryRoot, '../external')).rejects.toThrow('escapes configured root');
    expect(realpath).not.toHaveBeenCalled();
  });
});
