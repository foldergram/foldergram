import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  scanAll: vi.fn().mockResolvedValue(undefined),
  scanChangedPaths: vi.fn().mockResolvedValue(undefined),
  getSetting: vi.fn(),
  readMarkerState: vi.fn().mockResolvedValue(false),
  config: {
    isDevelopment: true,
    galleryRoot: '/gallery',
    galleryExcludedFolders: ['EnvBlocked'],
    managedGalleryRelativeIgnores: ['thumbnails']
  }
}));

vi.mock('chokidar', () => ({ default: { watch: mocks.watch } }));
vi.mock('../src/config/env.js', () => ({ appConfig: mocks.config }));
vi.mock('../src/db/repositories.js', () => ({ appSettingsRepository: { get: mocks.getSetting } }));
vi.mock('../src/services/scanner-service.js', () => ({
  scannerService: { scanAll: mocks.scanAll, scanChangedPaths: mocks.scanChangedPaths }
}));
vi.mock('../src/services/storage-service.js', () => ({
  storageService: { refreshAvailability: () => ({ libraryAvailable: true }) }
}));
vi.mock('../src/services/log-service.js', () => ({ log: { info: vi.fn(), error: vi.fn() } }));
vi.mock('../src/utils/exclusion-marker.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/utils/exclusion-marker.js')>(),
  readExclusionMarkerState: mocks.readMarkerState
}));

import { watcherService } from '../src/services/watcher-service.js';

describe('exclusion marker watcher events', () => {
  let emit: (event: string, absolutePath: string) => Promise<void>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.readMarkerState.mockReset().mockResolvedValue(false);
    mocks.getSetting.mockReturnValue('SettingsBlocked');
    mocks.config.isDevelopment = true;
    mocks.watch.mockReturnValue({ on: mocks.on, close: mocks.close });
    mocks.on.mockImplementation((name, callback) => {
      if (name === 'ready') callback();
    });
    await watcherService.start();
    emit = mocks.on.mock.calls.find(([event]) => event === 'all')![1];
  });

  afterEach(async () => {
    await watcherService.stop();
    vi.useRealTimers();
  });

  async function event(name: string, relativePath: string): Promise<void> {
    await emit(name, path.join(mocks.config.galleryRoot, relativePath));
  }

  function expectFullScan(): void {
    expect(mocks.scanAll).toHaveBeenCalledExactlyOnceWith('watcher', { allowDerivativeMigration: false });
    expect(mocks.scanChangedPaths).not.toHaveBeenCalled();
  }

  it.each(['add', 'unlink'])('requests a debounced full scan for marker %s', async (name) => {
    await event(name, 'Archive/.nofoldergram');
    await vi.advanceTimersByTimeAsync(699);
    expect(mocks.scanAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expectFullScan();
  });

  it('coalesces marker and media events into one full scan', async () => {
    await event('add', 'Trips/photo.jpg');
    await event('add', 'Archive/.nofoldergram');
    await vi.advanceTimersByTimeAsync(500);
    await event('unlink', 'Other/.nofoldergram');
    await vi.advanceTimersByTimeAsync(699);
    expect(mocks.scanAll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expectFullScan();
    await vi.advanceTimersByTimeAsync(700);
    expectFullScan();
  });

  it.each([
    ['change', 'Archive/.nofoldergram'],
    ['addDir', 'Archive/.nofoldergram'],
    ['unlinkDir', 'Archive/.nofoldergram'],
    ['add', 'Archive/.NOFOLDERGRAM'],
    ['add', 'Archive/.other'],
    ['unlink', 'Archive/.other'],
    ['change', 'Archive/.other'],
    ['add', '.nofoldergram'],
    ['unlink', '.nofoldergram'],
    ['add', '.hidden/Archive/.nofoldergram'],
    ['unlink', 'Archive/.hidden/.nofoldergram'],
    ['add', 'thumbnails/Archive/.nofoldergram'],
    ['unlink', 'thumbnails/.nofoldergram'],
    ['add', 'EnvBlocked/Nested/.nofoldergram'],
    ['unlink', 'SettingsBlocked/.nofoldergram']
  ])('ignores %s on %s', async (name, relativePath) => {
    await event(name, relativePath);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.scanAll).not.toHaveBeenCalled();
    expect(mocks.scanChangedPaths).not.toHaveBeenCalled();
  });

  it('seeds initial marker types without scans and detects later type changes', async () => {
    await watcherService.stop();
    mocks.readMarkerState.mockResolvedValue(true);
    mocks.on.mockImplementation((name, callback) => {
      if (name === 'ready') {
        emit = mocks.on.mock.calls.filter(([eventName]) => eventName === 'all').at(-1)![1];
        void emit('add', path.join(mocks.config.galleryRoot, 'Archive/.nofoldergram'));
        void emit('add', path.join(mocks.config.galleryRoot, 'Archive/photo.jpg'));
        callback();
      }
    });
    await watcherService.start();
    await event('change', 'Archive/.nofoldergram');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.scanAll).not.toHaveBeenCalled();
    expect(mocks.scanChangedPaths).not.toHaveBeenCalled();

    mocks.readMarkerState.mockResolvedValue(false);
    await event('change', 'Archive/.nofoldergram');
    await vi.advanceTimersByTimeAsync(700);
    expectFullScan();
  });

  it('requests reconciliation after a marker check failure and can process later events', async () => {
    mocks.readMarkerState.mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }));
    await event('change', 'Archive/.nofoldergram');
    await vi.advanceTimersByTimeAsync(700);
    expectFullScan();

    mocks.scanAll.mockClear();
    mocks.readMarkerState.mockResolvedValue(true);
    await event('change', 'Archive/.nofoldergram');
    await vi.advanceTimersByTimeAsync(700);
    expectFullScan();
  });

  it('keeps ordinary media events incremental', async () => {
    await event('add', 'Trips/photo.jpg');
    await event('change', 'Trips/other.jpg');
    await vi.advanceTimersByTimeAsync(700);
    expect(mocks.scanChangedPaths).toHaveBeenCalledExactlyOnceWith(['Trips/photo.jpg', 'Trips/other.jpg'], 'watcher');
    expect(mocks.scanAll).not.toHaveBeenCalled();
  });

  it.each(['addDir', 'unlinkDir'])('keeps ordinary %s events on the full scan path', async (name) => {
    await event(name, 'Trips');
    await vi.advanceTimersByTimeAsync(700);
    expectFullScan();
  });

  it('cancels queued marker work when stopped', async () => {
    await event('add', 'Archive/.nofoldergram');
    await watcherService.stop();
    await watcherService.start();
    await event('add', 'Trips/photo.jpg');
    await vi.advanceTimersByTimeAsync(700);
    expect(mocks.scanAll).not.toHaveBeenCalled();
    expect(mocks.scanChangedPaths).toHaveBeenCalledExactlyOnceWith(['Trips/photo.jpg'], 'watcher');
  });

  it('does not start a watcher outside development mode', async () => {
    await watcherService.stop();
    mocks.watch.mockClear();
    mocks.config.isDevelopment = false;
    await watcherService.start();
    expect(mocks.watch).not.toHaveBeenCalled();
  });
});
