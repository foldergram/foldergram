import { expect, test, type Page } from '@playwright/test';

const completed = {
  id: 3, started_at: '2026-11-16T07:04:00Z', finished_at: '2026-11-16T07:05:00Z',
  status: 'completed', scanned_files: 4, new_files: 4, updated_files: 0, removed_files: 0,
  error_text: null, warning_count: 0, warning_text: null
};

type ScanResult = typeof completed & { source_id?: number | null };

async function mockActivity(page: Page, admin: boolean, initiallyScanning = true, recentIssues: ScanResult[] = []) {
  let failed = false;
  let scan = {
    isScanning: initiallyScanning, scanReason: 'manual', phase: initiallyScanning ? 'derivatives' : 'idle', runId: 3,
    queuedDerivativeJobs: 4, processedDerivativeJobs: 2, generatedThumbnails: 2, generatedPreviews: 0,
    currentFile: admin ? 'private/holiday.jpg' : null, lastCompletedScan: null as typeof completed | null,
    recentIssues,
    operation: { id: 'a5a784a8-63e4-44a7-9647-233ed410c317', state: 'running', controls: admin ? ['pause', 'cancel'] : [] }
  };
  await page.addInitScript(() => localStorage.setItem('foldergram-locale', 'en'));
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/scan-progress')) {
      if (!admin && path.startsWith('/api/admin/')) throw new Error('Viewer requested privileged scan progress');
      if (failed) return route.fulfill({ status: 503, json: { message: 'Status offline' } });
      return route.fulfill({ json: scan });
    }
    if (path.endsWith('/pause')) {
      scan = { ...scan, operation: { ...scan.operation, state: 'paused', controls: ['resume', 'cancel'] } };
      return route.fulfill({ json: { ok: true, operation: scan.operation } });
    }
    if (path.endsWith('/cancel')) {
      scan = { ...scan, isScanning: false, phase: 'idle', lastCompletedScan: { ...completed, status: 'cancelled' },
        operation: { ...scan.operation, state: 'cancelled', controls: [] } };
      return route.fulfill({ json: { ok: true, operation: scan.operation } });
    }

    if (path === '/api/admin/stats') return route.fulfill({ status: 503, json: { message: 'No admin diagnostics in this fixture' } });

    const responses: Record<string, unknown> = {
      '/api/auth/status': {
        enabled: true, authenticated: true, role: admin ? 'admin' : 'viewer', accessMode: 'password',
        likesMode: 'local', defaultLocale: 'en', capabilities: {
          canManageLibrary: admin, canAccessSettings: admin, canDeleteMedia: admin, canUseLocalFavorites: true,
          canUseSharedLikes: false, canUseLocalCollections: true
        }
      },
      '/api/status': { folders: 0, indexedImages: 0, indexedVideos: 0, scan,
        storage: { available: true, reason: null }, libraryIndex: { rebuildRequired: false },
        preferences: { defaultHomeFeedMode: 'recent' },
        storiesMigration: { decisionPending: false } },
      '/api/sources/status': { items: [] },
      '/api/places': { items: [{ id: 1 }] }
    };
    return route.fulfill({ json: responses[path] ?? { items: [], page: 1, limit: 24, total: 0, hasMore: false } });
  });
  return {
    complete(result = completed) {
      scan = { ...scan, isScanning: false, phase: 'idle', lastCompletedScan: result,
        operation: { ...scan.operation, state: result.status, controls: [] } };
    },
    fail(result: ScanResult) {
      scan = { ...scan, isScanning: false, phase: 'idle', lastCompletedScan: result,
        recentIssues: [result, ...scan.recentIssues],
        operation: { ...scan.operation, state: 'failed', controls: [] } };
    },
    disconnect() { failed = true; },
    reconnect() { failed = false; }
  };
}

