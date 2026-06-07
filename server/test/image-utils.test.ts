import { describe, expect, it } from 'vitest';

import {
  createFingerprint,
  getDerivativeRelativePath,
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getStableSortTimestamp,
  getThumbnailRelativePath,
  isSupportedImageFile,
  isSupportedMediaFile,
  isSupportedVideoFile
} from '../src/utils/image-utils.js';
import {
  getPathBreadcrumb,
  getRelativePathWithinRoot,
  getSourceFolderPathFromRelativePath,
  isSameOrWithinPath,
  matchesRelativeRoot,
  normalizePath
} from '../src/utils/path-utils.js';
import { resolveUniqueSlug, slugifyFolderName, slugifyFolderPath } from '../src/utils/slug.js';

describe('scanner utilities', () => {
  it('creates stable normalized fingerprints', async () => {
    expect(createFingerprint('cats\\sunrise.jpg', 1200, 100.2)).toBe('cats/sunrise.jpg:1200:100');
  });

  it('generates mirrored webp derivative paths', async () => {
    expect(getDerivativeRelativePath('folder-one/post-1.jpeg')).toBe('folder-one/post-1.webp');
  });

  it('generates separate thumbnail and preview paths for videos', async () => {
    expect(getThumbnailRelativePath('folder-one/reel-1.mov')).toBe('folder-one/reel-1.webp');
    expect(getPreviewRelativePath('folder-one/reel-1.mov', 'video')).toBe('folder-one/reel-1.mp4');
  });

  it('detects supported video media files', async () => {
    expect(isSupportedVideoFile('clip.mp4')).toBe(true);
    expect(isSupportedMediaFile('clip.webm')).toBe(true);
    expect(getMediaTypeFromExtension('.mov')).toBe('video');
  });

  it('detects supported AVIF image files', async () => {
    expect(isSupportedImageFile('poster.avif')).toBe(true);
    expect(isSupportedMediaFile('poster.avif')).toBe(true);
    expect(getMediaTypeFromExtension('.avif')).toBe('image');
  });

  it('preserves existing sort timestamps before mtime fallback', async () => {
    expect(getStableSortTimestamp({ sortTimestamp: 45, firstSeenAt: '2026-03-01T00:00:00.000Z' }, 900)).toBe(45);
    expect(getStableSortTimestamp({ firstSeenAt: '2026-03-01T00:00:00.000Z' }, 900)).toBe(Date.parse('2026-03-01T00:00:00.000Z'));
    expect(getStableSortTimestamp(null, 900.8)).toBe(901);
  });
});

describe('folder slug resolution', () => {
  it('slugifies folder names safely', async () => {
    expect(slugifyFolderName('Summer Trips 2026')).toBe('summer-trips-2026');
    expect(slugifyFolderName('***')).toBe('folder');
  });

  it('slugifies full source folder paths safely', async () => {
    expect(slugifyFolderPath('galaxy/S24/Downloads')).toBe('galaxy-s24-downloads');
    expect(slugifyFolderPath('summer\\2026\\Camera Roll')).toBe('summer-2026-camera-roll');
  });

  it('resolves duplicate slugs with numeric suffixes', async () => {
    const existing = new Set<string>();
    expect(resolveUniqueSlug('Weekend', existing)).toBe('weekend');
    expect(resolveUniqueSlug('Weekend', existing)).toBe('weekend-2');
  });
});

describe('path normalization', () => {
  it('normalizes windows separators for mirrored storage', async () => {
    expect(normalizePath('alpha\\beta\\photo.png')).toBe('alpha/beta/photo.png');
  });

  it('resolves deep source folders from file paths', async () => {
    expect(getSourceFolderPathFromRelativePath('galaxy/S24/Downloads/photo.png')).toBe('galaxy/S24/Downloads');
    expect(getSourceFolderPathFromRelativePath('photo.png')).toBeNull();
  });

  it('builds breadcrumb text from relative folder paths', async () => {
    expect(getPathBreadcrumb('galaxy/S24/Downloads')).toBe('galaxy / S24');
    expect(getPathBreadcrumb('Downloads')).toBeNull();
  });

  it('resolves nested managed paths under a configured root', async () => {
    expect(getRelativePathWithinRoot('/gallery', '/gallery/thumbnails')).toBe('thumbnails');
    expect(getRelativePathWithinRoot('/gallery', '/gallery/cache/previews')).toBe('cache/previews');
    expect(getRelativePathWithinRoot('/gallery', '/outside/previews')).toBeNull();
  });

  it('detects overlapping managed directories', async () => {
    expect(isSameOrWithinPath('/gallery/cache', '/gallery/cache/previews')).toBe(true);
    expect(isSameOrWithinPath('/gallery/cache', '/gallery/cache')).toBe(true);
    expect(isSameOrWithinPath('/gallery/cache', '/gallery/previews')).toBe(false);
  });

  it('matches ignored relative roots for managed output folders', async () => {
    expect(matchesRelativeRoot('thumbnails/folder-a/post.webp', ['thumbnails', 'previews'])).toBe(true);
    expect(matchesRelativeRoot('previews/folder-a/post.webp', ['thumbnails', 'previews'])).toBe(true);
    expect(matchesRelativeRoot('folder-a/post.webp', ['thumbnails', 'previews'])).toBe(false);
  });
});
