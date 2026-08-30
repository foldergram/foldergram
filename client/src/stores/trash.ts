import { defineStore } from 'pinia';

import {
  acknowledgePermanentDeletionJob,
  enqueuePermanentDeletionBatch,
  fetchPermanentDeletionJob,
  fetchTrashImages
} from '../api/gallery';
import type { PermanentDeletionJob, TrashItem } from '../types/api';
import { updateCaptionInItems } from '../utils/caption';

interface TrashState {
  items: TrashItem[];
  page: number;
  limit: number;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  initialized: boolean;
  deletionActive: boolean;
  deletionTotal: number;
  deletionProcessed: number;
  deletionFailedCount: number;
  deletionErrorMessage: string | null;
}

export interface PermanentDeletionOutcome {
  succeededCount: number;
  failedCount: number;
}

// The batch runs on the server, so the client only polls for progress. Polling
// slowly keeps the cost negligible while the user browses other pages.
const DELETION_POLL_INTERVAL_MS = 1500;
let deletionPollTimer: ReturnType<typeof setTimeout> | null = null;

function stopDeletionPolling() {
  if (deletionPollTimer !== null) {
    clearTimeout(deletionPollTimer);
    deletionPollTimer = null;
  }
}

export const useTrashStore = defineStore('trash', {
  state: (): TrashState => ({
    items: [],
    page: 1,
    limit: 24,
    hasMore: true,
    loading: false,
    error: null,
    initialized: false,
    deletionActive: false,
    deletionTotal: 0,
    deletionProcessed: 0,
    deletionFailedCount: 0,
    deletionErrorMessage: null
  }),
  actions: {
    removeItems(ids: number[]) {
      if (ids.length === 0) {
        return;
      }

      const idSet = new Set(ids);
      this.items = this.items.filter((item) => !idSet.has(item.id));
    },

    reset() {
      this.items = [];
      this.page = 1;
      this.hasMore = true;
      this.loading = false;
      this.error = null;
      this.initialized = false;
      this.clearDeletionProgress();
    },

    clearDeletionProgress() {
      stopDeletionPolling();
      this.deletionActive = false;
      this.deletionTotal = 0;
      this.deletionProcessed = 0;
      this.deletionFailedCount = 0;
      this.deletionErrorMessage = null;
    },

    applyDeletionJob(job: PermanentDeletionJob) {
      this.deletionActive = job.active;
      this.deletionTotal = job.total;
      this.deletionProcessed = job.processed;
      this.deletionFailedCount = job.failedCount;
      this.deletionErrorMessage = job.errorMessage;

      if (job.deletedIds.length > 0) {
        this.removeItems(job.deletedIds);
      }
    },

    /**
     * Hands the batch to the server so it keeps running even if the app is closed,
     * then polls for progress while this client stays open.
     */
    async deletePermanently(ids: number[]): Promise<PermanentDeletionOutcome> {
      if (ids.length === 0) {
        return {
          succeededCount: 0,
          failedCount: 0
        };
      }

      try {
        const payload = await enqueuePermanentDeletionBatch(ids);
        this.applyDeletionJob(payload.job);
      } catch (error) {
        this.deletionErrorMessage = error instanceof Error ? error.message : 'Unable to start deletion';
        this.deletionActive = false;
        return {
          succeededCount: 0,
          failedCount: ids.length
        };
      }

      this.startDeletionPolling();

      return {
        succeededCount: 0,
        failedCount: 0
      };
    },

    startDeletionPolling() {
      stopDeletionPolling();

      const poll = async () => {
        try {
          const payload = await fetchPermanentDeletionJob();
          this.applyDeletionJob(payload.job);

          if (payload.job.active) {
            deletionPollTimer = setTimeout(() => void poll(), DELETION_POLL_INTERVAL_MS);
            return;
          }

          deletionPollTimer = null;
          if (payload.job.total > 0) {
            // Refresh the visible page once so counts settle after the batch.
            void this.loadInitial(true);
          }
        } catch {
          // A transient poll failure should not kill progress reporting.
          deletionPollTimer = setTimeout(() => void poll(), DELETION_POLL_INTERVAL_MS);
        }
      };

      deletionPollTimer = setTimeout(() => void poll(), DELETION_POLL_INTERVAL_MS);
    },

    /** Picks up a batch that is still running from an earlier session. */
    async syncDeletionJob() {
      try {
        const payload = await fetchPermanentDeletionJob();
        this.applyDeletionJob(payload.job);

        if (payload.job.active) {
          this.startDeletionPolling();
        }
      } catch {
        // Ignore: the trash page still works without job status.
      }
    },

    async dismissDeletionResult() {
      stopDeletionPolling();

      try {
        const payload = await acknowledgePermanentDeletionJob();
        this.applyDeletionJob(payload.job);
      } catch {
        this.clearDeletionProgress();
      }
    },

    async loadInitial(force = false) {
      if (this.loading) {
        return;
      }

      if (this.initialized && !force) {
        return;
      }

      const preserveExistingState = force && this.initialized;

      this.page = 1;
      this.hasMore = true;

      if (!preserveExistingState) {
        this.items = [];
        this.error = null;
        this.initialized = false;
      }

      this.loading = true;
      this.error = null;

      try {
        const payload = await fetchTrashImages(this.page, this.limit);
        this.items = payload.items;
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to load trash';
      } finally {
        this.loading = false;
      }
    },

    async loadMore() {
      if (this.loading || !this.hasMore) {
        return;
      }

      this.loading = true;
      this.error = null;

      try {
        const payload = await fetchTrashImages(this.page, this.limit);
        this.items.push(...payload.items);
        this.page += 1;
        this.hasMore = payload.hasMore;
        this.initialized = true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to load trash';
      } finally {
        this.loading = false;
      }
    },

    updateImageCaption(id: number, caption: string | null) {
      this.items = updateCaptionInItems(this.items, id, caption);
    }
  }
});
