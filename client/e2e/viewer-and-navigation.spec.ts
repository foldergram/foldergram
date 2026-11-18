import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const folder = {
  id: 1, slug: 'panoramas', name: 'Panoramas', description: null,
  folderPath: 'panoramas', breadcrumb: null, imageCount: 1, videoCount: 0,
  latestImageMtimeMs: 1_777_000_000_000, hasAvatarStory: false,
  avatarImageId: 1, avatarUrl: '/thumbnails/panorama.svg'
};
const panorama = {
  id: 1, folderId: 1, folderSlug: folder.slug, folderName: folder.name,
  folderPath: folder.folderPath, folderBreadcrumb: null,
  filename: 'panorama.jpg', relativePath: 'panoramas/panorama.jpg',
  width: 6000, height: 1000, mediaType: 'image', durationMs: null, isAnimated: false,
  caption: 'The entire panorama caption should remain readable.',
  thumbnailUrl: '/thumbnails/panorama.svg', previewUrl: '/previews/panorama.svg',
  originalUrl: '/api/originals/1', mimeType: 'image/jpeg', fileSize: 123_456,
  sortTimestamp: 1_777_000_000_000, takenAt: 1_777_000_000_000,
  folderAvatarImageId: 1, playbackStrategy: null, previousImageId: null, nextImageId: null,
  exif: {
    cameraMake: 'Test', cameraModel: 'Panorama', lensModel: 'Wide angle',
    fNumber: 8, exposureTimeSeconds: 0.01, iso: 100, focalLengthMm: 24
  }
};

async function mockGallery(page: Page, theme?: 'light' | 'dark') {
  await page.addInitScript(value => {
    if (value) localStorage.setItem('foldergram-theme', value);
    localStorage.setItem('foldergram-locale', 'en');
  }, theme);
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const paginated = { items: [panorama], page: 1, limit: 24, total: 1, hasMore: false };
    const scan = { isScanning: false, lastCompletedScan: { id: 1 } };
    const responses: Record<string, unknown> = {
      '/api/auth/status': {
        enabled: true, publicDemoMode: false, authenticated: false, role: 'anonymous', accessMode: 'public',
        likesMode: 'local', defaultLocale: 'en',
        capabilities: {
          canManageLibrary: false, canDeleteMedia: false, canAccessSettings: false,
          canUseSharedLikes: false, canUseLocalFavorites: true,
          canUseSharedCollections: false, canUseLocalCollections: true
        }
      },
      '/api/status': {
        folders: 1, indexedImages: 1, indexedVideos: 0, scan,
        storage: { available: true, reason: null },
        libraryIndex: { rebuildRequired: false, reason: null, ignoredRootMediaCount: 0 },
        preferences: { defaultHomeFeedMode: 'recent', defaultReelsFeedMode: 'recommended' },
        storiesMigration: { hasLegacyStoriesCandidates: false, decisionPending: false }
      },
      '/api/scan-progress': scan,
      '/api/folders': url.searchParams.has('limit')
        ? { items: [folder], page: 1, limit: Number(url.searchParams.get('limit')), total: 1, hasMore: false }
        : { items: [folder] },
      '/api/folders/panoramas': folder,
      '/api/folders/panoramas/images': { ...paginated, folder },
      '/api/folders/panoramas/stories': {
        railKind: 'stories', railTitle: 'Stories', railDescription: '', railSingularLabel: 'Story',
        hasAvatarStory: false, avatarStoryId: null, items: [], highlights: []
      },
      '/api/feed': paginated,
      '/api/feed/search': paginated,
      '/api/feed/moments': {
        railKind: 'moments', railTitle: 'Moments', railDescription: '', railSingularLabel: 'Moment', items: []
      },
      '/api/posts/1': panorama,
      '/api/places': { items: [] }
    };
    if (!(pathname in responses)) {
      await route.fulfill({ status: 404, json: { message: `Unmocked route: ${pathname}` } });
      return;
    }
    await route.fulfill({ json: responses[pathname] });
  });
  await page.route(/\/(thumbnails|previews)\/panorama\.svg/, route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="6000" height="1000"><rect width="6000" height="1000" fill="#527d93"/></svg>'
  }));
}

