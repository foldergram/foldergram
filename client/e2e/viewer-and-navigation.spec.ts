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

async function mockGallery(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript(value => {
    localStorage.setItem('foldergram-theme', value);
    localStorage.setItem('foldergram-locale', 'en');
  }, theme);
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.route('**/api/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    const paginated = { items: [panorama], page: 1, limit: 24, total: 1, hasMore: false };
    const scan = { isScanning: false, lastCompletedScan: { id: 1 } };
    const responses: Record<string, unknown> = {
      '/api/auth/status': {
        enabled: false, authenticated: false, role: 'anonymous', accessMode: 'public',
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
      '/api/folders': { items: [folder] },
      '/api/folders/panoramas/images': { ...paginated, folder },
      '/api/folders/panoramas/stories': {
        railKind: 'stories', railTitle: 'Stories', railDescription: '', railSingularLabel: 'Story',
        hasAvatarStory: false, avatarStoryId: null, items: [], highlights: []
      },
      '/api/feed': paginated,
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

async function expectReadableActiveNavigation(link: Locator) {
  const contrast = await link.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true })!;
    const luminance = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const rgba = context.getImageData(0, 0, 1, 1).data;
      const linear = Array.from(rgba).slice(0, 3).map(value => {
        const srgb = value / 255;
        return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const styles = getComputedStyle(element);
    const foreground = luminance(styles.color);
    const background = luminance(styles.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast, 'Active navigation text and icons need at least 4.5:1 contrast').toBeGreaterThanOrEqual(4.5);
}

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

    test('active main navigation and folder shortcuts are readable', async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('/');
      const sidebar = page.locator('.sidebar');
      await sidebar.hover();
      const activeMain = sidebar.locator('.sidebar__link.router-link-active');
      await expect(activeMain).toBeVisible();
      await expect(activeMain.locator('.sidebar__label')).toHaveCSS('opacity', '1');
      await expectReadableActiveNavigation(activeMain);
      await page.goto('/f/panoramas');
      await sidebar.hover();
      const activeFolder = sidebar.locator('.sidebar__folder.router-link-active');
      await expect(activeFolder).toBeVisible();
      await expect(activeFolder.locator('.sidebar__folder-copy')).toHaveCSS('opacity', '1');
      await expectReadableActiveNavigation(activeFolder);
    });
  });
}
