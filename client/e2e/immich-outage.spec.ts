import { expect, test } from '@playwright/test';

for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`Immich outage and recovery on ${viewport.name} in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(value => {
        localStorage.setItem('foldergram-theme', value);
        localStorage.setItem('foldergram-locale', 'en');
      }, theme);
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      let available = false;
      let mixed = false;
      let holdStatus = false;
      let holdPoll = false;
      let releasePoll!: () => void;
      const pollGate = new Promise<void>(resolve => { releasePoll = resolve; });
      let releaseStatus!: () => void;
      const statusGate = new Promise<void>(resolve => { releaseStatus = resolve; });
      let releaseLocalPage!: () => void;
      const localPageGate = new Promise<void>(resolve => { releaseLocalPage = resolve; });
      let laterPages = 0;
      let remoteImageRequests = 0;
      let releaseRetry!: () => void;
      const retryGate = new Promise<void>(resolve => { releaseRetry = resolve; });
      const item = (id: number, remote: boolean) => ({
        id, folderId: id, folderSlug: remote ? 'immich' : 'local', folderName: remote ? 'Holiday' : 'Local photos',
        folderPath: remote ? 'immich' : 'local', folderBreadcrumb: null, sourceId: remote ? 1 : null,
        filename: `${id}.png`, caption: remote ? 'Holiday memories' : 'A photo from your local library',
        width: 800, height: 600, mediaType: 'image', durationMs: null, isAnimated: false,
        thumbnailUrl: `/api/test-image/${id}`, previewUrl: `/api/test-image/${id}`, originalDownloadsAllowed: !remote,
        sortTimestamp: 1777000000000, takenAt: 1777000000000, isSaved: false
      });
      const remote = item(1, true);
      const local = item(2, false);
      const status = {
        folders: 15, indexedImages: 237, indexedVideos: 40,
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
        const url = new URL(route.request().url());
        const path = url.pathname;
        if (path.startsWith('/api/test-image/')) {
          if (path.endsWith('/1')) remoteImageRequests++;
          await route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5WQAAAAASUVORK5CYII=', 'base64') });
          return;
        }
        if (path === '/api/sources/status') {
          const availableAtStart = available;
          if (holdStatus) await statusGate;
          if (holdPoll && !url.searchParams.has('retry')) await pollGate;
          if (url.searchParams.has('retry')) await retryGate;
          await route.fulfill({ json: { hasLocalPosts: mixed, items: [{ id: 1, name: 'Immich', enabled: 1, status: 'ready', generation: 1, updated_at: '', available: availableAtStart, syncing: false }] } });
          return;
        }
        if (path === '/api/feed') {
          const pageNumber = Number(url.searchParams.get('page'));
          if (pageNumber > 1) {
            laterPages++;
            if (mixed) await localPageGate;
          }
          await route.fulfill({ json: { items: pageNumber > 1 ? [local] : [remote], page: pageNumber, limit: 18, total: mixed ? 2 : 237, hasMore: pageNumber === 1, mode: 'recent' } });
          return;
        }
        const responses: Record<string, unknown> = {
          '/api/auth/status': {
            enabled: false, authenticated: true, role: 'admin', accessMode: 'off', likesMode: 'shared', defaultLocale: 'en',
            capabilities: { canManageLibrary: true, canDeleteMedia: true, canAccessSettings: true, canUseSharedLikes: true, canUseLocalFavorites: false, canUseSharedCollections: true, canUseLocalCollections: false }
          },
          '/api/status': status,
          '/api/feed/moments': { items: [], railKind: 'moments', railTitle: 'Moments', railDescription: '', railSingularLabel: 'Moment' },
          '/api/folders': { items: [], page: 1, limit: 24, total: 15, hasMore: false },
          '/api/likes': { items: [] },
          '/api/collections': { items: [] }
        };
        await route.fulfill({ json: responses[path] ?? { items: [] } });
      });

      await page.goto('/');
      const notice = page.locator('[data-test="source-unavailable"]');
      const skeleton = page.locator('[data-test="home-feed-skeleton"]');
      await expect(notice.getByRole('heading', { name: 'Immich is unavailable' })).toBeVisible();
      await expect(notice.getByText('Reconnecting automatically')).toBeVisible();
      await expect(page.getByText('You are caught up', { exact: true })).toHaveCount(0);
      await expect(page.locator('.home-layout__header')).toHaveCount(0);
      await expect(skeleton).toHaveCount(0);
      await expect(page.getByText('Loading more...', { exact: true })).toHaveCount(0);
      expect(laterPages).toBe(0);
      expect(remoteImageRequests).toBe(0);
      const bounds = await notice.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      await page.screenshot({ path: test.info().outputPath('immich-only-offline.png'), fullPage: true });

      // While the first availability check is pending, render only skeletons,
      // even if a page of indexed remote posts has already arrived.
      holdStatus = true;
      const feedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/feed');
      await page.reload();
      await feedResponse;
      await expect(skeleton).toBeVisible();
      await expect(notice).toHaveCount(0);
      expect(remoteImageRequests).toBe(0);
      releaseStatus();
      holdStatus = false;
      await expect(notice).toBeVisible();
      await expect(skeleton).toHaveCount(0);
      await expect(page.locator('.home-layout__header')).toHaveCount(0);
      await expect(page.getByText('Loading more...', { exact: true })).toHaveCount(0);
      expect(laterPages).toBe(0);

      mixed = true;
      const localPageRequest = page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname === '/api/feed' && url.searchParams.get('page') === '2';
      });
      await page.reload();
      const localCard = page.getByRole('article').filter({ hasText: 'A photo from your local library' });
      const remoteCard = page.getByRole('article').filter({ hasText: 'Holiday memories' });
      await localPageRequest;
      await expect(skeleton).toBeVisible();
      await expect(notice).toHaveCount(0);
      await expect(page.getByText('Loading more...', { exact: true })).toHaveCount(0);
      releaseLocalPage();
      await expect(notice).toBeVisible();
      await expect(localCard).toBeVisible();
      await expect(remoteCard).toHaveCount(0);
      await expect(page.getByText('You are caught up', { exact: true })).toHaveCount(0);
      await page.screenshot({ path: test.info().outputPath('mixed-library-offline.png'), fullPage: true });

      holdPoll = true;
      await page.waitForRequest(request => {
        const url = new URL(request.url());
        return url.pathname === '/api/sources/status' && !url.searchParams.has('retry');
      });
      await notice.getByRole('button', { name: 'Retry', exact: true }).click();
      await expect(notice.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
      available = true;
      const forcedRetry = page.waitForRequest(request => new URL(request.url()).searchParams.get('retry') === '1');
      releasePoll();
      await forcedRetry;
      await expect(notice.getByRole('button', { name: 'Checking…', exact: true })).toBeDisabled();
      releaseRetry();
      await expect(notice).toHaveCount(0);
      await expect(remoteCard).toBeVisible();
      await expect(localCard).toBeVisible();
      expect(errors).toEqual([]);
    });
  }
}
