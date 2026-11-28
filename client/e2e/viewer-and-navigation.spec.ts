import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
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

async function openDisplayPreferences(page: Page) {
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch appearance', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Display preferences', exact: true }).click();
  return page.getByRole('dialog', { name: 'Display preferences', exact: true });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1280, 390]) {
    test(`display preferences apply immediately for visitors at ${width}px in ${theme} mode`, async ({ page }) => {
      await mockGallery(page, theme);
      await page.setViewportSize({ width, height: 720 });
      await page.route('**/api/appearance', route => route.fulfill({ json: { theme, accent: 'blue' } }));
      const writes: string[] = [];
      page.on('request', request => {
        if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
      });
      await page.goto('/');
      if (width === 1280) {
        await expect(page.locator('.home-layout > aside')).toBeVisible();
        expect((await page.locator('main article').first().boundingBox())!.width).toBeCloseTo(470);
      }
      let dialog = await openDisplayPreferences(page);
      const dialogBox = (await dialog.boundingBox())!;
      expect(dialogBox.x + dialogBox.width / 2).toBeCloseTo(width / 2, 0);
      expect(dialogBox.y + dialogBox.height / 2).toBeCloseTo(360, 0);
      const toggle = dialog.getByRole('switch', { name: 'Show suggested folders on desktop' });
      await expect(toggle).toHaveAttribute('aria-checked', 'true');
      await expect(dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true })).toHaveAttribute('aria-checked', 'false');
      await expect(dialog.getByRole('combobox', { name: 'Appearance', exact: true })).toBeFocused();
      await toggle.press('Space');
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(dialog.getByRole('status')).toHaveText('Saved in this browser.');
      expect(await page.evaluate(() => localStorage.getItem('foldergram-show-suggested-folders-on-desktop'))).toBe('false');
      await expect(page).toHaveURL('/');
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused();
      await expect(page.locator('.home-layout > aside')).toHaveCount(0);

      await page.reload();
      await page.setViewportSize({ width: 1280, height: 720 });
      await expect(page.locator('.home-layout')).toHaveClass(/home-layout--wide-feed/);
      expect((await page.locator('main article').first().boundingBox())!.width).toBeCloseTo(600);
      dialog = await openDisplayPreferences(page);
      await expect(dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true })).toHaveAttribute('aria-checked', 'false');
      await dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true }).click();
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.locator('.home-layout > aside')).toBeVisible();
      expect((await page.locator('main article').first().boundingBox())!.width).toBeCloseTo(470);
      expect(writes).toEqual([]);
    });
  }
}

for (const preference of [
  { key: 'foldergram-show-suggested-folders-on-desktop', label: 'Show suggested folders on desktop', initial: true },
  { key: 'foldergram-fit-tall-media-to-screen', label: 'Fit tall media to screen', initial: false },
  { key: 'foldergram-justified-album-grid', label: 'Justified album grid', initial: false }
]) {
  test(`display preferences explain blocked storage and recover for ${preference.label}`, async ({ page }) => {
    await mockGallery(page);
    await page.addInitScript(keyToBlock => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === keyToBlock && document.documentElement.dataset.allowDisplaySave !== 'true') {
          throw new DOMException('Storage blocked', 'SecurityError');
        }
        original.call(this, key, value);
      };
    }, preference.key);
    await page.goto('/');
    let dialog = await openDisplayPreferences(page);
    await dialog.getByRole('switch', { name: preference.label, exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Some preferences could not be saved in this browser. Unsaved changes apply only for this session.');
    await expect(dialog.getByRole('switch', { name: preference.label, exact: true })).toHaveAttribute('aria-checked', String(!preference.initial));
    expect(await page.evaluate(key => localStorage.getItem(key), preference.key)).toBeNull();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    dialog = await openDisplayPreferences(page);
    await expect(dialog.getByRole('alert')).toBeVisible();
    await page.evaluate(() => { document.documentElement.dataset.allowDisplaySave = 'true'; });
    await dialog.getByRole('switch', { name: preference.label, exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await expect(dialog.getByRole('status')).toHaveText('Saved in this browser.');
  });
}

for (const width of [390, 1280]) {
  test(`optional justified album grid preserves aspect ratios at ${width}px`, async ({ page }) => {
    await mockGallery(page, 'light');
    await page.setViewportSize({ width, height: 720 });
    const dimensions = [[6000, 1000], [1500, 1000], [1000, 1500], [1000, 1000], [1600, 900], [800, 1000]];
    const palette = [['#a8ccd4', '#527d93'], ['#f2cda1', '#b55b42'], ['#d8d9b5', '#56765e'], ['#bfcbe3', '#52618e'], ['#f3c8b9', '#9c6471'], ['#b8d9cf', '#42837b']];
    const images = dimensions.map(([w, h], index) => ({
      ...panorama, id: index + 1, filename: `fixture-${index + 1}.jpg`, width: w, height: h,
      thumbnailUrl: `/thumbnails/fixture-${index + 1}.svg`, previewUrl: `/previews/fixture-${index + 1}.svg`
    }));
    await page.route(/\/api\/folders\/panoramas\/images(?:\?|$)/, route => route.fulfill({
      json: { items: images, page: 1, limit: 24, total: images.length, hasMore: false, folder: { ...folder, imageCount: images.length } }
    }));
    await page.route(/\/(?:thumbnails|previews)\/fixture-\d+\.svg$/, route => {
      const index = Number(new URL(route.request().url()).pathname.match(/fixture-(\d+)/)![1]) - 1;
      const [w, h] = dimensions[index];
      const [sky, mountain] = palette[index];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 300 200" preserveAspectRatio="none"><rect width="300" height="200" fill="${sky}"/><circle cx="${50 + index * 35}" cy="50" r="22" fill="#fff2d2"/><path d="M0 155L74 73 132 139 196 56 300 155V200H0Z" fill="${mountain}"/><path d="M0 175Q70 145 150 180T300 160V200H0Z" fill="#243746" opacity=".65"/></svg>` });
    });
    await page.goto('/f/panoramas');
    const tile = page.locator('main a[href="/post/1"]').last();
    const tiles = images.map(item => page.locator(`main a[href="/post/${item.id}"]`).last());
    for (const [index, link] of tiles.entries()) {
      await link.scrollIntoViewIfNeeded();
      await expect(link.locator('img')).toHaveAttribute('data-loaded', 'true');
      await expect(link.locator('img')).toHaveAttribute('alt', images[index].filename);
    }
    await expect(tile).toBeVisible();
    await expect.poll(async () => {
      const box = (await tile.boundingBox())!;
      return box.width / box.height;
    }).toBeCloseTo(3 / 4, 1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath('album-standard.png'), fullPage: true });

    let dialog = await openDisplayPreferences(page);
    const toggle = dialog.getByRole('switch', { name: 'Justified album grid', exact: true });
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await dialog.screenshot({ path: test.info().outputPath('album-display-preferences.png') });
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    for (const [index, link] of tiles.entries()) {
      const [w, h] = dimensions[index];
      await expect.poll(async () => {
        const box = (await link.boundingBox())!;
        return box.width / box.height;
      }).toBeCloseTo(w / h, 1);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath('album-justified.png'), fullPage: true });
    await page.reload();
    await expect.poll(async () => {
      const box = (await tile.boundingBox())!;
      return box.width / box.height;
    }).toBeCloseTo(6, 1);

    dialog = await openDisplayPreferences(page);
    await dialog.getByRole('switch', { name: 'Justified album grid', exact: true }).click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect.poll(async () => {
      const box = (await tile.boundingBox())!;
      return box.width / box.height;
    }).toBeCloseTo(3 / 4, 1);
  });
}

test('browser themes explain failed writes and failed resets without changing instance settings', async ({ page }) => {
  await mockGallery(page);
  await page.route('**/api/appearance', route => route.fulfill({ json: { theme: 'dark', accent: 'blue' } }));
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    const removeItem = Storage.prototype.removeItem;
    const check = (key: string) => {
      if (key === 'foldergram-theme' && document.documentElement.dataset.allowThemeSave !== 'true') {
        throw new DOMException('Storage blocked', 'SecurityError');
      }
    };
    Storage.prototype.setItem = function (key, value) { check(key); setItem.call(this, key, value); };
    Storage.prototype.removeItem = function (key) { check(key); removeItem.call(this, key); };
  });
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  let dialog = await openDisplayPreferences(page);
  await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(dialog.getByRole('alert')).toContainText('Unsaved changes apply only for this session.');
  expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBeNull();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  dialog = await openDisplayPreferences(page);
  await expect(dialog.getByRole('combobox', { name: 'Appearance', exact: true })).toHaveValue('light');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('instance');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { document.documentElement.dataset.allowThemeSave = 'true'; });
  await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('status')).toHaveText('Saved in this browser.');
  expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBe('dark');
  await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('instance');
  expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBeNull();
  expect(writes).toEqual([]);
});

test('suggested folders is absent from General Settings and available in More for admins', async ({ page }) => {
  await mockGallery(page);
  await page.route('**/api/auth/status', route => route.fulfill({ json: adminAuthStatus }));
  await page.goto('/settings#general');
  await expect(page.getByRole('heading', { name: 'General Settings', exact: true })).toBeVisible();
  await expect(page.getByText('Show suggested folders on desktop', { exact: true })).toHaveCount(0);
  const dialog = await openDisplayPreferences(page);
  await expect(dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page).toHaveURL('/settings#general');
});

async function mockPortraitFeed(page: Page, width = 600, height = 3000) {
  const clip = Buffer.from(await readFile(new URL('./fixtures/tall-feed-video.mp4.base64', import.meta.url), 'utf8'), 'base64');
  await page.route('**/previews/tall-feed-video.mp4', route => {
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? '');
    const start = Number(range?.[1] ?? 0);
    const end = Math.min(Number(range?.[2] || clip.length - 1), clip.length - 1);
    // The fragmented MP4 needs a seekable response for actual playback, beyond metadata loading.
    return route.fulfill({
      status: range ? 206 : 200,
      contentType: 'video/mp4',
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${clip.length}` } : {})
      },
      body: clip.subarray(start, end + 1)
    });
  });
  await page.route('**/thumbnails/portrait.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#527d93"/></svg>`
  }));
  const photo = { ...panorama, id: 1, width, height, thumbnailUrl: '/thumbnails/portrait.svg', previewUrl: '/thumbnails/portrait.svg' };
  const video = { ...photo, id: 2, filename: 'tall.mp4', mediaType: 'video', width: 32, height: 160, durationMs: 3000, previewUrl: '/previews/tall-feed-video.mp4' };
  const carousel = { ...photo, id: 3, postType: 'carousel', itemCount: 3, mediaItems: [1, 2, 3].map(imageId => ({ ...photo, imageId, position: imageId - 1 })) };
  await page.route('**/api/feed?*', route => route.fulfill({ json: { items: [photo, video, carousel], page: 1, limit: 24, total: 3, hasMore: false } }));
}

test('Home feed remains viewport-centered on portrait desktops', async ({ page }) => {
  await mockGallery(page);

  for (const suggestedFolders of [true, false]) {
    await page.addInitScript(enabled => {
      localStorage.setItem('foldergram-show-suggested-folders-on-desktop', String(enabled));
    }, suggestedFolders);

    for (const width of [900, 960, 1040]) {
      await page.setViewportSize({ width, height: 1500 });
      await page.goto('/');
      await expect(page.locator('.home-layout--compact')).toBeVisible();
      await expect(page.locator('main article').first()).toBeVisible();

      const feed = (await page.locator('main article').first().boundingBox())!;
      expect(
        Math.abs(feed.x + feed.width / 2 - width / 2),
        `Feed should stay centered at ${width}px with suggested folders ${suggestedFolders ? 'on' : 'off'}`
      ).toBeLessThanOrEqual(3);
    }
  }
});

