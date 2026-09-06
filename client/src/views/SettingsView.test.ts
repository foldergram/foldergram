import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as galleryApi from '../api/gallery';
import type { AppStats, AppStatus, PlacesStatus } from '../types/api';
import { useAppStore } from '../stores/app';
import SettingsView from './SettingsView.vue';

vi.mock('vue-router', () => ({
  useRoute: () => ({
    query: {}
  })
}));

const scrollIntoViewSpy = vi.fn();

function createAppStatus(
  defaultHomeFeedMode: AppStatus['preferences']['defaultHomeFeedMode'] = 'rediscover',
  defaultReelsFeedMode: AppStatus['preferences']['defaultReelsFeedMode'] = 'random',
  defaultFolderImageOrder: NonNullable<AppStatus['preferences']['defaultFolderImageOrder']> = 'newest',
  defaultLocale: AppStatus['preferences']['defaultLocale'] = 'en'
): AppStatus {
  return {
    folders: 3,
    indexedImages: 18,
    indexedPosts: 18,
    indexedMediaAssets: 21,
    indexedCarousels: 3,
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
      discoveredFolders: 0,
      processedFolders: 0,
      discoveredImages: 0,
      processedImages: 0,
      queuedDerivativeJobs: 0,
      processedDerivativeJobs: 0,
      generatedThumbnails: 0,
      generatedPreviews: 0,
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
      defaultHomeFeedMode,
      defaultReelsFeedMode,
      defaultFolderImageOrder,
      nestedFolderTitleFormat: 'folder',
      treatStoriesAsFolders: false,
      treatCarouselsAsFolders: false,
      allowDownloads: true
    },
    storiesMigration: {
      hasLegacyStoriesCandidates: false,
      decisionPending: false
    },
    carouselsMigration: {
      hasLegacyCarouselsCandidates: false,
      decisionPending: false,
      reconciliationPending: false
    }
  };
}

function createAppStats(): AppStats {
  return {
    ...createAppStatus(),
    deletedImages: 0,
    thumbnailCount: 18,
    previewCount: 6,
    excludedFolders: {
      envExcludedFolders: [],
      customExcludedFolders: [],
      effectiveExcludedFolders: []
    },
    storage: {
      available: true,
      reason: null,
      usingInMemoryDatabase: false
    },
    libraryIndex: {
      rebuildRequired: false,
      reason: null,
      currentGalleryRoot: '/gallery',
      previousGalleryRoot: null,
      lastSuccessfulGalleryRoot: '/gallery',
      legacyDerivativeMigrationPending: false,
      pendingDerivativeMigrationRows: 0,
      ignoredRootMediaCount: 0
    },
    deletionRecovery: {
      failedCount: 0,
      failures: []
    },
    lastScan: null
  };
}

function createPlacesStatus(prepared = false): PlacesStatus {
  return {
    prepared,
    databasePath: '/data/geodata/geonames-cities500.sqlite',
    metadata: prepared
      ? {
          source: 'GeoNames cities500',
          sourceUrl: 'https://download.geonames.org/export/dump/cities500.zip',
          importedAt: '2026-04-24T00:00:00.000Z',
          rowCount: 210_000
        }
      : null
  };
}

function mountSettingsView() {
  return mount(SettingsView, {
    global: {
      stubs: {
        ConfirmDialog: true
      }
    }
  });
}

async function openGeneralSettingsSidebarTab(wrapper: ReturnType<typeof mountSettingsView>) {
  const generalSettingsButton = wrapper
    .findAll('button')
    .find((button) =>
      ['General Settings', 'Ajustes generales', '通用设置'].some((label) => button.text().includes(label))
    );

  expect(generalSettingsButton).toBeDefined();

  await generalSettingsButton!.trigger('click');
  await flushPromises();
}

