import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useTrashStore } from './trash';

const { fetchTrashImagesMock, deleteImageMock } = vi.hoisted(() => ({
  fetchTrashImagesMock: vi.fn(),
  deleteImageMock: vi.fn()
}));

vi.mock('../api/gallery', () => ({
  fetchTrashImages: fetchTrashImagesMock,
  deleteImage: deleteImageMock
}));

function createDeferred<T>() {
  let resolve: ((value: T) => void) | null = null;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });

  return {
    promise,
    resolve(value: T) {
      resolve?.(value);
    }
  };
}

describe('trash store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchTrashImagesMock.mockReset();
    deleteImageMock.mockReset();
  });

  it('deletes a batch with bounded concurrency and tracks progress', async () => {
    const trashStore = useTrashStore();
    trashStore.$patch({
      items: [1, 2, 3, 4, 5].map((id) => ({ id }) as never),
      initialized: true
    });

    let inFlight = 0;
    let peakInFlight = 0;
    deleteImageMock.mockImplementation(async () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { id: 0, folderSlug: '' };
    });

    const outcome = await trashStore.deletePermanently([1, 2, 3, 4, 5]);

    expect(outcome).toEqual({ succeededCount: 5, failedCount: 0 });
    expect(deleteImageMock).toHaveBeenCalledTimes(5);
    // Requests overlap to hide round-trip latency, but stay bounded.
    expect(peakInFlight).toBeGreaterThan(1);
    expect(peakInFlight).toBeLessThanOrEqual(3);
    expect(trashStore.items).toEqual([]);
    expect(trashStore.deletionActive).toBe(false);
    expect(trashStore.deletionProcessed).toBe(5);
  });

  it('keeps failed items in the list and records the first error message', async () => {
    const trashStore = useTrashStore();
    trashStore.$patch({
      items: [7, 8].map((id) => ({ id }) as never),
      initialized: true
    });

    deleteImageMock.mockImplementation(async (id: number) => {
      if (id === 8) {
        throw new Error('Read-only file system');
      }

      return { id, folderSlug: '' };
    });

    const outcome = await trashStore.deletePermanently([7, 8]);

    expect(outcome).toEqual({ succeededCount: 1, failedCount: 1 });
    expect(trashStore.items.map((item) => item.id)).toEqual([8]);
    expect(trashStore.deletionErrorMessage).toBe('Read-only file system');
  });

  it('ignores a second batch while one is already running', async () => {
    const trashStore = useTrashStore();
    const blocker = createDeferred<void>();
    trashStore.$patch({ items: [{ id: 9 }] as never, initialized: true });

    deleteImageMock.mockImplementation(async () => {
      await blocker.promise;
      return { id: 9, folderSlug: '' };
    });

    const firstRun = trashStore.deletePermanently([9]);
    await Promise.resolve();

    expect(await trashStore.deletePermanently([9])).toEqual({ succeededCount: 0, failedCount: 0 });

    blocker.resolve(undefined);
    await firstRun;
    expect(deleteImageMock).toHaveBeenCalledTimes(1);
  });

  it('keeps initialized empty state visible during a forced refresh', async () => {
    const trashStore = useTrashStore();
    const deferred = createDeferred<{
      items: [];
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    }>();

    trashStore.$patch({
      items: [],
      page: 2,
      hasMore: false,
      loading: false,
      error: null,
      initialized: true
    });

    fetchTrashImagesMock.mockReturnValue(deferred.promise);

    const refreshPromise = trashStore.loadInitial(true);

    expect(trashStore.loading).toBe(true);
    expect(trashStore.initialized).toBe(true);
    expect(trashStore.items).toEqual([]);

    deferred.resolve({
      items: [],
      page: 1,
      limit: trashStore.limit,
      total: 0,
      hasMore: false
    });

    await refreshPromise;

    expect(trashStore.loading).toBe(false);
    expect(trashStore.initialized).toBe(true);
    expect(trashStore.items).toEqual([]);
    expect(trashStore.hasMore).toBe(false);
    expect(trashStore.page).toBe(2);
  });
});
