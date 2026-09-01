import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTrashStore } from './trash';

const { fetchTrashImagesMock, enqueueBatchMock, fetchJobMock, acknowledgeJobMock } = vi.hoisted(() => ({
  fetchTrashImagesMock: vi.fn(),
  enqueueBatchMock: vi.fn(),
  fetchJobMock: vi.fn(),
  acknowledgeJobMock: vi.fn()
}));

vi.mock('../api/gallery', () => ({
  fetchTrashImages: fetchTrashImagesMock,
  enqueuePermanentDeletionBatch: enqueueBatchMock,
  fetchPermanentDeletionJob: fetchJobMock,
  acknowledgePermanentDeletionJob: acknowledgeJobMock
}));

function createJob(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      active: true,
      total: 0,
      processed: 0,
      remaining: 0,
      failedCount: 0,
      errorMessage: null,
      deletedIds: [] as number[],
      startedAt: '2026-08-30T10:00:00.000Z',
      finishedAt: null,
      ...overrides
    }
  };
}

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
    enqueueBatchMock.mockReset();
    fetchJobMock.mockReset();
    acknowledgeJobMock.mockReset();
  });

  afterEach(() => {
    useTrashStore().clearDeletionProgress();
    vi.useRealTimers();
  });

  it('hands the batch to the server and reflects the returned job snapshot', async () => {
    const trashStore = useTrashStore();
    trashStore.$patch({
      items: [1, 2, 3].map((id) => ({ id }) as never),
      initialized: true
    });

    enqueueBatchMock.mockResolvedValue(
      createJob({ total: 3, processed: 1, remaining: 2, deletedIds: [1] })
    );

    await trashStore.deletePermanently([1, 2, 3]);

    expect(enqueueBatchMock).toHaveBeenCalledWith([1, 2, 3]);
    expect(trashStore.deletionActive).toBe(true);
    expect(trashStore.deletionTotal).toBe(3);
    expect(trashStore.deletionProcessed).toBe(1);
    // Rows confirmed deleted by the server disappear immediately.
    expect(trashStore.items.map((item) => item.id)).toEqual([2, 3]);
  });

  it('records an error when the batch cannot be queued', async () => {
    const trashStore = useTrashStore();
    trashStore.$patch({ items: [{ id: 7 }] as never, initialized: true });

    enqueueBatchMock.mockRejectedValue(new Error('Admin access is required.'));

    const outcome = await trashStore.deletePermanently([7]);

    expect(outcome).toEqual({ succeededCount: 0, failedCount: 1 });
    expect(trashStore.deletionActive).toBe(false);
    expect(trashStore.deletionErrorMessage).toBe('Admin access is required.');
    expect(trashStore.items.map((item) => item.id)).toEqual([7]);
  });

  it('polls until the server job finishes and then refreshes the page', async () => {
    vi.useFakeTimers();
    const trashStore = useTrashStore();
    trashStore.$patch({
      items: [11, 12].map((id) => ({ id }) as never),
      initialized: true
    });

    enqueueBatchMock.mockResolvedValue(createJob({ total: 2, remaining: 2 }));
    fetchJobMock
      .mockResolvedValueOnce(createJob({ total: 2, processed: 1, remaining: 1, deletedIds: [11] }))
      .mockResolvedValueOnce(
        createJob({
          active: false,
          total: 2,
          processed: 2,
          remaining: 0,
          deletedIds: [11, 12],
          finishedAt: '2026-08-30T10:01:00.000Z'
        })
      );
    fetchTrashImagesMock.mockResolvedValue({ items: [], page: 1, limit: 24, total: 0, hasMore: false });

    await trashStore.deletePermanently([11, 12]);

    await vi.advanceTimersByTimeAsync(1500);
    expect(trashStore.deletionProcessed).toBe(1);
    expect(trashStore.items.map((item) => item.id)).toEqual([12]);

    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchJobMock).toHaveBeenCalledTimes(2);
    expect(trashStore.deletionActive).toBe(false);
    expect(trashStore.items).toEqual([]);
    expect(fetchTrashImagesMock).toHaveBeenCalled();
  });

  it('reconnects to a job that is still running from an earlier session', async () => {
    vi.useFakeTimers();
    const trashStore = useTrashStore();
    trashStore.$patch({ items: [{ id: 21 }] as never, initialized: true });

    fetchJobMock.mockResolvedValue(createJob({ total: 4, processed: 2, remaining: 2 }));

    await trashStore.syncDeletionJob();

    expect(trashStore.deletionActive).toBe(true);
    expect(trashStore.deletionTotal).toBe(4);

    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchJobMock).toHaveBeenCalledTimes(2);
  });

  it('clears the finished job banner when the result is dismissed', async () => {
    const trashStore = useTrashStore();
    trashStore.$patch({
      deletionActive: false,
      deletionTotal: 3,
      deletionProcessed: 3,
      deletionFailedCount: 1,
      deletionErrorMessage: 'Read-only file system'
    });

    acknowledgeJobMock.mockResolvedValue(
      createJob({ active: false, total: 0, processed: 0, remaining: 0, startedAt: null })
    );

    await trashStore.dismissDeletionResult();

    expect(acknowledgeJobMock).toHaveBeenCalled();
    expect(trashStore.deletionFailedCount).toBe(0);
    expect(trashStore.deletionErrorMessage).toBeNull();
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
