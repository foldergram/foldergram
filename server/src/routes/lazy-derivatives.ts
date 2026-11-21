import path from 'node:path';

import express from 'express';

import { appConfig } from '../config/env.js';
import { imageRepository } from '../db/repositories.js';
import type { ImageRecord } from '../types/models.js';
import { log } from '../services/log-service.js';
import { generatePreviewDerivative, generateThumbnailDerivative } from '../services/derivative-service.js';
import { scannerService } from '../services/scanner-service.js';
import { authService } from '../services/auth-service.js';
import { galleryService } from '../services/gallery-service.js';
import { indexedHeicSource } from '../services/heic/indexed-source.js';
import { derivativeWorkLimit, HeicError } from '../services/heic/service.js';
import { isHeicImage } from '../utils/image-utils.js';
import { MaintenancePausedError, maintenanceOperationLock } from '../services/maintenance-operation-lock.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import { isImmichSource, isLocalOriginalUnavailable, isSourceVisible } from '../sources/local-source.js';
import {
  applyDerivativeErrorHeaders,
  applyNoStoreMediaHeaders,
  applyOriginalMediaHeaders,
  applyProtectedMediaHeaders
} from '../utils/media-response.js';
import { isNonemptyDerivative } from '../utils/derivative-cache.js';
import { safeJoin } from '../utils/path-utils.js';
import { resolveVideoPlaybackSource } from '../utils/video-playback-policy.js';

// In-memory map to deduplicate concurrent generation requests for the same derivative path.
const inflightGenerations = new Map<string, Promise<void>>();


type SendDerivativeResult = 'sent' | 'aborted';

class DerivativeRecordNotFoundError extends Error {}

function getRequestedPath(request: express.Request): string | null {
  const rawPath = request.params.path;
  const relativePath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath ?? '';
  // Express has already decoded the route parameters. Accept only canonical
  // relative paths so the same path is used for the lookup and the file read.
  if (relativePath.includes('\\') || relativePath.includes('\0') ||
      relativePath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
    return null;
  }
  return relativePath;
}

function resolveDerivativePath(rootDir: string, requestedPath: string): string | null {
  try {
    return safeJoin(rootDir, requestedPath);
  } catch {
    return null;
  }
}

function findCurrentImageRecord(
  requestedPath: string,
  kind: 'thumbnail' | 'preview',
  expectedImageId?: number,
  allowTrashed = false
): ImageRecord | null {
  const imageRecord = kind === 'thumbnail'
    ? imageRepository.getByThumbnailPath(requestedPath)
    : imageRepository.getByPreviewPath(requestedPath);
  if (!imageRecord || (expectedImageId !== undefined && imageRecord.id !== expectedImageId)) {
    return null;
  }
  if (isImmichSource(imageRecord.source_id) || !isSourceVisible(imageRecord.source_id)) return null;
  if (isHeicImage(imageRecord) && (imageRecord.is_deleted || (imageRecord.is_trashed && !allowTrashed))) return null;
  return imageRecord;
}

function sendLocalSourceUnavailable(response: express.Response): void {
  applyDerivativeErrorHeaders(response);
  response.status(503).json({ message: 'The local source is unavailable. Check its drive or mount.' });
}

function sendDerivativeNotFound(response: express.Response): void {
  applyDerivativeErrorHeaders(response);
  response.status(404).json({ message: 'Derivative not found.' });
}

function isEligibleNormalVideo(imageRecord: ImageRecord): boolean {
  if (imageRecord.is_deleted || imageRecord.is_trashed) {
    return false;
  }

  return resolveVideoPlaybackSource({
    mediaType: imageRecord.media_type,
    extension: imageRecord.extension || path.extname(imageRecord.relative_path),
    fileSize: imageRecord.file_size,
    width: imageRecord.width,
    height: imageRecord.height,
    playbackStrategy: imageRecord.playback_strategy
  }) === 'original';
}

function resolveEligibleOriginalPath(imageRecord: ImageRecord): string | null {
  if (!isEligibleNormalVideo(imageRecord)) {
    return null;
  }

  return galleryService.getOriginalMediaFile(imageRecord.id)?.path ?? null;
}

