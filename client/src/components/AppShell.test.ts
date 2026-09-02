import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '../locales';
import { useAppStore } from '../stores/app';
import type { AppStatus } from '../types/api';
import AppShell from './AppShell.vue';

vi.mock('vue-router', () => ({
  RouterLink: { template: '<a><slot /></a>' },
  useRoute: () => ({ meta: {} })
}));

vi.mock('./SidebarNav.vue', () => ({
  default: { template: '<nav />' }
}));

vi.mock('./TopNav.vue', () => ({
  default: { template: '<header />' }
}));

function createScanningStatus(runId: number | null): AppStatus {
  return {
    folders: 1,
    indexedImages: 0,
    indexedVideos: 1,
    scan: {
      isScanning: true,
      scanReason: null,
      phase: 'scanning',
      startedAt: '2026-08-29T00:00:00.000Z',
      runId,
      migrationTotalRows: 0,
      processedMigrationRows: 0,
      migratedDerivativeFiles: 0,
      missingDerivativeFiles: 0,
      discoveredFolders: 1,
      processedFolders: 0,
      discoveredImages: 10,
      processedImages: 2,
      queuedDerivativeJobs: 0,
      processedDerivativeJobs: 0,
      generatedThumbnails: 0,
      generatedPreviews: 0,
      currentFolder: null,
      lastCompletedScan: null
    },
    storage: { available: true, reason: null },
    libraryIndex: { rebuildRequired: false, reason: null, ignoredRootMediaCount: 0 },
    preferences: { defaultHomeFeedMode: 'random', defaultReelsFeedMode: 'random' }
  } as AppStatus;
}

function mountShell() {
  return mount(AppShell, {
    global: {
      plugins: [i18n]
    }
  });
}

describe('AppShell scan banner', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
  });

  it('collapses the scan banner to a chip and remembers the choice for that run', async () => {
    const appStore = useAppStore();
    appStore.$patch({ stats: createScanningStatus(7) });

    const wrapper = mountShell();
    await flushPromises();

    expect(wrapper.find('[data-test="scan-banner-collapse"]').exists()).toBe(true);

    await wrapper.get('[data-test="scan-banner-collapse"]').trigger('click');

    // Collapsed, the banner no longer covers the feed but the run stays visible as a chip.
    expect(wrapper.find('[data-test="scan-banner-collapse"]').exists()).toBe(false);
    expect(wrapper.find('[data-test="scan-banner-expand"]').exists()).toBe(true);
    expect(window.localStorage.getItem('foldergram-scan-banner-dismissed')).toBe('7');

    const reopened = mountShell();
    await flushPromises();
    expect(reopened.find('[data-test="scan-banner-collapse"]').exists()).toBe(false);
  });

  it('announces a new scan run once even after an earlier one was dismissed', async () => {
    window.localStorage.setItem('foldergram-scan-banner-dismissed', '7');

    const appStore = useAppStore();
    appStore.$patch({ stats: createScanningStatus(8) });

    const wrapper = mountShell();
    await flushPromises();

    // A different run is new information, so it earns one more appearance.
    expect(wrapper.find('[data-test="scan-banner-collapse"]').exists()).toBe(true);
  });
});