test('desktop activity is opt-in, survives completion in an open panel, and leaves Library navigation intact', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 760 });
  const scan = await mockActivity(page, false);
  await page.goto('/library');
  await expect(page.locator('[data-test="library-scan-progress"]')).toContainText('2/4 jobs complete');
  const trigger = page.getByRole('button', { name: 'Library scan in progress. Show details' });
  await expect(trigger).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.app-shell__scan-status')).toHaveCount(0);
  await trigger.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog');
  await expect(details).toContainText('2/4 jobs complete');
  await expect(details.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(details).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  scan.complete();
  await expect(details).toContainText('Scan completed.');
  await expect(details.getByRole('button', { name: 'Close' })).toBeFocused();
  await details.getByRole('button', { name: 'Close' }).click();
  await expect(trigger).toHaveCount(0);
  await expect(page.locator('[data-test="library-scan-progress"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page).toHaveURL(/\/library$/);
});

for (const width of [320, 360]) {
  test('mobile scan sheet supports pause and cancel at ' + width + 'px', async ({ page }) => {
    await page.setViewportSize({ width, height: 690 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await mockActivity(page, true);
    await page.goto('/library');
    const trigger = page.getByRole('button', { name: 'Library scan in progress. Show details' });
    await expect(trigger).toBeVisible();
    expect((await trigger.boundingBox())!.width).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole('link', { name: 'Library', exact: true })).toBeInViewport();
    await trigger.tap({ force: true }).catch(() => trigger.click());
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('private/holiday.jpg');
    await sheet.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(sheet).toContainText('Scan paused');
    await expect(sheet.getByRole('button', { name: 'Resume' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Cancel scan' }).click();
    await expect(sheet).toContainText('Scan cancelled. Completed work has been kept.');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toHaveCount(0);
  });
}

for (const newerResult of [false, true]) {
  test(newerResult ? 'a newer cancellation replaces a deferred completion' : 'closing a reviewed deferred completion removes its indicator', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 760 });
    const scan = await mockActivity(page, true, false);
    const finishScan = Promise.withResolvers<void>();
    await page.route('**/api/admin/rescan', async route => {
      await finishScan.promise;
      scan.complete();
      await route.fulfill({ json: { ok: true, lastScan: completed } });
    });

    await page.goto('/settings#library');
    const sent = page.waitForRequest(request => new URL(request.url()).pathname === '/api/admin/rescan');
    await page.getByRole('button', { name: 'Scan for changes', exact: true }).click();
    await sent;
    try {
      await page.getByRole('link', { name: 'Library', exact: true }).click();
      await expect(page).toHaveURL(/\/library$/);
    } finally {
      finishScan.resolve();
    }

    const trigger = page.getByRole('button', { name: 'Show library activity', exact: true });
    await trigger.click();
    const details = page.getByRole('dialog');
    await expect(details).toContainText('Scan completed.');
    if (newerResult) {
      scan.complete({ ...completed, id: completed.id + 1, status: 'cancelled' });
      await expect(details).toContainText('Scan cancelled. Completed work has been kept.', { timeout: 10_000 });
    }
    await details.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(trigger).toHaveCount(0);
  });
}

test('historical repeated failures do not replace a successful scan or require repeated acknowledgement', async ({ page }) => {
  const interrupted = { ...completed, source_id: 1, id: 2,
    started_at: '2026-09-03T14:06:46.139Z', finished_at: '2026-11-16T03:06:21.582Z', status: 'failed',
    error_text: 'Scan interrupted by server restart. Run a scan to continue.' };
  const scan = await mockActivity(page, true, false, [interrupted, { ...interrupted, id: 1 }]);
  scan.complete();
  await page.goto('/settings#library');
  await expect(page.getByText('Scan completed.', { exact: true })).toBeVisible();
  await expect(page.getByText('Earlier scan needs attention', { exact: true })).toBeVisible();
  await expect(page.getByText('2 scans reported this issue.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge 2 results', exact: true }).click();
  await expect(page.getByText('Earlier scan needs attention', { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Scan completed.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Acknowledge/ })).toHaveCount(0);

  const failure = { ...interrupted, id: 4, started_at: '2026-11-16T14:10:00Z' };
  await page.route('**/api/admin/rescan', async route => {
    scan.fail(failure);
    await route.fulfill({ json: { ok: true, lastScan: failure } });
  });
  await page.getByRole('button', { name: 'Scan for changes', exact: true }).click();
  await expect(page.getByText('Scan could not finish.', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Acknowledge', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Acknowledge 2 results', exact: true })).toHaveCount(0);
});

test('a failed progress connection leaves the last scan visible and can retry', async ({ page }) => {
  const scan = await mockActivity(page, false);
  await page.goto('/library');
  await page.getByRole('button', { name: 'Details', exact: true }).click();
  scan.disconnect();
  const details = page.getByRole('dialog');
  await expect(details).toContainText('Status unavailable');
  await expect(details).toContainText('2/4 jobs complete');
  scan.reconnect();
  await details.getByRole('button', { name: 'Retry' }).click();
  await expect(details.getByText('Status unavailable')).toHaveCount(0);
});