for (const viewport of [
  { width: 900, height: 1200 },
  { width: 1080, height: 1778 },
  { width: 1440, height: 786 }
]) {
  test(`Home Play and time stay at the video bottom-left at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await mockGallery(page);
    await mockPortraitFeed(page);
    await page.setViewportSize(viewport);
    await page.goto('/');
    const video = page.locator('.feed-card__video-shell');
    await video.scrollIntoViewIfNeeded();
    await expect(video.locator('media-player')).toHaveAttribute('data-playing', '');
    const videoBox = (await video.boundingBox())!;
    await page.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2);
    const playBox = (await video.locator('media-play-button').boundingBox())!;
    const timeBox = (await video.locator('.video-progress-footer__time').boundingBox())!;
    expect(playBox.x - videoBox.x, 'Play should hug the left video edge').toBeLessThan(40);
    expect(timeBox.x - videoBox.x, 'Time should follow Play at the left video edge').toBeLessThan(95);
    expect(timeBox.x - (playBox.x + playBox.width)).toBeLessThan(20);
  });
}

test('Home video controls clear the expanded sidebar at tablet widths', async ({ page }) => {
  await mockGallery(page);
  await page.addInitScript(() => {
    localStorage.setItem('foldergram-show-suggested-folders-on-desktop', 'false');
    localStorage.setItem('foldergram-fit-tall-media-to-screen', 'true');
  });
  await page.setViewportSize({ width: 900, height: 1200 });
  await mockPortraitFeed(page);
  await page.goto('/');

  const sidebar = page.locator('aside.sidebar');
  const shell = page.locator('.feed-card__video-shell');
  await shell.scrollIntoViewIfNeeded();
  const playButton = shell.locator('media-play-button');
  const timeLabel = shell.locator('.video-progress-footer__time');
  await expect(shell.locator('media-player')).toHaveAttribute('data-playing', '');
  const videoBox = (await shell.boundingBox())!;
  await page.mouse.move(videoBox.x + videoBox.width / 2, videoBox.y + videoBox.height / 2);
  await expect(shell.locator('.video-progress-footer__slot--leading')).toHaveCSS('margin-left', '0px');
  const initialPlayBox = (await playButton.boundingBox())!;
  const initialTimeBox = (await timeLabel.boundingBox())!;
  // Collapsed navigation must never displace Play or the timestamp toward
  // the middle of the portrait video.
  expect(initialPlayBox.x - videoBox.x).toBeLessThan(40);
  expect(initialTimeBox.x - videoBox.x).toBeLessThan(95);
  await sidebar.hover();
  await expect(sidebar).toHaveCSS('width', '240px');
  const sidebarBox = (await sidebar.boundingBox())!;
  const playBox = (await playButton.boundingBox())!;
  expect(playBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width);
  await playButton.click();
  await expect(shell.locator('video')).toHaveJSProperty('paused', true);
  // Returning to the player collapses the sidebar and returns both controls
  // to their original bottom-left position.
  const restoredPlayBox = (await playButton.boundingBox())!;
  const restoredTimeBox = (await timeLabel.boundingBox())!;
  expect(restoredPlayBox.x).toBeCloseTo(initialPlayBox.x, 0);
  expect(restoredTimeBox.x).toBeCloseTo(initialTimeBox.x, 0);
});

for (const showSuggestedFolders of [true, false]) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 900, height: 1200 }]) {
    test(`Home fits portrait media at ${viewport.width}×${viewport.height} with suggested folders ${showSuggestedFolders ? 'on' : 'off'}`, async ({ page }) => {
      await mockGallery(page);
      await page.addInitScript(showFolders => {
        localStorage.setItem('foldergram-show-suggested-folders-on-desktop', String(showFolders));
        localStorage.setItem('foldergram-fit-tall-media-to-screen', 'true');
      }, showSuggestedFolders);
      await page.setViewportSize(viewport);
      await mockPortraitFeed(page);
      await page.goto('/');
      const expectedWidth = showSuggestedFolders ? 470 : 600;
      const cards = page.locator('main article');
      await expect(cards).toHaveCount(3);
      expect((await cards.first().boundingBox())!.width).toBeCloseTo(expectedWidth);
      await expect(page.locator('.home-layout > aside')).toHaveCount(showSuggestedFolders && viewport.width === 1280 ? 1 : 0);
      for (const [index, card] of (await cards.all()).entries()) {
        const bounds = await card.locator(':scope > :nth-child(2)').boundingBox();
        expect(bounds!.height).toBeLessThanOrEqual(index === 1 ? 585 : viewport.height - 32 + 1);
      }
      const imageBox = (await cards.first().locator(':scope > :nth-child(2)').boundingBox())!;
      expect(imageBox.width / imageBox.height).toBeCloseTo(0.2, 2);
      const shell = page.locator('.feed-card__video-shell');
      // Fitted Reels retain 4:5 proportions and cap their height at viewport - 32px.
      const expectedVideoWidth = Math.min(expectedWidth, 468, (viewport.height - 32) * 4 / 5);
      const actualVideoWidth = (await shell.boundingBox())!.width;
      expect(Math.abs(actualVideoWidth - expectedVideoWidth)).toBeLessThan(0.6);
      await shell.scrollIntoViewIfNeeded();
      const media = shell.locator('video');
      await expect(media).toHaveCSS('object-fit', 'contain');
      expect((await media.boundingBox())!.height).toBeCloseTo((await shell.boundingBox())!.height - 2, 0);
      await expect(shell.locator('media-player')).toHaveAttribute('data-playing', '');
      await expect.poll(() => media.evaluate(video => (video as HTMLVideoElement).currentTime)).toBeGreaterThan(0.25);
      await shell.locator('media-play-button').click();
      await expect(media).toHaveJSProperty('paused', true);
      await shell.locator('media-play-button').click();
      await expect(media).toHaveJSProperty('paused', false);
      const stage = cards.nth(2).getByRole('group');
      expect((await stage.boundingBox())!.width).toBeCloseTo(expectedWidth);
      expect((await stage.locator('img').boundingBox())!.height).toBeLessThanOrEqual(viewport.height - 32 + 1);
      await stage.getByRole('button', { name: 'Next carousel item', exact: true }).click();
      await stage.getByRole('button', { name: 'Previous carousel item', exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });
  }
}

test('hiding suggested folders grows portraits and fitting remains an independent opt-in', async ({ page }) => {
  await mockGallery(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockPortraitFeed(page, 640, 800);
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/') && request.method() !== 'GET') writes.push(request.url());
  });
  await page.goto('/');
  const cards = page.locator('main article');
  await expect(cards).toHaveCount(3);
  async function expectFrame(index: number, width: number, height: number) {
    const bounds = (await cards.nth(index).locator(':scope > :nth-child(2)').boundingBox())!;
    expect(bounds.width).toBeCloseTo(width, 0);
    expect(bounds.height).toBeCloseTo(height, 0);
  }
  await expectFrame(0, 470, 587.5);
  await expectFrame(1, 468, 585);
  await expectFrame(2, 470, 587.5);
  let dialog = await openDisplayPreferences(page);
  await expect(dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true })).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true }).click();
  await expect(dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true })).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expectFrame(0, 600, 750);
  await expectFrame(1, 468, 585);
  await expectFrame(2, 600, 750);
  await page.setViewportSize({ width: 1280, height: 600 });
  await expectFrame(0, 600, 750);
  await page.setViewportSize({ width: 1280, height: 720 });

  dialog = await openDisplayPreferences(page);
  await dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true }).click();
  await expect(dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true })).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expectFrame(0, 550.4, 688);
  await expectFrame(1, 468, 585);
  await expectFrame(2, 600, 688);
  await page.reload();
  await expect(cards).toHaveCount(3);
  await expectFrame(0, 550.4, 688);
  expect(await page.evaluate(() => localStorage.getItem('foldergram-fit-tall-media-to-screen'))).toBe('true');

  dialog = await openDisplayPreferences(page);
  await dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true }).click();
  await expect(dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expectFrame(0, 470, 587.5);
  await expectFrame(1, 468, 585);
  await expectFrame(2, 470, 587.5);

  dialog = await openDisplayPreferences(page);
  await dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true }).click();
  await expect(dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(cards).toHaveCount(3);
  await expectFrame(0, 470, 587.5);
  await expectFrame(1, 468, 585);
  await expectFrame(2, 470, 587.5);
  expect(await page.evaluate(() => localStorage.getItem('foldergram-fit-tall-media-to-screen'))).toBe('false');
  expect(writes).toEqual([]);
});

for (const height of [640, 720]) {
  test(`fitting preserves media already fitting a 720px viewport at ${height}px tall`, async ({ page }) => {
    await mockGallery(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await mockPortraitFeed(page, 470, height);
    await page.goto('/');
    const cards = page.locator('main article');
    await expect(cards).toHaveCount(3);
    const before = (await cards.first().locator(':scope > :nth-child(2)').boundingBox())!;
    expect(before.width).toBeCloseTo(470);
    expect(before.height).toBeCloseTo(height);
    const dialog = await openDisplayPreferences(page);
    await dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true }).click();
    await expect(dialog.getByRole('switch', { name: 'Show suggested folders on desktop', exact: true })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    for (const index of [0, 2]) {
      const frame = (await cards.nth(index).locator(':scope > :nth-child(2)').boundingBox())!;
      expect(frame.width).toBeCloseTo(before.width);
      expect(frame.height).toBeCloseTo(before.height);
    }
    // Reels keep their 585px preview when the viewport has sufficient height.
    expect((await page.locator('.feed-card__video-shell').boundingBox())!.height).toBeCloseTo(585, 0);
  });
}

for (const scenario of [
  { fontSize: 20, showSuggestedFolders: true, width: 470, height: 640 },
  { fontSize: 14, showSuggestedFolders: false, width: 600, height: 750 }
]) {
  test(`media fitting uses the rendered feed width at a ${scenario.fontSize}px root font`, async ({ page }) => {
    await mockGallery(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript(showFolders => {
      localStorage.setItem('foldergram-show-suggested-folders-on-desktop', String(showFolders));
    }, scenario.showSuggestedFolders);
    await mockPortraitFeed(page, scenario.width, scenario.height);
    await page.goto('/');
    await page.evaluate(fontSize => { document.documentElement.style.fontSize = `${fontSize}px`; }, scenario.fontSize);
    const cards = page.locator('main article');
    await expect(cards).toHaveCount(3);
    const frames = [0, 1, 2].map(index => cards.nth(index).locator(':scope > :nth-child(2)'));
    const feedWidth = scenario.width * scenario.fontSize / 16;
    const naturalHeight = feedWidth * scenario.height / scenario.width;
    await expect.poll(async () => (await frames[0].boundingBox())!.height).toBeCloseTo(naturalHeight);
    const before = await Promise.all(frames.map(frame => frame.boundingBox()));
    const dialog = await openDisplayPreferences(page);
    await dialog.getByRole('switch', { name: 'Fit tall media to screen', exact: true }).click();
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    async function expectFittedFrames(fontSize: number) {
      const width = scenario.width * fontSize / 16;
      const height = width * scenario.height / scenario.width;
      const fittedHeight = height <= 720 ? height : 688;
      await expect.poll(async () => (await frames[0].boundingBox())!.height).toBeCloseTo(fittedHeight, 1);
      await expect.poll(async () => (await frames[0].boundingBox())!.width).toBeCloseTo(fittedHeight * scenario.width / scenario.height, 1);
      await expect.poll(async () => (await frames[1].boundingBox())!.height).toBeCloseTo(Math.min(width, 468) * 5 / 4, 0);
      await expect.poll(async () => (await frames[1].boundingBox())!.width).toBeCloseTo(Math.min(width, 468), 0);
      await expect.poll(async () => (await frames[2].boundingBox())!.height).toBeCloseTo(fittedHeight);
      await expect.poll(async () => (await frames[2].boundingBox())!.width).toBeCloseTo(width);
    }

    await expectFittedFrames(scenario.fontSize);
    if (naturalHeight <= 720) {
      for (const index of [0, 2]) {
        const after = (await frames[index].boundingBox())!;
        expect(after.width).toBeCloseTo(before[index]!.width);
        expect(after.height).toBeCloseTo(before[index]!.height);
      }
    }
    // Root font changes resize the feed without emitting a window resize event.
    const otherFontSize = scenario.fontSize === 20 ? 14 : 20;
    await page.evaluate(fontSize => { document.documentElement.style.fontSize = `${fontSize}px`; }, otherFontSize);
    await expectFittedFrames(otherFontSize);
    await page.evaluate(fontSize => { document.documentElement.style.fontSize = `${fontSize}px`; }, scenario.fontSize);
    await expectFittedFrames(scenario.fontSize);
  });
}

test('desktop media fitting leaves mobile feed sizing unchanged', async ({ page }) => {
  await mockGallery(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('foldergram-show-suggested-folders-on-desktop', 'false');
    localStorage.setItem('foldergram-fit-tall-media-to-screen', 'true');
  });
  await mockPortraitFeed(page);
  await page.goto('/');
  const photo = page.locator('main article').first();
  await expect(photo).toBeVisible();
  const frame = (await photo.locator(':scope > :nth-child(2)').boundingBox())!;
  expect(frame.width).toBeCloseTo(310);
  expect(frame.height).toBeCloseTo(1550);
});

for (const width of [1280, 390]) {
  test(`browser appearance works while the instance request is pending at ${width}px`, async ({ page }) => {
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
    const root = page.locator('html');
    try {
      await page.goto('/explore?q=Panoramas', { waitUntil: 'domcontentloaded' });
      await expect(page.locator('#fg-splash')).toHaveCount(0);
      let dialog = await openDisplayPreferences(page);
      let themeSelect = dialog.getByRole('combobox', { name: 'Appearance', exact: true });
      await expect(themeSelect).toHaveValue('instance');
      await themeSelect.selectOption('dark');
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await themeSelect.selectOption('light');
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(dialog.getByRole('status')).toHaveText('Saved in this browser.');
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();

      sendAppearance();
      const selectedTab = page.getByRole('tab', { selected: true });
      await expect(selectedTab).toHaveCSS('background-color', 'rgb(180, 83, 9)');
      await expectReadableControl(selectedTab);
      await page.reload();
      await expect(root).toHaveAttribute('data-theme', 'light');
      dialog = await openDisplayPreferences(page);
      themeSelect = dialog.getByRole('combobox', { name: 'Appearance', exact: true });
      await expect(themeSelect).toHaveValue('light');
      await themeSelect.selectOption('dark');
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(selectedTab).toHaveCSS('background-color', 'rgb(251, 191, 36)');
      await expectReadableControl(selectedTab);
      await page.mouse.move(width - 1, 0);
      await selectedTab.hover({ timeout: 5000 });
      await expectReadableControl(selectedTab);

      dialog = await openDisplayPreferences(page);
      themeSelect = dialog.getByRole('combobox', { name: 'Appearance', exact: true });
      await themeSelect.selectOption('system');
      await expect(root).toHaveAttribute('data-theme', 'light');
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(root).toHaveAttribute('data-theme', 'dark');
      await themeSelect.selectOption('instance');
      expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBeNull();
      await page.emulateMedia({ colorScheme: 'light' });
      await expect(root).toHaveAttribute('data-theme', 'dark');
      expect(writes).toEqual([]);
    } finally {
      sendAppearance();
    }
  });

  test(`admin browser appearance stays personal while Settings saves instance defaults at ${width}px`, async ({ page }) => {
    await mockGallery(page);
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
      accent = payload.accent;
      await route.fulfill({ json: { theme, accent } });
    });
    const root = page.locator('html');
    const instanceTheme = page.getByRole('combobox', { name: 'Default appearance', exact: true });
    const save = instanceTheme.locator('xpath=ancestor::form').locator('button[type="submit"]');
    try {
      await page.goto('/settings#general');
      await expect(instanceTheme).toHaveValue('dark');
      await expect(root).toHaveAttribute('data-theme', 'dark');
      let dialog = await openDisplayPreferences(page);
      await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(dialog.getByRole('status')).toHaveText('Saved in this browser.');
      await dialog.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(instanceTheme).toHaveValue('dark');
      expect(theme).toBe('dark');
      expect(writes).toEqual([]);

      await expect(instanceTheme.locator('option[value="system"]')).toHaveText('System');
      await instanceTheme.selectOption('system');
      await page.getByRole('radio', { name: 'Green', exact: true }).check();
      await save.click();
      await expect(save).toBeDisabled();
      await expect(save).toHaveText('Saving…');
      await expect(root).toHaveAttribute('data-theme', 'light');
      releaseFailedSave();
      const form = instanceTheme.locator('xpath=ancestor::form');
      await expect(form.getByRole('alert')).toContainText('Could not save appearance');
      await expect(save).toBeEnabled();
      expect(theme).toBe('dark');
      await save.click();
      await expect(form.getByRole('status')).toHaveText('Appearance saved.');
      expect(theme).toBe('system');
      expect(accent).toBe('green');
      await expect(root).toHaveAttribute('data-theme', 'light');
      await expect(root).toHaveCSS('--accent', '#15803d');
      expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBe('light');
      await page.reload();
      await expect(instanceTheme).toHaveValue('system');
      await expect(page.getByRole('radio', { name: 'Green', exact: true })).toBeChecked();
      await expect(root).toHaveAttribute('data-theme', 'light');

      dialog = await openDisplayPreferences(page);
      const browserTheme = dialog.getByRole('combobox', { name: 'Appearance', exact: true });
      await expect(browserTheme).toHaveValue('light');
      await browserTheme.selectOption('instance');
      expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBeNull();
      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(root).toHaveAttribute('data-theme', 'dark');
      expect(writes).toEqual([
        { method: 'PUT', payload: { theme: 'system', accent: 'green' } },
        { method: 'PUT', payload: { theme: 'system', accent: 'green' } }
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
  await page.route('**/api/auth/status', route => route.fulfill({ json: { ...adminAuthStatus, enabled: false, publicDemoMode: true } }));
  let appearanceAvailable = false;
  await page.route('**/api/appearance', route => appearanceAvailable
    ? route.fulfill({ json: { theme: 'system', accent: 'orange' } })
    : route.fulfill({ status: 404, json: { message: 'Appearance unavailable' } }));
  const writes: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/admin/') && request.method() !== 'GET') writes.push(request.method());
  });
  const root = page.locator('html');
  const instanceTheme = page.getByRole('combobox', { name: 'Default appearance', exact: true });
  await page.goto('/settings#general');
  await expect(page.getByText(/Appearance settings are read-only in the public demo/)).toBeVisible();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  let dialog = await openDisplayPreferences(page);
  await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await expect(root).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('foldergram-theme'))).toBe('light');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();

  appearanceAvailable = true;
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'light');
  await expect(root).toHaveCSS('--accent', '#b45309');
  await expect(instanceTheme).toHaveValue('system');
  await expect(instanceTheme).toBeDisabled();
  await expect(page.getByRole('radio', { name: 'Orange' })).toBeChecked();
  await expect(page.getByRole('radio', { name: 'Orange' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save appearance', exact: true })).toBeDisabled();
  await instanceTheme.locator('xpath=ancestor::form').dispatchEvent('submit');
  dialog = await openDisplayPreferences(page);
  await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await expect(root).toHaveCSS('--accent', '#fbbf24');
  expect(writes).toEqual([]);
});

test('browser appearance survives reloads and entering or leaving admin mode', async ({ page }) => {
  await mockGallery(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  const viewer = { ...adminAuthStatus, role: 'viewer', capabilities: { ...adminAuthStatus.capabilities, canAccessSettings: false } };
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
  const dialog = await openDisplayPreferences(page);
  await dialog.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('dark');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(root).toHaveAttribute('data-theme', 'dark');

  await more.click();
  await page.getByRole('button', { name: 'Unlock admin', exact: true }).click();
  await page.locator('input[autocomplete="current-password"]').fill('fixture-admin-password');
  await page.locator('form button[type="submit"]').click();
  await expect(root).toHaveAttribute('data-theme', 'dark');
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

test('Home starts playback only for the selected visible streaming video', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1050 });
  await mockGallery(page, 'light');
  const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
  const items = [31, 32].map(id => ({
    ...panorama, id, mediaType: 'video', filename: 'stream-' + id + '.mp4',
    width: 640, height: 180, durationMs: 1000, videoPlaybackUrl: '/api/videos/' + id + '/playback'
  }));
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: 2, hasMore: false }
  }));

  await page.route(/\/api\/videos\/(31|32)\/playback$/, route =>
    route.fulfill({ json: {
      duration: 1, width: 640, height: 180, bitrate: 200_000,
      original: { url: '/mock-active-stream.mp4', type: 'video/mp4' }
    } }));
  await page.route('**/mock-active-stream.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  await page.goto('/');
  const videos = page.locator('.feed-card__player video');
  await expect(videos).toHaveCount(2);
  // The neighboring card's cover loads independently of playback ownership.
  await expect.poll(() => page.locator('.feed-card__player .local-video-feedback__cover').last()
    .evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  await expect(videos.first()).toBeInViewport({ ratio: 0.4 });
  // Fixed-height previews may put the second video below the autoplay threshold.
  await expect.poll(() => videos.evaluateAll(elements => elements.filter(element =>
    !(element as HTMLVideoElement).paused && (element as HTMLVideoElement).currentTime > 0.3).length)).toBe(1);
  const maximumPlaying = await videos.evaluateAll(async elements => {
    const until = performance.now() + 750;
    let maximum = 0;
    while (performance.now() < until) {
      maximum = Math.max(maximum, elements.filter(element => !(element as HTMLVideoElement).paused).length);
      await new Promise(requestAnimationFrame);
    }
    return maximum;
  });
  expect(maximumPlaying).toBe(1);
  await page.screenshot({ path: test.info().outputPath('streaming-home-desktop.png') });
  await videos.last().scrollIntoViewIfNeeded();
  await expect.poll(() => videos.last().evaluate(video => !(video as HTMLVideoElement).paused)).toBe(true);
  await expect(videos.first()).toHaveJSProperty('paused', true);
  await page.setViewportSize({ width: 390, height: 450 });
  await videos.last().evaluate(media => media.scrollIntoView({ block: 'center' }));
  await expect(videos.last()).toHaveJSProperty('paused', false);
  await expect(videos.first()).toHaveJSProperty('paused', true);
  await page.screenshot({ path: test.info().outputPath('streaming-home-mobile.png') });
});

for (const viewport of [{ width: 1280, height: 950 }, { width: 390, height: 680 }]) {
  test(`streaming failure shows the cover and a working Retry at ${viewport.width}px`, async ({ page }) => {
    try {
      await promisify(execFile)('ffmpeg', ['-version']);
    } catch {
      test.skip(true, 'FFmpeg is required for the generated HLS fixture.');
    }
    const temp = await mkdtemp(join(tmpdir(), 'foldergram-playwright-retry-'));
    try {
      await promisify(execFile)('ffmpeg', [
        '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=10:d=3',
        '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-hls_time', '3',
        '-hls_playlist_type', 'vod', '-hls_segment_filename', join(temp, 'segment-%03d.ts'),
        join(temp, 'stream.m3u8')
      ]);
      const manifest = await readFile(join(temp, 'stream.m3u8'));
      const segment = await readFile(join(temp, 'segment-000.ts'));
      await page.setViewportSize(viewport);
      await mockGallery(page, 'light');

      const endpoint = '/api/videos/37/playback';
      const thumbnailUrl = '/test-streaming-cover.svg';
      const item = { ...panorama, id: 37, filename: 'retry.mkv', mediaType: 'video', width: 640, height: 280,
        durationMs: 3000, videoPlaybackUrl: endpoint, thumbnailUrl };
      await page.route('**/api/feed?*', route => route.fulfill({
        json: { items: [item], page: 1, limit: 24, total: 1, hasMore: false }
      }));
      await page.route('**' + thumbnailUrl, route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="280"><rect width="640" height="280" fill="#40658a"/></svg>'
      }));

      const first = Promise.withResolvers<void>();
      const profiles: string[] = [];
      await page.route('**' + endpoint, route => route.fulfill({
        json: { original: null, width: 96, height: 64, duration: 3, bitrate: 150_000 }
      }));
      const window = endpoint + '/sessions/mock';
      await page.route('**' + endpoint + '/sessions', async route => {
        profiles.push(route.request().postDataJSON().profile);
        if (profiles.length === 1) await first.promise;
        if (profiles.length <= 2) {
          await route.fulfill({ status: 422, json: { message: 'The conversion failed.' } });
          return;
        }
        await route.fulfill({ json: { offset: 0, duration: 3, window: 3, profile: 'standard',
          url: window + '/stream.m3u8', releaseUrl: window + '/release' } });
      });
      await page.route('**' + window + '/stream.m3u8', route => route.fulfill({
        contentType: 'application/vnd.apple.mpegurl', body: manifest
      }));
      await page.route('**' + window + '/segment-000.ts', route => route.fulfill({ contentType: 'video/mp2t', body: segment }));
      await page.route('**' + window + '/release', route => route.fulfill({ status: 204 }));

      await page.goto('/');
      const player = page.locator('.feed-card__player');
      await player.scrollIntoViewIfNeeded();
      const cover = player.locator('.local-video-feedback__cover');
      try {
        await expect(cover).toBeVisible();
        await expect.poll(() => cover.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640);
        await expect(player.getByRole('status', { name: 'Preparing video…' })).toBeVisible();
      } finally {
        first.resolve();
      }
      await expect(player.getByRole('alert')).toHaveText('This video could not be played.');
      await expect(cover).toBeVisible();
      await expect(player.locator('.video-progress-footer')).toBeVisible();
      const retry = player.getByRole('button', { name: 'Retry playback' });
      await expect(retry).toBeInViewport();
      const retryBox = (await retry.boundingBox())!;
      const timeBox = (await player.locator('.video-progress-footer__time').boundingBox())!;
      expect(retryBox.y + retryBox.height).toBeLessThan(timeBox.y);
      await page.screenshot({ path: test.info().outputPath('streaming-retry.png') });
      await retry.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => profiles).toEqual(['standard', 'low', 'standard']);
      await expect(player.getByRole('alert')).toHaveCount(0);
      await expect.poll(() => player.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);
      await expect(cover).toBeHidden();
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}

test('a streaming Home carousel waits for Play or fullscreen', async ({ page }) => {
  await mockGallery(page, 'light');
  const endpoint = '/api/videos/38/playback';
  const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
  const item = { ...panorama, id: 38, postType: 'carousel', mediaCount: 2, mediaItems: [
    { ...panorama, imageId: 38, position: 1, mediaType: 'video', videoPlaybackUrl: endpoint, filename: 'carousel.mp4' },
    { ...panorama, imageId: 39, position: 2 }
  ] };
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items: [item], page: 1, limit: 24, total: 1, hasMore: false }
  }));
  let metadataRequests = 0;
  await page.route('**' + endpoint, route => {
    metadataRequests++;
    return route.fulfill({ json: { duration: 1, width: 640, height: 360, bitrate: 200_000,
      original: { url: '/mock-carousel.mp4', type: 'video/mp4' } } });
  });
  await page.route('**/mock-carousel.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  await page.goto('/');
  const player = page.getByRole('region', { name: 'Video Player - carousel.mp4' });
  await player.scrollIntoViewIfNeeded();
  await expect(player.locator('video')).toBeVisible();
  // Let the ordinary 200 ms auto-start interval pass with the card in view.
  await page.waitForTimeout(300);
  expect(metadataRequests).toBe(0);

  await player.locator('media-play-button').click();
  await expect.poll(() => metadataRequests).toBe(1);
  await expect.poll(() => player.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.1);

  await page.reload();
  await player.scrollIntoViewIfNeeded();
  await expect(player.locator('video')).toBeVisible();
  await player.locator('media-fullscreen-button').click();
  await expect(player).toHaveAttribute('data-fullscreen', '');
  await expect.poll(() => metadataRequests).toBe(2);
});

test('fullscreen transfers streaming Home playback to the inactive card and releases ownership on exit', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1050 });
  await mockGallery(page, 'light');
  const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
  const items = [31, 32].map(id => ({ ...panorama, id, mediaType: 'video', filename: `stream-${id}.mp4`,
    width: 640, height: 180, durationMs: 1000, videoPlaybackUrl: `/api/videos/${id}/playback` }));
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: 2, hasMore: false }
  }));
  await page.route(/\/api\/videos\/(31|32)\/playback$/, route => route.fulfill({ json: {
    duration: 1, width: 640, height: 180, bitrate: 200_000,
    original: { url: '/mock-fullscreen-stream.mp4', type: 'video/mp4' }
  } }));
  await page.route('**/mock-fullscreen-stream.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  await page.goto('/');
  const players = page.locator('.feed-card__player');
  await expect(players).toHaveCount(2);
  await expect.poll(() => players.locator('video').evaluateAll(elements =>
    elements.filter(element => !(element as HTMLVideoElement).paused).length)).toBe(1);
  const inactiveIndex = await players.evaluateAll(elements => elements.findIndex(element =>
    (element.querySelector('video') as HTMLVideoElement).paused));
  const inactive = players.nth(inactiveIndex);
  const previous = players.nth(1 - inactiveIndex);
  await inactive.evaluate((element: HTMLElement & { enterFullscreen(target: string): Promise<void> }) => element.enterFullscreen('media'));
  await expect(inactive).toHaveAttribute('data-fullscreen', '');
  await expect(previous.locator('video')).toHaveJSProperty('paused', true);
  await expect(inactive.locator('video')).toHaveJSProperty('paused', false);
  // Exercise the restored controls after fullscreen has taken playback ownership.
  await inactive.locator('media-play-button').click();
  await expect(inactive.locator('video')).toHaveJSProperty('paused', true);
  await inactive.locator('media-play-button').click();
  await expect(inactive.locator('video')).toHaveJSProperty('paused', false);
  await expect.poll(() => inactive.locator('video').evaluate((media: HTMLVideoElement) => media.currentTime)).toBeGreaterThan(0.2);
  await inactive.locator('media-mute-button').click();
  await expect(inactive.locator('video')).toHaveJSProperty('muted', false);
  await inactive.locator('media-fullscreen-button').click();
  await expect(inactive).not.toHaveAttribute('data-fullscreen', '');
  await expect.poll(() => players.locator('video').evaluateAll(elements =>
    elements.filter(element => !(element as HTMLVideoElement).paused).length)).toBe(1);
  await page.setViewportSize({ width: 390, height: 450 });
  await players.first().evaluate(element => element.scrollIntoView({ block: 'center' }));
  await expect(players.first().locator('video')).toHaveJSProperty('paused', false);
});

test('a streaming feed video seeks, hands off HLS windows, and respects a native pause', async ({ page }) => {
  const temp = await mkdtemp(join(tmpdir(), 'foldergram-playwright-hls-'));
  try {
    try {
      await promisify(execFile)('ffmpeg', ['-version']);
    } catch {
      test.skip(true, 'FFmpeg is required for the generated HLS fixture.');
    }
    await promisify(execFile)('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=10:d=24',
      '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p',
      '-force_key_frames', 'expr:gte(t,n_forced*3)', '-hls_time', '3', '-hls_playlist_type', 'vod',
      '-hls_flags', 'independent_segments', '-hls_segment_filename', join(temp, 'segment-%d.ts'),
      join(temp, 'stream.m3u8')
    ]);
    const manifest = await readFile(join(temp, 'stream.m3u8'));
    const segments = await Promise.all(Array.from({ length: 8 }, (_, index) => readFile(join(temp, 'segment-' + index + '.ts'))));
    await mockGallery(page, 'light');
    const playback = '/api/videos/9/playback';
    const item = { ...panorama, id: 9, mediaType: 'video', filename: 'stream.mp4', width: 96, height: 64,
      durationMs: 90_000, videoPlaybackUrl: playback };
    await page.route('**/api/feed?*', route => route.fulfill({
      json: { items: [item], page: 1, limit: 24, total: 1, hasMore: false }
    }));

    const starts: number[] = [];
    const prefetchPositions: number[] = [];
    const handoffManifest = Promise.withResolvers<void>();
    let handoffWaiting = false;
    let originalRequests = 0;
    let releases = 0;
    await page.route(/\/api\/videos\/9\/playback(?:\/|$)/, async route => {
      const url = new URL(route.request().url()).pathname;
      if (url === playback) {
        await route.fulfill({ json: { duration: 90, bitrate: 200_000, width: 96, height: 64,
          original: { type: 'video/mp4; codecs="avc1.64001e"', url: playback + '/original' } } });
      } else if (url.endsWith('/original')) {
        originalRequests++;
        await route.fulfill({ status: 415, contentType: 'text/plain', body: 'Unsupported' });
      } else if (url.endsWith('/sessions')) {
        const { at } = route.request().postDataJSON();
        if (at === 59) {
          prefetchPositions.push(await page.locator('.feed-card__player video').evaluate((media: HTMLVideoElement) => media.currentTime));
        }
        starts.push(at);
        const prefix = playback + '/sessions/window-' + starts.length;
        await route.fulfill({ json: {
          url: prefix + '/stream.m3u8', releaseUrl: prefix + '/release',
          offset: Math.floor(at), duration: 90, window: 24, profile: 'standard'
        } });
      } else if (url.endsWith('/stream.m3u8')) {
        if (url.endsWith('/window-3/stream.m3u8')) {
          handoffWaiting = true;
          await handoffManifest.promise;
        }
        await route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: manifest });
      } else if (url.endsWith('/release')) {
        releases++;
        await route.fulfill({ status: 204 });
      } else {
        const segment = Number(/segment-(\d+)\.ts$/.exec(url)?.[1]);
        await route.fulfill({ contentType: 'video/mp2t', body: segments[segment] });
      }
    });

    await page.goto('/');
    const player = page.locator('.feed-card__player').first();
    const video = player.locator('video');
    await expect.poll(() => originalRequests).toBeGreaterThan(0);
    await expect.poll(() => starts[0]).toBe(0);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(0.1);
    const slider = player.getByRole('slider', { name: 'Seek video' });
    await expect(player.locator('.video-progress-footer__time')).toHaveText(/^0:\d{2} \/ 1:30$/);
    await expect(slider).toHaveAttribute('aria-valuemax', '100');
    await expect(player.locator('media-play-button span').first())
      .toHaveCSS('mask-image', /data:image\/svg\+xml/);
    await player.evaluate((element: HTMLElement & { currentTime: number }) => {
      element.currentTime = 35;
    });
    await expect.poll(() => starts.at(-1)).toBe(35);
    await expect.poll(() => releases).toBeGreaterThan(0);
    await expect.poll(() => player.evaluate((element: HTMLElement & { currentTime: number }) => element.currentTime)).toBeGreaterThan(35);
    await video.evaluate((media: HTMLVideoElement & { handoffFrames?: Array<{ at: number; time: number }> }) => {
      const frames: Array<{ at: number; time: number }> = [];
      media.handoffFrames = frames;
      const observe = (at: number, frame: VideoFrameCallbackMetadata) => {
        frames.push({ at, time: frame.mediaTime });
        media.requestVideoFrameCallback(observe);
      };
      media.requestVideoFrameCallback(observe);
      media.playbackRate = 5;
    });
    await expect.poll(() => prefetchPositions[0], { timeout: 8000 }).toBeGreaterThan(17);
    expect(prefetchPositions[0]).toBeLessThan(23.8);
    try {
      await expect.poll(() => handoffWaiting).toBe(true);
      await expect(player.locator('.local-video-feedback__cover')).toBeVisible();
    } finally {
      handoffManifest.resolve();
    }
    await expect.poll(() => player.evaluate((element: HTMLElement & { currentTime: number }) => element.currentTime)).toBeGreaterThan(59.15);
    await expect(player.locator('.local-video-feedback__cover')).toBeHidden();
    expect(starts.filter(at => at === 59)).toHaveLength(1);
    const frames = await video.evaluate((media: HTMLVideoElement & { handoffFrames?: Array<{ at: number; time: number }> }) =>
      media.handoffFrames!);
    const handoff = frames.findIndex((frame, index) => index > 0 && frame.time < frames[index - 1].time - 10);
    expect(handoff).toBeGreaterThan(0);
    const handoffGapMs = frames[handoff].at - frames[handoff - 1].at;
    expect(handoffGapMs).toBeLessThan(1500);
    await test.info().attach('decoded-window-handoff', {
      body: JSON.stringify({ handoffGapMs, framesBefore: frames[handoff - 1], framesAfter: frames.slice(handoff) }),
      contentType: 'application/json'
    });

    await video.evaluate((media: HTMLVideoElement) => media.pause());
    await expect(video).toHaveJSProperty('paused', true);
    const startsOnPause = starts.slice();
    const pausedAt = await video.evaluate((media: HTMLVideoElement) => media.currentTime);
    await page.waitForTimeout(11_500);
    expect(starts).toEqual(startsOnPause);
    await expect(video).toHaveJSProperty('paused', true);
    expect(await video.evaluate((media: HTMLVideoElement) => media.currentTime)).toBeCloseTo(pausedAt, 1);
    await video.evaluate((media: HTMLVideoElement) => media.play());
    await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.currentTime)).toBeGreaterThan(pausedAt + 0.2);
    const releasedBeforeNavigation = releases;
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect.poll(() => releases).toBeGreaterThan(releasedBeforeNavigation);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 45_000);

test('Reels uses bundled HLS for growing playlists and resumes watched windows across swipes', async ({ page }) => {
  try {
    await promisify(execFile)('ffmpeg', ['-version']);
  } catch {
    test.skip(true, 'FFmpeg is required for the generated HLS fixture.');
  }
  const temp = await mkdtemp(join(tmpdir(), 'foldergram-reels-hls-'));
  try {
    await promisify(execFile)('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=15',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=15', '-c:v', 'libx264', '-threads', '1',
      '-pix_fmt', 'yuv420p', '-force_key_frames', 'expr:gte(t,n_forced*3)', '-c:a', 'aac',
      '-hls_time', '3', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments',
      '-hls_segment_filename', join(temp, 'segment-%03d.ts'), join(temp, 'stream.m3u8')
    ]);
    const full = await readFile(join(temp, 'stream.m3u8'), 'utf8');
    // Expose enough segments for default live-edge selection to skip the opening.
    const growing = full.slice(0, full.indexOf('segment-003.ts\n') + 'segment-003.ts\n'.length);
    let complete = false;
    await page.setViewportSize({ width: 390, height: 680 });
    await mockGallery(page, 'dark');
    // Chromium can advertise "maybe" even when its native HLS path rejects
    // a growing FFmpeg playlist. Vidstack's default should still use HLS.js.
    await page.addInitScript(() => {
      const canPlayType = HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType = function(type) {
        return type === 'application/vnd.apple.mpegurl' ? 'maybe' : canPlayType.call(this, type);
      };
    });
    const items = [41, 42].map(id => ({ ...panorama, id, mediaType: 'video', filename: `reel-${id}.mkv`,
      width: 160, height: 90, durationMs: 15_000, videoPlaybackUrl: `/api/videos/${id}/playback` }));
    await page.route('**/api/reels?*', route => route.fulfill({
      json: { items, page: 1, limit: 24, total: 2, hasMore: false }
    }));
    const sessions: Array<{ id: string; at: number; profile?: string; warmup?: boolean }> = [];
    const manifestTypes: string[] = [];
    const metadataRequests: string[] = [];
    const firstOpeningSegments: string[] = [];
    const secondOpening = Promise.withResolvers<void>();
    await page.route(/\/api\/videos\/(41|42)\/playback(?:\/.*)?$/, async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const id = pathname.split('/')[3];
      if (pathname.endsWith('/playback')) {
        metadataRequests.push(id);
        await route.fulfill({ json: { original: null, duration: 15, width: 160, height: 90, bitrate: 200_000 } });
      } else if (pathname.endsWith('/sessions')) {
        const body = request.postDataJSON();
        sessions.push({ id, ...body });
        if (id === '42' && !body.warmup) await secondOpening.promise;
        await route.fulfill({ json: body.warmup ? { warmed: true } : {
          offset: 0, duration: 15, window: 15, profile: 'standard',
          url: `/api/videos/${id}/playback/sessions/mock/stream.m3u8`,
          releaseUrl: `/api/videos/${id}/playback/sessions/mock/release`
        } });
      } else if (pathname.endsWith('/release')) {
        await route.fulfill({ status: 204 });
      } else if (pathname.endsWith('.m3u8')) {
        manifestTypes.push(request.resourceType());
        await route.fulfill({ contentType: 'application/vnd.apple.mpegurl', body: complete ? full : growing });
      } else {
        const segment = pathname.split('/').at(-1)!;
        if (id === '41' && !complete) firstOpeningSegments.push(segment);
        await route.fulfill({ contentType: 'video/mp2t', body: await readFile(join(temp, segment)) });
      }
    });
    await page.goto('/reels');
    const players = page.locator('.reel-player-card__player');
    const firstVideo = players.first().locator('video');
    await expect.poll(() => firstVideo.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.3);
    await expect(players.first().locator('.local-video-feedback__cover')).toBeHidden();
    expect(firstOpeningSegments[0]).toBe('segment-000.ts');
    await expect.poll(() => sessions.some(session => session.id === '42' && session.warmup)).toBe(true);
    complete = true;
    const secondPlayer = players.nth(1);
    await secondPlayer.evaluate(element => element.closest('.reel-deck__panel')!.scrollIntoView({ block: 'start', behavior: 'instant' }));
    try {
      await expect(secondPlayer.getByRole('status')).toBeVisible();
      await expect(secondPlayer.locator('.local-video-feedback__cover')).toBeVisible();
    } finally {
      secondOpening.resolve();
    }
    for (const index of [1, 0, 1, 0]) {
      const player = players.nth(index);
      await player.evaluate(element => element.closest('.reel-deck__panel')!.scrollIntoView({ block: 'start', behavior: 'instant' }));
      await expect.poll(() => player.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.3);
      await expect(player.locator('video')).toHaveJSProperty('paused', false);
      await expect(player.locator('.local-video-feedback__cover')).toBeHidden();
      await expect(players.nth(1 - index).locator('video')).toHaveJSProperty('paused', true);
      await expect(page.getByRole('alert')).toHaveCount(0);
    }
    expect(metadataRequests.filter(id => id === '42')).toHaveLength(1);
    expect(manifestTypes.length).toBeGreaterThan(0);
    expect(manifestTypes).not.toContain('media');
    const starts = sessions.filter(session => !session.warmup);
    expect(starts.length).toBeGreaterThanOrEqual(5);
    expect(starts.every(session => session.at === 0 && session.profile === 'standard')).toBe(true);
    await page.screenshot({ path: test.info().outputPath('reels-hls-resumed.png') });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}, 40_000);

for (const surface of ['post', 'reel', 'carousel', 'story', 'share'] as const) {
  test(`streaming ${surface} keeps its existing player controls and plays decoded video`, async ({ page }) => {
    await mockGallery(page, 'light');
    await page.mouse.move(1200, 700);
    const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
    const endpoint = surface === 'share' ? '/api/share/images/1/playback' : '/api/videos/1/playback';
    const item = { ...panorama, mediaType: 'video', filename: 'stream.mp4', width: 640, height: 360,
      durationMs: 1000, videoPlaybackUrl: endpoint };
    const requests: string[] = [];
    const outsideScripts: string[] = [];
    page.on('request', request => {
      if (request.resourceType() === 'script' && !new URL(request.url()).hostname.match(/^(127\.0\.0\.1|localhost)$/)) outsideScripts.push(request.url());
    });
    await page.route(/\/api\/(?:videos|share\/images)\/\d+\/playback$/, async route => {
      requests.push(new URL(route.request().url()).pathname);
      await route.fulfill({ json: { duration: 1, width: 640, height: 360, bitrate: 200_000,
        original: { url: '/mock-surface-stream.mp4', type: 'video/mp4' } } });
    });
    await page.route('**/mock-surface-stream.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
    let player: Locator;
    if (surface === 'reel') {
      await page.route('**/api/reels?*', route => route.fulfill({ json: { items: [item], page: 1, limit: 24, total: 1, hasMore: false } }));
      await page.goto('/reels');
      player = page.locator('.reel-player-card__player').first();
      await expect(player.locator('.reel-player-card__seekbar')).toBeVisible();
      await expect(player.locator('.video-progress-footer')).toHaveCount(0);
    } else if (surface === 'share') {
      await page.route('**/api/share/posts/1', route => route.fulfill({ json: item }));
      await page.goto('/share/panoramas/posts/1');
      player = page.locator('.video-media-player media-player');
      await expect(player.locator('.video-progress-footer')).toBeVisible();
      await expect(player).toHaveAttribute('data-can-play', '');
      await player.locator('media-play-button').click();
    } else if (surface === 'story') {
      const capsule = { id: 'stream-story', title: 'Streaming story', subtitle: 'Recent clips', dateContext: '', imageCount: 2, coverImage: item };
      const rail = { railKind: 'moments', railTitle: 'Moments', railDescription: '', railSingularLabel: 'Moment' };
      await page.route('**/api/feed/moments', route => route.fulfill({ json: { ...rail, items: [capsule] } }));
      await page.route('**/api/feed/moments/stream-story?*', route => route.fulfill({ json: {
        ...rail, moment: capsule, items: [item, { ...item, id: 2, videoPlaybackUrl: '/api/videos/2/playback' }], page: 1, limit: 18, total: 2, hasMore: false
      } }));
      const openingMetadata = Promise.withResolvers<void>();
      await page.route('**' + endpoint, async route => {
        await openingMetadata.promise;
        await route.fallback();
      });
      await page.goto('/');
      await page.mouse.move(1200, 700);
      const openingRequest = page.waitForRequest('**' + endpoint);
      await page.locator('.story-rail__button').filter({ hasText: 'Streaming story' }).click();
      player = page.locator('.story-stage__video');
      await expect(player.locator('media-time-slider')).toHaveCount(0);
      await expect(page.locator('.story-stage__controls')).toBeVisible();
      try {
        await openingRequest;
        await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
      } finally {
        openingMetadata.resolve();
      }
      await expect(player).toHaveAttribute('data-can-play', '');
      await expect(player.locator('video')).toHaveJSProperty('paused', true);
      await page.getByRole('button', { name: 'Resume playback', exact: true }).click();
    } else {
      const mediaItems = [11, 12].map((imageId, position) => ({ ...item, imageId, position,
        videoPlaybackUrl: `/api/videos/${imageId}/playback` }));
      await page.route('**/api/posts/1', route => route.fulfill({ json: surface === 'carousel'
        ? { ...item, postType: 'carousel', mediaItems, mediaCount: 2 } : item }));
      await page.goto('/post/1');
      player = surface === 'carousel' ? page.locator('.video-media-player media-player') : page.locator('.viewer__player');
      await expect(player.locator('.video-progress-footer')).toBeVisible();
    }
    await page.mouse.move(1200, 700);
    const video = player.locator('video');
    await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.currentTime)).toBeGreaterThan(0.1);
    await expect(video).toHaveJSProperty('paused', false);
    if (surface === 'story') {
      await page.getByRole('button', { name: 'Pause playback', exact: true }).click();
      await expect(video).toHaveJSProperty('paused', true);
      await video.evaluate((media: HTMLVideoElement) => { media.muted = false; });
      await expect.poll(() => page.evaluate(() => localStorage.getItem('foldergram-video-muted'))).toBe('false');
      await page.getByRole('button', { name: 'Resume playback', exact: true }).click();
      await expect(video).toHaveJSProperty('paused', false);
      await expect.poll(() => requests.includes('/api/videos/2/playback')).toBe(true);
      await expect.poll(() => video.evaluate((media: HTMLVideoElement) => media.currentTime)).toBeGreaterThan(0.1);
      await expect(video).toHaveJSProperty('muted', false);
      // The final story stays on its final frame, matching the existing viewer.
      await expect(video).toHaveJSProperty('ended', true);
    } else if (surface === 'reel') {
      await page.locator('.reel-player-card__surface').click({ position: { x: 20, y: 100 } });
      await expect(video).toHaveJSProperty('paused', true);
      await page.locator('.reel-player-card__sound-button').click();
      await expect(video).toHaveJSProperty('muted', false);
      await expect(video).toHaveJSProperty('paused', false);
    } else {
      await player.locator('media-play-button').click();
      await expect(video).toHaveJSProperty('paused', true);
      await player.locator('media-play-button').click();
      await expect(video).toHaveJSProperty('paused', false);
      await player.locator('media-mute-button').click();
      await expect(video).toHaveJSProperty('muted', false);
      if (surface === 'carousel') {
        await page.getByRole('button', { name: 'Next carousel item', exact: true }).click();
        await expect.poll(() => requests.includes('/api/videos/12/playback')).toBe(true);
        await expect.poll(() => page.locator('.video-media-player video').evaluate((media: HTMLVideoElement) => media.currentTime)).toBeGreaterThan(0.1);
        expect(requests).toEqual(['/api/videos/11/playback', '/api/videos/12/playback']);
      }
    }
    expect(outsideScripts).toEqual([]);
    await page.screenshot({ path: test.info().outputPath(`streaming-${surface}.png`) });
  });
}

async function mockVideoDeliveryMode(page: Page, videoDeliveryMode: 'streaming' | 'previews') {
  await page.route('**/api/admin/stats', route => route.fulfill({
    json: {
      videoDeliveryMode,
      libraryIndex: { currentGalleryRoot: '/gallery' },
      excludedFolders: { envExcludedFolders: [], customExcludedFolders: [], effectiveExcludedFolders: [] },
      deletionRecovery: { failedCount: 0, failures: [] }
    }
  }));
}

test('saved previews mode hides cleanup controls and lets an admin switch a local source', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await mockGallery(page);
  await page.route('**/api/auth/status', route => route.fulfill({ json: adminAuthStatus }));
  await mockVideoDeliveryMode(page, 'previews');
  const sources = [{ id: 1, name: 'Primary gallery' }, { id: 14, name: 'External gallery' }];
  const requests: string[] = [];
  await page.route('**/api/admin/video-previews/reclamation', route => {
    requests.push('cleanup ' + route.request().method());
    return route.fulfill({ json: { sources, job: null } });
  });

  const job = {
    id: 'preview-job', state: 'ready', sources: [sources[1]], confirmed: false, cancelRequested: false,
    assessment: { checked: 3, videos: 3, files: 2, bytes: 0, skipped: 0, reasons: {} },
    result: { switched: 0, files: 0, bytes: 0, skipped: 0, deferred: 0, failed: 0, reasons: {} }
  };
  let streamingCount = 3;
  let savedJob: object | null = null;
  await page.route('**/api/admin/video-previews/generation**', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ json: { sources, job: savedJob, streamingCount } });
    } else if (request.url().endsWith('/confirm')) {
      requests.push('generation confirmed');
      streamingCount = 0;
      savedJob = { ...job, state: 'complete', confirmed: true, result: { ...job.result, switched: 3, files: 2 } };
      await route.fulfill({ json: savedJob });
    } else {
      expect(request.postDataJSON()).toEqual({ sourceId: 14 });
      requests.push('generation assessed');
      await route.fulfill({ json: job });
    }
  });

  await page.goto('/settings#library');
  await expect(page.getByText('/gallery', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Switch to streaming and remove video previews' })).toHaveCount(0);
  const card = page.getByRole('region', { name: 'Switch existing videos to saved previews' });
  const playback = page.getByRole('region', { name: 'Video playback', exact: true });
  await expect(playback.getByText('Saved previews', { exact: true })).toBeVisible();
  await expect(card.getByText(/3 existing videos are still set to streaming/)).toBeVisible();
  await card.getByRole('combobox', { name: 'Local source' }).selectOption('14');
  await card.getByRole('button', { name: 'Check videos' }).click();
  await expect(card.getByRole('status').getByRole('term')).toHaveText(['Previews to generate', 'Videos to switch']);
  await expect(card.getByRole('status').getByRole('definition')).toHaveText(['2', '3']);
  await card.getByRole('button', { name: 'Generate previews and switch' }).click();
  const dialog = page.getByRole('dialog', { name: 'Switch to saved previews?' });
  await expect(dialog.getByText(/Creating previews takes time and disk space/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Generate previews and switch' }).click();
  const result = '3 videos switched to saved previews · 2 previews generated';
  await expect(playback.getByRole('status')).toContainText(result);
  await expect(playback.getByText('No videos left to switch to saved previews.')).toBeVisible();
  await expect(card).toHaveCount(0);
  expect(requests).toEqual(['cleanup GET', 'generation assessed', 'generation confirmed']);

  await page.reload();
  await expect(playback.getByRole('status')).toContainText(result);
  await expect(card).toHaveCount(0);
  await playback.screenshot({ path: test.info().outputPath('saved-previews-result.png') });
  await playback.getByRole('button', { name: 'Dismiss preview generation result' }).click();
  await expect(playback).toBeFocused();
  await page.reload();
  await expect(playback.getByText('No videos left to switch to saved previews.')).toBeVisible();
  await expect(playback.getByRole('status')).toHaveCount(0);
  await expect(card).toHaveCount(0);
});

test('saved previews mode keeps interrupted cleanup jobs accessible', async ({ page }) => {
  await mockGallery(page, 'dark');
  await page.route('**/api/auth/status', route => route.fulfill({ json: adminAuthStatus }));
  await mockVideoDeliveryMode(page, 'previews');
  const sources = [{ id: 1, name: 'Primary gallery' }];
  const job = {
    id: 'old-cleanup', state: 'interrupted', sources, confirmed: true, cancelRequested: false,
    assessment: { checked: 1, videos: 1, files: 1, bytes: 2_000_000, skipped: 0, reasons: {} },
    result: { switched: 0, files: 0, bytes: 0, skipped: 0, deferred: 1, failed: 0, reasons: { inUse: 1 } }
  };
  let streamingCount = 0;
  await page.route('**/api/admin/video-previews/generation', route => route.fulfill({ json: { sources, streamingCount, job: null } }));
  await page.route('**/api/admin/video-previews/reclamation**', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { sources, job } });
    } else {
      expect(route.request().url()).toMatch(/\/old-cleanup\/retry$/);
      streamingCount = 1;
      await route.fulfill({ json: {
        ...job, state: 'complete', result: { ...job.result, switched: 1, files: 1, bytes: 2_000_000, deferred: 0, reasons: {} }
      } });
    }
  });

  await page.goto('/settings#library');
  const card = page.getByRole('region', { name: 'Video preview cleanup recovery' });
  await expect(card.getByText('Operation interrupted')).toBeVisible();
  await expect(card.getByText('Preview in use (1)')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Assess previews' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Switch to streaming and remove video previews' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Switch existing videos to saved previews' })).toHaveCount(0);
  await card.getByRole('button', { name: 'Resume or retry' }).click();
  const result = page.getByRole('region', { name: 'Video maintenance result' });
  await expect(result.getByRole('status')).toContainText('2 MB freed');
  await expect(page.getByRole('region', { name: 'Switch existing videos to saved previews' }))
    .toContainText('1 existing video is still set to streaming.');
  await result.screenshot({ path: test.info().outputPath('cleanup-recovery.png') });
  await result.getByRole('button', { name: 'Dismiss cleanup result' }).click();
  await expect(result).toHaveCount(0);
  await expect(card).toHaveCount(0);
});

test('streaming status stays fast while an optional assessment finds leftover previews', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 840 });
  await mockGallery(page);
  await page.route('**/api/auth/status', route => route.fulfill({ json: adminAuthStatus }));
  await mockVideoDeliveryMode(page, 'streaming');
  const sources = [{ id: 1, name: 'Primary gallery' }];
  const ready = {
    id: 'leftover-preview', state: 'ready', sources, confirmed: false, cancelRequested: false,
    assessment: { checked: 1, videos: 0, files: 1, bytes: 12_000, skipped: 0, reasons: {} },
    result: { switched: 0, files: 0, bytes: 0, skipped: 0, deferred: 0, failed: 0, reasons: {} }
  };
  let job: typeof ready | null = null;
  let assessments = 0;
  await page.route('**/api/admin/video-previews/reclamation**', route => {
    if (route.request().method() === 'POST') {
      assessments++;
      job = ready;
      return route.fulfill({ status: 202, json: ready });
    }
    return route.fulfill({ json: { sources, job, cleanupPending: false } });
  });
  await page.goto('/settings#library');
  const playback = page.getByRole('region', { name: 'Video playback', exact: true });
  const card = page.getByRole('region', { name: 'Switch to streaming and remove video previews' });
  await expect(playback.getByText('All indexed local videos use streaming.')).toBeVisible();
  await expect(card).toHaveCount(0);
  await playback.getByRole('button', { name: 'Check for remaining previews' }).click();
  await expect(card.getByRole('button', { name: 'Assess previews' })).toBeVisible();
  await card.getByRole('button', { name: 'Assess previews' }).click();
  await expect(card.getByText('Previews to remove')).toBeVisible();
  await expect(card.getByRole('definition')).toHaveText(['12 kB', '1', '0']);
  expect(assessments).toBe(1);
  await card.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(playback.getByRole('button', { name: 'Check for remaining previews' })).toBeFocused();
  expect(assessments).toBe(1);
  await page.reload();
  await expect(card.getByText('Previews to remove')).toBeVisible();
  await card.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(playback.getByRole('button', { name: 'Check for remaining previews' })).toBeFocused();
  expect(assessments).toBe(1);
  await playback.screenshot({ path: test.info().outputPath('remaining-previews-closed.png') });
});

for (const theme of ['light', 'dark'] as const) {
  test(`preview reclamation confirms the assessed local source in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await page.setViewportSize({ width: theme === 'light' ? 390 : 1280, height: 840 });
    await mockGallery(page, theme);
    await page.route('**/api/auth/status', route => route.fulfill({ json: adminAuthStatus }));
    await mockVideoDeliveryMode(page, 'streaming');
    const sources = [{ id: 1, name: 'Primary gallery' }, { id: 14, name: 'External gallery' }];
    const assessedSources = theme === 'light' ? [sources[1]] : sources;
    const [bytes, formattedSize]: [number, string] = theme === 'light' ? [206_667_409, '207 MB'] : [1_240_000_000, '1.2 GB'];
    const job = {
      id: 'test-job', state: 'ready', sources: assessedSources, confirmed: false, cancelRequested: false,
      assessment: { checked: 4, videos: 3, files: 2, bytes, skipped: 1, reasons: { originalUnavailable: 1 } },
      result: { switched: 0, files: 0, bytes: 0, skipped: 0, deferred: 0, failed: 0, reasons: {} }
    };
    const completedJob = {
      ...job, state: 'complete', confirmed: true, result: { ...job.result, switched: 3, files: 2, bytes }
    };
    let savedJob: typeof completedJob | null = null;
    let cleanupPending = true;
    const requests: string[] = [];
    await page.route('**/api/admin/video-previews/reclamation**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (request.method() === 'GET') {
        await route.fulfill({ json: pathname.endsWith('/test-job') ? completedJob : { sources, job: savedJob, cleanupPending } });
      } else if (pathname.endsWith('/confirm')) {
        expect(request.headers()['x-foldergram-intent']).toBe('1');
        requests.push('confirmed');
        savedJob = completedJob;
        cleanupPending = theme === 'light';
        await route.fulfill({ json: theme === 'light' ? completedJob : { ...job, state: 'running', confirmed: true } });
      } else {
        expect(request.postDataJSON()).toEqual(theme === 'light' ? { sourceId: 14 } : {});
        requests.push('assessed');
        await route.fulfill({ json: job });
      }
    });
    await page.clock.install();
    await page.goto('/settings#library');
    const card = page.getByRole('region', { name: 'Switch to streaming and remove video previews' });
    const sourceSelect = card.getByRole('combobox', { name: 'Local source' });
    await expect(sourceSelect).toHaveCSS('border-top-width', '1px');
    await expect(sourceSelect).toHaveCSS('color-scheme', theme);
    await expectReadableControl(sourceSelect);
    await expectReadableControl(sourceSelect.locator('option[value="14"]'));
    await expect(card.getByRole('status')).toHaveCount(0);
    await sourceSelect.selectOption(theme === 'light' ? '14' : '');
    const assess = card.getByRole('button', { name: 'Assess previews' });
    await assess.click();
    const summary = card.getByRole('status');
    await expect(summary.getByRole('term')).toHaveText(['Estimated savings', 'Previews to remove', 'Videos to switch']);
    await expect(summary.getByRole('definition')).toHaveText([formattedSize, '2', '3']);
    await expect(summary.getByText(/Original unavailable or changed/)).toBeVisible();
    await expect(summary.getByText(`Sources: ${assessedSources.map(source => source.name).join(', ')}`, { exact: true })).toBeVisible();
    await card.screenshot({ path: test.info().outputPath('preview-reclamation-assessment.png') });
    const openDialog = card.getByRole('button', { name: 'Switch to streaming and remove video previews' });
    const dialog = page.getByRole('dialog', { name: 'Switch to streaming?' });
    const confirm = dialog.getByRole('button', { name: 'Remove previews' });

    await openDialog.click();
    await expect(dialog.getByText(`Sources: ${assessedSources.map(source => source.name).join(', ')}`, { exact: true })).toBeVisible();
    await expect(dialog.getByText('Videos to switch')).toBeVisible();
    await expect(dialog.getByText('Previews to remove')).toBeVisible();
    await expect(dialog.getByText('Estimated savings')).toBeVisible();
    await expect(dialog.getByRole('definition')).toHaveText(['3', '2', formattedSize]);

    if (theme === 'light') {
      await page.setViewportSize({ width: 390, height: 360 });
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.width).toBeLessThanOrEqual(390 - 32);
      expect(bounds.y).toBeGreaterThanOrEqual(16);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(360 - 16);
      const playbackNote = dialog.getByText(/Some videos may take longer/);
      await playbackNote.scrollIntoViewIfNeeded();
      await expect(playbackNote).toBeInViewport();
      await expect(confirm).toBeInViewport();
      await page.setViewportSize({ width: 390, height: 840 });
    } else {
      const bounds = (await dialog.boundingBox())!;
      expect(bounds.width).toBeGreaterThan(500);
      expect(bounds.x + bounds.width / 2).toBeCloseTo(1280 / 2, 0);
    }

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(requests).toEqual(['assessed']);
    await openDialog.click();
    await confirm.click();
    if (theme === 'dark') {
      await expect(card.getByText('Switching videos and removing previews…')).toBeVisible();
      await page.clock.fastForward(1_100);
    }
    const playback = page.getByRole('region', { name: 'Video playback', exact: true });
    await expect(playback.getByText('Streaming', { exact: true })).toBeVisible();
    await expect(playback.getByRole('status')).toContainText(`${formattedSize} freed`);
    await expect(playback.getByRole('status')).toContainText('2 previews removed · 3 videos switched to streaming');
    expect(requests).toEqual(['assessed', 'confirmed']);
    if (theme === 'dark') {
      await expect(playback.getByText('All indexed local videos use streaming.')).toBeVisible();
      await expect(card).toHaveCount(0);
      await page.reload();
    } else {
      await assess.focus();
    }
    const dismiss = playback.getByRole('button', { name: 'Dismiss cleanup result' });
    await expect(dismiss).toBeVisible();
    await playback.screenshot({ path: test.info().outputPath('preview-reclamation-complete.png') });
    await page.mouse.move(0, 0);
    await page.clock.fastForward(60_000);
    await expect(dismiss).toBeVisible();
    if (theme === 'light') {
      await dismiss.press('Enter');
    } else {
      await dismiss.click();
    }
    await expect(theme === 'light' ? assess : playback).toBeFocused();
    await expect(playback.getByRole('status')).toHaveCount(0);

    await page.reload();
    if (theme === 'light') {
      await expect(assess).toBeEnabled();
    } else {
      await expect(playback.getByText('All indexed local videos use streaming.')).toBeVisible();
      await expect(card).toHaveCount(0);
    }
    await expect(playback.getByRole('status')).toHaveCount(0);

    if (theme === 'dark') {
      savedJob = { ...completedJob, result: { ...completedJob.result, failed: 1, reasons: { removalFailed: 1 } } };
      await page.reload();
      await expect(card.getByRole('button', { name: 'Resume or retry' })).toBeVisible();
      await expect(card.getByText('Preview removal failed (1)')).toBeVisible();
    }
  });
}

