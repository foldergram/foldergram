import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getMediaTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type AppConfigModule = typeof import('../src/config/env.js');
type AppSettingKeysModule = typeof import('../src/constants/app-setting-keys.js');
type GalleryServiceModule = typeof import('../src/services/gallery-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe.sequential('stories feature', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let galleryService: GalleryServiceModule['galleryService'];
  let scannerService: ScannerServiceModule['scannerService'];
  let appSettingsRepository: RepositoriesModule['appSettingsRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];
  let STORIES_MIGRATION_DECISION_SETTING_KEY: AppSettingKeysModule['STORIES_MIGRATION_DECISION_SETTING_KEY'];
  let TREAT_STORIES_AS_FOLDERS_SETTING_KEY: AppSettingKeysModule['TREAT_STORIES_AS_FOLDERS_SETTING_KEY'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-stories-feature-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    generateThumbnailDerivativeMock.mockReset();
    generateDerivativesMock.mockReset();
    readMediaMetadataMock.mockReset();

    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    vi.doMock('../src/services/derivative-service.js', () => ({
      generateDerivatives: generateDerivativesMock,
      generateThumbnailDerivative: generateThumbnailDerivativeMock,
      readMediaMetadata: readMediaMetadataMock
    }));

    ({ appConfig } = await import('../src/config/env.js'));
    ({ galleryService } = await import('../src/services/gallery-service.js'));
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({appSettingsRepository, maintenanceRepository} = await import('../src/db/repositories.js'));
    await (await import('../src/db/repositories.js')).initRepositories();
    ({ STORIES_MIGRATION_DECISION_SETTING_KEY, TREAT_STORIES_AS_FOLDERS_SETTING_KEY } = await import(
      '../src/constants/app-setting-keys.js'
    ));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockImplementation(async (absolutePath: string) => {
      const extension = path.extname(absolutePath).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);

      return {
        width: mediaType === 'video' ? 1080 : 1440,
        height: mediaType === 'video' ? 1920 : 960,
        takenAt: null,
        durationMs: mediaType === 'video' ? 4_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false
      };
    });

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string) => {
      const extension = path.extname(relativePath).toLowerCase();
      const mediaType = getMediaTypeFromExtension(extension);

      return {
        width: mediaType === 'video' ? 1080 : 1440,
        height: mediaType === 'video' ? 1920 : 960,
        takenAt: null,
        durationMs: mediaType === 'video' ? 4_000 : null,
        mediaType,
        playbackStrategy: 'preview',
        isAnimated: false,
        thumbnailPath: getThumbnailRelativePath(relativePath),
        previewPath: getPreviewRelativePath(relativePath, mediaType),
        generatedThumbnail: true,
        generatedPreview: true
      };
    });

    await maintenanceRepository.resetLibraryIndex();
    await appSettingsRepository.remove(TREAT_STORIES_AS_FOLDERS_SETTING_KEY);
    await appSettingsRepository.remove(STORIES_MIGRATION_DECISION_SETTING_KEY);
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('keeps reserved stories hidden from normal surfaces and exposes them through folder story rails', async () => {
    await createSourceFile('albums/beach/photo-main.jpg', 8_000);
    await createSourceFile('albums/beach/stories/avatar-1.jpg', 6_000);
    await createSourceFile('albums/beach/stories/avatar-2.mp4', 5_000);
    await createSourceFile('albums/beach/stories/highlights/day-1.jpg', 4_000);
    await createSourceFile('albums/beach/stories/highlights/deeper/day-2.jpg', 3_000);

    await scannerService.scanAll('manual');

    const folders = await galleryService.listFolders();
    expect(folders).toHaveLength(1);
    expect(folders[0]?.folderPath).toBe('albums/beach');
    expect(folders[0]?.hasAvatarStory).toBe(true);

    const folder = folders[0]!;
    expect((await galleryService.getFeed(1, 20, 'recent')).total).toBe(1);
    expect((await galleryService.searchMedia('avatar', 1, 20)).total).toBe(0);
    expect((await galleryService.searchMedia('day-1', 1, 20)).total).toBe(0);

    const stories = await galleryService.getFolderStories(folder.slug);
    expect(stories).not.toBeNull();
    expect(stories?.hasAvatarStory).toBe(true);
    expect(stories?.avatarStoryId).toBeTruthy();
    expect(stories?.items).toHaveLength(2);
    expect(stories?.highlights).toHaveLength(1);
    expect(stories?.items[0]?.presentation).toBe('avatar');
    expect(stories?.highlights[0]?.presentation).toBe('highlight');
    expect(stories?.items.every((capsule) => typeof capsule.latestActivityTimestamp === 'number')).toBe(true);
    expect(typeof stories?.highlights[0]?.latestActivityTimestamp).toBe('number');

    const avatarFeed = await galleryService.getFolderStoryFeed(folder.slug, stories!.avatarStoryId!, 1, 20);
    expect(avatarFeed).not.toBeNull();
    expect(avatarFeed?.story.presentation).toBe('avatar');
    expect(typeof avatarFeed?.story.latestActivityTimestamp).toBe('number');
    expect(avatarFeed?.items.map((item) => item.mediaType)).toEqual(['video', 'image']);
    expect(avatarFeed?.items.every((item) => item.folderSlug === folder.slug)).toBe(true);
    expect(avatarFeed?.items.every((item) => item.folderPath === folder.folderPath)).toBe(true);

    const highlightFeed = await galleryService.getFolderStoryFeed(folder.slug, stories!.highlights[0]!.id, 1, 20);
    expect(highlightFeed).not.toBeNull();
    expect(highlightFeed?.story.presentation).toBe('highlight');
    expect(typeof highlightFeed?.story.latestActivityTimestamp).toBe('number');
    expect(highlightFeed?.total).toBe(2);
    expect(highlightFeed?.items.every((item) => item.folderSlug === folder.slug)).toBe(true);

    expect((await galleryService.getStatus()).storiesMigration).toEqual({
      hasLegacyStoriesCandidates: true,
      decisionPending: true
    });
  });

  it('restores legacy stories folders when the setting is enabled before scanning', async () => {
    await galleryService.setTreatStoriesAsFolders(true);

    await createSourceFile('albums/beach/photo-main.jpg', 8_000);
    await createSourceFile('albums/beach/stories/avatar-1.jpg', 6_000);
    await createSourceFile('albums/beach/stories/highlights/day-1.jpg', 4_000);

    await scannerService.scanAll('manual');

    const folders = (await galleryService.listFolders())
      .map((folder) => folder.folderPath)
      .sort();

    expect(folders).toEqual([
      'albums/beach',
      'albums/beach/stories',
      'albums/beach/stories/highlights'
    ]);

    const ownerFolder = (await galleryService.listFolders()).find((folder) => folder.folderPath === 'albums/beach');
    expect(ownerFolder).toBeDefined();
    expect(ownerFolder?.hasAvatarStory).toBe(false);
    expect(await galleryService.getFolderStories(ownerFolder!.slug)).toEqual({
      railKind: 'stories',
      railTitle: 'Stories',
      railDescription: `Stories and highlights for ${ownerFolder!.name}.`,
      railSingularLabel: 'Story',
      hasAvatarStory: false,
      avatarStoryId: null,
      items: [],
      highlights: []
    });

    expect((await galleryService.searchMedia('avatar', 1, 20)).total).toBe(1);
    expect((await galleryService.getStatus()).preferences.treatStoriesAsFolders).toBe(true);
    expect((await galleryService.getStatus()).storiesMigration).toEqual({
      hasLegacyStoriesCandidates: true,
      decisionPending: false
    });
  });

  it('uses the latest nested highlight media as the avatar story when the root stories folder has no direct media', async () => {
    await createSourceFile('albums/beach/photo-main.jpg', 20_000);
    await createSourceFile('albums/beach/stories/city/city-01.jpg', 12_000);
    await createSourceFile('albums/beach/stories/city/city-02.jpg', 11_000);
    await createSourceFile('albums/beach/stories/city/city-03.jpg', 10_000);
    await createSourceFile('albums/beach/stories/city/city-04.jpg', 9_000);
    await createSourceFile('albums/beach/stories/city/city-05.jpg', 8_000);
    await createSourceFile('albums/beach/stories/city/city-06.jpg', 7_000);
    await createSourceFile('albums/beach/stories/food/food-07.jpg', 6_000);
    await createSourceFile('albums/beach/stories/food/food-08.jpg', 5_000);
    await createSourceFile('albums/beach/stories/food/food-09.jpg', 4_000);
    await createSourceFile('albums/beach/stories/food/food-10.jpg', 3_000);
    await createSourceFile('albums/beach/stories/food/food-11.jpg', 2_000);
    await createSourceFile('albums/beach/stories/food/food-12.mp4', 1_000);

    await scannerService.scanAll('manual');

    const folder = (await galleryService.listFolders())[0]!;
    expect(folder.hasAvatarStory).toBe(true);
    const stories = await galleryService.getFolderStories(folder.slug);
    expect(stories).not.toBeNull();
    expect(stories?.hasAvatarStory).toBe(true);
    expect(stories?.avatarStoryId).toBeTruthy();
    expect(stories?.items).toHaveLength(3);
    expect(stories?.highlights).toHaveLength(2);
    expect(stories?.items[0]?.id).toBe(stories?.avatarStoryId);
    expect(stories?.items[0]?.presentation).toBe('avatar');
    expect(stories?.items[0]?.imageCount).toBe(10);

    const avatarFeed = await galleryService.getFolderStoryFeed(folder.slug, stories!.avatarStoryId!, 1, 20);
    expect(avatarFeed).not.toBeNull();
    expect(avatarFeed?.story.presentation).toBe('avatar');
    expect(avatarFeed?.total).toBe(10);
    expect(avatarFeed?.hasMore).toBe(false);
    expect(avatarFeed?.items.map((item) => item.filename)).toEqual([
      'food-12.mp4',
      'food-11.jpg',
      'food-10.jpg',
      'food-09.jpg',
      'food-08.jpg',
      'food-07.jpg',
      'city-06.jpg',
      'city-05.jpg',
      'city-04.jpg',
      'city-03.jpg'
    ]);
    expect(avatarFeed?.items.every((item) => item.folderSlug === folder.slug)).toBe(true);
    expect(avatarFeed?.items.every((item) => item.folderPath === folder.folderPath)).toBe(true);
  });

  async function createSourceFile(relativePath: string, mtimeOffsetMs = 0): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);

    if (mtimeOffsetMs > 0) {
      const now = new Date();
      now.setMilliseconds(now.getMilliseconds() - mtimeOffsetMs);
      await fs.utimes(absolutePath, now, now);
    }
  }
});
