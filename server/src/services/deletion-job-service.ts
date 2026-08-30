import { PERMANENT_DELETION_JOB_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository } from '../db/repositories.js';
import { galleryService } from './gallery-service.js';
import { log } from './log-service.js';
import { storageService } from './storage-service.js';

const JOB_VERSION = 1;
/** Keeps the persisted payload and the polling response small on huge batches. */
const MAX_REPORTED_DELETED_IDS = 2000;

interface PersistedDeletionJob {
  version: number;
  remainingIds: number[];
  deletedIds: number[];
  total: number;
  processed: number;
  failedCount: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface DeletionJobSnapshot {
  active: boolean;
  total: number;
  processed: number;
  remaining: number;
  failedCount: number;
  errorMessage: string | null;
  deletedIds: number[];
  startedAt: string | null;
  finishedAt: string | null;
}

const idleSnapshot: DeletionJobSnapshot = {
  active: false,
  total: 0,
  processed: 0,
  remaining: 0,
  failedCount: 0,
  errorMessage: null,
  deletedIds: [],
  startedAt: null,
  finishedAt: null
};

function parsePersistedJob(value: string | null): PersistedDeletionJob | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<PersistedDeletionJob>;
    if (
      parsed.version !== JOB_VERSION ||
      !Array.isArray(parsed.remainingIds) ||
      !Array.isArray(parsed.deletedIds) ||
      typeof parsed.total !== 'number' ||
      typeof parsed.processed !== 'number' ||
      typeof parsed.failedCount !== 'number' ||
      typeof parsed.startedAt !== 'string'
    ) {
      return null;
    }

    return {
      version: JOB_VERSION,
      remainingIds: parsed.remainingIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0),
      deletedIds: parsed.deletedIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0),
      total: parsed.total,
      processed: parsed.processed,
      failedCount: parsed.failedCount,
      errorMessage: typeof parsed.errorMessage === 'string' ? parsed.errorMessage : null,
      startedAt: parsed.startedAt,
      finishedAt: typeof parsed.finishedAt === 'string' ? parsed.finishedAt : null
    };
  } catch {
    return null;
  }
}

/**
 * Runs permanent deletions as a server-side job so a batch keeps going after the
 * browser tab is closed. Progress is persisted after every item, letting an
 * interrupted job resume on the next server start.
 */
class DeletionJobService {
  private job: PersistedDeletionJob | null = null;
  private runner: Promise<void> | null = null;
  private loaded = false;

  private load(): void {
    if (this.loaded) {
      return;
    }

    this.job = parsePersistedJob(appSettingsRepository.get(PERMANENT_DELETION_JOB_SETTING_KEY));
    this.loaded = true;
  }

  private persist(): void {
    if (!this.job) {
      appSettingsRepository.remove(PERMANENT_DELETION_JOB_SETTING_KEY);
      return;
    }

    appSettingsRepository.set(PERMANENT_DELETION_JOB_SETTING_KEY, JSON.stringify(this.job));
  }

  private toSnapshot(): DeletionJobSnapshot {
    if (!this.job) {
      return { ...idleSnapshot };
    }

    return {
      active: this.job.finishedAt === null,
      total: this.job.total,
      processed: this.job.processed,
      remaining: this.job.remainingIds.length,
      failedCount: this.job.failedCount,
      errorMessage: this.job.errorMessage,
      deletedIds: [...this.job.deletedIds],
      startedAt: this.job.startedAt,
      finishedAt: this.job.finishedAt
    };
  }

  getSnapshot(): DeletionJobSnapshot {
    this.load();
    return this.toSnapshot();
  }

  /** Clears a finished job so its result banner stops being reported. */
  acknowledgeFinished(): DeletionJobSnapshot {
    this.load();
    if (this.job && this.job.finishedAt !== null) {
      this.job = null;
      this.persist();
    }

    return this.toSnapshot();
  }

  enqueue(ids: number[]): DeletionJobSnapshot {
    this.load();
    const requestedIds = [...new Set(ids)].filter((id) => Number.isSafeInteger(id) && id > 0);
    if (requestedIds.length === 0) {
      return this.toSnapshot();
    }

    if (this.job && this.job.finishedAt === null) {
      // Merge into the running job instead of starting a competing one.
      const known = new Set([...this.job.remainingIds, ...this.job.deletedIds]);
      const addedIds = requestedIds.filter((id) => !known.has(id));
      this.job.remainingIds.push(...addedIds);
      this.job.total += addedIds.length;
    } else {
      this.job = {
        version: JOB_VERSION,
        remainingIds: requestedIds,
        deletedIds: [],
        total: requestedIds.length,
        processed: 0,
        failedCount: 0,
        errorMessage: null,
        startedAt: new Date().toISOString(),
        finishedAt: null
      };
    }

    this.persist();
    this.startRunner();
    return this.toSnapshot();
  }

  /** Restarts an interrupted job after a server restart. */
  resumePendingJob(): void {
    this.load();
    if (!this.job || this.job.finishedAt !== null || this.job.remainingIds.length === 0) {
      return;
    }

    log.info('Resuming interrupted permanent deletion batch', {
      remaining: this.job.remainingIds.length,
      total: this.job.total
    });
    this.startRunner();
  }

  private startRunner(): void {
    if (this.runner) {
      return;
    }

    this.runner = this.run().finally(() => {
      this.runner = null;
    });
  }

  private async run(): Promise<void> {
    for (;;) {
      const job = this.job;
      if (!job || job.finishedAt !== null) {
        return;
      }

      const nextId = job.remainingIds.shift();
      if (nextId === undefined) {
        job.finishedAt = new Date().toISOString();
        this.persist();
        log.info('Permanent deletion batch finished', {
          total: job.total,
          processed: job.processed,
          failed: job.failedCount
        });
        return;
      }

      if (!storageService.getState().libraryAvailable) {
        // Keep the id queued so the batch resumes once storage is back.
        job.remainingIds.unshift(nextId);
        job.errorMessage = 'Configured library storage is unavailable.';
        job.finishedAt = new Date().toISOString();
        this.persist();
        return;
      }

      try {
        const deleted = await galleryService.deleteImage(nextId);
        if (deleted) {
          if (job.deletedIds.length < MAX_REPORTED_DELETED_IDS) {
            job.deletedIds.push(nextId);
          }
        } else {
          job.failedCount += 1;
          job.errorMessage ??= 'Post not found or the library index needs a rebuild.';
        }
      } catch (error) {
        job.failedCount += 1;
        const message = error instanceof Error ? error.message : String(error);
        job.errorMessage ??= message;
        log.error('Permanent deletion batch item failed', { postId: nextId, error: message });
      } finally {
        job.processed += 1;
        this.persist();
      }
    }
  }
}

export const deletionJobService = new DeletionJobService();