async function expectReadableBetweenStickyBars(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const result = await target.evaluate(element => {
    const panel = element.closest('.viewer__sidebar')!;
    const header = panel.querySelector('.viewer__sidebar-header')!.getBoundingClientRect();
    const footer = panel.querySelector('.viewer__sidebar-actions')!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const top = Math.max(bounds.top, header.bottom);
    const bottom = Math.min(bounds.bottom, footer.top);
    const hit = document.elementFromPoint(bounds.x + bounds.width / 2, (top + bottom) / 2);
    return { readableHeight: bottom - top, unobscured: hit !== null && element.contains(hit) };
  });
  expect(result.readableHeight, 'Caption or metadata must have visible space between sticky bars').toBeGreaterThan(16);
  expect(result.unobscured, 'Sticky controls must not cover the text').toBe(true);
}

async function expectReadableControl(control: Locator) {
  const contrast = await control.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const luminance = (colors: string[]) => {
      context.clearRect(0, 0, 1, 1);
      for (const color of colors) {
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
      }
      const rgba = context.getImageData(0, 0, 1, 1).data;
      const linear = Array.from(rgba).slice(0, 3).map(value => {
        const srgb = value / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const backgroundLayers: string[] = [];
    for (let layer: Element | null = element; layer; layer = layer.parentElement) {
      backgroundLayers.unshift(getComputedStyle(layer).backgroundColor);
    }
    const background = luminance(backgroundLayers);
    const foreground = luminance([...backgroundLayers, getComputedStyle(element).color]);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast, 'Control text and icons need at least 4.5:1 contrast').toBeGreaterThanOrEqual(4.5);
}

const adminAuthStatus = {
  enabled: true, publicDemoMode: false, authenticated: true, role: 'admin', accessMode: 'public',
  likesMode: 'local', defaultLocale: 'en', capabilities: {
    canManageLibrary: true, canDeleteMedia: true, canAccessSettings: true,
    canUseSharedLikes: false, canUseLocalFavorites: true,
    canUseSharedCollections: false, canUseLocalCollections: true
  }
};

async function expectAppearanceRow(toggle: Locator, mobile: boolean) {
  await expect(toggle).toHaveCSS('display', 'flex');
  const dimensions = await toggle.evaluate(button => {
    const icon = button.querySelector('span[aria-hidden="true"]')!;
    const row = button.getBoundingClientRect();
    const iconBox = icon.getBoundingClientRect();
    const style = getComputedStyle(button);
    return {
      width: row.width, available: button.parentElement!.clientWidth, height: row.height,
      gap: parseFloat(style.columnGap), padding: parseFloat(style.paddingLeft),
      iconWidth: iconBox.width, iconHeight: iconBox.height, mask: getComputedStyle(icon).maskImage,
      background: style.backgroundColor
    };
  });
  expect(dimensions.width).toBeCloseTo(dimensions.available, 0);
  expect(dimensions.height).toBeGreaterThanOrEqual(mobile ? 53 : 48);
  expect(dimensions.gap).toBeCloseTo(15.2);
  expect(dimensions.padding).toBeCloseTo(mobile ? 16.8 : 19.2);
  expect(dimensions.iconWidth).toBeCloseTo(18.875);
  expect(dimensions.iconHeight).toBeCloseTo(18.875);
  expect(dimensions.mask).not.toBe('none');
  await toggle.hover();
  await expect.poll(() => toggle.evaluate(button => getComputedStyle(button).backgroundColor))
    .not.toBe(dimensions.background);
}

for (const width of [1280, 390]) {
  test(`public appearance works while the instance request is pending at ${width}px`, async ({ page }) => {
    await mockGallery(page);
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    let sendAppearance!: () => void;
    const pending = new Promise<void>(resolve => { sendAppearance = resolve; });
    await page.route('**/api/appearance', async route => {
      await pending;
      await route.fulfill({ json: { theme: 'dark', accent: 'orange' } });
    });
    const writes: string[] = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/admin/settings/appearance')) writes.push(request.method());
    });

    try {
      await page.goto('/explore?q=Panoramas', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#fg-splash')).toHaveCount(0);
      const more = page.getByRole('button', { name: 'More', exact: true });
      const toggle = page.getByRole('button', { name: 'Switch appearance', exact: true });
      const root = page.locator('html');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByRole('combobox', { name: /Switch appearance/i })).toHaveCount(0);
      await toggle.click();
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();
      await toggle.click();
      await expect(root).toHaveAttribute('data-theme', 'light');

      sendAppearance();
      const selectedTab = page.getByRole('tab', { selected: true });
      await expect(selectedTab).toHaveCSS('background-color', 'rgb(180, 83, 9)');
      await expectReadableControl(selectedTab);

      await page.reload();
      await expect(root).toHaveAttribute('data-theme', 'light');
      await more.click();
      await toggle.click();
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await expect(selectedTab).toHaveCSS('background-color', 'rgb(251, 191, 36)');
      await expectReadableControl(selectedTab);
      await page.mouse.move(width - 1, 0);
      await selectedTab.hover({ timeout: 5000 });
      await expectReadableControl(selectedTab);
      expect(writes).toEqual([]);
    } finally {
      sendAppearance();
    }
  });

  test(`admin appearance uses the database for More and Settings at ${width}px`, async ({ page }) => {
    await mockGallery(page, 'light');
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.route('**/api/auth/status', route => route.fulfill({ json: adminAuthStatus }));

    let theme = 'dark';
    let accent = 'orange';
    let releaseFailedSave!: () => void;
    const failedSave = new Promise<void>(resolve => { releaseFailedSave = resolve; });
    const writes: unknown[] = [];
    await page.route('**/api/appearance', route => route.fulfill({ json: { theme, accent } }));
    await page.route('**/api/admin/settings/appearance', async route => {
      const method = route.request().method();
      const payload = route.request().postDataJSON();
      writes.push({ method, payload });
      if (writes.length === 1) {
        await failedSave;
        await route.fulfill({ status: 500, json: { message: 'Appearance save failed' } });
        return;
      }
      theme = payload.theme;
      if (method === 'PUT') accent = payload.accent;
      await route.fulfill({ json: { theme, accent } });
    });

    const root = page.locator('html');
    const more = page.getByRole('button', { name: 'More', exact: true });
    const toggle = page.getByRole('button', { name: 'Switch appearance', exact: true });
    const themeSelect = page.getByRole('combobox', { name: 'Default appearance' });
    const save = page.getByRole('button', { name: 'Save appearance', exact: true });
    try {
      await page.goto('/settings#general');
      await expect(themeSelect).toHaveValue('dark');
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await more.click();
      await expectAppearanceRow(toggle, width === 390);
      await expect(toggle.locator('span[aria-hidden="true"]')).toHaveClass(/i-fluent-weather-sunny/);
      await toggle.click();
      await expect(toggle).toBeDisabled();
      await expect(toggle).toHaveCSS('cursor', 'wait');
      await expect(toggle).toHaveCSS('opacity', '0.6');
      await expect(root).toHaveAttribute('data-theme', 'dark');
      releaseFailedSave();
      const error = toggle.locator('+ [role="alert"]');
      await expect(error).toBeVisible();
      await expect(error).toContainText('Could not save appearance');
      await expect(toggle).toBeEnabled();
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await expect(themeSelect).toHaveValue('dark');

      await toggle.click();
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(themeSelect).toHaveValue('light');
      expect(theme).toBe('light');
      await expect(page.getByRole('radio', { name: 'Orange' })).toBeChecked();
      await expect(root).toHaveCSS('--accent', '#b45309');
      await more.click();
      await expect(toggle.locator('span[aria-hidden="true"]')).toHaveClass(/i-fluent-weather-moon/);
      await more.click();

      await expect(themeSelect.locator('option[value="system"]')).toHaveText('System');
      await themeSelect.selectOption('dark');
      await save.click();
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await expect(root).toHaveCSS('--accent', '#fbbf24');
      expect(theme).toBe('dark');
      expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBe('light');
      await page.reload();
      await expect(themeSelect).toHaveValue('dark');
      await expect(root).toHaveAttribute('data-theme', 'dark');

      expect(writes).toEqual([
        { method: 'PATCH', payload: { theme: 'light' } },
        { method: 'PATCH', payload: { theme: 'light' } },
        { method: 'PUT', payload: { theme: 'dark', accent: 'orange' } }
      ]);
    } finally {
      releaseFailedSave();
    }
  });
}