function queueLazyGeneration(
  absoluteOutputPath: string,
  requestedPath: string,
  kind: 'thumbnail' | 'preview',
  initialImage: ImageRecord,
  allowTrashed = false
): Promise<void> {
  const expectedImageId = initialImage.id;
  const isHeic = isHeicImage(initialImage);
  const key = JSON.stringify([absoluteOutputPath, expectedImageId, initialImage.checksum_or_fingerprint, allowTrashed]);
  const existingGeneration = inflightGenerations.get(key);
  if (existingGeneration) return existingGeneration;

  const generate = async () => {
    const imageRecord = findCurrentImageRecord(requestedPath, kind, expectedImageId, allowTrashed);
    if (!imageRecord) throw new DerivativeRecordNotFoundError('Derivative no longer has an indexed image record');

    // A scan or rebuild may have generated the file while this request waited
    // for the maintenance lock.
    if (await isNonemptyDerivative(absoluteOutputPath)) return;

    log.info('Lazy derivative generate', {
      kind,
      file: requestedPath,
      source: imageRecord.relative_path
    });

    const sourcePath = resolveOriginalPath(imageRecord.relative_path, imageRecord.source_id);
    const heicOptions = isHeic ? { heicSource: indexedHeicSource(imageRecord, sourcePath, { allowTrashed }), heicForeground: true } : {};
    if (kind === 'thumbnail') {
      await generateThumbnailDerivative(sourcePath, imageRecord.relative_path, false, {
        thumbnailPath: imageRecord.thumbnail_path,
        ...heicOptions
      });
      return;
    }

    await generatePreviewDerivative(sourcePath, imageRecord.relative_path, false, {
      previewPath: imageRecord.preview_path,
      ...heicOptions
    });
  };
  // HEIC jobs use the shared derivative budget from inside their bounded
  // queue. They recheck the indexed source before publishing.
  const generationWork = isHeic ? generate() : maintenanceOperationLock.runExclusive(() => derivativeWorkLimit(generate));
  let trackedGeneration: Promise<void>;
  trackedGeneration = generationWork.finally(() => {
    if (inflightGenerations.get(key) === trackedGeneration) {
      inflightGenerations.delete(key);
    }
  });
  inflightGenerations.set(key, trackedGeneration);
  return trackedGeneration;
}

function sendHeicGenerationError(error: unknown, response: express.Response): boolean {
  if (!(error instanceof HeicError)) return false;
  applyDerivativeErrorHeaders(response);
  if (error.kind === 'busy' || error.kind === 'stale') {
    response.setHeader('Retry-After', '2');
    response.status(503).json({ message: 'HEIC processing is temporarily unavailable. Try again shortly.' });
  } else if (error.kind === 'media') {
    response.status(422).json({ message: error.message });
  } else {
    response.status(500).json({ message: 'Failed to generate HEIC derivative.' });
  }
  return true;
}

function isConnectionTerminationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? error.code : null;
  return code === 'ECONNABORTED' || code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE';
}

function sendDerivativeFile(
  response: express.Response,
  absolutePath: string,
  options?: { noStore?: boolean; original?: boolean }
): Promise<SendDerivativeResult> {
  if (options?.noStore) {
    applyNoStoreMediaHeaders(response);
  } else if (options?.original) {
    applyOriginalMediaHeaders(response);
  } else {
    applyProtectedMediaHeaders(response);
  }

  return new Promise((resolve, reject) => {
    response.sendFile(absolutePath, (error) => {
      if (error) {
        if (response.headersSent || isConnectionTerminationError(error)) {
          resolve('aborted');
          return;
        }

        if ('status' in error && error.status === 416) {
          applyDerivativeErrorHeaders(response);
          response.status(416).end();
          resolve('sent');
          return;
        }

        reject(error);
        return;
      }

      resolve('sent');
    });
  });
}

async function serveOrGenerate(
  request: express.Request,
  response: express.Response,
  rootDir: string,
  kind: 'thumbnail' | 'preview',
  generateMissing: boolean
): Promise<void> {
  const requestedPath = getRequestedPath(request);
  if (!requestedPath) {
    applyDerivativeErrorHeaders(response);
    response.status(400).json({ message: 'Invalid derivative path.' });
    return;
  }

  const absoluteOutputPath = resolveDerivativePath(rootDir, requestedPath);
  if (!absoluteOutputPath) {
    applyDerivativeErrorHeaders(response);
    response.status(400).json({ message: 'Invalid derivative path.' });
    return;
  }

  const allowTrashed = kind === 'thumbnail' && authService.hasCapability(request, 'canDeleteMedia');
  const initialImageRecord = findCurrentImageRecord(requestedPath, kind, undefined, allowTrashed);
  if (!initialImageRecord) {
    sendDerivativeNotFound(response);
    return;
  }

  if (kind === 'preview' && initialImageRecord.media_type === 'video') {
    const originalPath = resolveEligibleOriginalPath(initialImageRecord);
    if (originalPath) {
      try {
        await sendDerivativeFile(response, originalPath, { original: true });
      } catch {
        if (!response.headersSent) {
          applyDerivativeErrorHeaders(response);
          response.status(500).json({ message: 'Failed to serve derivative.' });
        }
      }
      return;
    }
  }

  // Fast path: reuse only a nonempty cached derivative.
  if (await isNonemptyDerivative(absoluteOutputPath)) {
    if (!findCurrentImageRecord(requestedPath, kind, initialImageRecord.id, allowTrashed)) {
      sendDerivativeNotFound(response);
      return;
    }
    try {
      const result = await sendDerivativeFile(response, absoluteOutputPath);
      if (result === 'aborted') {
        return;
      }
    } catch {
      if (response.headersSent) {
        return;
      }

      applyDerivativeErrorHeaders(response);
      response.status(500).json({ message: 'Failed to serve derivative.' });
    }
    return;
  }

  if (isLocalOriginalUnavailable(initialImageRecord.source_id)) {
    sendLocalSourceUnavailable(response);
    return;
  }

  if ((!generateMissing && !isHeicImage(initialImageRecord)) || (kind === 'preview' && isEligibleNormalVideo(initialImageRecord))) {
    sendDerivativeNotFound(response);
    return;
  }

  if (scannerService.isLibraryRebuildRequired(initialImageRecord.source_id)) {
    applyDerivativeErrorHeaders(response);
    response.status(409).json({ message: 'Library rebuild required before generating derivatives.' });
    return;
  }

  const queuedGeneration = queueLazyGeneration(
    absoluteOutputPath, requestedPath, kind, initialImageRecord, allowTrashed && Boolean(initialImageRecord.is_trashed)
  );

  try {
    await queuedGeneration;
  } catch (error) {
    if (response.headersSent) {
      return;
    }
    if (error instanceof MaintenancePausedError) {
      applyDerivativeErrorHeaders(response);
      response.setHeader('Retry-After', '2');
      response.status(503).json({ message: 'Scan paused. Try again shortly.' });
      return;
    }

    if (error instanceof DerivativeRecordNotFoundError) {
      sendDerivativeNotFound(response);
      return;
    }
    if (isLocalOriginalUnavailable(initialImageRecord.source_id)) {
      sendLocalSourceUnavailable(response);
      return;
    }
    if (sendHeicGenerationError(error, response)) return;
    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message: 'Failed to generate derivative.' });
    return;
  }

  if (!findCurrentImageRecord(requestedPath, kind, initialImageRecord.id, allowTrashed)) {
    sendDerivativeNotFound(response);
    return;
  }

  try {
    const result = await sendDerivativeFile(response, absoluteOutputPath);
    if (result === 'aborted') {
      return;
    }
  } catch {
    if (response.headersSent) {
      return;
    }

    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message: 'Failed to serve derivative.' });
  }
}

