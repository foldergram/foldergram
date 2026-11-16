import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCALE, i18n } from '../locales';
import type { AppStatus, ScanRunSummary } from '../types/api';
import { useAppStore } from './app';
import { useAuthStore } from './auth';

const {
  fetchAdminScanProgressMock,
  fetchAdminStatsMock,
  fetchScanProgressMock,
  fetchStatusMock
} = vi.hoisted(() => ({
  fetchAdminScanProgressMock: vi.fn(),
  fetchAdminStatsMock: vi.fn(),
  fetchScanProgressMock: vi.fn(),
  fetchStatusMock: vi.fn()
}));

vi.mock('../api/gallery', () => ({
  fetchAdminScanProgress: fetchAdminScanProgressMock,
  fetchAdminStats: fetchAdminStatsMock,
  fetchScanProgress: fetchScanProgressMock,
  fetchStats: fetchStatusMock
}));

function setNavigatorLocales(locales: string[], language = locales[0] ?? 'en-US') {
  Object.defineProperty(window.navigator, 'languages', {
    configurable: true,
    value: locales
  });

  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: language
  });
}

function createAppStatus(defaultLocale: AppStatus['preferences']['defaultLocale'] = null): AppStatus {
  return {
    folders: 3,
    indexedImages: 18,
    indexedVideos: 6,
    scan: {
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
      currentFolder: null,
      lastCompletedScan: null
    },
    storage: {
      available: true,
      reason: null
    },
    libraryIndex: {
      rebuildRequired: false,
      reason: null,
      ignoredRootMediaCount: 0
    },
    preferences: {
      defaultLocale,
      defaultHomeFeedMode: 'random',
      defaultReelsFeedMode: 'random',
      defaultFolderImageOrder: 'newest',
      treatStoriesAsFolders: false
    },
    storiesMigration: {
      hasLegacyStoriesCandidates: false,
      decisionPending: false
    }
  };
}