test('public demo appearance is local and the Settings card is read-only', async ({ page }) => {
  await mockGallery(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route('**/api/auth/status', route => route.fulfill({
    json: { ...adminAuthStatus, enabled: false, publicDemoMode: true }
  }));
  let appearanceAvailable = false;
  await page.route('**/api/appearance', route => appearanceAvailable
    ? route.fulfill({ json: { theme: 'system', accent: 'orange' } })
    : route.fulfill({ status: 404, json: { message: 'Appearance unavailable' } }));
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/admin/') && request.method() !== 'GET') writes.push(request.method());
  });
  const root = page.locator('html');
  const more = page.getByRole('button', { name: 'More', exact: true });
  const toggle = page.getByRole('button', { name: 'Switch appearance', exact: true });
  const themeSelect = page.getByRole('combobox', { name: 'Default appearance' });

  await page.goto('/settings#general');
  await expect(page.getByText(/Appearance settings are read-only in the public demo/)).toBeVisible();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await more.click();
  await toggle.click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBe('light');

  appearanceAvailable = true;
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveCSS('--accent', '#b45309');
  await expect(themeSelect).toHaveValue('system');
  await expect(themeSelect).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Orange' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Orange' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeDisabled();
  await themeSelect.locator('xpath=ancestor::form').dispatchEvent('submit');
  await more.click();
  await toggle.click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveCSS('--accent', '#fbbf24');
  expect(writes).toEqual([]);
});

