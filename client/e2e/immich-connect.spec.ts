import { expect, test } from '@playwright/test';

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Immich connection and exclusions on ${viewport.name} in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(value => {
        localStorage.setItem('foldergram-theme', value);
        localStorage.setItem('foldergram-locale', 'en');
      }, theme);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const sources: Record<string, unknown>[] = [];
      const saves: Record<string, any>[] = [];
      let holdSources = false;
      let releaseSources!: () => void;
      const sourcesGate = new Promise<void>(resolve => { releaseSources = resolve; });
      const status = {
        folders: 0, indexedImages: 0, indexedVideos: 0,
        scan: { isScanning: false, lastCompletedScan: null },
        storage: { available: true, reason: null },
        libraryIndex: { rebuildRequired: false, reason: null, ignoredRootMediaCount: 0 },
        preferences: { defaultLocale: 'en', defaultHomeFeedMode: 'recent', defaultReelsFeedMode: 'random' },
        storiesMigration: { hasLegacyStoriesCandidates: false, decisionPending: false },
        carouselsMigration: { hasLegacyCarouselsCandidates: false, decisionPending: false, reconciliationPending: false }
      };
      await page.route('https://fonts.googleapis.com/**', route => route.abort());
      await page.route('https://fonts.gstatic.com/**', route => route.abort());
      await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path === '/api/admin/sources/immich/test') {
          await route.fulfill({ json: {
            version: '3.3.5', assetCount: 240, uploadCount: 0, warnings: [], suggestedMode: 'both',
            libraries: [{ id: 'library', name: 'Photos', importPaths: ['/photos'] }, { id: 'archive', name: 'Archive', importPaths: ['/archive'] }],
            roots: [], albums: [{ id: 'holiday', albumName: 'Summer holidays' }, { id: 'family', albumName: 'Family', shared: true }]
          } });
          return;
        }
        if (path === '/api/admin/sources' && route.request().method() === 'GET' && holdSources) {
          await sourcesGate;
        }
        if ((path === '/api/admin/sources' && route.request().method() === 'POST') || (path === '/api/admin/sources/1' && route.request().method() === 'PATCH')) {
          const body = route.request().postDataJSON();
          saves.push(body);
          const source = {
            id: 1, name: body.name, server_url: body.serverUrl, selection: body.selection,
            managed_by: 'settings', enabled: 1, status: 'ready', asset_count: 240, folder_count: 2,
            last_success: null, last_error: null, syncing: false, progress: 0
          };
          sources.splice(0, sources.length, source);
          await route.fulfill({ status: 201, json: source });
          return;
        }
        const responses: Record<string, unknown> = {
          '/api/auth/status': {
            enabled: false, authenticated: true, role: 'admin', accessMode: 'off', likesMode: 'shared', defaultLocale: 'en',
            capabilities: { canManageLibrary: true, canDeleteMedia: true, canAccessSettings: true, canUseSharedLikes: true, canUseLocalFavorites: false, canUseSharedCollections: true, canUseLocalCollections: false }
          },
          '/api/status': status,
          '/api/admin/stats': { ...status, excludedFolders: { envExcludedFolders: [], customExcludedFolders: [], effectiveExcludedFolders: [] }, deletionRecovery: { failedCount: 0, failures: [] } },
          '/api/admin/places/status': { prepared: true, metadata: null },
          '/api/admin/sources': { items: sources },
          '/api/folders': { items: [] },
          '/api/likes': { items: [] },
          '/api/collections': { items: [] }
        };
        await route.fulfill({ json: responses[path] ?? { items: [] } });
      });

      await page.goto('/settings?section=sources');
      await page.getByRole('button', { name: 'Connect Immich', exact: true }).click();
      await page.getByLabel('Immich server URL').fill('http://immich-server:2283');
      await page.getByLabel('API key', { exact: true }).fill('example-key');
      await expect(page.getByRole('radio')).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('connection.png'), fullPage: true });
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await expect(page.getByRole('radio', { name: /^Both(?: |$)/ })).toBeChecked();
      await expect(page.getByText('2 folders · 2 albums selected', { exact: true })).toBeVisible();
      await expect(page.getByRole('checkbox')).toHaveCount(0); // Collapsed controls stay out of the accessibility tree.
      expect(saves).toHaveLength(0);
      await page.screenshot({ path: test.info().outputPath('content.png'), fullPage: true });

      const bounds = await page.locator('[aria-labelledby="sources-title"]').boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      await page.getByText('Customize selection', { exact: true }).click();
      const archive = page.getByRole('checkbox', { name: /Archive/ });
      const family = page.getByRole('checkbox', { name: /Family/ });
      await expect(archive).toBeChecked();
      await expect(family).toBeChecked();
      await archive.uncheck();
      await family.uncheck();
      await expect(page.getByText('1 folder · 1 album selected', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Connect and sync', exact: true }).click();
      await expect(page.getByText('Source saved. Synchronization is running in the background.')).toBeVisible();
      expect(saves).toHaveLength(1);
      expect(saves[0].selection.roots).toEqual([{ libraryId: 'library', path: '/photos' }]);
      expect(saves[0].selection.albumIds).toEqual(['holiday']);

      // Reproduce a saved source from before inactive categories had defaults.
      sources[0].selection = { mode: 'albums', roots: [], albumIds: ['family'], exclusions: [], includeUnfiled: false, allowOriginals: false, intervalMinutes: 0 };
      await page.getByRole('button', { name: /^General Settings(?: |$)/ }).click();
      holdSources = true;
      await page.getByRole('button', { name: /^Sources(?: |$)/ }).click();
      await expect(page.getByText('Loading sources…', { exact: true })).toBeVisible();
      await expect(page.getByText('Connect your Immich library', { exact: true })).toHaveCount(0);
      releaseSources();
      await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
      await expect(page.getByText('Connect your Immich library', { exact: true })).toHaveCount(0);
      await page.getByRole('button', { name: 'Edit', exact: true }).click();
      const folders = page.getByRole('radio', { name: /^Folders(?: |$)/ });
      await expect(folders).toBeEnabled();
      await folders.locator('..').click();
      await expect(page.getByText('2 folders selected', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Save and sync', exact: true }).click();
      await expect(page.getByText('Source saved. Synchronization is running in the background.')).toBeVisible();
      expect(saves[1].selection.roots).toEqual([{ libraryId: 'library', path: '/photos' }, { libraryId: 'archive', path: '/archive' }]);
      expect(saves[1].selection.albumIds).toEqual(['family']);
      expect(saves[1].selection.initializedModes).toEqual(['albums', 'folders']);

      await page.getByText('Using local folders too?', { exact: true }).click();
      await page.getByRole('button', { name: 'Open folder exclusions', exact: true }).click();
      await expect(page.getByText('Excluded source folders', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Custom rules', exact: true })).toBeFocused();
      expect(errors).toEqual([]);
    });
  }
}
