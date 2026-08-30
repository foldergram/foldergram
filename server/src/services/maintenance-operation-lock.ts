export const PERMANENT_DELETION_QUARANTINE_DIRECTORY_NAME = '.foldergram-delete-quarantine';

export type MaintenanceOperationPriority = 'interactive' | 'background';

export interface MaintenanceOperationContext {
  /** True when a higher-priority operation is waiting for the lock. */
  isContended(): boolean;
  /** Releases the lock so waiting higher-priority work runs, then re-acquires it. */
  yieldToHigherPriority(): Promise<void>;
}

export interface MaintenanceOperationOptions {
  priority?: MaintenanceOperationPriority;
}

interface LockWaiter {
  resolve: () => void;
}

/**
 * Scans and rebuilds hold this lock for many minutes. Interactive work
 * (permanent deletion, lazy derivative generation) runs at `interactive`
 * priority so it is handed the lock at the next background yield point instead
 * of waiting for the whole scan to finish.
 */
class MaintenanceOperationLock {
  private locked = false;
  private interactiveQueue: LockWaiter[] = [];
  private backgroundQueue: LockWaiter[] = [];

  private acquire(priority: MaintenanceOperationPriority): Promise<void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      const waiter: LockWaiter = { resolve };
      if (priority === 'interactive') {
        this.interactiveQueue.push(waiter);
      } else {
        this.backgroundQueue.push(waiter);
      }
    });
  }

  private release(): void {
    const next = this.interactiveQueue.shift() ?? this.backgroundQueue.shift();
    if (next) {
      // Hand the lock straight to the next waiter so nothing can slip in between.
      next.resolve();
      return;
    }

    this.locked = false;
  }

  async runExclusive<T>(
    operation: (context: MaintenanceOperationContext) => Promise<T>,
    options: MaintenanceOperationOptions = {}
  ): Promise<T> {
    const priority = options.priority ?? 'interactive';
    await this.acquire(priority);

    const context: MaintenanceOperationContext = {
      isContended: () => priority === 'background' && this.interactiveQueue.length > 0,
      yieldToHigherPriority: async () => {
        if (priority !== 'background' || this.interactiveQueue.length === 0) {
          return;
        }

        this.release();
        await this.acquire(priority);
      }
    };

    try {
      return await operation(context);
    } finally {
      this.release();
    }
  }
}

export const maintenanceOperationLock = new MaintenanceOperationLock();