test('viewer appearance survives a reload and resumes when leaving admin mode', async ({ page }) => {
  await mockGallery(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  const viewer = {
    ...adminAuthStatus,
    role: 'viewer',
    capabilities: { ...adminAuthStatus.capabilities, canAccessSettings: false }
  };
  await page.route('**/api/auth/status', route => route.fulfill({ json: viewer }));
  await page.route('**/api/appearance', route => route.fulfill({ json: { theme: 'light', accent: 'orange' } }));
  await page.route('**/api/auth/unlock-admin', route => route.fulfill({ json: { ok: true, auth: adminAuthStatus } }));
  await page.route('**/api/auth/logout', route => route.fulfill({ json: { ok: true, auth: viewer } }));
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/admin/settings/appearance')) writes.push(request.method());
  });

  const root = page.locator('html');
  const more = page.getByRole('button', { name: 'More', exact: true });
  await page.goto('/');
  await more.click();
  await page.getByRole('button', { name: 'Switch appearance', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await more.click();
  await page.getByRole('button', { name: 'Unlock admin', exact: true }).click();
  await page.locator('input[autocomplete="current-password"]').fill('fixture-admin-password');
  await page.locator('form button[type="submit"]').click();
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBe('dark');

  await more.click();
  await page.getByRole('button', { name: 'Return to public view', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  expect(writes).toEqual([]);
});

test('home videos stop playing off screen after leaving fullscreen', async ({ page }) => {
  await mockGallery(page, 'light');
  await page.setViewportSize({ width: 1280, height: 720 });
  const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
  await page.route('**/previews/feed-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  const image = (id: number) => ({ ...panorama, id, width: 1200, height: 1200 });
  const video = (id: number) => ({
    ...panorama, id, filename: `clip-${id}.mp4`, mediaType: 'video',
    width: 160, height: 90, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
  });
  const items = [image(1), image(2), video(3), image(4), image(5), video(6), image(7), image(8)];
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: items.length, hasMore: false }
  }));
  await page.goto('/');

  const shell = page.locator('.feed-card__video-shell').first();
  const player = shell.locator('media-player');
  const media = shell.locator('video');
  await shell.scrollIntoViewIfNeeded();
  await expect(media).toHaveJSProperty('paused', false);
  await shell.locator('media-mute-button').click();
  await expect(media).toHaveJSProperty('muted', false);

  for (const direction of ['down', 'up']) {
    await shell.locator('media-fullscreen-button').click();
    await expect(player).toHaveAttribute('data-fullscreen', '');
    await expect(media).toHaveJSProperty('paused', false);
    await page.evaluate(() => document.exitFullscreen());
    await expect(player).not.toHaveAttribute('data-fullscreen');

    const target = direction === 'down'
      ? page.locator('.feed-card__video-shell').nth(1)
      : page.locator('main article').first();
    await target.scrollIntoViewIfNeeded();
    await expect(shell).not.toBeInViewport();
    await expect(media).toHaveJSProperty('paused', true);
    await expect(media).toHaveJSProperty('muted', false);
    if (direction === 'down') {
      await expect(target.locator('video')).toHaveJSProperty('paused', false);
    }

    await shell.scrollIntoViewIfNeeded();
    await expect(media).toHaveJSProperty('paused', false);
  }
});

