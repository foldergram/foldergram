import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPreviewRelativePath, getThumbnailRelativePath } from '../src/utils/image-utils.js';
import {
  isSupportedMetadataExtension,
  parseMetadataContent,
  readCompanionMetadata
} from '../src/utils/metadata-file.js';

type AppConfigModule = typeof import('../src/config/env.js');
type ScannerServiceModule = typeof import('../src/services/scanner-service.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');

const generateThumbnailDerivativeMock = vi.fn();
const generateDerivativesMock = vi.fn();
const readMediaMetadataMock = vi.fn();

describe('metadata file utilities', () => {
  it('correctly identifies supported metadata extensions', () => {
    expect(isSupportedMetadataExtension('.txt')).toBe(true);
    expect(isSupportedMetadataExtension('.TXT')).toBe(true);
    expect(isSupportedMetadataExtension('.nfo')).toBe(true);
    expect(isSupportedMetadataExtension('.NFO')).toBe(true);
    expect(isSupportedMetadataExtension('.jpg')).toBe(false);
    expect(isSupportedMetadataExtension('.json')).toBe(false);
    expect(isSupportedMetadataExtension('.xml')).toBe(false);
  });

  it('parses structured key-value metadata content with title, description, and date', () => {
    const raw = [
      'title: Sunrise at the summit',
      'date: 2026-07-20T05:45:00Z',
      'description: An incredible hike up the mountain with breathtaking views.'
    ].join('\n');

    const result = parseMetadataContent(raw);
    expect(result.caption).toBe(
      'Sunrise at the summit\n\nAn incredible hike up the mountain with breathtaking views.'
    );
    expect(result.takenAt).toBe(Date.parse('2026-07-20T05:45:00Z'));
  });

  it('parses JSON format metadata', () => {
    const raw = JSON.stringify({
      title: 'City Sunset',
      description: 'Golden hour in downtown',
      date: '2026-08-15T19:00:00Z'
    });

    const result = parseMetadataContent(raw);
    expect(result.caption).toBe('City Sunset\n\nGolden hour in downtown');
    expect(result.takenAt).toBe(Date.parse('2026-08-15T19:00:00Z'));
  });

  it('parses NFO / XML format metadata', () => {
    const raw = `<?xml version="1.0" encoding="UTF-8"?>
<episodedetails>
  <title>Episode Title</title>
  <plot>Episode synopsis and details.</plot>
  <aired>2026-09-01</aired>
</episodedetails>`;

    const result = parseMetadataContent(raw);
    expect(result.caption).toBe('Episode Title\n\nEpisode synopsis and details.');
    expect(result.takenAt).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
  });

  it('parses real-world XML / NFO format with CDATA and XML entities', () => {
    const raw = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<episodedetails>
  <title><![CDATA[Ben & Jerry's Adventure]]></title>
  <plot><![CDATA[They found a "secret" cave &amp; explored it.]]></plot>
  <premiered>2026-04-12</premiered>
</episodedetails>`;

    const result = parseMetadataContent(raw);
    expect(result.title).toBe("Ben & Jerry's Adventure");
    expect(result.description).toBe('They found a "secret" cave & explored it.');
    expect(result.caption).toBe("Ben & Jerry's Adventure\n\nThey found a \"secret\" cave & explored it.");
    expect(result.takenAt).toBe(Date.parse('2026-04-12T00:00:00.000Z'));
  });

  it('parses real-world text-based NFO format with Plot and Air Date headers', () => {
    const raw = [
      'Title: Summer Road Trip',
      'Air Date: 2026-07-10',
      'Plot: Driving along the coast from dawn to dusk.'
    ].join('\n');

    const result = parseMetadataContent(raw);
    expect(result.title).toBe('Summer Road Trip');
    expect(result.description).toBe('Driving along the coast from dawn to dusk.');
    expect(result.caption).toBe('Summer Road Trip\n\nDriving along the coast from dawn to dusk.');
    expect(result.takenAt).toBe(Date.parse('2026-07-10T00:00:00.000Z'));
  });

  it('correctly handles ISO timestamps with timezone offsets and EXIF format dates', () => {
    // EXIF colon format: YYYY:MM:DD HH:MM:SS
    const exifDate = parseMetadataContent('date: 2026:06:01 18:30:00');
    expect(exifDate.takenAt).toBe(Date.parse('2026-06-01 18:30:00'));

    // ISO timestamp with timezone offset (+05:30)
    const offsetDate = parseMetadataContent('date: 2026-06-01T18:30:00+05:30');
    expect(offsetDate.takenAt).toBe(Date.parse('2026-06-01T18:30:00+05:30'));

    // Rejects invalid dates or out-of-range timestamps
    const outOfRange = parseMetadataContent('date: 999999999999999');
    expect(outOfRange.takenAt).toBeNull();

    const negativeEpoch = parseMetadataContent('date: -1000');
    expect(negativeEpoch.takenAt).toBeNull();
  });

  it('parses timestamps in unix epoch seconds and milliseconds', () => {
    const epochSec = parseMetadataContent('timestamp: 1770000000');
    expect(epochSec.takenAt).toBe(1770000000000);

    const epochMs = parseMetadataContent('date: 1770000000000');
    expect(epochMs.takenAt).toBe(1770000000000);
  });

  it('falls back to plain text description when no headers match', () => {
    const raw = 'Just a casual photo taken on a sunny afternoon in the park.';
    const result = parseMetadataContent(raw);
    expect(result.caption).toBe('Just a casual photo taken on a sunny afternoon in the park.');
    expect(result.takenAt).toBeNull();
  });

  it('returns empty result for empty or whitespace-only content', () => {
    expect(parseMetadataContent('')).toEqual({ title: null, description: null, caption: null, takenAt: null });
    expect(parseMetadataContent('   \n\t  \n  ')).toEqual({ title: null, description: null, caption: null, takenAt: null });
  });

  it('gracefully handles malformed JSON or dates without throwing', () => {
    const malformedJson = '{ "title": "Broken", "date": ';
    const result = parseMetadataContent(malformedJson);
    expect(result.caption).toBe(malformedJson.trim());
    expect(result.takenAt).toBeNull();

    const invalidDate = parseMetadataContent('date: not-a-real-date-string\ntitle: Safe');
    expect(invalidDate.caption).toBe('Safe');
    expect(invalidDate.takenAt).toBeNull();
  });

  it('enforces 64 KB file size limit in readCompanionMetadata', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'meta-size-test-'));
    const bigFile = path.join(tempDir, 'huge.txt');
    try {
      const hugeContent = 'A'.repeat(70 * 1024);
      await fs.writeFile(bigFile, hugeContent, 'utf8');
      const res = await readCompanionMetadata(bigFile);
      expect(res).toBeNull();
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});

describe.sequential('metadata file integration with scanner', () => {
  let tempRoot = '';
  let appConfig: AppConfigModule['appConfig'];
  let scannerService: ScannerServiceModule['scannerService'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let postRepository: RepositoriesModule['postRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-metadata-scan-'));

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
    ({ scannerService } = await import('../src/services/scanner-service.js'));
    ({ imageRepository, postRepository, maintenanceRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    readMediaMetadataMock.mockResolvedValue({
      width: 1920,
      height: 1080,
      takenAt: null,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: false
    });

    generateDerivativesMock.mockImplementation(async (_sourcePath: string, relativePath: string) => ({
      width: 1920,
      height: 1080,
      takenAt: null,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: false,
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, 'image'),
      generatedThumbnail: true,
      generatedPreview: true
    }));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  async function createSourceFile(relativePath: string, mtimeOffsetMs = 0): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `source:${relativePath}`);

    if (mtimeOffsetMs) {
      const now = new Date();
      now.setMilliseconds(now.getMilliseconds() - mtimeOffsetMs);
      await fs.utimes(absolutePath, now, now);
    }
  }

  async function createMetadataFile(relativePath: string, content: string): Promise<void> {
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content, 'utf8');
  }

  it('1. indexes media with a valid metadata file and populates caption and taken_at', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/photo-1.jpg');
    await createMetadataFile(
      'vacation/photo-1.txt',
      'title: Beach Sunset\ndate: 2026-06-01T18:30:00Z\ndescription: Watching the sun go down.'
    );

    await scannerService.scanAll('manual');

    const image = imageRepository.getByRelativePath('vacation/photo-1.jpg');
    expect(image).toBeDefined();
    expect(image?.caption).toBe('Beach Sunset\n\nWatching the sun go down.');
    expect(image?.taken_at).toBe(Date.parse('2026-06-01T18:30:00Z'));
    expect(image?.taken_at_source).toBe('metadata');
    expect(image?.sort_timestamp).toBe(Date.parse('2026-06-01T18:30:00Z'));

    const post = postRepository.findById(image!.id);
    expect(post).toBeDefined();
    expect(post?.caption).toBe('Beach Sunset\n\nWatching the sun go down.');
    expect(post?.taken_at).toBe(Date.parse('2026-06-01T18:30:00Z'));
    expect(post?.taken_at_source).toBe('metadata');
    expect(post?.sort_timestamp).toBe(Date.parse('2026-06-01T18:30:00Z'));
  });

  it('2. media without metadata file functions with existing fallbacks', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/no-meta.jpg');
    await scannerService.scanAll('manual');

    const image = imageRepository.getByRelativePath('vacation/no-meta.jpg');
    expect(image).toBeDefined();
    expect(image?.caption).toBeNull();
    expect(image?.taken_at_source).not.toBe('metadata');

    const post = postRepository.findById(image!.id);
    expect(post).toBeDefined();
    expect(post?.caption).toBeNull();
  });

  it('3. handles empty or whitespace-only metadata files gracefully', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/empty-meta.jpg');
    await createMetadataFile('vacation/empty-meta.txt', '   \n  \n');

    await scannerService.scanAll('manual');

    const image = imageRepository.getByRelativePath('vacation/empty-meta.jpg');
    expect(image).toBeDefined();
    expect(image?.caption).toBeNull();
    expect(image?.taken_at_source).not.toBe('metadata');
  });

  it('4. handles malformed metadata without scan failure', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/broken.jpg');
    await createMetadataFile('vacation/broken.txt', '{"bad json syntax: true, date: none');

    await scannerService.scanAll('manual');

    const image = imageRepository.getByRelativePath('vacation/broken.jpg');
    expect(image).toBeDefined();
    // Raw plain text is retained as fallback caption without crashing
    expect(image?.caption).toBe('{"bad json syntax: true, date: none');
    expect(image?.taken_at_source).not.toBe('metadata');
  });

  it('5. handles missing optional fields (title only, description only, date only)', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/title-only.jpg');
    await createMetadataFile('vacation/title-only.txt', 'title: Only Title');

    await createSourceFile('vacation/desc-only.jpg');
    await createMetadataFile('vacation/desc-only.txt', 'description: Only Description');

    await createSourceFile('vacation/date-only.jpg');
    await createMetadataFile('vacation/date-only.txt', 'date: 2026-05-15T12:00:00Z');

    await scannerService.scanAll('manual');

    const imgTitle = imageRepository.getByRelativePath('vacation/title-only.jpg');
    expect(imgTitle?.caption).toBe('Only Title');
    expect(imgTitle?.taken_at_source).not.toBe('metadata');

    const imgDesc = imageRepository.getByRelativePath('vacation/desc-only.jpg');
    expect(imgDesc?.caption).toBe('Only Description');
    expect(imgDesc?.taken_at_source).not.toBe('metadata');

    const imgDate = imageRepository.getByRelativePath('vacation/date-only.jpg');
    expect(imgDate?.caption).toBeNull();
    expect(imgDate?.taken_at).toBe(Date.parse('2026-05-15T12:00:00Z'));
    expect(imgDate?.taken_at_source).toBe('metadata');
  });

  it('6. pairs multiple media files with their respective metadata files independently', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/first.jpg');
    await createMetadataFile('vacation/first.txt', 'title: First Picture\ndate: 2026-01-01T10:00:00Z');

    await createSourceFile('vacation/second.jpg');
    await createMetadataFile('vacation/second.nfo', '<episodedetails><title>Second Picture</title><aired>2026-02-02</aired></episodedetails>');

    await scannerService.scanAll('manual');

    const first = imageRepository.getByRelativePath('vacation/first.jpg');
    const second = imageRepository.getByRelativePath('vacation/second.jpg');

    expect(first?.caption).toBe('First Picture');
    expect(first?.taken_at).toBe(Date.parse('2026-01-01T10:00:00Z'));

    expect(second?.caption).toBe('Second Picture');
    expect(second?.taken_at).toBe(Date.parse('2026-02-02T00:00:00.000Z'));
  });

  it('7. updates caption and date during rescanning when metadata file changes', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/rescan-item.jpg');
    await createMetadataFile('vacation/rescan-item.txt', 'title: Original Title\ndate: 2026-01-01T00:00:00Z');

    await scannerService.scanAll('manual');

    let image = imageRepository.getByRelativePath('vacation/rescan-item.jpg');
    expect(image?.caption).toBe('Original Title');
    expect(image?.taken_at).toBe(Date.parse('2026-01-01T00:00:00Z'));

    // Update metadata file
    await createMetadataFile('vacation/rescan-item.txt', 'title: Updated Title\ndate: 2026-02-01T00:00:00Z');

    await scannerService.scanAll('manual');

    image = imageRepository.getByRelativePath('vacation/rescan-item.jpg');
    expect(image?.caption).toBe('Updated Title');
    expect(image?.taken_at).toBe(Date.parse('2026-02-01T00:00:00Z'));

    const post = postRepository.findById(image!.id);
    expect(post?.caption).toBe('Updated Title');
    expect(post?.taken_at).toBe(Date.parse('2026-02-01T00:00:00Z'));
  });

  it('8. prevents metadata files (.txt, .nfo) from being indexed as media posts', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/item.jpg');
    await createMetadataFile('vacation/item.txt', 'title: Item Caption');
    await createMetadataFile('vacation/standalone.txt', 'just some notes');
    await createMetadataFile('vacation/info.nfo', '<info></info>');

    await scannerService.scanAll('manual');

    const txtImage = imageRepository.getByRelativePath('vacation/item.txt');
    const standaloneTxt = imageRepository.getByRelativePath('vacation/standalone.txt');
    const nfoImage = imageRepository.getByRelativePath('vacation/info.nfo');

    expect(txtImage).toBeUndefined();
    expect(standaloneTxt).toBeUndefined();
    expect(nfoImage).toBeUndefined();

    // Exactly 1 media post should exist
    expect(postRepository.countFeed()).toBe(1);
    const itemImage = imageRepository.getByRelativePath('vacation/item.jpg');
    expect(itemImage).toBeDefined();
    expect(itemImage?.filename).toBe('item.jpg');
  });

  it('9. preserves existing behavior when EXIF data is present on media without metadata file', async () => {
    maintenanceRepository.resetLibraryIndex();

    const exifTimestamp = Date.parse('2025-12-25T15:30:00Z');
    readMediaMetadataMock.mockResolvedValueOnce({
      width: 1920,
      height: 1080,
      takenAt: exifTimestamp,
      durationMs: null,
      mediaType: 'image',
      playbackStrategy: 'preview',
      isAnimated: false
    });

    await createSourceFile('vacation/exif-photo.jpg');
    await scannerService.scanAll('manual');

    const image = imageRepository.getByRelativePath('vacation/exif-photo.jpg');
    expect(image).toBeDefined();
    expect(image?.caption).toBeNull();
    expect(image?.taken_at).toBe(exifTimestamp);
    expect(image?.taken_at_source).toBe('exif');
  });

  it('10. propagates metadata to carousel posts', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/carousels/my-trip/01-start.jpg');
    await createSourceFile('vacation/carousels/my-trip/02-end.jpg');
    await createMetadataFile(
      'vacation/carousels/my-trip/my-trip.txt',
      'title: Road Trip Highlights\ndate: 2026-07-04T12:00:00Z'
    );

    await scannerService.scanAll('manual');

    const posts = postRepository.listFeed(1, 20);
    const carouselPost = posts.find((p) => p.postType === 'carousel');
    expect(carouselPost).toBeDefined();
    expect(carouselPost?.caption).toBe('Road Trip Highlights');
    expect(carouselPost?.takenAt).toBe(Date.parse('2026-07-04T12:00:00Z'));

    const storedPost = postRepository.findById(carouselPost!.id);
    expect(storedPost?.taken_at_source).toBe('metadata');
  });

  it('11. carousel-level metadata coexists cleanly with slide-level metadata without conflict', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/carousels/mountains/01-base.jpg');
    await createMetadataFile('vacation/carousels/mountains/01-base.txt', 'title: Base Camp');

    await createSourceFile('vacation/carousels/mountains/02-peak.jpg');
    await createMetadataFile('vacation/carousels/mountains/02-peak.txt', 'title: Mountain Peak');

    await createMetadataFile(
      'vacation/carousels/mountains/mountains.txt',
      'title: Mountain Expedition\ndate: 2026-08-01T08:00:00Z'
    );

    await scannerService.scanAll('manual');

    // 1. Carousel post should have top-level carousel metadata
    const posts = postRepository.listFeed(1, 20);
    const carouselPost = posts.find((p) => p.postType === 'carousel');
    expect(carouselPost).toBeDefined();
    expect(carouselPost?.caption).toBe('Mountain Expedition');
    expect(carouselPost?.takenAt).toBe(Date.parse('2026-08-01T08:00:00Z'));

    // 2. Individual slide images retain their own slide-level captions
    const slide1 = imageRepository.getByRelativePath('vacation/carousels/mountains/01-base.jpg');
    const slide2 = imageRepository.getByRelativePath('vacation/carousels/mountains/02-peak.jpg');
    expect(slide1?.caption).toBe('Base Camp');
    expect(slide2?.caption).toBe('Mountain Peak');
  });

  it('12. preserves manually edited captions in DB across rescans when media has no metadata file', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/manual-edit.jpg');
    await scannerService.scanAll('manual');

    let image = imageRepository.getByRelativePath('vacation/manual-edit.jpg');
    expect(image).toBeDefined();
    expect(image?.caption).toBeNull();

    // User manually sets caption via UI/repository
    imageRepository.updateCaption(image!.id, 'User Hand-Crafted Caption');

    image = imageRepository.getByRelativePath('vacation/manual-edit.jpg');
    expect(image?.caption).toBe('User Hand-Crafted Caption');

    // Rescan library without adding any metadata file
    await scannerService.scanAll('manual');

    image = imageRepository.getByRelativePath('vacation/manual-edit.jpg');
    expect(image?.caption).toBe('User Hand-Crafted Caption');

    const post = postRepository.findById(image!.id);
    expect(post?.caption).toBe('User Hand-Crafted Caption');
  });

  it('13. handles metadata file removal and resets caption and timestamp to fallbacks', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/removable.jpg');
    await createMetadataFile(
      'vacation/removable.txt',
      'title: Temporary Title\ndate: 2026-06-01T12:00:00Z'
    );

    await scannerService.scanAll('manual');

    let image = imageRepository.getByRelativePath('vacation/removable.jpg');
    expect(image?.caption).toBe('Temporary Title');
    expect(image?.taken_at_source).toBe('metadata');

    let post = postRepository.findById(image!.id);
    expect(post?.caption).toBe('Temporary Title');
    expect(post?.taken_at_source).toBe('metadata');

    // Remove the companion metadata file from disk
    const metaPath = path.join(appConfig.galleryRoot, 'vacation/removable.txt');
    await fs.rm(metaPath, { force: true });

    await scannerService.scanAll('manual');

    image = imageRepository.getByRelativePath('vacation/removable.jpg');
    expect(image?.caption).toBeNull();
    expect(image?.taken_at_source).not.toBe('metadata');

    post = postRepository.findById(image!.id);
    expect(post?.caption).toBeNull();
    expect(post?.taken_at_source).not.toBe('metadata');
  });

  it('14. preserves manual UI edits when companion file exists unless companion file is modified', async () => {
    maintenanceRepository.resetLibraryIndex();

    await createSourceFile('vacation/protected.jpg');
    await createMetadataFile('vacation/protected.txt', 'title: Initial File Caption');

    await scannerService.scanAll('manual');

    let image = imageRepository.getByRelativePath('vacation/protected.jpg');
    expect(image?.caption).toBe('Initial File Caption');

    // User updates caption in UI after initial scan
    await new Promise((resolve) => setTimeout(resolve, 50));
    imageRepository.updateCaption(image!.id, 'Manually Edited In UI');

    image = imageRepository.getByRelativePath('vacation/protected.jpg');
    expect(image?.caption).toBe('Manually Edited In UI');

    // Add another file in the folder to trigger folder scan without touching protected.txt
    await createSourceFile('vacation/other.jpg');
    await scannerService.scanAll('manual');

    // Caption should remain the UI edit
    image = imageRepository.getByRelativePath('vacation/protected.jpg');
    expect(image?.caption).toBe('Manually Edited In UI');
    let post = postRepository.findById(image!.id);
    expect(post?.caption).toBe('Manually Edited In UI');

    // Now user explicitly updates the companion file on disk
    await new Promise((resolve) => setTimeout(resolve, 50));
    await createMetadataFile('vacation/protected.txt', 'title: Newly Updated File Caption');

    await scannerService.scanAll('manual');

    // Now that the file was modified after the UI edit, the new file content applies
    image = imageRepository.getByRelativePath('vacation/protected.jpg');
    expect(image?.caption).toBe('Newly Updated File Caption');
    post = postRepository.findById(image!.id);
    expect(post?.caption).toBe('Newly Updated File Caption');
  });
});
