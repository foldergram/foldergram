import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PERMANENT_DELETION_JOB_SETTING_KEY } from '../src/constants/app-setting-keys.js';

type DeletionJobModule = typeof import('../src/services/deletion-job-service.js');

const settings = new Map<string, string>();
const deleteImageMock = vi.fn();
let libraryAvailable = true;

vi.mock('../src/db/repositories.js', () => ({
  appSettingsRepository: {
    get: (key: string) => settings.get(key) ?? null,
    set: (key: string, value: string) => {
      settings.set(key, value);
    },
    remove: (key: string) => {
      settings.delete(key);
    }
  }
}));

vi.mock('../src/services/gallery-service.js', () => ({
  galleryService: {
    deleteImage: (id: number) => deleteImageMock(id)
  }
}));

vi.mock('../src/services/storage-service.js', () => ({
  storageService: {
    getState: () => ({ libraryAvailable })
  }
}));

vi.mock('../src/services/log-service.js', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

async function loadService(): Promise<DeletionJobModule['deletionJobService']> {
  vi.resetModules();
  const { deletionJobService } = await import('../src/services/deletion-job-service.js');
  return deletionJobService;
}

/** Waits for the fire-and-forget runner to drain its queue. */
async function settle() {
  for (let index = 0; index < 50; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

describe.sequential('deletionJobService', () => {
  beforeEach(() => {
    settings.clear();
    deleteImageMock.mockReset();
    deleteImageMock.mockImplementation(async (id: number) => ({ id, folderSlug: 'trip' }));
    libraryAvailable = true;
  });

  it('reports an idle snapshot when nothing was ever queued', async () => {
    const service = await loadService();

    expect(service.getSnapshot()).toMatchObject({
      active: false,
      total: 0,
      processed: 0,
      remaining: 0,
      failedCount: 0,
      deletedIds: []
    });
  });

  it('deletes every queued post and persists the finished job', async () => {
    const service = await loadService();

    service.enqueue([3, 1, 2]);
    await settle();

    expect(deleteImageMock.mock.calls.map(([id]) => id)).toEqual([3, 1, 2]);

    const snapshot = service.getSnapshot();
    expect(snapshot.active).toBe(false);
    expect(snapshot.total).toBe(3);
    expect(snapshot.processed).toBe(3);
    expect(snapshot.remaining).toBe(0);
    expect(snapshot.failedCount).toBe(0);
    expect(snapshot.deletedIds).toEqual([3, 1, 2]);
    expect(snapshot.finishedAt).not.toBeNull();
    expect(settings.has(PERMANENT_DELETION_JOB_SETTING_KEY)).toBe(true);
  });

  it('deduplicates ids and rejects invalid ones', async () => {
    const service = await loadService();

    service.enqueue([5, 5, 0, -2, 6]);
    await settle();

    expect(deleteImageMock.mock.calls.map(([id]) => id)).toEqual([5, 6]);
    expect(service.getSnapshot().total).toBe(2);
  });

  it('merges a new request into the job that is still running', async () => {
    const service = await loadService();
    let releaseFirst: (() => void) | null = null;
    const firstStarted = new Promise<void>((resolve) => {
      deleteImageMock.mockImplementationOnce(async (id: number) => {
        resolve();
        await new Promise<void>((release) => {
          releaseFirst = release;
        });
        return { id, folderSlug: 'trip' };
      });
    });

    service.enqueue([11]);
    await firstStarted;

    // 11 is already known, so only 12 is appended to the running job.
    const merged = service.enqueue([11, 12]);
    expect(merged.total).toBe(2);
    expect(merged.active).toBe(true);

    releaseFirst?.();
    await settle();

    expect(deleteImageMock.mock.calls.map(([id]) => id)).toEqual([11, 12]);
    expect(service.getSnapshot().processed).toBe(2);
  });

  it('counts a missing post as a failure without stopping the batch', async () => {
    const service = await loadService();
    deleteImageMock.mockImplementation(async (id: number) => (id === 21 ? null : { id, folderSlug: 'trip' }));

    service.enqueue([21, 22]);
    await settle();

    const snapshot = service.getSnapshot();
    expect(snapshot.processed).toBe(2);
    expect(snapshot.failedCount).toBe(1);
    expect(snapshot.errorMessage).toContain('not found');
    expect(snapshot.deletedIds).toEqual([22]);
  });

  it('records the first thrown error and keeps going', async () => {
    const service = await loadService();
    deleteImageMock.mockImplementation(async (id: number) => {
      if (id === 31) {
        throw new Error('Read-only file system');
      }
      return { id, folderSlug: 'trip' };
    });

    service.enqueue([31, 32]);
    await settle();

    const snapshot = service.getSnapshot();
    expect(snapshot.failedCount).toBe(1);
    expect(snapshot.errorMessage).toBe('Read-only file system');
    expect(snapshot.deletedIds).toEqual([32]);
  });

  it('stops and keeps the remaining ids queued when the library goes offline', async () => {
    const service = await loadService();
    libraryAvailable = false;

    service.enqueue([41, 42]);
    await settle();

    expect(deleteImageMock).not.toHaveBeenCalled();
    const snapshot = service.getSnapshot();
    expect(snapshot.remaining).toBe(2);
    expect(snapshot.processed).toBe(0);
    expect(snapshot.errorMessage).toContain('unavailable');
  });

  it('resumes an interrupted job after a restart', async () => {
    const service = await loadService();
    libraryAvailable = false;
    service.enqueue([51, 52]);
    await settle();
    expect(service.getSnapshot().remaining).toBe(2);

    // A fresh process reads the persisted job from app settings.
    libraryAvailable = true;
    const restarted = await loadService();
    expect(restarted.getSnapshot().remaining).toBe(2);

    restarted.resumePendingJob();
    await settle();

    expect(deleteImageMock.mock.calls.map(([id]) => id)).toEqual([51, 52]);
    expect(restarted.getSnapshot().active).toBe(false);
  });

  it('clears a finished job when the client acknowledges it', async () => {
    const service = await loadService();

    service.enqueue([61]);
    await settle();
    expect(service.getSnapshot().total).toBe(1);

    const acknowledged = service.acknowledgeFinished();
    expect(acknowledged.total).toBe(0);
    expect(acknowledged.active).toBe(false);
    expect(settings.has(PERMANENT_DELETION_JOB_SETTING_KEY)).toBe(false);
  });

  it('keeps a running job when acknowledge is called too early', async () => {
    const service = await loadService();
    let release: (() => void) | null = null;
    const started = new Promise<void>((resolve) => {
      deleteImageMock.mockImplementationOnce(async (id: number) => {
        resolve();
        await new Promise<void>((resolveRelease) => {
          release = resolveRelease;
        });
        return { id, folderSlug: 'trip' };
      });
    });

    service.enqueue([71, 72]);
    await started;

    expect(service.acknowledgeFinished().active).toBe(true);

    release?.();
    await settle();
    expect(service.getSnapshot().active).toBe(false);
  });
});