test('Home keeps desktop sidebar across portrait and tablet breakpoints', async ({ page }) => {
  await mockGallery(page, 'dark');
  await page.goto('/');
  const sidebar = page.locator('.app-shell > aside.sidebar');
  const mobileNav = page.locator('.mobile-nav');
  const content = page.locator('.app-shell__content');

  for (const width of [768, 900, 960, 979, 980]) {
    await page.setViewportSize({ width, height: 1500 });
    await expect(sidebar, `Desktop sidebar missing at ${width}px`).toBeVisible();
    await expect(mobileNav).toBeHidden();
    const bounds = (await content.boundingBox())!;
    expect(bounds.x, `Home content should reserve sidebar space at ${width}px`).toBeGreaterThan(70);
  }

  await page.setViewportSize({ width: 767, height: 1500 });
  await expect(sidebar).toBeHidden();
  await expect(mobileNav).toBeVisible();
});

test('very tall home videos are cropped into bounded previews while opening the original Reel', async ({ page }) => {
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
  expect(bounds.height).toBeCloseTo(585, 0);
  const viewportHeight = page.viewportSize()!.height;
  expect(await media.evaluate(el => getComputedStyle(el).objectFit)).toBe('cover');
  const player = shell.locator('media-player');
  await expect(player).toHaveAttribute('data-playing', '');

  await page.route('**/api/reels?*', route => route.fulfill({
    json: { items: [video], page: 1, limit: 6, total: 1, hasMore: false }
  }));
  const x = bounds.x + bounds.width / 2;
  const y = viewportHeight / 2;
  await page.mouse.click(x, y);
  await expect(page).toHaveURL(new RegExp(`/reels/${video.id}\\?from=home`));
  await expect(page.locator('.app__reel-modal-layer')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL('/');
});

test('Home Reel overlay preserves mounted cards, exact scroll position, and Back/Forward after navigating Reels', async ({ page }) => {
  await mockGallery(page, 'dark');
  await page.setViewportSize({ width: 1440, height: 786 });
  const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
  await page.route('**/previews/feed-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  const items = Array.from({ length: 16 }, (_, index) => ({
    ...panorama,
    id: index + 1,
    filename: `video-${index + 1}.mp4`,
    mediaType: 'video',
    width: index % 3 === 0 ? 1920 : index % 3 === 1 ? 1080 : 1080,
    height: index % 3 === 0 ? 1080 : index % 3 === 1 ? 1080 : 1920,
    durationMs: 1000,
    previewUrl: '/previews/feed-video.mp4'
  }));
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: items.length, hasMore: false }
  }));
  await page.route('**/api/reels?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: items.length, hasMore: false }
  }));
  await page.goto('/');
  const cards = page.locator('.feed-card__video-shell');
  await expect(cards).toHaveCount(16);
  for (const index of [0, 1, 2]) {
    const shell = cards.nth(index);
    const dimensions = (await shell.boundingBox())!;
    expect(dimensions.height).toBeCloseTo(585, 0);
    expect(await shell.locator('video').evaluate(el => getComputedStyle(el).objectFit)).toBe('cover');
  }
  await cards.nth(9).scrollIntoViewIfNeeded();
  const originalY = await page.evaluate(() => scrollY);
  const originalTop = (await cards.nth(9).boundingBox())!.y;
  await cards.nth(9).click({ position: { x: 130, y: 140 } });
  await expect(page).toHaveURL(/\/reels\/10\?from=home/);
  await expect(page.locator('.app__reel-modal-layer')).toBeVisible();
  await expect(page.locator('.reels-view--home-overlay .reels-view__layout')).toHaveCSS('--reels-rail-adjustment', 'calc(1.5rem - 10px)');
  await expect(page.locator('.feed-card__video-shell')).toHaveCount(16);
  await page.getByRole('button', { name: 'Next reel' }).click();
  await expect(page).toHaveURL(/\/reels\/11\?from=home/);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('.app__reel-modal-layer')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(originalY);
  expect((await cards.nth(9).boundingBox())!.y).toBeCloseTo(originalTop, 0);
  await page.goForward();
  await expect(page).toHaveURL(/\/reels\/11\?from=home/);
  await expect(page.locator('.app__reel-modal-layer')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(originalY);
});