test('very tall home videos play at their original aspect ratio', async ({ page }) => {
  await mockGallery(page, 'light');
  await page.setViewportSize({ width: 1280, height: 720 });
  const encodedClip = await readFile(new URL('./fixtures/tall-feed-video.mp4.base64', import.meta.url), 'utf8');
  const clip = Buffer.from(encodedClip, 'base64');
  await page.route('**/previews/tall-feed-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  const video = {
    ...panorama, filename: 'tall-clip.mp4', mediaType: 'video',
    width: 32, height: 160, durationMs: 3000, previewUrl: '/previews/tall-feed-video.mp4'
  };
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items: [video], page: 1, limit: 24, total: 1, hasMore: false }
  }));
  await page.goto('/');

  const shell = page.locator('.feed-card__video-shell');
  const media = shell.locator('video');
  await shell.scrollIntoViewIfNeeded();
  const bounds = (await shell.boundingBox())!;
  expect(bounds.width / bounds.height).toBeCloseTo(0.2, 2);
  const viewportHeight = page.viewportSize()!.height;
  expect(viewportHeight / bounds.height).toBeLessThan(0.55);
  const player = shell.locator('media-player');
  await expect(player).toHaveAttribute('data-playing', '');

  const x = bounds.x + bounds.width / 2;
  const y = viewportHeight / 2;
  await page.mouse.click(x, y);
  await expect(media).toHaveJSProperty('paused', true);
  await page.mouse.click(x, y);
  await expect(player).toHaveAttribute('data-playing', '');
});

async function mockReels(page: Page) {
  await mockGallery(page, 'light');
  const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
  await page.route('**/previews/feed-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  const items = [1, 2, 3].map(id => ({
    ...panorama, id, filename: `reel-${id}.mp4`, mediaType: 'video',
    width: 1080, height: 1920, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
  }));
  await page.route('**/api/reels?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: items.length, hasMore: false }
  }));
}

