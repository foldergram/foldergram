import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { appConfig, repositoryRoot } from './config/env.js';
import { requireApiAuthentication, requireMediaAuthentication } from './middleware/auth-protection.js';
import { requireTrustedMutationRequest } from './middleware/csrf-protection.js';
import { compressTextResponses } from './middleware/response-compression.js';
import { blockPublicDemoMutations } from './middleware/public-demo-mode.js';
import { apiRouter } from './routes/api.js';
import { authService } from './services/auth-service.js';
import { lazyThumbnailsRouter, lazyPreviewsRouter } from './routes/lazy-derivatives.js';
import { createProtectedStaticOptions } from './utils/media-response.js';

export function applyApiNoStoreHeaders(response: Pick<express.Response, 'setHeader'>) {
  authService.setNoStoreHeaders(response as express.Response);
  if (authService.isEnabled()) {
    response.setHeader('Vary', 'Cookie');
  }
}

export function createApp() {
  const app = express();

  // Compression sits in front of everything: the JSON API, the app shell and the
  // Vite bundles all benefit, while media routes opt out by content type.
  app.use(compressTextResponses);
  app.use(express.json());

  if (appConfig.derivativeMode === 'lazy') {
    app.use('/thumbnails', requireMediaAuthentication, lazyThumbnailsRouter);
    app.use('/previews', requireMediaAuthentication, lazyPreviewsRouter);
  } else {
    app.use('/thumbnails', requireMediaAuthentication, express.static(appConfig.thumbnailsDir, createProtectedStaticOptions()));
    app.use('/previews', requireMediaAuthentication, express.static(appConfig.previewsDir, createProtectedStaticOptions()));
  }

  app.use('/api', (_request, response, next) => {
    applyApiNoStoreHeaders(response);
    next();
  });
  app.use('/api', blockPublicDemoMutations, requireTrustedMutationRequest, requireApiAuthentication, apiRouter);

  if (appConfig.nodeEnv === 'production') {
    const clientDist = path.join(repositoryRoot, 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      // Vite emits content-hashed filenames under /assets, so those can be cached
      // forever. index.html and the service worker must stay revalidated or a new
      // deploy would never reach an installed PWA.
      app.use(
        express.static(clientDist, {
          index: false,
          setHeaders(response, filePath) {
            if (filePath.includes(`${path.sep}assets${path.sep}`)) {
              response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
              return;
            }

            response.setHeader('Cache-Control', 'no-cache');
          }
        })
      );
      app.get(/^(?!\/api|\/thumbnails|\/previews).*/, (_request, response) => {
        response.setHeader('Cache-Control', 'no-cache');
        response.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const message = error instanceof Error ? error.message : 'Unexpected server error';
    response.status(400).json({ message });
  });

  return app;
}
