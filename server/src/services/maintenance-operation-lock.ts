export const PERMANENT_DELETION_QUARANTINE_DIRECTORY_NAME = '.foldergram-delete-quarantine';

export class MaintenancePausedError extends Error {
  readonly status = 409;

  constructor() {
    super('A library scan is paused or stopping. Resume it or wait for it to stop, then retry.');
  }
}

class MaintenanceOperationLock {
  private tail: Promise<void> = Promise.resolve();
  private suspended = false;
  private waiting = new Set<() => void>();

  suspendConflictingRequests(): void {
    this.suspended = true;
    for (const reject of this.waiting) reject();
    this.waiting.clear();
  }

  resumeConflictingRequests(): void {
    this.suspended = false;
  }

  runExclusive<T>(operation: () => Promise<T>, options: { waitDuringPause?: boolean } = {}): Promise<T> {
    if (options.waitDuringPause) return this.enqueue(operation);
    if (this.suspended) return Promise.reject(new MaintenancePausedError());

    return new Promise<T>((resolve, reject) => {
      let interrupted = false;
      const interrupt = () => {
        interrupted = true;
        reject(new MaintenancePausedError());
      };
      this.waiting.add(interrupt);
      void this.enqueue(async () => {
        this.waiting.delete(interrupt);
        if (interrupted) return;
        try {
          resolve(await operation());
        } catch (error) {
          reject(error);
        }
      });
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export const maintenanceOperationLock = new MaintenanceOperationLock();
