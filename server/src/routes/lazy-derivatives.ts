import fs from 'node:fs/promises';

import express from 'express';
import pLimit from 'p-limit';

import { appConfig } from '../config/env.js';
import { imageRepository } from '../db/repositories.js';
import { log } from '../services/log-service.js';
import { generatePreviewDerivative, generateThumbnailDerivative } from '../services/derivative-service.js';
import { scannerService } from '../services/scanner-service.js';
import { resolveOriginalPath } from '../utils/media-paths.js';
import { applyDerivativeErrorHeaders, applyProtectedMediaHeaders } from '../utils/media-response.js';
import { normalizePath, safeJoin } from '../utils/path-utils.js';

// In-memory map to deduplicate concurrent generation requests for the same derivative path.
const inflightGenerations = new Map<string, Promise<void>>();
const generationLimit = pLimit(appConfig.scanDerivativeConcurrency);

type SendDerivativeResult = 'sent' | 'aborted';

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

function isConnectionTerminationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = 'code' in error ? error.code : null;
  return code === 'ECONNABORTED' || code === 'ECONNRESET' || code === 'ERR_STREAM_PREMATURE_CLOSE';
}

function sendDerivativeFile(response: express.Response, absolutePath: string): Promise<SendDerivativeResult> {
  applyProtectedMediaHeaders(response);

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

  // Fast path: file already exists and is non-empty.
  try {
    const stat = await fs.stat(absoluteOutputPath);
    if (stat.size === 0) throw new Error('empty');
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

  if (await scannerService.isLibraryRebuildRequired()) {
    applyDerivativeErrorHeaders(response);
    response.status(409).json({ message: 'Library rebuild required before generating derivatives.' });
    return;
  }

  // Look up the source row by derivative path.
  const imageRecord =
    kind === 'thumbnail'
      ? await imageRepository.getByThumbnailPath(requestedPath)
      : await imageRepository.getByPreviewPath(requestedPath);

  if (!imageRecord) {
    applyDerivativeErrorHeaders(response);
    response.status(404).json({ message: 'Derivative not found.' });
    return;
  }

  // Video previews are never served — always redirect to the original file.
  if (kind === 'preview' && imageRecord.media_type === 'video') {
    response.redirect(302, `/api/originals/${imageRecord.id}`);
    return;
  }

  let generationPromise = inflightGenerations.get(absoluteOutputPath);

  if (!generationPromise) {
    log.info('Lazy derivative generate', {
      kind,
      file: requestedPath,
      source: imageRecord.relative_path
    });

    generationPromise = generationLimit(async () => {
      try {
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
      } finally {
        inflightGenerations.delete(absoluteOutputPath);
      }
    });

    inflightGenerations.set(absoluteOutputPath, generationPromise);
  }

  const queuedGeneration = generationPromise;
  if (!queuedGeneration) {
    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message: 'Failed to queue derivative generation.' });
    return;
  }

  try {
    await queuedGeneration;
  } catch (error) {
    if (response.headersSent) {
      return;
    }

    const message = error instanceof Error ? error.message : 'Failed to generate derivative.';
    applyDerivativeErrorHeaders(response);
    response.status(500).json({ message });
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

const lazyThumbnailsRouter = express.Router();
const lazyPreviewsRouter = express.Router();

lazyThumbnailsRouter.get('/*path', async (request, response) => {
  await serveOrGenerate(request, response, appConfig.thumbnailsDir, 'thumbnail');
});

lazyPreviewsRouter.get('/*path', async (request, response) => {
  await serveOrGenerate(request, response, appConfig.previewsDir, 'preview');
});

export { lazyThumbnailsRouter, lazyPreviewsRouter };
