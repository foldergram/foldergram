import { defineStore } from 'pinia';

import {
  acknowledgeScanIssues,
  controlScanOperation,
  fetchAdminScanProgress,
  fetchScanProgress,
  fetchStats as fetchStatus
} from '../api/gallery';
import {
  DEFAULT_LOCALE,
  i18n,
  resolvePreferredLocale,
  resolveSupportedLocale,
  syncDocumentLanguage,
  type SupportedLocale
} from '../locales';
import type { AppStatus, FeedMode, FolderImageOrder, ReelsFeedMode, ScanControl, ScanProgress, ScanRunSummary } from '../types/api';
import { useAuthStore } from './auth';

interface AppState {
  stats: AppStatus | null;
  loadingStats: boolean;
  error: string | null;
  theme: 'light' | 'dark';
  locale: SupportedLocale;
  videoMuted: boolean;
  lastOpenedFolderSlug: string | null;
  recentOpenedFolderSlugs: string[];
  imageModalBackgroundPath: string | null;
  statsPollFailures: number;
  statsPollTimer: number | null;
  scanStatusUnavailable: boolean;
  scanControlPending: boolean;
  scanControlError: boolean;
  acknowledgedScanResults: string[];
  scanAcknowledgementPending: boolean;
  scanAcknowledgementError: boolean;
  scanCompletion: { result: ScanRunSummary; surface: string | null } | null;
}

const LOCALE_STORAGE_KEY = 'foldergram-locale';
const VIDEO_MUTED_STORAGE_KEY = 'foldergram-video-muted';
const LAST_OPENED_FOLDER_STORAGE_KEY = 'foldergram-last-opened-folder';
const RECENT_OPENED_FOLDERS_STORAGE_KEY = 'foldergram-recent-opened-folders';
const RECENT_OPENED_FOLDERS_LIMIT = 24;
const SCAN_PROGRESS_POLL_INTERVAL_MS = 1000;
const IDLE_SCAN_POLL_INTERVAL_MS = 5000;
const SCAN_COMPLETION_DURATION_MS = 6000;

function readLegacyScanAcknowledgements(): Set<string> {
  const keys = new Set<string>();
  for (const storage of ['localStorage', 'sessionStorage'] as const) {
    try {
      const saved: unknown = JSON.parse(window[storage].getItem('foldergram-scan-acknowledgements') ?? '[]');
      if (Array.isArray(saved)) {
        for (const key of saved.slice(-50)) if (typeof key === 'string') keys.add(key);
      }
    } catch {
      // Browser storage is only needed to migrate acknowledgements from older clients.
    }
  }
  return keys;
}

function scanResultKey(result: ScanRunSummary): string {
  return [result.id, result.started_at, result.finished_at].join('/');
}

function scanIssueGroupKey(result: ScanRunSummary): string {
  return JSON.stringify([result.source_id ?? null, result.status, result.error_text, result.warning_text]);
}

let protectedStateGeneration = 0;
let inFlightStatusRequest: Promise<AppStatus> | null = null;
let inFlightScanRequest: Promise<void> | null = null;
let scanSnapshotRevision = 0;
let scanCapabilityGeneration = 0;
let completionTimer: number | undefined;
let discoverScanUntil = 0;

function parseStoredRecentFolderSlugs(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry, index, items) => entry.length > 0 && items.indexOf(entry) === index)
      .slice(0, RECENT_OPENED_FOLDERS_LIMIT);
  } catch {
    return [];
  }
}

function getStoredLocalePreference(): SupportedLocale | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return resolveSupportedLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
}

function getBrowserLocaleCandidates(): string[] {
  if (typeof navigator === 'undefined') {
    return [];
  }

  return [...(Array.isArray(navigator.languages) ? navigator.languages : []), navigator.language];
}

function resolveSavedDefaultLocale(locale: string | null | undefined): SupportedLocale | null {
  return resolveSupportedLocale(locale);
}

