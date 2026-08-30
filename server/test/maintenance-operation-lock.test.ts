import { describe, expect, it } from 'vitest';

import { maintenanceOperationLock } from '../src/services/maintenance-operation-lock.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolveFn) => {
    resolve = resolveFn;
  });
  return { promise, resolve };
}

describe('maintenanceOperationLock priorities', () => {
  it('runs queued operations exclusively', async () => {
    const order: string[] = [];
    const first = maintenanceOperationLock.runExclusive(async () => {
      order.push('first:start');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      order.push('first:end');
    });
    const second = maintenanceOperationLock.runExclusive(async () => {
      order.push('second');
    });

    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
  });

  it('lets interactive work preempt a background holder at its yield point', async () => {
    const order: string[] = [];
    const backgroundReachedYield = deferred();
    const interactiveQueued = deferred();

    const background = maintenanceOperationLock.runExclusive(
      async (context) => {
        order.push('background:batch-1');
        expect(context.isContended()).toBe(false);
        backgroundReachedYield.resolve();
        await interactiveQueued.promise;

        expect(context.isContended()).toBe(true);
        await context.yieldToHigherPriority();
        order.push('background:batch-2');
      },
      { priority: 'background' }
    );

    await backgroundReachedYield.promise;
    const interactive = maintenanceOperationLock.runExclusive(async () => {
      order.push('interactive');
    });
    // Give the interactive acquisition a turn to register in the queue.
    await new Promise<void>((resolve) => setImmediate(resolve));
    interactiveQueued.resolve();

    await Promise.all([background, interactive]);
    expect(order).toEqual(['background:batch-1', 'interactive', 'background:batch-2']);
  });

  it('does not yield when no interactive work is waiting', async () => {
    const order: string[] = [];
    await maintenanceOperationLock.runExclusive(
      async (context) => {
        order.push('batch-1');
        await context.yieldToHigherPriority();
        order.push('batch-2');
      },
      { priority: 'background' }
    );

    expect(order).toEqual(['batch-1', 'batch-2']);
  });

  it('releases the lock when a background operation throws', async () => {
    await expect(
      maintenanceOperationLock.runExclusive(
        async () => {
          throw new Error('scan failed');
        },
        { priority: 'background' }
      )
    ).rejects.toThrow('scan failed');

    await expect(maintenanceOperationLock.runExclusive(async () => 'recovered')).resolves.toBe('recovered');
  });
});
