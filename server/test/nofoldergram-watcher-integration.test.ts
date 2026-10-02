import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scanAll: vi.fn().mockResolvedValue(undefined),
  scanChangedPaths: vi.fn().mockResolvedValue(undefined),
  watcher: null as FSWatcher | null,
  ready: Promise.resolve(),
  config: {
    isDevelopment: true, galleryRoot: '', galleryExcludedFolders: [], managedGalleryRelativeIgnores: []
  }
}));

vi.mock('chokidar', async (importOriginal) => {
  const actual = await importOriginal<typeof import('chokidar')>();
  return { default: { watch: (...args: Parameters<typeof actual.default.watch>) => {
    mocks.watcher = actual.default.watch(...args);
    mocks.ready = new Promise<void>((resolve) => mocks.watcher!.once('ready', resolve));
    return mocks.watcher;
  } } };
});
vi.mock('../src/config/env.js', () => ({ appConfig: mocks.config }));
vi.mock('../src/db/repositories.js', () => ({ appSettingsRepository: { get: () => null } }));
vi.mock('../src/services/scanner-service.js', () => ({ scannerService: mocks }));
vi.mock('../src/services/storage-service.js', () => ({
  storageService: { refreshAvailability: () => ({ libraryAvailable: true }) }
}));
vi.mock('../src/services/log-service.js', () => ({ log: { info: vi.fn(), error: vi.fn() } }));

import { watcherService } from '../src/services/watcher-service.js';

describe('real Chokidar marker reconciliation', () => {
  let tempRoot: string;
  let markerPath: string;
  let targetPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-marker-watcher-'));
    mocks.config.galleryRoot = path.join(tempRoot, 'gallery');
    await fs.mkdir(path.join(mocks.config.galleryRoot, 'Album'), { recursive: true });
    markerPath = path.join(mocks.config.galleryRoot, 'Album/.nofoldergram');
    targetPath = path.join(tempRoot, 'target');
    await fs.writeFile(targetPath, 'symlink target');
  });

  afterEach(async () => {
    await watcherService.stop();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function start(): Promise<void> {
    await watcherService.start();
    await mocks.ready;
    expect(mocks.scanAll).not.toHaveBeenCalled();
    expect(mocks.scanChangedPaths).not.toHaveBeenCalled();
  }

  it.each(['symlink-to-file', 'file-to-symlink'])('reconciles an atomic %s marker replacement', async (transition) => {
    if (transition === 'symlink-to-file') await fs.symlink(targetPath, markerPath);
    else await fs.writeFile(markerPath, '');
    await start();

    const replacement = path.join(path.dirname(markerPath), '.replacement');
    if (transition === 'symlink-to-file') await fs.writeFile(replacement, '');
    else await fs.symlink(targetPath, replacement);
    await fs.rename(replacement, markerPath);

    await vi.waitFor(() => {
      expect(mocks.scanAll).toHaveBeenCalledExactlyOnceWith('watcher', { allowDerivativeMigration: false });
    }, { timeout: 4_000 });
    expect(mocks.scanChangedPaths).not.toHaveBeenCalled();
  });

  it.each(['content-edit', 'atomic-file-replacement'])('ignores %s on an existing regular marker', async (operation) => {
    await fs.writeFile(markerPath, '');
    await start();
    const events = vi.fn();
    mocks.watcher!.on('change', events);
    if (operation === 'content-edit') {
      await fs.writeFile(markerPath, 'contents have no meaning');
    } else {
      const replacement = path.join(path.dirname(markerPath), '.replacement');
      await fs.writeFile(replacement, 'different contents');
      await fs.rename(replacement, markerPath);
    }
    await vi.waitFor(() => expect(events).toHaveBeenCalled(), { timeout: 2_000 });
    await new Promise((resolve) => setTimeout(resolve, 900));
    expect(mocks.scanAll).not.toHaveBeenCalled();
    expect(mocks.scanChangedPaths).not.toHaveBeenCalled();
  });
});
