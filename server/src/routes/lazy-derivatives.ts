import fs from 'node:fs/promises';

import express from 'express';
import pLimit from 'p-limit';

import { appConfig } from '../config/env.js';
import { imageRepository } from '../db/repositories.js';
import type { ImageRecord } from '../types/models.js';
import { log } from '../services/log-service.js';
import { generatePreviewDerivative, generateThumbnailDerivative } from '../services/derivative-service.js';
import { scannerService } from '../services/scanner-service.js';
import { maintenanceOperationLock } from '../services/maintenance-operation-lock.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import { applyDerivativeErrorHeaders, applyNoStoreMediaHeaders, applyProtectedMediaHeaders } from '../utils/media-response.js';
import { normalizePath, safeJoin } from '../utils/path-utils.js';

// In-memory map to deduplicate concurrent generation requests for the same derivative path.
const inflightGenerations = new Map<string, Promise<void>>();
const generationLimit = pLimit(appConfig.scanDerivativeConcurrency);

type SendDerivativeResult = 'sent' | 'aborted';

class DerivativeRecordNotFoundError extends Error {}

function getRequestedPath(request: express.Request): string | null {
  const rawPath = request.params.path;
  const relativePath = Array.isArray(rawPath) ? rawPath.join('/') : rawPath ?? '';
  const normalizedPath = normalizePath(relativePath).replace(/^\/+/, '');

  return normalizedPath.length > 0 ? normalizedPath : null;
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
  expectedImageId?: number
): ImageRecord | null {
  const imageRecord = kind === 'thumbnail'
    ? imageRepository.getByThumbnailPath(requestedPath)
    : imageRepository.getByPreviewPath(requestedPath);
  if (!imageRecord || (expectedImageId !== undefined && imageRecord.id !== expectedImageId)) {
    return null;
  }
  return imageRecord;
}

function sendDerivativeNotFound(response: express.Response): void {
  applyDerivativeErrorHeaders(response);
  response.status(404).json({ message: 'Derivative not found.' });
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function queueLazyGeneration(
  absoluteOutputPath: string,
  requestedPath: string,
  kind: 'thumbnail' | 'preview',
  expectedImageId: number
): Promise<void> {
  const existingGeneration = inflightGenerations.get(absoluteOutputPath);
  if (existingGeneration) return existingGeneration;

  const generationWork = generationLimit(() => maintenanceOperationLock.runExclusive(async () => {
    const imageRecord = findCurrentImageRecord(requestedPath, kind, expectedImageId);
    if (!imageRecord) throw new DerivativeRecordNotFoundError('Derivative no longer has an indexed image record');

    // A scan or rebuild may have generated the file while this request waited
    // for the maintenance lock.
    if (await pathExists(absoluteOutputPath)) return;

    log.info('Lazy derivative generate', {
      kind,
      file: requestedPath,
      source: imageRecord.relative_path
    });

    const sourcePath = resolveOriginalPath(imageRecord.relative_path);
    if (kind === 'thumbnail') {
      await generateThumbnailDerivative(sourcePath, imageRecord.relative_path, false, {
        thumbnailPath: imageRecord.thumbnail_path
      });
      return;
    }

    await generatePreviewDerivative(sourcePath, imageRecord.relative_path, false, {
      previewPath: imageRecord.preview_path
    });
  }));
  let trackedGeneration: Promise<void>;
  trackedGeneration = generationWork.finally(() => {
    if (inflightGenerations.get(absoluteOutputPath) === trackedGeneration) {
      inflightGenerations.delete(absoluteOutputPath);
    }
  });
  inflightGenerations.set(absoluteOutputPath, trackedGeneration);
  return trackedGeneration;
}

async function retireRecordWhenOriginalIsGone(requestedPath: string, kind: 'thumbnail' | 'preview'): Promise<boolean> {
  const imageRecord = findCurrentImageRecord(requestedPath, kind);
  if (!imageRecord) {
    return false;
  }

  let sourcePath: string;
  try {
    sourcePath = resolveOriginalPath(imageRecord.relative_path);
  } catch {
    imageRepository.markDeleted(imageRecord.relative_path);
    return true;
  }

  if (await pathExists(sourcePath)) {
    return false;
  }

  // Generation can never succeed without the original, so retiring the row here
  // stops the feed from handing out the same broken card on every reload.
  imageRepository.markDeleted(imageRecord.relative_path);
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
  options?: { noStore?: boolean }
): Promise<SendDerivativeResult> {
  if (options?.noStore) {
    applyNoStoreMediaHeaders(response);
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
  kind: 'thumbnail' | 'preview'
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

  const initialImageRecord = findCurrentImageRecord(requestedPath, kind);
  if (!initialImageRecord) {
    sendDerivativeNotFound(response);
    return;
  }

  // Fast path: file already exists.
  try {
    await fs.access(absoluteOutputPath);
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
  } catch {
    // File does not exist — fall through to generation.
  }

  if (scannerService.isLibraryRebuildRequired()) {
    applyDerivativeErrorHeaders(response);
    response.status(409).json({ message: 'Library rebuild required before generating derivatives.' });
    return;
  }

  const queuedGeneration = queueLazyGeneration(
    absoluteOutputPath,
    requestedPath,
    kind,
    initialImageRecord.id
  );

  try {
    await queuedGeneration;
  } catch (error) {
    if (response.headersSent) {
      return;
    }

    if (error instanceof DerivativeRecordNotFoundError) {
      sendDerivativeNotFound(response);
      return;
    }

    if (await retireRecordWhenOriginalIsGone(requestedPath, kind)) {
      sendDerivativeNotFound(response);
      return;
    }

    const message = error instanceof Error ? error.message : 'Failed to generate derivative.';
    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message });
    return;
  }

  if (!findCurrentImageRecord(requestedPath, kind, initialImageRecord.id)) {
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

  try {
    await fs.access(absoluteOutputPath);
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
  } catch {
    // File does not exist — fall through to generation.
  }

  if (scannerService.isLibraryRebuildRequired()) {
    applyDerivativeErrorHeaders(response);
    response.status(409).json({ message: 'Library rebuild required before generating derivatives.' });
    return;
  }

  const generationPromise = queueLazyGeneration(
    absoluteOutputPath,
    requestedPath,
    kind,
    initialImageRecord.id
  );

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

    if (await retireRecordWhenOriginalIsGone(requestedPath, kind)) {
      sendDerivativeNotFound(response);
      return;
    }

    const message = error instanceof Error ? error.message : 'Failed to generate derivative.';
    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message });
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

const lazyThumbnailsRouter = express.Router();
const lazyPreviewsRouter = express.Router();

lazyThumbnailsRouter.get('/*path', async (request, response) => {
  await serveOrGenerate(request, response, appConfig.thumbnailsDir, 'thumbnail');
});

lazyPreviewsRouter.get('/*path', async (request, response) => {
  await serveOrGenerate(request, response, appConfig.previewsDir, 'preview');
});

export { lazyThumbnailsRouter, lazyPreviewsRouter };
