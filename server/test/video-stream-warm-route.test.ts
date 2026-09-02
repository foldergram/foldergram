import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFingerprint,
  getMediaTypeFromExtension,
  getMimeTypeFromExtension,
  getPreviewRelativePath,
  getThumbnailRelativePath
} from '../src/utils/image-utils.js';

type EnvModule = typeof import('../src/config/env.js');
type RepositoriesModule = typeof import('../src/db/repositories.js');
type VideoStreamRouterModule = typeof import('../src/routes/video-stream.js');
type ModelsModule = typeof import('../src/types/models.js');

type FolderRecord = ModelsModule['FolderRecord'];

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: express.RequestHandler }>;
  };
}

const getSegmentMock = vi.fn(async () => Buffer.from('segment'));

describe.sequential('HLS segment warm-up route', () => {
  let tempRoot = '';
  let appConfig: EnvModule['appConfig'];
  let videoStreamRouter: VideoStreamRouterModule['videoStreamRouter'];
  let folderRepository: RepositoriesModule['folderRepository'];
  let imageRepository: RepositoriesModule['imageRepository'];
  let maintenanceRepository: RepositoriesModule['maintenanceRepository'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-video-warm-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    getSegmentMock.mockClear();

    // Stubbing the encoder keeps the route contract under test without ffmpeg.
    vi.doMock('../src/services/video-stream-service.js', async () => {
      const actual = await vi.importActual<typeof import('../src/services/video-stream-service.js')>(
        '../src/services/video-stream-service.js'
      );

      return { ...actual, getSegment: getSegmentMock, getSourceVideoCodec: async () => 'h264' };
    });

    ({ appConfig } = await import('../src/config/env.js'));
    ({ videoStreamRouter } = await import('../src/routes/video-stream.js'));
    ({ folderRepository, imageRepository, maintenanceRepository } = await import('../src/db/repositories.js'));

    await Promise.all([
      fs.mkdir(appConfig.galleryRoot, { recursive: true }),
      fs.mkdir(appConfig.dbDir, { recursive: true }),
      fs.mkdir(appConfig.thumbnailsDir, { recursive: true }),
      fs.mkdir(appConfig.previewsDir, { recursive: true })
    ]);

    maintenanceRepository.resetLibraryIndex();
  });

  afterAll(async () => {
    vi.doUnmock('../src/services/video-stream-service.js');
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('accepts the request immediately and transcodes the leading segments in the background', async () => {
    const folder = folderRepository.upsert({ slug: 'clips', name: 'Clips', folderPath: 'clips' });
    const video = await createIndexedVideo(folder, 'clip.mp4', 4_000, 30_000);
    const handler = getRouteHandler('/:id/hls/:quality/warm');
    const response = createResponse();

    handler(
      {
        params: { id: String(video.id), quality: '720p' },
        query: { segments: '2' }
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    // The response must not wait on ffmpeg, otherwise the stall just moves here.
    expect(response.status).toHaveBeenCalledWith(202);
    expect(response.json).toHaveBeenCalledWith({ warming: 2 });

    await vi.waitFor(() => expect(getSegmentMock).toHaveBeenCalledTimes(2));
    expect(getSegmentMock.mock.calls.map(([input]: any[]) => input.index)).toEqual([0, 1]);
    expect((getSegmentMock.mock.calls[0]?.[0] as any).quality).toBe('720p');
  });

  it('warms the segments around a resume position instead of the head of the clip', async () => {
    const folder = folderRepository.upsert({ slug: 'resume', name: 'Resume', folderPath: 'resume' });
    const video = await createIndexedVideo(folder, 'resume.mp4', 7_000, 60_000);
    const handler = getRouteHandler('/:id/hls/:quality/warm');
    const response = createResponse();

    // 10s sits inside segment 5 with a 2 second target duration, which is where a
    // handover from the feed lands.
    handler(
      {
        params: { id: String(video.id), quality: '720p' },
        query: { segments: '3', from: '10' }
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.json).toHaveBeenCalledWith({ warming: 3 });
    await vi.waitFor(() => expect(getSegmentMock).toHaveBeenCalledTimes(3));
    expect(getSegmentMock.mock.calls.map(([input]: any[]) => input.index)).toEqual([5, 6, 7]);
  });

  it('clamps a resume position past the end of the clip to the last segment', async () => {
    const folder = folderRepository.upsert({ slug: 'clamp', name: 'Clamp', folderPath: 'clamp' });
    const video = await createIndexedVideo(folder, 'clamp.mp4', 8_000, 9_000);
    const handler = getRouteHandler('/:id/hls/:quality/warm');
    const response = createResponse();

    handler(
      {
        params: { id: String(video.id), quality: '720p' },
        query: { segments: '2', from: '900' }
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.json).toHaveBeenCalledWith({ warming: 1 });
    await vi.waitFor(() => expect(getSegmentMock).toHaveBeenCalledTimes(1));
    expect(getSegmentMock.mock.calls.map(([input]: any[]) => input.index)).toEqual([4]);
  });

  it('never warms more segments than the clip actually has', async () => {
    const folder = folderRepository.upsert({ slug: 'short', name: 'Short', folderPath: 'short' });
    const video = await createIndexedVideo(folder, 'short.mp4', 5_000, 3_000);
    const handler = getRouteHandler('/:id/hls/:quality/warm');
    const response = createResponse();

    handler(
      {
        params: { id: String(video.id), quality: '720p' },
        query: { segments: '4' }
      } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    // A 3 second clip only has two 2-second segments to warm.
    expect(response.json).toHaveBeenCalledWith({ warming: 2 });
    await vi.waitFor(() => expect(getSegmentMock).toHaveBeenCalledTimes(2));
  });

  it('rejects unknown qualities and unknown videos without transcoding anything', async () => {
    const handler = getRouteHandler('/:id/hls/:quality/warm');

    const badQuality = createResponse();
    handler(
      { params: { id: '1', quality: '4320p' }, query: {} } as unknown as express.Request,
      badQuality as unknown as express.Response,
      vi.fn()
    );
    expect(badQuality.status).toHaveBeenCalledWith(404);

    const missingVideo = createResponse();
    handler(
      { params: { id: '987654', quality: '720p' }, query: {} } as unknown as express.Request,
      missingVideo as unknown as express.Response,
      vi.fn()
    );
    expect(missingVideo.status).toHaveBeenCalledWith(404);

    expect(getSegmentMock).not.toHaveBeenCalled();
  });

  it('refuses to warm a clip whose duration is unknown', async () => {
    const folder = folderRepository.upsert({ slug: 'unknown', name: 'Unknown', folderPath: 'unknown' });
    const video = await createIndexedVideo(folder, 'unknown.mp4', 6_000, null);
    const handler = getRouteHandler('/:id/hls/:quality/warm');
    const response = createResponse();

    handler(
      { params: { id: String(video.id), quality: '720p' }, query: {} } as unknown as express.Request,
      response as unknown as express.Response,
      vi.fn()
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(getSegmentMock).not.toHaveBeenCalled();
  });

  function createResponse(): MockResponse {
    const response: MockResponse = {
      status: vi.fn(() => response),
      json: vi.fn(() => response)
    };

    return response;
  }

  function getRouteHandler(routePath: string): express.RequestHandler {
    const routerLayers = (videoStreamRouter as unknown as { stack: RouteLayer[] }).stack;
    const layer = routerLayers.find((entry) => entry.route?.path === routePath && entry.route.methods.post);

    if (!layer?.route) {
      throw new Error(`Route POST ${routePath} was not found`);
    }

    return layer.route.stack.at(-1)!.handle;
  }

  async function createIndexedVideo(
    folder: FolderRecord,
    filename: string,
    mtimeMs: number,
    durationMs: number | null
  ) {
    const relativePath = `${folder.folder_path}/${filename}`;
    const absolutePath = path.join(appConfig.galleryRoot, relativePath);
    const extension = path.extname(filename).toLowerCase();
    const mediaType = getMediaTypeFromExtension(extension);
    const fileSize = 4_096 + mtimeMs;

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `video:${filename}`);

    return imageRepository.upsert({
      folderId: folder.id,
      filename,
      extension,
      relativePath,
      absolutePath,
      fileSize,
      width: 1920,
      height: 1080,
      mediaType,
      mimeType: getMimeTypeFromExtension(extension),
      durationMs,
      fingerprint: createFingerprint(relativePath, fileSize, mtimeMs),
      mtimeMs,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      sortTimestamp: mtimeMs,
      takenAt: mtimeMs,
      takenAtSource: 'mtime',
      exifJson: null,
      thumbnailPath: getThumbnailRelativePath(relativePath),
      previewPath: getPreviewRelativePath(relativePath, mediaType),
      playbackStrategy: 'original'
    });
  }
});