describe('useAppStore locale preferences', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    setNavigatorLocales(['en-US']);
    document.documentElement.lang = '';
    i18n.global.locale.value = DEFAULT_LOCALE;
    fetchAdminScanProgressMock.mockReset();
    fetchAdminStatsMock.mockReset();
    fetchScanProgressMock.mockReset();
    fetchStatusMock.mockReset();
  });

  it('initializes locale from localStorage before browser preferences', () => {
    window.localStorage.setItem('foldergram-locale', 'en');
    setNavigatorLocales(['fr-FR'], 'fr-FR');

    const store = useAppStore();
    store.initializeLocale();

    expect(store.locale).toBe('en');
    expect(i18n.global.locale.value).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('normalizes stored region locales on startup', () => {
    window.localStorage.setItem('foldergram-locale', 'zh-TW');

    const store = useAppStore();
    store.initializeLocale();

    expect(store.locale).toBe('zh');
    expect(i18n.global.locale.value).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(window.localStorage.getItem('foldergram-locale')).toBe('zh');
  });

  it('falls back to English when stored and browser locales are unsupported', () => {
    window.localStorage.setItem('foldergram-locale', 'fr');
    setNavigatorLocales(['fr-FR'], 'fr-FR');

    const store = useAppStore();
    store.initializeLocale();

    expect(store.locale).toBe(DEFAULT_LOCALE);
    expect(i18n.global.locale.value).toBe(DEFAULT_LOCALE);
    expect(document.documentElement.lang).toBe(DEFAULT_LOCALE);
    expect(window.localStorage.getItem('foldergram-locale')).toBeNull();
  });

  it('uses a supported browser locale when no saved locale exists', () => {
    setNavigatorLocales(['es-ES'], 'es-ES');

    const store = useAppStore();
    store.initializeLocale();

    expect(store.locale).toBe('es');
    expect(i18n.global.locale.value).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(window.localStorage.getItem('foldergram-locale')).toBeNull();
  });

  it('normalizes German browser locales to de', () => {
    setNavigatorLocales(['de-AT'], 'de-AT');

    const store = useAppStore();
    store.initializeLocale();

    expect(store.locale).toBe('de');
    expect(i18n.global.locale.value).toBe('de');
    expect(document.documentElement.lang).toBe('de');
  });

  it('normalizes Chinese browser locales to zh', () => {
    setNavigatorLocales(['zh-CN'], 'zh-CN');

    const store = useAppStore();
    store.initializeLocale();

    expect(store.locale).toBe('zh');
    expect(i18n.global.locale.value).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(window.localStorage.getItem('foldergram-locale')).toBeNull();
  });

  it('normalizes region locales before persisting them', () => {
    const store = useAppStore();
    store.setLocale('zh-TW');

    expect(store.locale).toBe('zh');
    expect(i18n.global.locale.value).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(window.localStorage.getItem('foldergram-locale')).toBe('zh');
  });

  it('applies the saved app default locale after stats load when no local override exists', async () => {
    setNavigatorLocales(['en-US'], 'en-US');
    fetchStatusMock.mockResolvedValue(createAppStatus('zh'));

    const store = useAppStore();
    store.initializeLocale();
    await store.fetchStats();

    expect(store.locale).toBe('zh');
    expect(i18n.global.locale.value).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(window.localStorage.getItem('foldergram-locale')).toBeNull();
  });

  it('applies the auth-status app default locale when no local override exists', () => {
    setNavigatorLocales(['en-US'], 'en-US');

    const store = useAppStore();
    store.initializeLocale();
    store.syncLocaleFromAuthStatus('zh');

    expect(store.locale).toBe('zh');
    expect(i18n.global.locale.value).toBe('zh');
    expect(document.documentElement.lang).toBe('zh');
    expect(window.localStorage.getItem('foldergram-locale')).toBeNull();
  });

  it('keeps the browser local override ahead of the saved app default locale', async () => {
    window.localStorage.setItem('foldergram-locale', 'es');
    fetchStatusMock.mockResolvedValue(createAppStatus('zh'));

    const store = useAppStore();
    store.initializeLocale();
    await store.fetchStats();

    expect(store.locale).toBe('es');
    expect(i18n.global.locale.value).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(window.localStorage.getItem('foldergram-locale')).toBe('es');
  });

  it('keeps the browser local override ahead of the auth-status app default locale', () => {
    window.localStorage.setItem('foldergram-locale', 'es');

    const store = useAppStore();
    store.initializeLocale();
    store.syncLocaleFromAuthStatus('zh');

    expect(store.locale).toBe('es');
    expect(i18n.global.locale.value).toBe('es');
    expect(document.documentElement.lang).toBe('es');
    expect(window.localStorage.getItem('foldergram-locale')).toBe('es');
  });
});

describe('scan issue acknowledgements', () => {
  const issue: ScanRunSummary = {
    id: 2, source_id: 1, started_at: '2026-09-03T14:06:46.139Z', finished_at: '2026-11-16T03:06:21.582Z',
    status: 'failed', scanned_files: 0, new_files: 0, updated_files: 0, removed_files: 0,
    error_text: 'Scan interrupted by server restart. Run a scan to continue.', warning_count: 0, warning_text: null
  };
  const older = { ...issue, id: 1, started_at: '2026-09-03T14:02:23.321Z' };

  beforeEach(() => {
    setActivePinia(createPinia());
    window.sessionStorage.clear();
  });

  it('groups matching failures without acknowledging another error or source', () => {
    const store = useAppStore();
    const status = createAppStatus();
    store.stats = { ...status, scan: { ...status.scan, recentIssues: [issue, older,
      { ...older, id: 3, error_text: 'A different failure' }, { ...older, id: 4, source_id: 3 }
    ] } };
    expect(store.unacknowledgedScanResults.map(result => result.id)).toEqual([2, 1]);
    store.acknowledgeScanResults(store.unacknowledgedScanResults);
    expect(store.unacknowledgedScanResult?.id).toBe(3);
    store.acknowledgeScanResult(store.unacknowledgedScanResult!);
    expect(store.unacknowledgedScanResult?.id).toBe(4);
  });

  it('keeps a newly arrived matching failure unacknowledged', () => {
    const store = useAppStore();
    const status = createAppStatus();
    store.stats = { ...status, scan: { ...status.scan, recentIssues: [issue, older] } };
    const displayed = store.unacknowledgedScanResults;
    const newer = { ...issue, id: 3, started_at: '2026-11-16T14:00:00Z' };
    store.updateScanProgress({ ...store.stats.scan, recentIssues: [newer, issue, older] });
    store.acknowledgeScanResults(displayed);
    expect(store.unacknowledgedScanResults.map(result => result.id)).toEqual([3]);
  });
});