describe('SettingsView', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    window.localStorage.clear();
    scrollIntoViewSpy.mockReset();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoViewSpy
    });
    vi.spyOn(galleryApi, 'fetchAdminStats').mockResolvedValue(createAppStats());
  });

  it('shows a persistent warning when permanent deletion recovery needs attention', async () => {
    const appStore = useAppStore();
    appStore.$patch({ stats: createAppStatus() });
    const stats = createAppStats();
    stats.deletionRecovery = {
      failedCount: 1,
      failures: [{
        journalName: 'operation.json',
        operationId: 'operation',
        postId: 6070,
        folderSlug: 'photos',
        createdAt: '2026-08-29T15:14:55.472Z',
        message: 'Unable to restore 1 quarantined deletion target(s)'
      }]
    };
    vi.spyOn(galleryApi, 'fetchAdminStats').mockResolvedValue(stats);

    const wrapper = mountSettingsView();
    await flushPromises();

    const warning = wrapper.get('[data-test="deletion-recovery-warning"]');
    expect(warning.text()).toContain('1 permanent deletion needs attention');
    expect(warning.text()).toContain('Post 6070');
    expect(warning.text()).toContain('The server and library remain available.');
  });

  it('renders the combined feed defaults card with separate home and reels groups', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    const wrapper = mountSettingsView();

    await flushPromises();

    expect(wrapper.text()).toContain('Scan & Library');
    expect(wrapper.text()).toContain('General Settings');
    expect(wrapper.text()).not.toContain('Home feed sort order');

    await openGeneralSettingsSidebarTab(wrapper);

    expect(wrapper.text()).toContain('Home feed sort order');
    expect(wrapper.text()).toContain('Reels feed sort order');
    expect(wrapper.text()).toContain('App folder photo order');
    expect(wrapper.text()).toContain('Excluded source folders');
    expect(wrapper.text().indexOf('Home feed sort order')).toBeLessThan(wrapper.text().indexOf('Reels feed sort order'));
    expect(wrapper.text().indexOf('Reels feed sort order')).toBeLessThan(wrapper.text().indexOf('App folder photo order'));
    expect(wrapper.text().indexOf('App folder photo order')).toBeLessThan(
      wrapper.text().indexOf('Treat stories folders as normal app folders')
    );

    const [homeButton, reelsButton, folderButton] = wrapper.findAll('button[aria-expanded]');
    expect(homeButton?.text()).toContain('Rediscover');
    expect(reelsButton?.text()).toContain('Random');
    expect(folderButton?.text()).toContain('Newest First');

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Saved');

    expect(saveButton).toBeDefined();
    expect(saveButton!.attributes('disabled')).toBeDefined();
  });

  it('hydrates the saved feed defaults correctly when app status finishes loading after mount', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: null,
      loadingStats: true
    });

    const wrapper = mountSettingsView();

    await flushPromises();

    await openGeneralSettingsSidebarTab(wrapper);

    appStore.$patch({
      loadingStats: false,
      stats: createAppStatus('recent', 'random', 'oldest')
    });

    await flushPromises();

    const [homeButton, reelsButton, folderButton] = wrapper.findAll('button[aria-expanded]');
    expect(homeButton?.text()).toContain('Recent');
    expect(reelsButton?.text()).toContain('Random');
    expect(folderButton?.text()).toContain('Oldest First');

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Saved');

    expect(saveButton).toBeDefined();
    expect(saveButton!.attributes('disabled')).toBeDefined();
  });

  it('switches the client locale from the General Settings language selector', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const languageSelect = wrapper.get('select');
    expect((languageSelect.element as HTMLSelectElement).value).toBe('en');

    await languageSelect.setValue('es');
    await flushPromises();

    expect(appStore.locale).toBe('es');
    expect(window.localStorage.getItem('foldergram-locale')).toBe('es');
    expect(wrapper.text()).toContain('Idioma de la aplicación');
    expect(wrapper.text()).toContain('Controles de la biblioteca');
  });

  it('saves the selected app language as the app-wide default from General Settings', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();
    const updateAppLocaleSpy = vi.spyOn(galleryApi, 'updateAppLocale').mockResolvedValue({
      defaultLocale: 'zh'
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    await wrapper.get('select').setValue('zh');
    await flushPromises();

    const saveButton = wrapper
      .findAll('button')
      .find((button) => ['Save changes', 'Guardar cambios', '保存更改'].includes(button.text()));

    expect(saveButton).toBeDefined();

    await saveButton!.trigger('click');
    await flushPromises();

    expect(updateAppLocaleSpy).toHaveBeenCalledWith('zh');
    expect(appStore.stats?.preferences.defaultLocale).toBe('zh');
    expect(wrapper.text()).toContain('应用语言默认值已保存为中文。');
  });

  it('lets admins save an existing browser-local language as the app default without changing the selector again', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus('rediscover', 'random', 'newest', 'zh')
    });
    appStore.setLocale('es');

    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();
    const updateAppLocaleSpy = vi.spyOn(galleryApi, 'updateAppLocale').mockResolvedValue({
      defaultLocale: 'es'
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const localeOverrideNotice = wrapper.get('[data-testid="locale-override-notice"]');
    expect(localeOverrideNotice.attributes('role')).toBe('status');
    expect(localeOverrideNotice.attributes('class')).toContain('bg-[rgba(24,119,242,0.08)]');
    expect(localeOverrideNotice.text()).toContain('El valor predeterminado de la app es Chino.');
    expect(localeOverrideNotice.text()).toContain('Este navegador está usando temporalmente Español');
    expect(localeOverrideNotice.text()).toContain('configuración solo de este navegador');

    const saveButton = wrapper
      .findAll('button')
      .find((button) => ['Save changes', 'Guardar cambios', '保存更改'].includes(button.text()));

    expect(saveButton).toBeDefined();
    expect(saveButton!.attributes('disabled')).toBeUndefined();

    await saveButton!.trigger('click');
    await flushPromises();

    expect(updateAppLocaleSpy).toHaveBeenCalledWith('es');
    expect(appStore.stats?.preferences.defaultLocale).toBe('es');
    expect(wrapper.text()).toContain('El idioma predeterminado de la app se guardó como Español.');
  });

  it('shows the pending legacy derivative migration warning next to the scan action', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    const pendingStats = createAppStats();
    pendingStats.libraryIndex.legacyDerivativeMigrationPending = true;
    pendingStats.libraryIndex.pendingDerivativeMigrationRows = 24;
    vi.spyOn(galleryApi, 'fetchAdminStats').mockResolvedValue(pendingStats);

    const wrapper = mountSettingsView();
    await flushPromises();

    expect(wrapper.text()).toContain('Legacy derivative migration pending');
    expect(wrapper.text()).toContain('24 indexed media records still use the old mirrored thumbnail and preview paths.');
    expect(wrapper.text()).toContain('Run Scan Library to move legacy mirrored thumbnails and previews into the asset-key storage layout.');
    expect(wrapper.text()).toContain('This keeps the current thumbnail paths and does not migrate legacy mirrored derivatives.');
  });

  it('shows localized scan guidance while carousel folder reconciliation is pending', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.carouselsMigration = {
      hasLegacyCarouselsCandidates: false,
      decisionPending: false,
      reconciliationPending: true
    };
    appStore.$patch({ stats: status });

    const wrapper = mountSettingsView();
    await flushPromises();

    expect(wrapper.text()).toContain('Carousel folder update pending');
    expect(wrapper.text()).toContain(
      'The saved Carousel folder mode has not been applied to the index. Run Scan Library to update folders and posts.'
    );
    expect(wrapper.text()).toContain(
      'Run Scan Library to apply the saved Carousel folder mode to indexed folders and posts.'
    );
    expect(wrapper.text()).not.toContain('settings.library.carouselReconciliation');
    expect(wrapper.text()).not.toContain('settings.library.scanActionNote.carouselReconciliation');
  });

  it('shows the Places onboarding banner and opens the Places tab from its setup action', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });
    vi.spyOn(galleryApi, 'fetchPlacesStatus').mockResolvedValue(createPlacesStatus(false));

    const wrapper = mountSettingsView();
    await flushPromises();

    expect(wrapper.text()).toContain('Places from photo GPS data');

    const setupButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Set up Places');

    expect(setupButton).toBeDefined();

    await setupButton!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Places from photo GPS data');
    expect(wrapper.text()).toContain('Offline places');
    expect(wrapper.text()).toContain('Prepare GeoNames city data');
  });

  it('persists Places onboarding dismissal and hides the banner', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });
    vi.spyOn(galleryApi, 'fetchPlacesStatus').mockResolvedValue(createPlacesStatus(false));

    const wrapper = mountSettingsView();
    await flushPromises();

    const dismissButton = wrapper.get('button[aria-label="Dismiss places announcement"]');
    await dismissButton.trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Places from photo GPS data');
    expect(window.localStorage.getItem('foldergram:places-onboarding-dismissed:v1')).toBe('1');
  });

  it('does not show the Places onboarding banner after geodata is prepared', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });
    vi.spyOn(galleryApi, 'fetchPlacesStatus').mockResolvedValue(createPlacesStatus(true));

    const wrapper = mountSettingsView();
    await flushPromises();

    expect(wrapper.text()).not.toContain('Places from photo GPS data');
  });

  it('saves the reels default from the general settings card', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();
    const updateReelsFeedDefaultSpy = vi.spyOn(galleryApi, 'updateReelsFeedDefault').mockResolvedValue({
      defaultMode: 'recommended'
    });

    const wrapper = mountSettingsView();

    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const [, reelsButton] = wrapper.findAll('button[aria-expanded]');
    expect(reelsButton).toBeDefined();

    await reelsButton!.trigger('click');
    await flushPromises();
    const recommendedOption = wrapper.findAll('button').find((button) => button.text().includes('Recommended'));
    expect(recommendedOption).toBeDefined();
    await recommendedOption!.trigger('click');
    await flushPromises();

    const updateHomeFeedDefaultSpy = vi.spyOn(galleryApi, 'updateHomeFeedDefault');
    const updateExcludedFoldersSpy = vi.spyOn(galleryApi, 'updateExcludedFolders');
    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save changes');

    expect(saveButton).toBeDefined();

    await saveButton!.trigger('click');
    await flushPromises();

    expect(updateReelsFeedDefaultSpy).toHaveBeenCalledWith('recommended');
    expect(updateHomeFeedDefaultSpy).not.toHaveBeenCalled();
    expect(updateExcludedFoldersSpy).not.toHaveBeenCalled();
    expect(appStore.stats?.preferences.defaultReelsFeedMode).toBe('recommended');
    expect(wrapper.text()).toContain('Reels now opens with Recommended.');
  });

  it('saves the app folder photo order from the general settings card', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();
    const updateFolderImageOrderDefaultSpy = vi.spyOn(galleryApi, 'updateFolderImageOrderDefault').mockResolvedValue({
      defaultOrder: 'oldest'
    });

    const wrapper = mountSettingsView();

    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const [, , folderButton] = wrapper.findAll('button[aria-expanded]');
    expect(folderButton).toBeDefined();

    await folderButton!.trigger('click');
    await flushPromises();
    const oldestOption = wrapper.findAll('button').find((button) => button.text().includes('Oldest First'));
    expect(oldestOption).toBeDefined();
    await oldestOption!.trigger('click');
    await flushPromises();

    const updateHomeFeedDefaultSpy = vi.spyOn(galleryApi, 'updateHomeFeedDefault');
    const updateReelsFeedDefaultSpy = vi.spyOn(galleryApi, 'updateReelsFeedDefault');
    const updateExcludedFoldersSpy = vi.spyOn(galleryApi, 'updateExcludedFolders');
    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save changes');

    expect(saveButton).toBeDefined();

    await saveButton!.trigger('click');
    await flushPromises();

    expect(updateFolderImageOrderDefaultSpy).toHaveBeenCalledWith('oldest');
    expect(updateHomeFeedDefaultSpy).not.toHaveBeenCalled();
    expect(updateReelsFeedDefaultSpy).not.toHaveBeenCalled();
    expect(updateExcludedFoldersSpy).not.toHaveBeenCalled();
    expect(appStore.stats?.preferences.defaultFolderImageOrder).toBe('oldest');
    expect(wrapper.text()).toContain('App folders now open with Oldest First.');
  });

  it('saves the nested folder title format from the general settings card', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();
    const updateNestedFolderTitleFormatSpy = vi
      .spyOn(galleryApi, 'updateNestedFolderTitleFormat')
      .mockResolvedValue({
        titleFormat: 'parent-plus-folder'
      });

    const wrapper = mountSettingsView();

    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const [, , , nestedTitleButton] = wrapper.findAll('button[aria-expanded]');
    expect(nestedTitleButton).toBeDefined();

    await nestedTitleButton!.trigger('click');
    await flushPromises();
    const parentPlusFolderOption = wrapper.findAll('button').find((button) => button.text().includes('Parent + folder name'));
    expect(parentPlusFolderOption).toBeDefined();
    await parentPlusFolderOption!.trigger('click');
    await flushPromises();

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save changes');

    expect(saveButton).toBeDefined();

    await saveButton!.trigger('click');
    await flushPromises();

    expect(updateNestedFolderTitleFormatSpy).toHaveBeenCalledWith('parent-plus-folder');
    expect(appStore.stats?.preferences.nestedFolderTitleFormat).toBe('parent-plus-folder');
    expect(wrapper.text()).toContain('Nested app folders now use Parent + folder name.');
  });

  it('saves custom excluded folder rules from the settings textarea', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();
    const updateExcludedFoldersSpy = vi.spyOn(galleryApi, 'updateExcludedFolders').mockResolvedValue({
      envExcludedFolders: ['@eaDir'],
      customExcludedFolders: ['Archive/cache', 'thumbnails'],
      effectiveExcludedFolders: ['@eaDir', 'Archive/cache', 'thumbnails'],
      requiresScan: true
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    await wrapper.get('textarea').setValue('Archive/cache\nthumbnails');
    await flushPromises();

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save changes');

    expect(saveButton).toBeDefined();

    await saveButton!.trigger('click');
    await flushPromises();

    expect(updateExcludedFoldersSpy).toHaveBeenCalledWith(['Archive/cache', 'thumbnails']);
    expect(wrapper.text()).toContain('Excluded folders were saved. Run a library scan to apply them.');
  });

  it('keeps partial-save feedback localized after the language is switched', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus('rediscover', 'random', 'newest', 'es')
    });
    appStore.setLocale('es');

    vi.spyOn(appStore, 'fetchStats').mockRejectedValue(new Error('Network down'));
    vi.spyOn(galleryApi, 'updateExcludedFolders').mockResolvedValue({
      envExcludedFolders: ['@eaDir'],
      customExcludedFolders: ['Archive/cache'],
      effectiveExcludedFolders: ['@eaDir', 'Archive/cache'],
      requiresScan: true
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    await wrapper.get('textarea').setValue('Archive/cache');
    await flushPromises();

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text().includes('Guardar'));

    expect(saveButton).toBeDefined();

    await saveButton!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Se guardaron algunos ajustes (carpetas excluidas), pero la actualización no terminó: Network down'
    );
    expect(wrapper.text()).not.toContain('excluded folders');
  });

  it('dismisses the stories migration notice and scrolls to save when choosing Use Stories Feature', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.storiesMigration = {
      hasLegacyStoriesCandidates: true,
      decisionPending: true
    };
    appStore.$patch({
      stats: status
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    expect(wrapper.text()).toContain('This library may already use folders named stories');

    const useStoriesFeatureButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Use Stories Feature');

    expect(useStoriesFeatureButton).toBeDefined();

    await useStoriesFeatureButton!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('This library may already use folders named stories');
    expect(wrapper.get('button[role="switch"]').attributes('aria-checked')).toBe('false');
    expect(wrapper.text()).toContain(
      'Save this change, then run a library scan before expecting stories folders, avatar stories, or highlights to update.'
    );
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('dismisses the stories migration notice and flips the stories mode when keeping legacy behavior', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.storiesMigration = {
      hasLegacyStoriesCandidates: true,
      decisionPending: true
    };
    appStore.$patch({
      stats: status
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const keepLegacyBehaviorButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Keep Legacy Behavior');

    expect(keepLegacyBehaviorButton).toBeDefined();

    await keepLegacyBehaviorButton!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('This library may already use folders named stories');
    expect(wrapper.get('button[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(wrapper.text()).toContain('Legacy mode is enabled. stories folders remain ordinary app folders everywhere.');
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('dismisses the stories migration notice and scrolls to save when the stories toggle is changed directly', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.storiesMigration = {
      hasLegacyStoriesCandidates: true,
      decisionPending: true
    };
    appStore.$patch({
      stats: status
    });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    await wrapper.get('button[role="switch"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('This library may already use folders named stories');
    expect(wrapper.get('button[role="switch"]').attributes('aria-checked')).toBe('true');
    expect(scrollIntoViewSpy).toHaveBeenCalledTimes(1);
  });

  it('shows, expands, and permanently dismisses the carousel posts announcement', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.carouselsMigration = {
      hasLegacyCarouselsCandidates: false,
      decisionPending: true
    };
    appStore.$patch({ stats: status });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    expect(wrapper.text()).toContain('Carousel Posts');
    expect(wrapper.text()).toContain('Reserved carousels/ folders can combine media into one post');
    expect(wrapper.text()).not.toContain('This library may already use folders named carousels');

    const structureButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'See carousel directory structure');
    expect(structureButton).toBeDefined();
    await structureButton!.trigger('click');

    expect(wrapper.text()).toContain('carousels/');
    expect(wrapper.text()).toContain('02-lions.mp4');
    expect(wrapper.text()).toContain('detail.jpg');
    expect(wrapper.text()).not.toContain('02-detail.jpg');

    const dismissButton = wrapper.get('button[aria-label="Dismiss carousel posts announcement"]');
    await dismissButton.trigger('click');
    await flushPromises();

    expect(wrapper.text()).not.toContain('Reserved carousels/ folders can combine media into one post');
    expect(window.localStorage.getItem('foldergram-carousels-announcement-dismissed:v1')).toBe('1');

    wrapper.unmount();
    const remountedWrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(remountedWrapper);

    expect(remountedWrapper.text()).not.toContain('Reserved carousels/ folders can combine media into one post');
  });

  it('shows the carousel migration decision instead of the announcement when indexed folders conflict', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.carouselsMigration = {
      hasLegacyCarouselsCandidates: true,
      decisionPending: true
    };
    appStore.$patch({ stats: status });

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    expect(wrapper.text()).toContain('This library may already use folders named carousels');
    expect(wrapper.text()).not.toContain('Reserved carousels/ folders can combine media into one post');
  });

  it('keeps the Carousel reconciliation reminder visible after settings reload until a scan completes', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.carouselsMigration = {
      hasLegacyCarouselsCandidates: true,
      decisionPending: false,
      reconciliationPending: true
    };
    appStore.$patch({ stats: status });

    const wrapper = mountSettingsView();
    await flushPromises();

    expect(wrapper.text()).toContain('Carousel folder update pending');
    expect(wrapper.text()).toContain('Run Scan Library to update folders and posts.');
    const scanButton = wrapper.findAll('button').find((button) => button.text() === 'Run Scan Library');
    expect(scanButton?.attributes('disabled')).toBeUndefined();

    await openGeneralSettingsSidebarTab(wrapper);

    expect(wrapper.text()).toContain(
      'Run a library scan to apply the saved Carousel folder mode to indexed folders and posts.'
    );
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Saved');
    expect(saveButton?.attributes('disabled')).toBeDefined();
  });

  it('directs pending Carousel reconciliation to the enabled rebuild action when a rebuild is required', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.libraryIndex.rebuildRequired = true;
    status.libraryIndex.reason = 'gallery_root_changed';
    status.carouselsMigration = {
      hasLegacyCarouselsCandidates: true,
      decisionPending: false,
      reconciliationPending: true
    };
    appStore.$patch({ stats: status });

    const wrapper = mountSettingsView();
    await flushPromises();

    expect(wrapper.text()).toContain('Rebuild Library Index below to apply it to the current gallery location.');
    const scanButton = wrapper.findAll('button').find((button) => button.text() === 'Run Scan Library');
    const rebuildButton = wrapper.findAll('button').find((button) => button.text() === 'Rebuild Library Index');
    expect(scanButton?.attributes('disabled')).toBeDefined();
    expect(rebuildButton?.attributes('disabled')).toBeUndefined();

    await openGeneralSettingsSidebarTab(wrapper);
    expect(wrapper.text()).toContain(
      'Rebuild the library index to apply the saved Carousel folder mode to the current gallery location.'
    );
  });

  it('directs a saved Carousel mode to rebuild when the gallery location requires a new index', async () => {
    const appStore = useAppStore();
    const status = createAppStatus();
    status.libraryIndex.rebuildRequired = true;
    status.libraryIndex.reason = 'gallery_root_changed';
    appStore.$patch({ stats: status });
    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();

    const responseStatus = createAppStatus();
    responseStatus.libraryIndex.rebuildRequired = true;
    responseStatus.libraryIndex.reason = 'gallery_root_changed';
    responseStatus.preferences.treatCarouselsAsFolders = true;
    responseStatus.carouselsMigration.reconciliationPending = true;
    vi.spyOn(galleryApi, 'updateCarouselsMode').mockResolvedValue(responseStatus);

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const switches = wrapper.findAll('button[role="switch"]');
    await switches[1]!.trigger('click');
    const saveButton = wrapper.findAll('button').find((button) => button.text() === 'Save changes');
    await saveButton!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Folder behavior was saved. Rebuild the library index to apply it to the current gallery location.'
    );
  });

  it('displays accurate localized success message when only carousel setting is changed', async () => {
    const appStore = useAppStore();
    appStore.$patch({
      stats: createAppStatus()
    });

    vi.spyOn(appStore, 'fetchStats').mockResolvedValue();
    const updateCarouselsSpy = vi.spyOn(galleryApi, 'updateCarouselsMode').mockResolvedValue(createAppStatus());

    const wrapper = mountSettingsView();
    await flushPromises();
    await openGeneralSettingsSidebarTab(wrapper);

    const switches = wrapper.findAll('button[role="switch"]');
    const carouselSwitch = switches[1]; // Second switch is carousels
    expect(carouselSwitch).toBeDefined();

    await carouselSwitch!.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain(
      'Save this change, then run a library scan before expecting carousel posts or carousels folders to update.'
    );

    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save changes');

    expect(saveButton).toBeDefined();
    await saveButton!.trigger('click');
    await flushPromises();

    expect(updateCarouselsSpy).toHaveBeenCalledWith(true);
    expect(wrapper.text()).toContain('Carousel folder behavior was saved. Run a library scan to apply it.');
    expect(wrapper.text()).not.toContain('Stories folder behavior was saved');
  });
});