export const useAppStore = defineStore('app', {
  state: (): AppState => ({
    stats: null,
    loadingStats: false,
    error: null,
    theme: 'light',
    locale: DEFAULT_LOCALE,
    videoMuted: true,
    lastOpenedFolderSlug: null,
    recentOpenedFolderSlugs: [],
    imageModalBackgroundPath: null,
    statsPollFailures: 0,
    statsPollTimer: null,
    scanStatusUnavailable: false,
    scanControlPending: false,
    scanControlError: false,
    acknowledgedScanResults: [],
    scanAcknowledgementPending: false,
    scanAcknowledgementError: false,
    scanCompletion: null
  }),
  getters: {
    isLibraryUnavailable: (state) => state.stats?.storage.available === false,
    libraryUnavailableReason: (state) => state.stats?.storage.reason ?? i18n.global.t('common.libraryUnavailableReason'),
    isLibraryRebuildRequired: (state) => state.stats?.libraryIndex.rebuildRequired === true,
    isScanning: (state) => state.stats?.scan.isScanning === true,
    isRebuilding: (state) => state.stats?.scan.isScanning === true && state.stats?.scan.scanReason === 'rebuild',
    hasCompletedScan: (state) => Boolean(state.stats?.scan.lastCompletedScan),
    unacknowledgedScanResults(state): ScanRunSummary[] {
      const issues = state.stats?.scan.recentIssues?.filter(result =>
        !state.acknowledgedScanResults.includes(scanResultKey(result))
      ) ?? [];
      if (!issues.length) return [];
      const groupKey = scanIssueGroupKey(issues[0]);
      return issues.filter(result => scanIssueGroupKey(result) === groupKey);
    },
    unacknowledgedScanResult(): ScanRunSummary | null {
      return this.unacknowledgedScanResults[0] ?? null;
    },
    isInitialScan: (state) => state.stats?.scan.isScanning === true && state.stats?.scan.lastCompletedScan === null,
    defaultHomeFeedMode: (state): FeedMode => state.stats?.preferences.defaultHomeFeedMode ?? 'random',
    savedDefaultLocale: (state): SupportedLocale | null => resolveSupportedLocale(state.stats?.preferences.defaultLocale ?? null),
    defaultReelsFeedMode: (state): ReelsFeedMode => state.stats?.preferences.defaultReelsFeedMode ?? 'random',
    defaultFolderImageOrder: (state): FolderImageOrder => state.stats?.preferences.defaultFolderImageOrder ?? 'newest',
    nestedFolderTitleFormat: (state) => state.stats?.preferences.nestedFolderTitleFormat ?? 'folder',
    treatStoriesAsFolders: (state) => state.stats?.preferences.treatStoriesAsFolders === true,
    treatCarouselsAsFolders: (state) => state.stats?.preferences.treatCarouselsAsFolders === true,
    isCarouselsReconciliationPending: (state) => state.stats?.carouselsMigration?.reconciliationPending === true
  },
  actions: {
    persistOpenedFolderState() {
      if (this.lastOpenedFolderSlug) {
        window.localStorage.setItem(LAST_OPENED_FOLDER_STORAGE_KEY, this.lastOpenedFolderSlug);
      } else {
        window.localStorage.removeItem(LAST_OPENED_FOLDER_STORAGE_KEY);
      }

      window.localStorage.setItem(
        RECENT_OPENED_FOLDERS_STORAGE_KEY,
        JSON.stringify(this.recentOpenedFolderSlugs.slice(0, RECENT_OPENED_FOLDERS_LIMIT))
      );
    },

    initializeLocale() {
      const rawStoredLocale = typeof window === 'undefined' ? null : window.localStorage.getItem(LOCALE_STORAGE_KEY);
      const storedLocale = resolveSupportedLocale(rawStoredLocale);

      if (typeof window !== 'undefined') {
        if (rawStoredLocale && storedLocale && rawStoredLocale !== storedLocale) {
          window.localStorage.setItem(LOCALE_STORAGE_KEY, storedLocale);
        }

        if (rawStoredLocale && !storedLocale) {
          window.localStorage.removeItem(LOCALE_STORAGE_KEY);
        }
      }

      if (storedLocale) {
        this.setLocale(storedLocale, { persist: false });
        return;
      }

      this.setLocale(resolvePreferredLocale(...getBrowserLocaleCandidates()), { persist: false });
    },

    initializeLastOpenedFolder() {
      const savedSlug = window.localStorage.getItem(LAST_OPENED_FOLDER_STORAGE_KEY);
      this.lastOpenedFolderSlug = savedSlug && savedSlug.length > 0 ? savedSlug : null;

      const savedRecentSlugs = parseStoredRecentFolderSlugs(window.localStorage.getItem(RECENT_OPENED_FOLDERS_STORAGE_KEY));
      this.recentOpenedFolderSlugs = this.lastOpenedFolderSlug
        ? [this.lastOpenedFolderSlug, ...savedRecentSlugs.filter((slug) => slug !== this.lastOpenedFolderSlug)]
        : savedRecentSlugs;

      this.persistOpenedFolderState();
    },

    setTheme(theme: 'light' | 'dark') {
      this.theme = theme;
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    },

    setLocale(locale: string | SupportedLocale, options: { persist?: boolean } = {}) {
      const resolvedLocale = resolvePreferredLocale(locale);

      this.locale = resolvedLocale;
      i18n.global.locale.value = resolvedLocale;
      syncDocumentLanguage(resolvedLocale);

      if ((options.persist ?? true) && typeof window !== 'undefined') {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, resolvedLocale);
      }
    },

    syncLocaleFromSavedDefault(defaultLocale: string | null | undefined) {
      if (getStoredLocalePreference()) {
        return;
      }

      const resolvedLocale = resolveSavedDefaultLocale(defaultLocale);
      if (!resolvedLocale) {
        return;
      }

      this.setLocale(resolvedLocale, { persist: false });
    },

    syncLocaleFromStats(stats?: AppStatus | null) {
      this.syncLocaleFromSavedDefault((stats ?? this.stats)?.preferences.defaultLocale ?? null);
    },

    syncLocaleFromAuthStatus(defaultLocale: string | null | undefined) {
      this.syncLocaleFromSavedDefault(defaultLocale);
    },

    initializeVideoMuted() {
      const savedPreference = window.localStorage.getItem(VIDEO_MUTED_STORAGE_KEY);
      this.videoMuted = savedPreference === 'false' ? false : true;
    },

    setVideoMuted(videoMuted: boolean) {
      this.videoMuted = videoMuted;
      window.localStorage.setItem(VIDEO_MUTED_STORAGE_KEY, String(videoMuted));
    },

    recordOpenedFolder(slug: string) {
      this.lastOpenedFolderSlug = slug;
      this.recentOpenedFolderSlugs = [slug, ...this.recentOpenedFolderSlugs.filter((entry) => entry !== slug)].slice(
        0,
        RECENT_OPENED_FOLDERS_LIMIT
      );
      this.persistOpenedFolderState();
    },

    setImageModalBackground(path: string) {
      this.imageModalBackgroundPath = path;
    },

    clearImageModalBackground() {
      this.imageModalBackgroundPath = null;
    },

    markLibraryRebuildStarted() {
      if (!this.stats) {
        return;
      }

      this.error = null;
      this.stats = {
        ...this.stats,
        folders: 0,
        indexedImages: 0,
        indexedVideos: 0,
        scan: {
          ...this.stats.scan,
          isScanning: true,
          scanReason: 'rebuild',
          phase: 'discovery',
          startedAt: new Date().toISOString(),
          runId: null,
          migrationTotalRows: 0,
          processedMigrationRows: 0,
          migratedDerivativeFiles: 0,
          missingDerivativeFiles: 0,
          repairedDerivativeFiles: 0,
          backfilledAssetKeys: 0,
          discoveredFolders: 0,
          processedFolders: 0,
          discoveredImages: 0,
          processedImages: 0,
          queuedDerivativeJobs: 0,
          processedDerivativeJobs: 0,
          generatedThumbnails: 0,
          generatedPreviews: 0,
          currentOperation: 'discovering_media',
          currentFile: null,
          currentPhaseMessage: 'Discovering folders and media for the current gallery root.',
          currentFolder: null
        }
      };
      this.startStatsPolling();
    },

    acknowledgeScanResult(result: ScanRunSummary) {
      return this.acknowledgeScanResults([result]);
    },

    async acknowledgeScanResults(results: readonly ScanRunSummary[]) {
      if (!this.shouldUseAdminScanProgress() || useAuthStore().publicDemoMode || this.scanAcknowledgementPending) return;
      const keys = results.map(scanResultKey);
      if (keys.every(key => this.acknowledgedScanResults.includes(key))) return;

      const requestGeneration = scanCapabilityGeneration;
      this.scanAcknowledgementPending = true;
      this.scanAcknowledgementError = false;
      try {
        await acknowledgeScanIssues(results);
        if (requestGeneration !== scanCapabilityGeneration) return;
        // Keep an older in-flight poll from restoring issues already saved as acknowledged.
        this.acknowledgedScanResults = [...new Set([...this.acknowledgedScanResults, ...keys])].slice(-50);
      } catch {
        if (requestGeneration === scanCapabilityGeneration) this.scanAcknowledgementError = true;
      } finally {
        if (requestGeneration === scanCapabilityGeneration) this.scanAcknowledgementPending = false;
      }
    },

    showScanCompletion(result: ScanRunSummary | null, surface: string | null) {
      if (!result || !this.shouldUseAdminScanProgress() ||
          (this.stats?.scan.lastCompletedScan?.id ?? 0) > result.id ||
          (this.scanCompletion?.result.id ?? 0) > result.id) return;
      window.clearTimeout(completionTimer);
      this.scanCompletion = { result: { ...result, error_text: null, warning_text: null }, surface };
      if (surface !== null) {
        completionTimer = window.setTimeout(() => {
          if (this.scanCompletion?.surface === surface) this.scanCompletion = null;
        }, SCAN_COMPLETION_DURATION_MS);
      }
    },

    reviewDeferredScanCompletion() {
      if (this.scanCompletion?.surface === null) this.scanCompletion = null;
    },

    discardSupersededScanCompletion(latest: ScanRunSummary | null) {
      if (!latest || !this.scanCompletion || latest.id <= this.scanCompletion.result.id) return;
      window.clearTimeout(completionTimer);
      this.scanCompletion = null;
    },

    leaveScanSurface(fullPath: string) {
      if (this.scanCompletion?.surface === fullPath) this.scanCompletion = null;
    },

    scanStatusPending() {
      discoverScanUntil = Date.now() + 3000;
      this.refreshVisibleScanStatus();
    },

    startStatsPolling() {
      if (this.statsPollTimer !== null || document.visibilityState === 'hidden') return;

      const running = this.stats?.scan.isScanning && this.stats.scan.operation?.state !== 'paused';
      const delay = running || Date.now() < discoverScanUntil
        ? SCAN_PROGRESS_POLL_INTERVAL_MS
        : IDLE_SCAN_POLL_INTERVAL_MS;
      this.statsPollTimer = window.setTimeout(() => {
        if (document.visibilityState === 'hidden') {
          this.statsPollTimer = null;
          return;
        }

        const timer = this.statsPollTimer;
        void this.refreshScanProgress().finally(() => {
          if (this.statsPollTimer !== timer) return;
          this.statsPollTimer = null;
          this.startStatsPolling();
        });
      }, delay);
    },

    stopStatsPolling() {
      if (this.statsPollTimer === null) return;
      window.clearTimeout(this.statsPollTimer);
      this.statsPollTimer = null;
    },

    refreshVisibleScanStatus() {
      this.stopStatsPolling();
      if (document.visibilityState === 'hidden') return;
      void this.refreshScanProgress();
      this.startStatsPolling();
    },

    resetScanCapability() {
      scanCapabilityGeneration += 1;
      inFlightScanRequest = null;
      window.clearTimeout(completionTimer);
      this.scanCompletion = null;
      this.scanControlPending = false;
      this.scanControlError = false;
      this.acknowledgedScanResults = [];
      this.scanAcknowledgementPending = false;
      this.scanAcknowledgementError = false;
      if (this.stats && !this.shouldUseAdminScanProgress()) {
        const { lastCompletedScan, operation } = this.stats.scan;
        this.updateScanProgress({
          ...this.stats.scan,
          currentFile: null,
          currentFolder: null,
          recentIssues: [],
          operation: operation && { state: operation.state, controls: [] },
          lastCompletedScan: lastCompletedScan && { ...lastCompletedScan, error_text: null, warning_text: null }
        });
      }
    },

    resetProtectedState() {
      protectedStateGeneration += 1;
      inFlightStatusRequest = null;
      this.stopStatsPolling();
      this.resetScanCapability();
      discoverScanUntil = 0;
      this.stats = null;
      this.statsPollFailures = 0;
      this.scanStatusUnavailable = false;
      this.loadingStats = false;
      this.error = null;
      this.imageModalBackgroundPath = null;
    },

    shouldUseAdminScanProgress() {
      return useAuthStore().canAccessSettings;
    },

    updateScanProgress(progress: ScanProgress) {
      if (!this.stats) {
        return;
      }

      scanSnapshotRevision += 1;
      this.discardSupersededScanCompletion(progress.lastCompletedScan);
      this.stats = {
        ...this.stats,
        scan: progress
      };
    },

    removeIndexedImage(removedFolderCount = 0, mediaType: 'image' | 'video' = 'image') {
      if (!this.stats) {
        return;
      }

      this.stats.folders = Math.max(0, this.stats.folders - removedFolderCount);
      this.stats.indexedImages = Math.max(0, this.stats.indexedImages - 1);
      if (mediaType === 'video') {
        this.stats.indexedVideos = Math.max(0, this.stats.indexedVideos - 1);
      }
    },

    removeFolder(deletedImageCount: number) {
      if (!this.stats) {
        return;
      }

      this.stats.folders = Math.max(0, this.stats.folders - 1);
      this.stats.indexedImages = Math.max(0, this.stats.indexedImages - deletedImageCount);
    },

    async fetchStats(options: { background?: boolean } = {}) {
      const requestGeneration = protectedStateGeneration;

      if (!options.background) {
        this.loadingStats = true;
        this.error = null;
      }

      const revision = scanSnapshotRevision;
      const statusRequest = inFlightStatusRequest ?? fetchStatus();
      const requestRevision = inFlightStatusRequest ? -1 : revision;
      inFlightStatusRequest = statusRequest;

      try {
        const stats = await statusRequest;

        if (requestGeneration !== protectedStateGeneration) {
          return;
        }

        // Status carries a viewer-safe snapshot. Keep any newer lightweight response
        // and preserve diagnostics if both snapshots describe the same operation.
        const previous = this.stats?.scan;
        const sameProgress = previous && previous.isScanning === stats.scan.isScanning &&
          previous.runId === stats.scan.runId && previous.lastCompletedScan?.id === stats.scan.lastCompletedScan?.id;
        const scan = previous && (requestRevision !== scanSnapshotRevision || sameProgress)
          ? previous
          : previous?.recentIssues ? { ...stats.scan, recentIssues: previous.recentIssues } : stats.scan;
        this.discardSupersededScanCompletion(scan.lastCompletedScan);
        this.stats = { ...stats, scan };
        this.syncLocaleFromStats(this.stats);

        if (options.background && this.error) {
          this.error = null;
        }

      } catch (error) {
        if (requestGeneration !== protectedStateGeneration) {
          return;
        }

        const message = error instanceof Error ? error.message : i18n.global.t('errors.loadAppStats');

        if (!options.background) this.error = message;
      } finally {
        if (inFlightStatusRequest === statusRequest) {
          inFlightStatusRequest = null;
        }

        if (!options.background && requestGeneration === protectedStateGeneration) {
          this.loadingStats = false;
        }
      }
    },

    async sendScanControl(action: ScanControl) {
      const operation = this.stats?.scan.operation;
      if (!useAuthStore().canManageLibrary || !operation?.id || !operation.controls.includes(action) ||
          this.scanControlPending || this.scanStatusUnavailable) return;

      const requestGeneration = scanCapabilityGeneration;
      this.scanControlPending = true;
      this.scanControlError = false;
      try {
        const { operation: updated } = await controlScanOperation(operation.id, action);
        const scan = this.stats?.scan;
        if (requestGeneration === scanCapabilityGeneration && this.shouldUseAdminScanProgress() &&
            scan?.operation?.id === updated.id && scan?.isScanning) {
          this.updateScanProgress({ ...scan, operation: updated });
        }
      } catch {
        if (requestGeneration === scanCapabilityGeneration) this.scanControlError = true;
      } finally {
        if (requestGeneration === scanCapabilityGeneration) {
          // Wait out an older read before requesting a fresh post-mutation snapshot.
          await inFlightScanRequest;
          if (requestGeneration === scanCapabilityGeneration) {
            this.scanControlPending = false;
            this.refreshVisibleScanStatus();
          }
        }
      }
    },

    async refreshScanProgress() {
      if (inFlightScanRequest) return inFlightScanRequest;

      const requestGeneration = scanCapabilityGeneration;
      const admin = this.shouldUseAdminScanProgress();
      const request = (async () => {
        try {
          if (!this.stats) {
            await this.fetchStats({ background: true });
            if (!this.stats) throw new Error('Status unavailable');
          }
          if (requestGeneration !== scanCapabilityGeneration || admin !== this.shouldUseAdminScanProgress()) return;

          const progress = admin ? await fetchAdminScanProgress() : await fetchScanProgress();
          if (requestGeneration !== scanCapabilityGeneration || admin !== this.shouldUseAdminScanProgress()) return;

          const previous = this.stats?.scan;
          if (previous?.operation?.id !== progress.operation?.id) this.scanControlError = false;
          this.updateScanProgress(progress);
          this.statsPollFailures = 0;
          this.scanStatusUnavailable = false;
          if (admin && !this.scanAcknowledgementError) {
            const legacyKeys = readLegacyScanAcknowledgements();
            const legacyIssues = progress.recentIssues?.filter(result => legacyKeys.has(scanResultKey(result))) ?? [];
            if (legacyIssues.length) await this.acknowledgeScanResults(legacyIssues);
          }
          if ((previous?.isScanning && !progress.isScanning) ||
              previous?.lastCompletedScan?.id !== progress.lastCompletedScan?.id) {
            await this.fetchStats({ background: true });
          }
        } catch {
          if (requestGeneration !== scanCapabilityGeneration || admin !== this.shouldUseAdminScanProgress()) return;

          this.statsPollFailures += 1;
          if (this.statsPollFailures >= 2) this.scanStatusUnavailable = true;
        }
      })();
      inFlightScanRequest = request;
      try {
        await request;
      } finally {
        if (inFlightScanRequest === request) inFlightScanRequest = null;
      }
    }
  }
});