test('portrait Reels keep the next card in view and separate the two control columns', async ({ page }) => {
  await mockReels(page);
  const viewport = { width: 1080, height: 1778 };
  await page.setViewportSize(viewport);
  await page.goto('/reels');

  const stages = page.locator('.reel-player-card__stage');
  const actions = page.locator('.reels-view__action-rail--desktop');
  const next = page.getByRole('button', { name: 'Next reel' });
  await expect(stages).toHaveCount(3);
  await expect(next).toBeEnabled();

  const first = (await stages.nth(0).boundingBox())!;
  const second = (await stages.nth(1).boundingBox())!;
  const actionBounds = (await actions.boundingBox())!;
  const arrowBounds = (await next.boundingBox())!;
  expect(first.y).toBeCloseTo(16, 0);
  expect(first.width / first.height).toBeCloseTo(9 / 16, 2);
  expect(second.y - (first.y + first.height)).toBeCloseTo(32, 0);
  expect(second.y).toBeLessThan(viewport.height - 100);
  expect(actionBounds.x).toBeGreaterThan(first.x + first.width);
  expect(actionBounds.x - (first.x + first.width)).toBeLessThan(22);
  expect(arrowBounds.x).toBeGreaterThan(actionBounds.x + actionBounds.width);

  await actions.locator('.reel-action-rail__info-wrap button').click({ trial: true });
  await next.click();
  await expect(stages.nth(1).locator('.reel-player-card__overlay--visible')).toHaveCount(1);
  await expect.poll(async () => (await stages.nth(1).boundingBox())?.y).toBeCloseTo(16, 0);

  await page.locator('.reel-deck').evaluate(deck => { deck.scrollTop = deck.scrollHeight; });
  await expect(next).toBeDisabled();
  await expect.poll(async () => (await stages.nth(2).boundingBox())?.y).toBeCloseTo(16, 0);
});

