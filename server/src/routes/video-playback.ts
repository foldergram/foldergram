import type express from 'express';
import { z } from 'zod';

import { hlsCache } from '../services/hls-cache.js';
import { HLS_MANIFEST, HlsDeliveryError } from '../services/hls-encoder.js';
import {
  ensureVideoMetadata, getIndexedLocalVideo, originalVideoType, resolveCurrentVideoOriginal
} from '../services/local-video-source.js';
import type { ImageRecord } from '../types/models.js';
import { applyNoStoreMediaHeaders } from '../utils/media-response.js';

const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const requestSchema = z.object({
  at: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
  profile: z.enum(['standard', 'low']).default('standard'),
  warmup: z.literal(true).optional()
}).refine(body => !body.warmup || (body.at === 0 && body.profile === 'standard'), {
  message: 'Video warmup only supports the standard opening window.'
});
const consumers = new Map<string, { expires: number; count: number; warmups: number }>();

function allowStart(request: express.Request, warmup: boolean): boolean {
  const now = Date.now();
  const address = request.ip ?? request.socket.remoteAddress ?? 'unknown';
  let entry = consumers.get(address);
  if (!entry || entry.expires <= now) {
    for (const [key, value] of consumers) if (value.expires <= now) consumers.delete(key);
    if (consumers.size >= 512) return false;
    entry = { expires: now + 60_000, count: 0, warmups: 0 };
    consumers.set(address, entry);
  }
  if (entry.count >= 80 || (warmup && entry.warmups >= 8)) return false;
  entry.count++;
  if (warmup) entry.warmups++;
  return true;
}

function sendError(response: express.Response, error: unknown) {
  const status = error instanceof HlsDeliveryError ? error.status : 503;
  if (status === 503 || status === 507) response.setHeader('Retry-After', '1');
  response.status(status).json({
    message: error instanceof HlsDeliveryError ? error.message : 'Video playback is temporarily unavailable.'
  });
}

export function registerVideoPlaybackRoutes(
  router: express.Router,
  shareAllowed: (request: express.Request, response: express.Response, image: ImageRecord) => boolean
): void {
  for (const shared of [false, true]) {
    const base = shared ? '/share/images/:id/playback' : '/videos/:id/playback';
    const authorize = (request: express.Request, response: express.Response): ImageRecord | undefined => {
      applyNoStoreMediaHeaders(response);
      const image = getIndexedLocalVideo(idSchema.parse(request.params.id));
      if (!image || image.video_delivery_policy !== 'streaming') {
        response.status(404).json({ message: 'Local streaming video not found.' });
        return;
      }
      if (shared && !shareAllowed(request, response, image)) return;
      return image;
    };
    const mediaBase = (image: ImageRecord) => '/api' + base.replace(':id', String(image.id));

    router.get(base, async (request, response) => {
      const image = authorize(request, response);
      if (!image) return;
      try {
        const source = await resolveCurrentVideoOriginal(image);
        const metadata = await ensureVideoMetadata(image, source);
        const directType = originalVideoType(image, metadata);
        response.json({
          duration: (metadata.durationMs ?? 0) / 1000,
          bitrate: metadata.bitrate,
          width: metadata.displayWidth,
          height: metadata.displayHeight,
          warmupAvailable: hlsCache.hasWarmupCapacity(),
          original: directType ? { url: mediaBase(image) + '/original', type: directType } : null
        });
      } catch (error) {
        sendError(response, error);
      }
    });

    router.get(base + '/original', async (request, response) => {
      const image = authorize(request, response);
      if (!image) return;
      try {
        const contentType = originalVideoType(image)?.split(';')[0];
        if (!contentType) {
          response.status(415).json({ message: 'This original requires streaming conversion.' });
          return;
        }
        response.type(contentType).sendFile(await resolveCurrentVideoOriginal(image));
      } catch (error) {
        sendError(response, error);
      }
    });

    router.post(base + '/sessions', async (request, response) => {
      const image = authorize(request, response);
      if (!image) return;
      const body = requestSchema.parse(request.body);
      if (!allowStart(request, body.warmup ?? false)) {
        response.setHeader('Retry-After', '10');
        response.status(429).json({ message: 'Too many video conversions requested. Try again shortly.' });
        return;
      }
      const abort = new AbortController();
      response.on('close', () => { if (!response.writableFinished) abort.abort(); });
      try {
        const sourcePath = await resolveCurrentVideoOriginal(image);
        const metadata = await ensureVideoMetadata(image, sourcePath);
        const opened = await hlsCache.open({ image, sourcePath, metadata, ...body, signal: abort.signal });
        if (abort.signal.aborted) {
          hlsCache.release(opened.row.id, opened.lease);
          return;
        }
        if (body.warmup) {
          hlsCache.release(opened.row.id, opened.lease);
          response.json({ warmed: true });
          return;
        }
        const prefix = mediaBase(image) + '/sessions/' + opened.row.id + '/' + opened.lease;
        response.json({
          url: prefix + '/' + HLS_MANIFEST,
          type: 'application/vnd.apple.mpegurl',
          releaseUrl: prefix + '/release',
          offset: opened.offsetSeconds,
          duration: opened.durationSeconds,
          window: opened.windowSeconds,
          profile: opened.profile
        });
      } catch (error) {
        if (!abort.signal.aborted) sendError(response, error);
      }
    });

    router.post(base + '/sessions/:window/:lease/release', (request, response) => {
      const image = authorize(request, response);
      if (!image) return;
      hlsCache.releaseForImage(image.id, request.params.window as string, request.params.lease as string);
      response.status(204).end();
    });

    router.get(base + '/sessions/:window/:lease/:file', async (request, response) => {
      const image = authorize(request, response);
      if (!image) return;
      try {
        await resolveCurrentVideoOriginal(image);
      } catch (error) {
        sendError(response, error);
        return;
      }
      const { window, lease, file } = request.params as Record<string, string>;
      const acquired = hlsCache.acquireFile(image, window, lease, file);
      if (!acquired) {
        response.status(404).json({ message: 'Playback session expired or is unavailable.' });
        return;
      }
      response.once('close', acquired.end);
      response.type(file === HLS_MANIFEST ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
      response.sendFile(acquired.file, { lastModified: false, cacheControl: false }, error => {
        acquired.end();
        if (error && !response.headersSent && !response.destroyed) {
          response.status(404).json({ message: 'The requested playback segment is unavailable.' });
        }
      });
    });
  }
}