export async function serveDerivativeForImage(
  response: express.Response,
  imageRecord: ImageRecord,
  kind: 'thumbnail' | 'preview',
  options?: { noStore?: boolean }
): Promise<void> {
  const requestedPath = kind === 'thumbnail' ? imageRecord.thumbnail_path : imageRecord.preview_path;
  const rootDir = kind === 'thumbnail' ? appConfig.thumbnailsDir : appConfig.previewsDir;
  const absoluteOutputPath = resolveDerivativePath(rootDir, requestedPath);
  if (!absoluteOutputPath) {
    applyDerivativeErrorHeaders(response);
    response.status(400).json({ message: 'Invalid derivative path.' });
    return;
  }

  const initialImageRecord = findCurrentImageRecord(requestedPath, kind, imageRecord.id);
  if (!initialImageRecord) {
    sendDerivativeNotFound(response);
    return;
  }

  if (await isNonemptyDerivative(absoluteOutputPath)) {
    try {
      const result = await sendDerivativeFile(response, absoluteOutputPath, options);
      if (result === 'aborted') {
        return;
      }
    } catch {
      if (response.headersSent) {
        return;
      }

      applyDerivativeErrorHeaders(response);
      response.status(500).json({ message: 'Failed to serve derivative.' });
    }
    return;
  }

  // Missing or empty derivatives fall through to generation.
  if (isLocalOriginalUnavailable(initialImageRecord.source_id)) {
    sendLocalSourceUnavailable(response);
    return;
  }

  if (scannerService.isLibraryRebuildRequired(initialImageRecord.source_id)) {
    applyDerivativeErrorHeaders(response);
    response.status(409).json({ message: 'Library rebuild required before generating derivatives.' });
    return;
  }

  const generationPromise = queueLazyGeneration(absoluteOutputPath, requestedPath, kind, initialImageRecord);

  try {
    await generationPromise;
  } catch (error) {
    if (response.headersSent) {
      return;
    }

    if (error instanceof DerivativeRecordNotFoundError) {
      sendDerivativeNotFound(response);
      return;
    }
    if (isLocalOriginalUnavailable(initialImageRecord.source_id)) {
      sendLocalSourceUnavailable(response);
      return;
    }
    if (sendHeicGenerationError(error, response)) return;
    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message: 'Failed to generate derivative.' });
    return;
  }

  if (!findCurrentImageRecord(requestedPath, kind, initialImageRecord.id)) {
    sendDerivativeNotFound(response);
    return;
  }

  try {
    const result = await sendDerivativeFile(response, absoluteOutputPath, options);
    if (result === 'aborted') {
      return;
    }
  } catch {
    if (response.headersSent) {
      return;
    }

    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message: 'Failed to serve derivative.' });
  }
}

function createDerivativeRouter(kind: 'thumbnail' | 'preview', generateMissing: boolean) {
  const router = express.Router();
  const rootDir = kind === 'thumbnail' ? appConfig.thumbnailsDir : appConfig.previewsDir;

  router.get('/*path', (request, response) =>
    serveOrGenerate(request, response, rootDir, kind, generateMissing)
  );

  return router;
}

export const lazyThumbnailsRouter = createDerivativeRouter('thumbnail', true);
export const lazyPreviewsRouter = createDerivativeRouter('preview', true);
export const cachedThumbnailsRouter = createDerivativeRouter('thumbnail', false);
export const cachedPreviewsRouter = createDerivativeRouter('preview', false);
