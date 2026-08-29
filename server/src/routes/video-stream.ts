import express from 'express';
import { z } from 'zod';

import { imageRepository } from '../db/repositories.js';
import { scannerService } from '../services/scanner-service.js';
import { storageService } from '../services/storage-service.js';
import {
  HLS_SEGMENT_SECONDS,
  buildMasterPlaylist,
  buildMediaPlaylist,
  getSegment,
  getSegmentCount,
  getSourceVideoCodec,
  isStreamQuality,
  resolveOfferedQualities
} from '../services/video-stream-service.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import { applyProtectedMediaHeaders } from '../utils/media-response.js';

const videoStreamRouter = express.Router();

const imageIdParamSchema = z.object({
  id: z.coerce.number().int().positive()
});

const segmentParamSchema = imageIdParamSchema.extend({
  quality: z.string(),
  index: z.coerce.number().int().min(0)
});

const warmQuerySchema = z.object({
  segments: z.coerce.number().int().min(1).max(4).default(2),
  /** Playback position in seconds the viewer is about to seek to. */
  from: z.coerce.number().min(0).default(0)
});

interface StreamableVideo {
  id: number;
  sourcePath: string;
  width: number;
  height: number;
  durationMs: number | null;
}

function resolveStreamableVideo(id: number): StreamableVideo | null {
  if (!storageService.getState().libraryAvailable || scannerService.isLibraryRebuildRequired()) {
    return null;
  }

  const record = imageRepository.getById(id);
  if (!record || record.is_deleted || record.is_trashed || record.media_type !== 'video') {
    return null;
  }

  let sourcePath: string;
  try {
    sourcePath = resolveOriginalPath(record.relative_path);
  } catch {
    return null;
  }

  return {
    id: record.id,
    sourcePath,
    width: record.width,
    height: record.height,
    durationMs: record.duration_ms
  };
}

function sendPlaylist(response: express.Response, body: string): void {
  // Playlists are derived purely from indexed metadata, so they are cheap to
  // regenerate but must not be cached as long as the segments themselves.
  response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  response.setHeader('Cache-Control', 'private, max-age=60');
  response.send(body);
}

videoStreamRouter.get('/:id/hls/master.m3u8', (request, response) => {
  const params = imageIdParamSchema.parse(request.params);
  const video = resolveStreamableVideo(params.id);

  if (!video) {
    response.status(404).json({ message: 'Video not found' });
    return;
  }

  if (getSegmentCount(video.durationMs) === 0) {
    response.status(409).json({ message: 'Video duration is unknown, streaming is unavailable.' });
    return;
  }

  sendPlaylist(
    response,
    buildMasterPlaylist(video.id, video.width, video.height, resolveOfferedQualities(video.width, video.height))
  );
});

videoStreamRouter.get('/:id/hls/:quality/index.m3u8', (request, response) => {
  const params = segmentParamSchema.omit({ index: true }).parse(request.params);

  if (!isStreamQuality(params.quality)) {
    response.status(404).json({ message: 'Unknown stream quality' });
    return;
  }

  const video = resolveStreamableVideo(params.id);
  if (!video) {
    response.status(404).json({ message: 'Video not found' });
    return;
  }

  if (getSegmentCount(video.durationMs) === 0) {
    response.status(409).json({ message: 'Video duration is unknown, streaming is unavailable.' });
    return;
  }

  sendPlaylist(response, buildMediaPlaylist(video.durationMs));
});

videoStreamRouter.get('/:id/hls/:quality/segment-:index.ts', async (request, response) => {
  const params = segmentParamSchema.parse(request.params);

  if (!isStreamQuality(params.quality)) {
    response.status(404).json({ message: 'Unknown stream quality' });
    return;
  }

  const video = resolveStreamableVideo(params.id);
  if (!video) {
    response.status(404).json({ message: 'Video not found' });
    return;
  }

  if (params.index >= getSegmentCount(video.durationMs)) {
    response.status(404).json({ message: 'Segment out of range' });
    return;
  }

  try {
    const payload = await getSegment({
      imageId: video.id,
      sourcePath: video.sourcePath,
      sourceCodec: await getSourceVideoCodec(video.sourcePath),
      durationMs: video.durationMs,
      width: video.width,
      height: video.height,
      quality: params.quality,
      index: params.index
    });

    applyProtectedMediaHeaders(response);
    response.setHeader('Content-Type', 'video/mp2t');
    response.setHeader('Content-Length', String(payload.byteLength));
    response.end(payload);
  } catch (error) {
    if (response.headersSent) {
      response.end();
      return;
    }

    response.setHeader('Cache-Control', 'no-store');
    response.status(500).json({
      message: error instanceof Error ? error.message : 'Failed to produce video segment.'
    });
  }
});

/**
 * Fire-and-forget segment warm-up. The reels deck calls this for the clip the user
 * is about to swipe to, so the first segments are already transcoded and cached by
 * the time the player asks for them. The response returns immediately: waiting
 * here would just move the stall from the player to this request.
 */
videoStreamRouter.post('/:id/hls/:quality/warm', (request, response) => {
  const params = segmentParamSchema.omit({ index: true }).parse(request.params);

  if (!isStreamQuality(params.quality)) {
    response.status(404).json({ message: 'Unknown stream quality' });
    return;
  }

  // Captured before the async closure so the narrowed type survives.
  const quality = params.quality;

  const video = resolveStreamableVideo(params.id);
  if (!video) {
    response.status(404).json({ message: 'Video not found' });
    return;
  }

  const segmentCount = getSegmentCount(video.durationMs);
  if (segmentCount === 0) {
    response.status(409).json({ message: 'Video duration is unknown, streaming is unavailable.' });
    return;
  }

  const warmQuery = warmQuerySchema.parse(request.query);
  // Handing a clip over from another surface resumes mid-file, so warm the segment
  // that holds that position rather than always the head of the playlist.
  const firstIndex = Math.min(
    Math.max(0, Math.floor(warmQuery.from / HLS_SEGMENT_SECONDS)),
    segmentCount - 1
  );
  const indexes = Array.from(
    { length: Math.min(warmQuery.segments, segmentCount - firstIndex) },
    (_, offset) => firstIndex + offset
  );

  void (async () => {
    for (const index of indexes) {
      try {
        await getSegment({
          imageId: video.id,
          sourcePath: video.sourcePath,
          sourceCodec: await getSourceVideoCodec(video.sourcePath),
          durationMs: video.durationMs,
          width: video.width,
          height: video.height,
          quality,
          index
        });
      } catch {
        // A warm-up failure is not user visible; the player will retry the segment.
        return;
      }
    }
  })();

  response.status(202).json({ warming: indexes.length });
});

export { videoStreamRouter };