test('Reels bookmark saves the active reel and opens a scrollable collection picker on hover', async ({ page }) => {
  await mockReels(page);
  await page.setViewportSize({ width: 1080, height: 1778 });
  await page.addInitScript(() => {
    const timestamp = '2026-11-17T00:00:00.000Z';
    const collections = Array.from({ length: 12 }, (_, index) => ({
      slug: `reel-collection-${index + 1}`,
      name: `Reel collection ${index + 1}`,
      isDefault: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      items: []
    }));
    localStorage.setItem('foldergram-local-collections-v1', JSON.stringify({ collections }));
  });
  await page.goto('/reels');

  const actions = page.locator('.reels-view__action-rail--desktop');
  const bookmark = actions.locator('.collection-bookmark__button');
  const picker = page.locator('.collection-bookmark__popover');
  const next = page.getByRole('button', { name: 'Next reel' });

  await expect(bookmark).toHaveAccessibleName('Save post');
  await bookmark.click();
  await expect(bookmark).toHaveAccessibleName('Remove saved post');
  await expect(picker).toHaveCount(0);

  await next.hover();
  await bookmark.hover();
  await expect(picker).toHaveAttribute('data-placement', 'left');
  const pickerBounds = (await picker.boundingBox())!;
  const bookmarkBounds = (await bookmark.boundingBox())!;
  expect(pickerBounds.x + pickerBounds.width).toBeLessThan(bookmarkBounds.x);

  const rows = picker.locator('.collection-bookmark__rows');
  await rows.hover();
  await page.mouse.wheel(0, 440);
  await expect.poll(() => rows.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Previous reel' })).toBeDisabled();
  await picker.getByRole('button', { name: 'Reel collection 12', exact: true }).click();
  await expect(picker).toHaveCount(0);

  const storedItems = await page.evaluate(() => {
    const { collections } = JSON.parse(localStorage.getItem('foldergram-local-collections-v1') ?? '{}');
    return collections.find((collection: { slug: string }) => collection.slug === 'reel-collection-12')?.items;
  });
  expect(storedItems).toEqual([expect.objectContaining({ id: 1, mediaType: 'video' })]);

  await bookmark.hover();
  await expect(picker).toBeVisible();
  await next.click();
  await expect(picker).toHaveCount(0);
  await expect(bookmark).toHaveAccessibleName('Save post');
});

for (const viewport of [{ width: 1280, height: 720 }, { width: 1152, height: 900 }, { width: 1080, height: 1778 }]) {
  test(`reel details leave both navigation arrows clickable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await mockReels(page);
    await page.setViewportSize(viewport);
    await page.goto('/reels');

    const details = page.locator('.reels-view__action-rail--desktop .reel-action-rail__info-wrap button');
    const panel = page.locator('.reels-info-sidebar');
    const previous = page.getByRole('button', { name: 'Previous reel' });
    const next = page.getByRole('button', { name: 'Next reel' });

    await next.click();
    await expect(previous).toBeEnabled();
    await details.click();
    await expect(panel).toBeVisible();
    await previous.click({ trial: true });
    await next.click();
    await expect(next).toBeDisabled();
  });
}

test('reel metadata clears the expanded sidebar and moves on-video in a narrow gutter', async ({ page }) => {
  await mockReels(page);
  await page.setViewportSize({ width: 1440, height: 786 });
  await page.goto('/reels');

  const sidebar = page.locator('aside.sidebar');
  const external = page.locator('.reels-view__metadata');
  const onVideo = page.locator('.reel-player-card__overlay--visible .reel-player-card__folder-link');

  await sidebar.hover();
  await expect(sidebar).toHaveCSS('width', '240px');
  await expect(external).toBeVisible();
  const sidebarBounds = (await sidebar.boundingBox())!;
  expect((await external.boundingBox())!.x).toBeGreaterThan(sidebarBounds.x + sidebarBounds.width);
  await external.click({ trial: true });

  await page.setViewportSize({ width: 1152, height: 900 });
  await sidebar.hover();
  await expect(external).toHaveCount(0);
  await onVideo.click();
  await expect(page).toHaveURL(/\/f\/panoramas$/);
});

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await mockGallery(page, theme);
    });

    for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 1440, height: 900 }]) {
      test(`panoramic details remain readable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto('/f/panoramas');
        await page.locator('main a[href="/post/1"]').last().click();
        const panel = page.locator('.viewer--details-docked .viewer__sidebar');
        await expect(panel).toBeVisible();
        await expectReadableBetweenStickyBars(panel.locator('.viewer__sidebar-caption'));
        await expectReadableBetweenStickyBars(panel.locator('.viewer__sidebar-metadata-item').last());
        await panel.getByRole('link', { name: 'Open original file', exact: true }).click({ trial: true });
        const media = await page.locator('.viewer__media-shell').boundingBox();
        const details = await panel.boundingBox();
        expect(details!.height).toBeGreaterThan(media!.height);
        expect(details!.y).toBeGreaterThanOrEqual(0);
        expect(details!.y + details!.height).toBeLessThanOrEqual(viewport.height);
        expect(media!.width / media!.height).toBeCloseTo(6, 1);
      });
    }

    test('expanded desktop navigation paints a full panel only in portrait', async ({ page }) => {
      await page.setViewportSize({ width: 1040, height: 1500 });
      await page.goto('/');

      const sidebar = page.locator('aside.sidebar');
      const post = page.locator('main article').first();
      await expect(post).toBeVisible();
      const beforeHover = await post.boundingBox();

      await sidebar.getByRole('link', { name: 'Reels' }).hover();
      await expect(sidebar).toHaveCSS('width', '240px');
      await expect(sidebar).toHaveCSS('background-size', '100% 100%');
      expect(await post.boundingBox()).toEqual(beforeHover);

      await page.setViewportSize({ width: 1040, height: 720 });
      await sidebar.getByRole('link', { name: 'Reels' }).hover();
      await expect(sidebar).toHaveCSS('width', '240px');
      await expect(sidebar).toHaveCSS('background-size', '77.6px 100%');
    });

    test('active main navigation is readable without Folders Spotlight', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      const sidebar = page.locator('.sidebar');
      await sidebar.hover();
      const activeMain = sidebar.locator('.sidebar__link.router-link-active');
      await expect(activeMain).toBeVisible();
      await expect(activeMain.locator('.sidebar__label')).toHaveCSS('opacity', '1');
      await expectReadableControl(activeMain);
      await expect(sidebar.getByText('Folders Spotlight')).toHaveCount(0);
      await expect(sidebar.locator('a[href^="/f/"]')).toHaveCount(0);
    });
  });
}


