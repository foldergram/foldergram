import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_LOCALE, i18n } from '../locales';
import type { AppStatus } from '../types/api';
import { useAppStore } from './app';

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

  it('broadcasts every explicit request to enable sound, even when already enabled', () => {
    const store = useAppStore();

    store.setVideoMuted(false);
    const firstGeneration = store.videoSoundGeneration;
    store.setVideoMuted(false);

    expect(store.videoMuted).toBe(false);
    expect(store.videoSoundGeneration).toBe(firstGeneration + 1);
    expect(window.localStorage.getItem('foldergram-video-muted')).toBe('false');
  });

  it('does not let a later autoplay failure override an explicit sound-on gesture', () => {
    const store = useAppStore();
    store.setVideoMuted(false);

    expect(store.reportAudibleAutoplayBlocked()).toBe(false);

    expect(store.videoMuted).toBe(false);
    expect(store.audibleAutoplayBlocked).toBe(false);
    expect(store.videoEffectivelyMuted).toBe(false);
  });

  it('treats opening or resuming a saved audible video as a session user gesture', () => {
    const store = useAppStore();
    window.localStorage.setItem('foldergram-video-muted', 'false');
    store.initializeVideoMuted();
    store.reportAudibleAutoplayBlocked();

    expect(store.videoEffectivelyMuted).toBe(true);

    store.activateVideoSoundFromUserGesture();

    expect(store.videoMuted).toBe(false);
    expect(store.videoEffectivelyMuted).toBe(false);
    expect(store.hasExplicitlyEnabledVideoSound).toBe(true);
    expect(store.reportAudibleAutoplayBlocked()).toBe(false);
  });

  it('shares the initial autoplay verdict until the viewer explicitly enables sound', () => {
    const store = useAppStore();
    window.localStorage.setItem('foldergram-video-muted', 'false');
    store.initializeVideoMuted();

    expect(store.reportAudibleAutoplayBlocked()).toBe(true);
    expect(store.audibleAutoplayBlocked).toBe(true);
    expect(store.videoEffectivelyMuted).toBe(true);

    const generationBeforeGesture = store.videoSoundGeneration;
    store.setVideoMuted(false);

    expect(store.audibleAutoplayBlocked).toBe(false);
    expect(store.videoEffectivelyMuted).toBe(false);
    expect(store.videoSoundGeneration).toBe(generationBeforeGesture + 1);
  });

  it('keeps videoEffectivelyMuted true while the stored preference is muted', () => {
    const store = useAppStore();
    store.setVideoMuted(true);

    expect(store.videoEffectivelyMuted).toBe(true);

    store.clearAudibleAutoplayBlock();

    // Clearing a block never turns the sound on by itself.
    expect(store.videoEffectivelyMuted).toBe(true);
    expect(store.videoMuted).toBe(true);
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
    setNavigatorLocales(['de-DE'], 'de-DE');

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
    fetchAdminStatsMock.mockResolvedValue(createAppStatus('zh'));

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
    fetchAdminStatsMock.mockResolvedValue(createAppStatus('zh'));

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
