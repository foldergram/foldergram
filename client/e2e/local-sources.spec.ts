import { expect, test } from '@playwright/test';

test('sets up a local folder and keeps its cached media visible during an outage', async ({ page }) => {
  const primary = { id: 1, kind: 'local', name: 'Primary gallery', managed_by: 'environment', rootPath: '/app/data/gallery', enabled: 1, available: true, status: 'ready', asset_count: 0, folder_count: 0, progress: 100, syncing: false };
  const local = { ...primary, id: 2, name: 'Backup drive', managed_by: 'settings', rootPath: '/sources/backup', readOnlyOriginals: true, asset_count: 1, folder_count: 1 };
  const immich = { id: 3, kind: 'immich', name: 'Immich', enabled: 1, available: true, status: 'ready', asset_count: 1, folder_count: 1, syncing: false };
  let added = false;
  let disconnected = false;
  let enabled = true;
  const stats = {
    folders: 0, indexedImages: 0, indexedVideos: 0,
    scan: { isScanning: false, lastCompletedScan: null },
    storage: { available: true, reason: null },
    libraryIndex: { rebuildRequired: false, reason: null, ignoredRootMediaCount: 0 },
    preferences: { defaultLocale: 'en', defaultHomeFeedMode: 'recent', defaultReelsFeedMode: 'random' },
    storiesMigration: { hasLegacyStoriesCandidates: false, decisionPending: false },
    carouselsMigration: { hasLegacyCarouselsCandidates: false, decisionPending: false, reconciliationPending: false }
  };
  const post = (id: number, sourceKind: string, folderName: string) => ({
    id, sourceId: id, sourceKind, folderId: id, folderName, folderSlug: sourceKind, filename: 'photo.jpg',
    mediaType: 'image', postType: 'single', width: 120, height: 90, thumbnailUrl: '/icon-192.png',
    previewUrl: '/icon-192.png', sortTimestamp: 1, mediaItems: []
  });

  await page.addInitScript(() => localStorage.setItem('foldergram-locale', 'en'));
  await page.route('**/api/**', async route => {
    const { pathname } = new URL(route.request().url());
    const method = route.request().method();
    if (pathname === '/api/admin/sources/local/test') {
      expect(route.request().postDataJSON()).toEqual({ rootPath: local.rootPath });
      return route.fulfill({ json: { ignoredRootMediaCount: 1, partial: false } });
    }
    if (pathname === '/api/admin/sources' && method === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ kind: 'local', rootPath: local.rootPath, name: local.name, readOnlyOriginals: true });
      added = true;
      return route.fulfill({ status: 201, json: local });
    }
    if (pathname === '/api/admin/sources/2/sync') return route.fulfill({ status: 202, json: { ok: true } });
    if (pathname === '/api/admin/sources/2' && method === 'PATCH') {
      enabled = route.request().postDataJSON().enabled;
      return route.fulfill({ json: { ...local, enabled: Number(enabled) } });
    }
    const secondary = { ...local, available: !disconnected && enabled, enabled: Number(enabled), generation: enabled ? 1 : 2, status: disconnected ? 'unavailable' : 'ready' };
    const items = added ? [post(3, 'immich', 'Remote album'), ...(enabled ? [post(2, 'local', 'Backup album')] : [])] : [];
    const responses: Record<string, unknown> = {
      '/api/auth/status': {
        enabled: false, authenticated: true, role: 'admin', accessMode: 'off', likesMode: 'shared', defaultLocale: 'en',
        capabilities: { canManageLibrary: true, canDeleteMedia: true, canAccessSettings: true, canUseSharedLikes: true, canUseSharedCollections: true }
      },
      '/api/status': { ...stats, folders: items.length, indexedImages: items.length },
      '/api/admin/stats': { ...stats, excludedFolders: { envExcludedFolders: [], customExcludedFolders: [], effectiveExcludedFolders: [] }, deletionRecovery: { failedCount: 0, failures: [] } },
      '/api/admin/sources': { items: [primary, ...(added ? [secondary, immich] : [])] },
      '/api/sources/status': { items: [primary, ...(added ? [secondary, immich] : [])], hasLocalPosts: added && enabled, hasVisiblePosts: added },
      '/api/feed': { items, page: 1, limit: 20, total: items.length, hasMore: false, mode: 'recent' }
    };
    await route.fulfill({ json: responses[pathname] ?? { items: [] } });
  });

  await page.goto('/');
  const connectSource = page.getByRole('link', { name: 'Connect a source' });
  await expect(connectSource).toHaveAttribute('href', '/settings#sources');
  await connectSource.click();
  await expect(page.getByText('Primary gallery', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: /^General Settings(?: |$)/ }).click();
  await expect(page).toHaveURL(/#general$/);
  await page.goBack();
  await expect(page).toHaveURL(/#sources$/);
  await expect(page.getByText('Primary gallery', { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/#general$/);
  await expect(page.getByText('Primary gallery', { exact: true })).toBeHidden();
  await page.goBack();
  await page.reload();
  await expect(page).toHaveURL(/#sources$/);
  await expect(page.getByText('Primary gallery', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add local folder' }).click();
  await page.getByLabel('Name', { exact: true }).fill(local.name);
  await page.getByLabel('Server folder path').fill(local.rootPath);
  await page.getByRole('button', { name: 'Validate path' }).click();
  await expect(page.getByText('Root-level media files found and skipped: 1.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Save & Sync' }).click();
  const card = page.getByRole('article').filter({ hasText: 'Backup drive' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Sync now' }).click();

  disconnected = true;
  await page.goto('/');
  await expect(page.getByText('Local source unavailable')).toBeVisible();
  await expect(page.getByText('Backup album', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Remote album', { exact: true }).first()).toBeVisible();

  await page.goto('/settings?section=sources');
  await card.getByText('More options').click();
  await card.getByRole('button', { name: 'Disable', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(card.getByText('Disabled', { exact: true })).toBeVisible();
  await page.goto('/');
  await expect(page.getByText('Remote album', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Backup album', { exact: true })).toHaveCount(0);
});