for (const [name, path] of [['Library', '/library'], ['Places', '/places']]) {
  test(`${name} stays centered clear of the expanded desktop navigation`, async ({ page }) => {
    await mockGallery(page, 'light');
    await page.setViewportSize({ width: 1440, height: 744 });
    await page.goto(path);

    const content = page.locator('main .centered-page');
    const sidebar = page.locator('aside.sidebar');
    const margins = () => content.evaluate(element => {
      const { left, right } = element.getBoundingClientRect();
      return { left, right: document.documentElement.clientWidth - right };
    });

    for (const width of [1440, 1024]) {
      await page.setViewportSize({ width, height: 744 });
      await page.mouse.move(width - 20, 20);
      const collapsed = await margins();

      await sidebar.hover();
      await expect(sidebar).toHaveCSS('width', '240px');
      const expanded = await margins();
      const sidebarBounds = await sidebar.boundingBox();

      expect(expanded).toEqual(collapsed);
      expect(expanded.left).toBeCloseTo(expanded.right, 1);
      expect(expanded.left - (sidebarBounds!.x + sidebarBounds!.width)).toBeGreaterThanOrEqual(12);
    }
  });
}

for (const folderCount of [1500, 5000, 10000]) {
  test(`folder bootstrap, Library pagination, and Explore search with ${folderCount} folders`, async ({ page }) => {
    await mockGallery(page, 'light');
    const folders = Array.from({ length: folderCount }, (_, index) => ({
      ...folder, id: index + 1, slug: `album-${index}`, name: `Album ${String(index).padStart(3, '0')}`,
      folderPath: `archive/${index}`, avatarUrl: null
    }));
    const requests: URL[] = [];
    await page.route('**/api/folders?*', async route => {
      const url = new URL(route.request().url());
      requests.push(url);
      const query = url.searchParams.get('q')?.toLowerCase() ?? '';
      const matches = folders.filter(item => item.name.toLowerCase().includes(query));
      const pageNumber = Number(url.searchParams.get('page'));
      const limit = Number(url.searchParams.get('limit'));
      await route.fulfill({ json: { items: matches.slice((pageNumber - 1) * limit, pageNumber * limit),
        page: pageNumber, limit, total: matches.length, hasMore: pageNumber * limit < matches.length } });
    });
    await page.goto('/');
    await expect.poll(() => requests.some(url => url.searchParams.get('limit') === '24')).toBe(true);
    const mountStartedAt = Date.now();
    await page.goto('/library');
    await expect(page.locator('main a[href="/f/album-49"]')).toBeAttached();
    console.info('[folder-directory-browser]', JSON.stringify({ total: folderCount,
      renderedRows: await page.locator('main a[href^="/f/album-"]').count(),
      navigationAndMountMs: Date.now() - mountStartedAt }));
    await page.locator('main a[href="/f/album-49"]').scrollIntoViewIfNeeded();
    await expect(page.locator('main a[href="/f/album-99"]')).toBeAttached();
    await page.locator('#library-search').fill('Album 090');
    await expect(page.locator('main a[href="/f/album-90"]')).toBeVisible();
    await expect(page.locator('main a[href="/f/album-0"]')).toHaveCount(0);
    await page.goto('/explore?q=Album%20090&tab=folders');
    await expect(page.getByRole('button', { name: /Album 090/ })).toBeVisible();
    expect(requests.every(url => Number(url.searchParams.get('limit')) <= 50)).toBe(true);
  });
}