describe('useAppStore protected bootstrap status', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    setNavigatorLocales(['en-US']);
    document.documentElement.lang = '';
    i18n.global.locale.value = DEFAULT_LOCALE;
    fetchAdminScanProgressMock.mockReset();
    fetchAdminStatsMock.mockReset();
    fetchScanProgressMock.mockReset();
    fetchStatusMock.mockReset();
  });

  it('uses the lightweight status endpoint for protected bootstrap even for admin sessions', async () => {
    const status = createAppStatus();
    fetchStatusMock.mockResolvedValue(status);

    const store = useAppStore();
    await store.fetchStats();

    expect(fetchStatusMock).toHaveBeenCalledTimes(1);
    expect(fetchAdminStatsMock).not.toHaveBeenCalled();
    expect(store.stats).toEqual(status);
  });

  it('uses the lightweight status endpoint for viewer sessions', async () => {
    const status = createAppStatus();
    fetchStatusMock.mockResolvedValue(status);

    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      authenticated: true,
      role: 'viewer',
      accessMode: 'password',
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: true,
        canUseLocalFavorites: false,
        canUseSharedCollections: true,
        canUseLocalCollections: false
      }
    });

    const store = useAppStore();
    await store.fetchStats();

    expect(fetchStatusMock).toHaveBeenCalledTimes(1);
    expect(fetchAdminStatsMock).not.toHaveBeenCalled();
    expect(store.stats).toEqual(status);
  });

  it('uses the lightweight status endpoint for anonymous public sessions', async () => {
    const status = createAppStatus();
    fetchStatusMock.mockResolvedValue(status);

    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      authenticated: false,
      role: 'anonymous',
      accessMode: 'public',
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: false,
        canUseLocalFavorites: true,
        canUseSharedCollections: false,
        canUseLocalCollections: true
      }
    });

    const store = useAppStore();
    await store.fetchStats({ background: true });

    expect(fetchStatusMock).toHaveBeenCalledTimes(1);
    expect(fetchAdminStatsMock).not.toHaveBeenCalled();
    expect(store.stats).toEqual(status);
  });

  it('deduplicates concurrent bootstrap callers into a single status request', async () => {
    let resolveStatus: (value: AppStatus) => void = () => {};
    fetchStatusMock.mockImplementation(
      () =>
        new Promise<AppStatus>((resolve) => {
          resolveStatus = resolve;
        })
    );

    const store = useAppStore();
    const firstLoad = store.fetchStats();
    const secondLoad = store.fetchStats({ background: true });

    resolveStatus(createAppStatus());
    await Promise.all([firstLoad, secondLoad]);

    expect(fetchStatusMock).toHaveBeenCalledTimes(1);
    expect(store.stats).not.toBeNull();
  });

  it('starts a fresh status request for a new access context after a reset', async () => {
    const firstStatus = createAppStatus();
    const secondStatus = createAppStatus();
    secondStatus.folders = 5;

    let resolveFirst: (value: AppStatus) => void = () => {};
    let resolveSecond: (value: AppStatus) => void = () => {};
    fetchStatusMock
      .mockImplementationOnce(
        () =>
          new Promise<AppStatus>((resolve) => {
            resolveFirst = resolve;
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<AppStatus>((resolve) => {
            resolveSecond = resolve;
          })
      );

    const store = useAppStore();
    const firstLoad = store.fetchStats();

    store.resetProtectedState();

    const secondLoad = store.fetchStats();

    expect(fetchStatusMock).toHaveBeenCalledTimes(2);

    resolveFirst(firstStatus);
    await firstLoad;

    expect(store.stats).toBeNull();
    expect(store.loadingStats).toBe(true);

    resolveSecond(secondStatus);
    await secondLoad;

    expect(store.stats).toEqual(secondStatus);
  });

  it('ignores stale status failures from a previous access context', async () => {
    let rejectFirst: (error: Error) => void = () => {};
    fetchStatusMock
      .mockImplementationOnce(
        () =>
          new Promise<AppStatus>((_resolve, reject) => {
            rejectFirst = reject;
          })
      )
      .mockResolvedValue(createAppStatus());

    const store = useAppStore();
    const firstLoad = store.fetchStats();

    store.resetProtectedState();

    const secondLoad = store.fetchStats();

    rejectFirst(new Error('network unavailable'));
    await firstLoad;
    await secondLoad;

    expect(store.error).toBeNull();
    expect(store.stats).not.toBeNull();
  });

  it('clears a deferred completion when fresher status arrives and rejects a delayed older reply', async () => {
    const completed = {
      id: 1, started_at: '2026-11-16T07:00:00Z', finished_at: '2026-11-16T07:01:00Z',
      status: 'completed', scanned_files: 1, new_files: 1, updated_files: 0, removed_files: 0,
      error_text: null, warning_count: 0, warning_text: null
    };
    const status = createAppStatus();
    fetchStatusMock.mockResolvedValue(status);
    const store = useAppStore();
    await store.fetchStats();
    store.showScanCompletion(completed, null);

    const sameRun = { ...status.scan, lastCompletedScan: completed };
    fetchAdminScanProgressMock.mockResolvedValue(sameRun);
    await store.refreshScanProgress();
    expect(store.scanCompletion?.result.id).toBe(completed.id);

    const cancelled = { ...completed, id: 2, finished_at: '2026-11-16T07:02:00Z', status: 'cancelled' };
    const latest = { ...status, scan: { ...status.scan, lastCompletedScan: cancelled } };
    fetchStatusMock.mockResolvedValue(latest);
    fetchAdminScanProgressMock.mockResolvedValue(latest.scan);
    await store.refreshScanProgress();
    expect(store.scanCompletion).toBeNull();
    expect(store.stats?.scan.lastCompletedScan).toEqual(cancelled);

    store.showScanCompletion(completed, null);
    expect(store.scanCompletion).toBeNull();
  });

  it('supersedes a deferred completion through the full status response too', async () => {
    const completed = {
      id: 1, started_at: '2026-11-16T07:00:00Z', finished_at: '2026-11-16T07:01:00Z',
      status: 'completed', scanned_files: 1, new_files: 1, updated_files: 0, removed_files: 0,
      error_text: null, warning_count: 0, warning_text: null
    };
    const status = createAppStatus();
    const store = useAppStore();
    store.stats = status;
    store.showScanCompletion(completed, null);

    fetchStatusMock.mockResolvedValue({
      ...status,
      scan: { ...status.scan, lastCompletedScan: { ...completed, id: 2, status: 'cancelled' } }
    });
    await store.fetchStats();
    expect(store.scanCompletion).toBeNull();
  });

  it('polls lightweight scan progress and refreshes status without fetching full admin stats', async () => {
    const scanningStatus = createAppStatus();
    scanningStatus.scan.isScanning = true;
    fetchStatusMock.mockResolvedValue(scanningStatus);

    const store = useAppStore();
    await store.fetchStats();
    store.startStatsPolling();

    const completedScan = {
      ...scanningStatus.scan,
      isScanning: false,
      scanReason: null,
      phase: 'idle' as const,
      startedAt: null
    };
    fetchAdminScanProgressMock.mockResolvedValue(completedScan);
    fetchStatusMock.mockResolvedValue({ ...scanningStatus, scan: completedScan });

    await store.refreshScanProgress();

    expect(fetchAdminScanProgressMock).toHaveBeenCalledTimes(1);
    expect(fetchScanProgressMock).not.toHaveBeenCalled();
    expect(fetchAdminStatsMock).not.toHaveBeenCalled();
    expect(fetchStatusMock).toHaveBeenCalledTimes(2);
    expect(store.statsPollTimer).not.toBeNull();
    store.stopStatsPolling();
  });
});