// Realistic six-item cursor pages: the Home anchor (8) returns on page two,
// and a duplicate-only page three must not halt pagination of 1,000 candidates.
for (const viewport of [
  { width: 1440, height: 786 },
  { width: 1080, height: 1778 },
  { width: 390, height: 844 }
]) {
  test(`Home Reel paging and independent history sessions with 1,000 videos at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await mockGallery(page, 'dark');
    await page.setViewportSize(viewport);
    const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
    await page.route('**/previews/feed-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
    const video = (id: number) => ({
      ...panorama, id, filename: `reel-${id}.mp4`, mediaType: 'video',
      width: 1080, height: 1920, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
    });
    await page.route('**/api/status', route => route.fulfill({ json: {
      folders: 1, indexedImages: 0, indexedVideos: 1000,
      scan: { isScanning: false, lastCompletedScan: { id: 1 } },
      storage: { available: true, reason: null },
      libraryIndex: { rebuildRequired: false, reason: null, ignoredRootMediaCount: 0 },
      preferences: { defaultHomeFeedMode: 'recent', defaultReelsFeedMode: 'random' },
      storiesMigration: { hasLegacyStoriesCandidates: false, decisionPending: false }
    } }));
    await page.route('**/api/feed?*', route => route.fulfill({
      json: { items: [1, 2, 8, 4, 25, 6].map(video), page: 1, limit: 24, total: 6, hasMore: false }
    }));
    await page.route('**/api/posts/*', route => {
      const id = Number(new URL(route.request().url()).pathname.split('/').at(-1));
      return route.fulfill({ json: video(id) });
    });
    const reelRequests: Array<{ page: number; seed: string | null }> = [];
    await page.route('**/api/reels?*', route => {
      const params = new URL(route.request().url()).searchParams;
      const nextPage = params.get('cursor')?.replace('cursor-', '');
      const pageNumber = Number(nextPage ?? params.get('page') ?? 1);
      const seed = params.get('seed');
      reelRequests.push({ page: pageNumber, seed });
      const ids = pageNumber === 3
        ? [7, 8, 9, 10, 11, 12]
        : Array.from({ length: Math.min(6, 1000 - (pageNumber - (pageNumber > 3 ? 2 : 1)) * 6) }, (_, index) =>
          (pageNumber - (pageNumber > 3 ? 2 : 1)) * 6 + index + 1);
      return route.fulfill({ json: {
        mode: 'random', items: ids.map(video), page: pageNumber, limit: 6,
        total: 1000, hasMore: pageNumber < 168,
        nextCursor: pageNumber < 168 ? `cursor-${pageNumber + 1}` : null
      } });
    });
    await page.goto('/');
    const homeCards = page.locator('.feed-card__video-shell');
    await expect(homeCards).toHaveCount(6);
    await homeCards.nth(2).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(homeCards.nth(2)).toHaveAttribute('role', 'button');
    const homeY = await page.evaluate(() => scrollY);
    await homeCards.nth(2).click({ position: { x: 100, y: 120 } });
    await expect(page).toHaveURL(/\/reels\/8\?from=home/);
    const sessionA = await page.evaluate(() => history.state.reelSessionKey as string);
    expect(sessionA).toMatch(/^home:/);
    const deck = page.locator('.app__reel-modal-layer .reel-deck');
    const panelIds = async () => deck.locator('.reel-deck__panel').evaluateAll(panels =>
      panels.map(panel => Number(panel.getAttribute('data-reel-id'))));
    await expect.poll(panelIds).toEqual([8, 1, 2, 3, 4, 5, 6]);

    // Advance across multiple six-item pages rather than merely testing page one.
    const expected = [1, 2, 3, 4, 5, 6, 7, ...Array.from({ length: 17 }, (_, index) => index + 9)];
    for (const id of expected) {
      await page.waitForTimeout(160); // allow the deck's scroll settle lock to clear
      if (viewport.width >= 768) {
        await page.getByRole('button', { name: 'Next reel' }).click();
      } else {
        await page.mouse.move(viewport.width / 2, viewport.height / 2);
        await page.mouse.wheel(0, 320);
      }
      await expect(page).toHaveURL(new RegExp(`/reels/${id}\\?from=home`));
      const ids = await panelIds();
      expect(new Set(ids).size).toBe(ids.length);
      expect(await deck.locator('.reel-player-card').count()).toBeLessThanOrEqual(5);
      await expect(deck.locator('.reel-player-card__surface[role="button"]')).toHaveCount(1);
    }
    expect(reelRequests.map(request => request.page)).toEqual(expect.arrayContaining([1, 2, 3, 4]));
    expect(new Set(reelRequests.map(request => request.seed)).size).toBe(1);
    const queueA = await panelIds();
    expect(queueA.filter(id => id === 8)).toHaveLength(1);

    // Back retains the mounted Home and Forward restores the original cursor/seed.
    const requestsBeforeForward = reelRequests.length;
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL('/');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(homeY);
    await page.goForward();
    await expect(page).toHaveURL(/\/reels\/25\?from=home/);
    expect(await page.evaluate(() => history.state.reelSessionKey)).toBe(sessionA);
    await expect.poll(panelIds).toEqual(queueA);
    expect(reelRequests).toHaveLength(requestsBeforeForward);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL('/');

    // A new explicit Home opening is never a resurrection of that queue,
    // even when its video was already present in the previous session.
    await homeCards.nth(4).evaluate(element => element.scrollIntoView({ block: 'center' }));
    await expect(homeCards.nth(4)).toHaveAttribute('role', 'button');
    await homeCards.nth(4).click({ position: { x: 100, y: 120 } });
    await expect(page).toHaveURL(/\/reels\/25\?from=home/);
    const sessionB = await page.evaluate(() => history.state.reelSessionKey as string);
    expect(sessionB).not.toBe(sessionA);
    await expect.poll(panelIds).toEqual([25, 1, 2, 3, 4, 5, 6]);
    expect(reelRequests.length).toBeGreaterThan(requestsBeforeForward);
    expect(reelRequests.at(-1)?.seed).not.toBe(reelRequests[0]?.seed);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL('/');
  });
}

for (const browseA of [false, true]) {
  test(`direct history jump restores Home Reel session ${browseA ? 'after browsing' : 'with identical video URL'} without unmounting`, async ({ page }) => {
    await mockGallery(page, 'dark');
    await page.setViewportSize({ width: 1440, height: 786 });
    const clip = await readFile(new URL('./fixtures/feed-video.mp4', import.meta.url));
    await page.route('**/previews/feed-video.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
    const video = (id: number) => ({
      ...panorama, id, filename: `reel-${id}.mp4`, mediaType: 'video',
      width: 1080, height: 1920, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
    });
    await page.route('**/api/status', route => route.fulfill({ json: {
      folders: 1, indexedImages: 0, indexedVideos: 1000,
      scan: { isScanning: false, lastCompletedScan: { id: 1 } },
      storage: { available: true, reason: null },
      libraryIndex: { rebuildRequired: false, reason: null, ignoredRootMediaCount: 0 },
      preferences: { defaultHomeFeedMode: 'recent', defaultReelsFeedMode: 'random' },
      storiesMigration: { hasLegacyStoriesCandidates: false, decisionPending: false }
    } }));
    await page.route('**/api/feed?*', route => route.fulfill({
      json: { items: [video(8)], page: 1, limit: 24, total: 1, hasMore: false }
    }));
    await page.route('**/api/posts/*', route =>
      route.fulfill({ json: video(Number(new URL(route.request().url()).pathname.split('/').at(-1))) }));
    const requests: Array<{ seed: string; page: number }> = [];
    let seedA: string | null = null;
    await page.route('**/api/reels?*', route => {
      const params = new URL(route.request().url()).searchParams;
      const seed = params.get('seed')!;
      const pageNumber = Number(params.get('cursor')?.replace('page-', '') ?? params.get('page') ?? 1);
      seedA ??= seed;
      requests.push({ seed, page: pageNumber });
      const start = seed === seedA ? 1 : 101;
      return route.fulfill({ json: {
        mode: 'random', page: pageNumber, limit: 6, total: 1000, hasMore: pageNumber < 4,
        nextCursor: pageNumber < 4 ? `page-${pageNumber + 1}` : null,
        items: Array.from({ length: 6 }, (_, index) => video(start + (pageNumber - 1) * 6 + index))
      } });
    });
    await page.goto('/');
    const homeCard = page.locator('.feed-card__video-shell').first();
    await homeCard.scrollIntoViewIfNeeded();
    await expect(homeCard).toHaveAttribute('role', 'button');
    const initialScroll = await page.evaluate(() => scrollY);
    await homeCard.click({ position: { x: 100, y: 120 } });
    await expect(page).toHaveURL(/\/reels\/8\?from=home/);
    const keyA = await page.evaluate(() => history.state.reelSessionKey as string);
    const deck = page.locator('.reels-view--home-overlay .reel-deck');
    if (browseA) {
      await page.getByRole('button', { name: 'Next reel' }).click();
      await expect(page).toHaveURL(/\/reels\/1\?from=home/);
    }
    const aUrl = page.url();
    const aIds = await deck.locator('.reel-deck__panel').evaluateAll(panels =>
      panels.map(panel => Number(panel.getAttribute('data-reel-id'))));
    // Folder and Home create intervening history entries, but jumping directly
    // from B to A keeps the same ReelsView mounted (and may keep the same URL).
    await page.locator('.reels-view__metadata').click();
    await expect(page).toHaveURL(/\/f\/panoramas/);
    await page.locator('aside.sidebar').getByRole('link', { name: 'Home', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    await homeCard.scrollIntoViewIfNeeded();
    await expect(homeCard).toHaveAttribute('role', 'button');
    await homeCard.click({ position: { x: 100, y: 120 } });
    await expect(page).toHaveURL(/\/reels\/8\?from=home/);
    const keyB = await page.evaluate(() => history.state.reelSessionKey as string);
    expect(keyB).not.toBe(keyA);
    await expect.poll(() => deck.locator('.reel-deck__panel').evaluateAll(panels =>
      panels.map(panel => Number(panel.getAttribute('data-reel-id'))))).toEqual([8, 101, 102, 103, 104, 105, 106]);
    const bSeed = requests.at(-1)!.seed;
    expect(bSeed).not.toBe(seedA);
    await page.evaluate(() => history.go(-3));
    await expect(page).toHaveURL(aUrl);
    await expect.poll(() => page.evaluate(() => history.state.reelSessionKey)).toBe(keyA);
    await expect.poll(() => deck.locator('.reel-deck__panel').evaluateAll(panels =>
      panels.map(panel => Number(panel.getAttribute('data-reel-id'))))).toEqual(aIds);
    await expect(deck.locator('.reel-player-card__surface[role="button"]')).toHaveCount(1);
    // Cursor continuity after restoration must still use A's seed.
    const requestCount = requests.length;
    for (const id of (browseA ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6])) {
      await page.waitForTimeout(160);
      await page.getByRole('button', { name: 'Next reel' }).click();
      await expect(page).toHaveURL(new URL(`/reels/${id}?from=home`, page.url()).href);
    }
    await expect.poll(() => requests.length).toBeGreaterThan(requestCount);
    expect(requests.at(-1)!.seed).toBe(seedA);
    expect(requests.at(-1)!.seed).not.toBe(bSeed);
    await page.getByRole('button', { name: 'Close' }).click();
    await expect(page).toHaveURL('/');
    // The same Home view remains available without scroll/focus contamination.
    await expect(page.locator('.feed-card__video-shell')).toHaveCount(1);
    expect(initialScroll).toBeGreaterThanOrEqual(0);
  });
}

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

test('Home Reel overlay traps keyboard focus, isolates background, and restores focus on Close', async ({ page }) => {
  await mockReels(page);
  const items = [1, 2, 3].map(id => ({
    ...panorama, id, filename: `reel-${id}.mp4`, mediaType: 'video',
    width: 1080, height: 1920, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
  }));
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: items.length, hasMore: false }
  }));
  await page.goto('/');
  const opener = page.locator('.feed-card__video-shell[role="button"]').first();
  await opener.scrollIntoViewIfNeeded();
  await opener.focus();
  await expect(opener).toBeFocused();
  await page.keyboard.press('Enter');

  await expect(page).toHaveURL(/\/reels\/\d+\?from=home/);
  const dialog = page.getByRole('dialog', { name: 'Reels' });
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  await expect(page.locator('.app__background-route')).toHaveAttribute('inert', '');
  await expect(page.locator('.app-shell > aside.sidebar')).toHaveAttribute('inert', '');
  await expect(page.locator('.mobile-nav')).toHaveAttribute('inert', '');

  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.app__reel-modal-layer')))).toBe(true);
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.app__reel-modal-layer')))).toBe(true);
  }

  await close.click();
  await expect(page).toHaveURL('/');
  await expect(page.locator('.app__background-route')).not.toHaveAttribute('inert', '');
  await expect(opener).toBeFocused();
});

test('Home Reel overlay reloads after a source generation changes', async ({ page }) => {
  await mockReels(page);
  const items = [1, 2, 3].map(id => ({
    ...panorama, id, filename: `reel-${id}.mp4`, mediaType: 'video',
    width: 1080, height: 1920, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
  }));
  await page.route('**/api/feed?*', route => route.fulfill({
    json: { items, page: 1, limit: 24, total: items.length, hasMore: false }
  }));
  let sourceGeneration = 1;
  let sourceRequests = 0;
  let reelRequests = 0;
  await page.route('**/api/sources/status*', route => {
    sourceRequests++;
    return route.fulfill({ json: { items: [{
      id: 9, kind: 'local', name: 'Gallery', enabled: 1, status: 'ready',
      generation: sourceGeneration, updated_at: '2026-11-24', available: true, syncing: false
    }] } });
  });
  await page.route('**/api/reels?*', route => {
    reelRequests++;
    return route.fulfill({ json: { items, page: 1, limit: 24, total: items.length, hasMore: false } });
  });

  await page.goto('/');
  await expect.poll(() => sourceRequests).toBeGreaterThan(0);
  const opener = page.locator('.feed-card__video-shell[role="button"]').first();
  await opener.scrollIntoViewIfNeeded();
  await opener.click({ position: { x: 100, y: 120 } });
  await expect(page).toHaveURL(/\/reels\/\d+\?from=home/);
  const dialog = page.getByRole('dialog', { name: 'Reels' });
  await expect(dialog.locator('.reel-deck__panel')).toHaveCount(3);
  const requestsBeforeChange = reelRequests;
  const sourcePollBeforeChange = sourceRequests;
  sourceGeneration = 2;

  await expect.poll(() => sourceRequests, { timeout: 10000 }).toBeGreaterThan(sourcePollBeforeChange);
  await expect.poll(() => reelRequests, { timeout: 10000 }).toBeGreaterThan(requestsBeforeChange);
  await expect(dialog.locator('.reel-deck__panel')).toHaveCount(3);
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();
  await close.click();
  await expect(page).toHaveURL('/');
  // The source refresh can replace the original card. Return to a live Home
  // control or the Home navigation, never the removed Reel dialog/body.
  await expect.poll(() => page.evaluate(() =>
    Boolean(document.activeElement?.closest('.app__background-route, .app-shell > .sidebar, .mobile-nav'))
  )).toBe(true);
});

test('fitted Home Reel preview stays within a short 480px viewport', async ({ page }) => {
  await mockGallery(page, 'dark');
  await page.addInitScript(() => {
    localStorage.setItem('foldergram-fit-tall-media-to-screen', 'true');
  });
  await page.setViewportSize({ width: 1280, height: 480 });
  await mockPortraitFeed(page);
  await page.goto('/');
  const shell = page.locator('.feed-card__video-shell');
  await expect(shell).toBeVisible();
  const box = (await shell.boundingBox())!;
  expect(box.height).toBeLessThanOrEqual(448.5);
  expect(box.width / box.height).toBeCloseTo(4 / 5, 2);
  await expect(shell.locator('video')).toHaveCSS('object-fit', 'contain');
});

for (const viewport of [
  { width: 900, height: 1200 },
  { width: 960, height: 1600 },
  { width: 1080, height: 1778 }
]) {
  test(`Home Reel overlay has Instagram-style portrait gutters and controls at ${viewport.width}×${viewport.height}; refresh becomes standalone Reels`, async ({ page }) => {
    await mockReels(page);
    await page.setViewportSize(viewport);
    const clips = [1, 2, 3].map(id => ({
      ...panorama, id, filename: `reel-${id}.mp4`, mediaType: 'video',
      width: 1080, height: 1920, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
    }));
    await page.route('**/api/feed?*', route => route.fulfill({
      json: { items: clips, page: 1, limit: 24, total: clips.length, hasMore: false }
    }));
    await page.goto('/');

    const homeVideos = page.locator('.feed-card__video-shell');
    await expect(homeVideos).toHaveCount(3);
    const homeBox = (await homeVideos.first().boundingBox())!;
    expect(Math.abs(homeBox.x + homeBox.width / 2 - viewport.width / 2), 'Home should not drift far to the right').toBeLessThan(40);
    await homeVideos.first().scrollIntoViewIfNeeded();
    const activeHomeVideo = page.locator('.feed-card__video-shell[role="button"]').first();
    await expect(activeHomeVideo).toBeVisible();
    await activeHomeVideo.click({ position: { x: 130, y: 140 } });

    await expect(page).toHaveURL(/\/reels\/\d+\?from=home/);
    const openedReelUrl = page.url().split('?')[0]!;
    await expect(page.locator('.app__reel-modal-layer')).toBeVisible();
    await expect(page.locator('.app-shell--home')).toBeVisible();
    const sidebar = page.locator('.app-shell > aside.sidebar');
    await expect(sidebar).toBeVisible();
    await expect(sidebar.locator('.sidebar__link').nth(0)).toHaveClass(/router-link-active/);
    await expect(sidebar.locator('.sidebar__link').nth(1)).not.toHaveClass(/router-link-active/);
    await expect(page.locator('.reels-view--home-overlay .reels-view__layout')).toHaveCSS('--reels-rail-adjustment', '-1rem');
    const overlayBox = (await page.locator('.app__reel-modal-layer').boundingBox())!;
    expect(overlayBox.x).toBeCloseTo(0, 0);
    expect(overlayBox.width).toBeCloseTo(viewport.width, 0);
    // The Home sidebar stays mounted for restoration but must not be visible or
    // interactive while the immersive viewer covers the full viewport.
    expect(await page.evaluate(() => {
      const point = document.elementFromPoint(40, 600);
      return Boolean(point?.closest('aside.sidebar'));
    })).toBe(false);
    const close = page.locator('.reels-view__close');
    await expect(close).toBeVisible();
    await expect(close).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(close.locator('svg')).toBeVisible();
    const overlayStage = (await page.locator('.reel-player-card__stage').first().boundingBox())!;
    const overlayRail = (await page.locator('.reels-view__action-rail--desktop').boundingBox())!;
    const navButtons = page.locator('.reels-view__nav-button');
    const arrows = (await navButtons.last().boundingBox())!;
    const closeBox = (await close.boundingBox())!;
    const closeIcon = (await close.locator('svg').boundingBox())!;
    // Instagram screenshot: the video has a breathing-space gutter on the
    // left; actions sit just beside it; arrows and X share the right lane.
    expect(overlayStage.x / viewport.width).toBeGreaterThan(0.07);
    expect(overlayStage.x / viewport.width).toBeLessThan(0.17);
    expect(overlayRail.x - (overlayStage.x + overlayStage.width)).toBeGreaterThanOrEqual(6);
    expect(overlayRail.x + overlayRail.width).toBeLessThan(arrows.x);
    expect(Math.abs(closeBox.x + closeBox.width / 2 - arrows.x - arrows.width / 2)).toBeLessThan(5);
    expect(closeIcon.width).toBeCloseTo(32, 0);
    expect(closeBox.y).toBeCloseTo(17, 0);
    const fullViewerCenter = (overlayStage.x + overlayRail.x + overlayRail.width) / 2;
    expect(Math.abs(fullViewerCenter - viewport.width / 2)).toBeLessThan(75);

    await page.reload();
    await expect(page).toHaveURL(openedReelUrl);
    await expect(page.locator('.app-shell--reels')).toBeVisible();
    await expect(sidebar.locator('.sidebar__link').nth(1)).toHaveClass(/router-link-active/);
    await expect(page.locator('.app__reel-modal-layer')).toHaveCount(0);
    await expect(page.locator('.reels-view__close')).toHaveCount(0);
    const directStage = (await page.locator('.reel-player-card__stage').first().boundingBox())!;
    expect(directStage.x).toBeGreaterThan(0);
    expect(directStage.width).toBeGreaterThan(0);
    // Standalone Reels deliberately reserve sidebar width; the Home overlay
    // uses the entire viewport and therefore does not share its stage X.
    expect(overlayStage.x).toBeLessThan(directStage.x);
  });
}

test('opening standalone Reels from the sidebar does not create a Home overlay', async ({ page }) => {
  await mockReels(page);
  await page.goto('/');
  await page.locator('aside.sidebar').getByRole('link', { name: /Reels/i }).click();
  await expect(page).toHaveURL(/\/reels\/1$/);
  await expect(page.locator('.app-shell--reels')).toBeVisible();
  await expect(page.locator('.app__reel-modal-layer')).toHaveCount(0);
  await expect(page.locator('.reels-view__close')).toHaveCount(0);
});

test('direct Home-origin Reel URL without mounted Home is a standalone Reels page', async ({ page }) => {
  await mockReels(page);
  await page.goto('/reels/2?from=home');
  await expect(page).toHaveURL(/\/reels\/2$/);
  await expect(page.locator('.app-shell--reels')).toBeVisible();
  await expect(page.locator('.app__reel-modal-layer')).toHaveCount(0);
  await expect(page.locator('.reels-view__close')).toHaveCount(0);
});

test('Reels share the desktop navigation breakpoint at exactly 768px', async ({ page }) => {
  await mockReels(page);
  await page.setViewportSize({ width: 768, height: 1200 });
  await page.goto('/reels/1');
  await expect(page.locator('.app-shell > aside.sidebar')).toBeVisible();
  await expect(page.locator('.mobile-nav')).toBeHidden();
  await expect(page.locator('.reels-view__action-rail--desktop')).toBeVisible();
  await expect(page.locator('.reels-view__action-rail--mobile')).toHaveCount(0);
  await page.getByRole('button', { name: 'Next reel' }).click();
  await expect(page).toHaveURL(/\/reels\/2$/);

  await page.setViewportSize({ width: 767, height: 1200 });
  await expect(page.locator('.app-shell > aside.sidebar')).toBeHidden();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await expect(page.locator('.reels-view__action-rail--desktop')).toHaveCount(0);
  await expect(page.locator('.reels-view__action-rail--mobile')).toHaveCount(1);
});

test('the Reels entry route resolves to a post URL and scrolling updates the URL', async ({ page }) => {
  await mockReels(page);
  await page.goto('/reels');
  await expect(page).toHaveURL(/\/reels\/1$/);
  await page.getByRole('button', { name: 'Next reel' }).click();
  await expect(page).toHaveURL(/\/reels\/2$/);
});

test('landscape Reels resize to their source aspect ratio without exposing the next card', async ({ page }) => {
  await mockReels(page);
  await page.setViewportSize({ width: 1080, height: 1778 });
  const landscapes = [1, 2, 3].map(id => ({
    ...panorama, id, filename: `landscape-${id}.mp4`, mediaType: 'video',
    width: 1920, height: 1080, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
  }));
  await page.route('**/api/reels?*', route => route.fulfill({
    json: { items: landscapes, page: 1, limit: 6, total: 3, hasMore: false }
  }));
  await page.goto('/reels/2');
  const stages = page.locator('.reel-player-card__stage');
  await expect(page.locator('.reel-player-card__overlay--visible')).toHaveCount(1);
  await expect.poll(async () => (await stages.nth(1).boundingBox())?.width).toBeGreaterThan(600);
  const active = (await stages.nth(1).boundingBox())!;
  expect(active.width / active.height).toBeCloseTo(16 / 9, 1);
  const next = (await stages.nth(2).boundingBox())!;
  expect(next.y).toBeGreaterThanOrEqual(1770);
  await expect(page).toHaveURL(/\/reels\/2$/);

  await page.setViewportSize({ width: 1600, height: 900 });
  const desktopStage = (await stages.nth(1).boundingBox())!;
  const actionRail = (await page.locator('.reels-view__action-rail--desktop').boundingBox())!;
  const arrows = (await page.locator('.reels-view__nav-controls').boundingBox())!;
  expect(desktopStage.x + desktopStage.width).toBeLessThan(actionRail.x);
  expect(actionRail.x + actionRail.width).toBeLessThan(arrows.x);
});

test('mixed aspect ratios preserve all Reel panel positions during fast navigation', async ({ page }) => {
  await mockReels(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  const mixedItems = [
    { id: 1, width: 1080, height: 1920 },
    { id: 2, width: 1080, height: 1080 },
    { id: 3, width: 1920, height: 1080 },
    { id: 4, width: 1080, height: 1920 }
  ].map(({ id, width, height }) => ({
    ...panorama, id, filename: `mixed-${id}.mp4`, mediaType: 'video',
    width, height, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
  }));
  await page.route('**/api/reels?*', route => route.fulfill({
    json: { items: mixedItems, page: 1, limit: 6, total: 4, hasMore: false }
  }));
  await page.goto('/reels/1');
  const panels = page.locator('.reel-deck__panel');
  await expect(panels).toHaveCount(4);
  const initial = await panels.evaluateAll(elements => elements.map(element => ({
    top: (element as HTMLElement).offsetTop, height: (element as HTMLElement).offsetHeight
  })));
  const next = page.getByRole('button', { name: 'Next reel' });
  for (const id of [2, 3, 4]) {
    await next.click();
    await expect(page).toHaveURL(new RegExp(`/reels/${id}$`));
    const positions = await panels.evaluateAll(elements => elements.map(element => ({
      top: (element as HTMLElement).offsetTop, height: (element as HTMLElement).offsetHeight
    })));
    expect(positions).toEqual(initial);
    // The deck deliberately locks navigation while smooth scrolling settles.
    // A further click should occur after that lock, not during it.
    await page.waitForTimeout(480);
  }

  // Stress input during the transition back toward portrait media.
  await page.mouse.wheel(0, -280);
  await page.mouse.wheel(0, -280);
  const afterRapidWheel = await panels.evaluateAll(elements => elements.map(element => ({
    top: (element as HTMLElement).offsetTop, height: (element as HTMLElement).offsetHeight
  })));
  expect(afterRapidWheel).toEqual(initial);
});

test('portrait desktop keeps the sidebar, stage gutters, and hides previews for square and wide Reels', async ({ page }) => {
  await mockReels(page);
  const viewport = { width: 960, height: 1600 };
  await page.setViewportSize(viewport);
  const items = [
    { id: 1, width: 1080, height: 1920 },
    { id: 2, width: 1080, height: 1080 },
    { id: 3, width: 1920, height: 1080 },
    { id: 4, width: 1080, height: 1920 }
  ].map(({ id, width, height }) => ({
    ...panorama, id, filename: `mixed-${id}.mp4`, mediaType: 'video',
    width, height, durationMs: 1000, previewUrl: '/previews/feed-video.mp4'
  }));
  await page.route('**/api/reels?*', route => route.fulfill({
    json: { items, page: 1, limit: 6, total: items.length, hasMore: false }
  }));
  await page.goto('/reels/1');
  const sidebar = page.locator('.app-shell > aside.sidebar');
  const stages = page.locator('.reel-player-card__stage');
  const panels = page.locator('.reel-deck__panel');
  const nextButton = page.getByRole('button', { name: 'Next reel' });
  await expect(sidebar).toBeVisible();
  const dockedSidebarWidth = await sidebar.evaluate(element =>
    parseFloat(getComputedStyle(element).getPropertyValue('--desktop-sidebar-width')) *
    (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)
  );
  const portraitBox = (await stages.nth(0).boundingBox())!;
  expect(portraitBox.x).toBeGreaterThanOrEqual(dockedSidebarWidth);
  expect(portraitBox.y).toBeGreaterThanOrEqual(12);
  // The portrait panel is shorter, but the incoming square stage remains centered
  // in its full-height panel and must not peek into the current Reel's viewport.
  expect((await panels.nth(1).boundingBox())!.y).toBeLessThan(viewport.height);
  expect((await stages.nth(1).boundingBox())!.y).toBeGreaterThanOrEqual(viewport.height);

  for (const id of [2, 3]) {
    await nextButton.click();
    await expect(page).toHaveURL(new RegExp(`/reels/${id}$`));
    await expect.poll(async () => (await panels.nth(id - 1).boundingBox())?.y).toBeCloseTo(16, -1);
    const current = (await stages.nth(id - 1).boundingBox())!;
    const following = (await stages.nth(id).boundingBox())!;
    expect(current.x).toBeGreaterThanOrEqual(dockedSidebarWidth);
    expect(current.y).toBeGreaterThanOrEqual(12);
    expect(current.y + current.height).toBeLessThanOrEqual(viewport.height - 12);
    expect(following.y).toBeGreaterThanOrEqual(viewport.height);
    // The action rail belongs beside the Reel, not on top of the navigation arrows.
    const rail = (await page.locator('.reels-view__action-rail--desktop').boundingBox())!;
    const arrows = (await page.locator('.reels-view__nav-controls').boundingBox())!;
    expect(rail.x, `Reel ${id}: action rail should follow stage ending at ${current.x + current.width}`).toBeGreaterThan(current.x + current.width);
    expect(rail.x + rail.width, `Reel ${id}: action rail must clear arrows starting at ${arrows.x}`).toBeLessThan(arrows.x);
    await nextButton.click({ trial: true });
    await page.waitForTimeout(480);
  }

  // Confirm the same two independent control lanes at the screenshot's
  // approximate desktop widths, not only at the 960px breakpoint edge.
  for (const width of [984, 1080]) {
    await page.setViewportSize({ width, height: viewport.height });
    for (const id of [2, 3]) {
      await page.goto(`/reels/${id}`);
      await expect(page).toHaveURL(new RegExp(`/reels/${id}$`));
      const stage = (await stages.nth(id - 1).boundingBox())!;
      const rail = (await page.locator('.reels-view__action-rail--desktop').boundingBox())!;
      const arrows = (await page.locator('.reels-view__nav-controls').boundingBox())!;
      expect(rail.x, `${width}px Reel ${id}: rail should clear video`).toBeGreaterThan(stage.x + stage.width);
      expect(rail.x + rail.width, `${width}px Reel ${id}: rail should clear arrows`).toBeLessThan(arrows.x);
      await nextButton.click({ trial: true });
    }
  }
});

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
        await page.mouse.move(viewport.width - 1, 0);
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
