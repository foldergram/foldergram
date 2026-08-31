import { defineStore } from 'pinia';

import {
  fetchAdminScanProgress,
  fetchAdminStats,
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
import type {
  AppStatus,
  FeedMode,
  FolderImageOrder,
  ReelsFeedMode,
  ScanProgress,
  VideoPlaybackQuality
} from '../types/api';
import { useAuthStore } from './auth';

interface AppState {
  stats: AppStatus | null;
  loadingStats: boolean;
  error: string | null;
  theme: 'light' | 'dark';
  locale: SupportedLocale;
  videoMuted: boolean;
  /**
   * Set when the browser refuses audible autoplay. An autoplay verdict is issued per
   * document, not per element, so this is global: keeping it in each player is what
   * used to make one card silent while another showed "sound on".
   */
  audibleAutoplayBlocked: boolean;
  hasExplicitlyEnabledVideoSound: boolean;
  videoSoundGeneration: number;
  videoPlaybackQualityOverride: VideoPlaybackQuality | null;
  lastOpenedFolderSlug: string | null;
  recentOpenedFolderSlugs: string[];
  imageModalBackgroundPath: string | null;
  statsPollFailures: number;
  statsPollTimer: number | null;
  statsPollInFlight: boolean;
}

const THEME_STORAGE_KEY = 'foldergram-theme';
const LOCALE_STORAGE_KEY = 'foldergram-locale';
const VIDEO_MUTED_STORAGE_KEY = 'foldergram-video-muted';
const VIDEO_PLAYBACK_QUALITY_STORAGE_KEY = 'foldergram-video-playback-quality';
const VIDEO_PLAYBACK_QUALITIES: VideoPlaybackQuality[] = ['original'];

function parseStoredVideoPlaybackQuality(value: string | null): VideoPlaybackQuality | null {
  return VIDEO_PLAYBACK_QUALITIES.includes(value as VideoPlaybackQuality)
    ? (value as VideoPlaybackQuality)
    : null;
}
const LAST_OPENED_FOLDER_STORAGE_KEY = 'foldergram-last-opened-folder';
const RECENT_OPENED_FOLDERS_STORAGE_KEY = 'foldergram-recent-opened-folders';
const RECENT_OPENED_FOLDERS_LIMIT = 24;
const SCAN_PROGRESS_POLL_INTERVAL_MS = 1000;

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
    audibleAutoplayBlocked: false,
    hasExplicitlyEnabledVideoSound: false,
    videoSoundGeneration: 0,
    videoPlaybackQualityOverride: null,
    lastOpenedFolderSlug: null,
    recentOpenedFolderSlugs: [],
    imageModalBackgroundPath: null,
    statsPollFailures: 0,
    statsPollTimer: null,
    statsPollInFlight: false
  }),
  getters: {
    isLibraryUnavailable: (state) => state.stats?.storage.available === false,
    /**
     * The single source of truth every player must use for its `muted` property:
     * the stored preference, plus the browser's autoplay verdict.
     */
    videoEffectivelyMuted: (state) => state.videoMuted || state.audibleAutoplayBlocked,
    libraryUnavailableReason: (state) => state.stats?.storage.reason ?? 'Configured library storage is unavailable.',
    isLibraryRebuildRequired: (state) => state.stats?.libraryIndex.rebuildRequired === true,
    isScanning: (state) => state.stats?.scan.isScanning === true,
    isRebuilding: (state) => state.stats?.scan.isScanning === true && state.stats?.scan.scanReason === 'rebuild',
    hasCompletedScan: (state) => state.stats?.scan.lastCompletedScan !== null,
    isInitialScan: (state) => state.stats?.scan.isScanning === true && state.stats?.scan.lastCompletedScan === null,
    defaultHomeFeedMode: (state): FeedMode => state.stats?.preferences.defaultHomeFeedMode ?? 'random',
    savedDefaultLocale: (state): SupportedLocale | null => resolveSupportedLocale(state.stats?.preferences.defaultLocale ?? null),
    defaultReelsFeedMode: (state): ReelsFeedMode => state.stats?.preferences.defaultReelsFeedMode ?? 'random',
    defaultFolderImageOrder: (state): FolderImageOrder => state.stats?.preferences.defaultFolderImageOrder ?? 'newest',
    nestedFolderTitleFormat: (state) => state.stats?.preferences.nestedFolderTitleFormat ?? 'folder',
    savedVideoPlaybackQuality: (state): VideoPlaybackQuality =>
      state.stats?.preferences.videoPlaybackQuality ?? 'auto',
    /** Origin stamped on share links created from outside the LAN. */
    sharePublicBaseUrl: (state): string | null => state.stats?.preferences.sharePublicBaseUrl ?? null,
    // A per-device override wins over the library default so one phone on a weak
    // connection can drop to 720p without changing playback for everyone.
    videoPlaybackQuality: (state): VideoPlaybackQuality =>
      state.videoPlaybackQualityOverride ?? state.stats?.preferences.videoPlaybackQuality ?? 'auto',
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

    initializeTheme() {
      const savedTheme = window.localStorage.getItem(THEME_STORAGE_KEY);
      const preferredTheme =
        savedTheme === 'light' || savedTheme === 'dark'
          ? savedTheme
          : window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';

      this.setTheme(preferredTheme);
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
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
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

    toggleTheme() {
      this.setTheme(this.theme === 'light' ? 'dark' : 'light');
    },

    initializeVideoMuted() {
      const savedPreference = window.localStorage.getItem(VIDEO_MUTED_STORAGE_KEY);
      this.videoMuted = savedPreference === 'false' ? false : true;
      this.audibleAutoplayBlocked = false;
      this.hasExplicitlyEnabledVideoSound = false;
    },

    initializeVideoPlaybackQuality() {
      this.videoPlaybackQualityOverride = parseStoredVideoPlaybackQuality(
        window.localStorage.getItem(VIDEO_PLAYBACK_QUALITY_STORAGE_KEY)
      );
    },

    setVideoPlaybackQualityOverride(quality: VideoPlaybackQuality | null) {
      this.videoPlaybackQualityOverride = quality;

      if (quality) {
        window.localStorage.setItem(VIDEO_PLAYBACK_QUALITY_STORAGE_KEY, quality);
      } else {
        window.localStorage.removeItem(VIDEO_PLAYBACK_QUALITY_STORAGE_KEY);
      }
    },

    setVideoMuted(videoMuted: boolean) {
      this.videoMuted = videoMuted;
      if (!videoMuted) {
        // Turning sound on is a user gesture, which is exactly what lifts the
        // browser's autoplay restriction for the rest of the session.
        this.audibleAutoplayBlocked = false;
        this.hasExplicitlyEnabledVideoSound = true;
        this.videoSoundGeneration += 1;
      }
      window.localStorage.setItem(VIDEO_MUTED_STORAGE_KEY, String(videoMuted));
    },

    /**
     * Records a refused audible autoplay without touching the stored preference, so
     * the sound icon keeps showing what the viewer asked for while every player
     * falls back to muted playback together.
     */
    reportAudibleAutoplayBlocked(): boolean {
      // Once the viewer explicitly enables sound, a later autoplay failure from an
      // off-screen/new player must not silently mute every surface again.
      if (this.hasExplicitlyEnabledVideoSound) {
        return false;
      }

      if (this.audibleAutoplayBlocked) {
        return true;
      }

      this.audibleAutoplayBlocked = true;
      return true;
    },

    /** Called after a user gesture proves audible playback is allowed again. */
    clearAudibleAutoplayBlock() {
      if (!this.audibleAutoplayBlocked) {
        return;
      }

      this.audibleAutoplayBlocked = false;
      this.videoSoundGeneration += 1;
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

    markScanStatusUnavailable() {
      if (!this.stats) {
        return;
      }

      this.stats = {
        ...this.stats,
        scan: {
          ...this.stats.scan,
          isScanning: false,
          scanReason: null,
          phase: 'idle',
          startedAt: null,
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
          currentOperation: null,
          currentFile: null,
          currentPhaseMessage: null,
          currentFolder: null
        }
      };
    },

    startStatsPolling() {
      if (this.statsPollTimer) {
        return;
      }

      this.statsPollTimer = window.setInterval(() => {
        if (document.visibilityState === 'hidden') {
          return;
        }

        if (!this.stats?.scan.isScanning) {
          this.stopStatsPolling();
          return;
        }

        if (this.statsPollInFlight) {
          return;
        }

        this.statsPollInFlight = true;
        void this.refreshScanProgress().finally(() => {
          this.statsPollInFlight = false;
        });
      }, SCAN_PROGRESS_POLL_INTERVAL_MS);
    },

    stopStatsPolling() {
      if (this.statsPollTimer) {
        clearInterval(this.statsPollTimer);
        this.statsPollTimer = null;
      }

      this.statsPollFailures = 0;
      this.statsPollInFlight = false;
    },

    resetProtectedState() {
      this.stopStatsPolling();
      this.stats = null;
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
      if (!options.background) {
        this.loadingStats = true;
        this.error = null;
      }

      try {
        this.stats = this.shouldUseAdminScanProgress()
          ? await fetchAdminStats()
          : await fetchStatus();
        this.syncLocaleFromStats(this.stats);
        this.statsPollFailures = 0;

        if (options.background && this.error) {
          this.error = null;
        }

        if (this.stats.scan.isScanning) {
          this.startStatsPolling();
        } else {
          this.stopStatsPolling();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load app stats';

        if (options.background) {
          this.statsPollFailures += 1;

          if (this.statsPollFailures >= 3) {
            this.stopStatsPolling();
            this.markScanStatusUnavailable();
            this.error = 'Lost connection while refreshing scan status.';
          }
        } else {
          this.error = message;
        }
      } finally {
        if (!options.background) {
          this.loadingStats = false;
        }
      }
    },

    async refreshScanProgress() {
      if (!this.stats) {
        await this.fetchStats({ background: true });
        return;
      }

      try {
        const progress = this.shouldUseAdminScanProgress()
          ? await fetchAdminScanProgress()
          : await fetchScanProgress();

        this.updateScanProgress(progress);
        this.statsPollFailures = 0;

        if (this.error) {
          this.error = null;
        }

        if (!progress.isScanning) {
          this.stopStatsPolling();
          await this.fetchStats({ background: true });
        }
      } catch {
        this.statsPollFailures += 1;

        if (this.statsPollFailures >= 3) {
          this.stopStatsPolling();
          this.markScanStatusUnavailable();
          this.error = 'Lost connection while refreshing scan status.';
        }
      }
    }
  }
});
