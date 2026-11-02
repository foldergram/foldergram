import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { appConfig, repositoryRoot } from './config/env.js';
import { requireApiAuthentication, requireMediaAuthentication } from './middleware/auth-protection.js';
import { requireTrustedMutationRequest } from './middleware/csrf-protection.js';
import { blockPublicDemoMutations } from './middleware/public-demo-mode.js';
import { routeTimingMiddleware } from './middleware/route-timing.js';
import { apiRouter } from './routes/api.js';
import { authService } from './services/auth-service.js';
import { lazyThumbnailsRouter, lazyPreviewsRouter, previewOriginalResolutionRouter } from './routes/lazy-derivatives.js';
import { createProtectedStaticOptions } from './utils/media-response.js';

export function applyApiNoStoreHeaders(response: Pick<express.Response, 'setHeader'>) {
  authService.setNoStoreHeaders(response as express.Response);
  if (authService.isEnabled()) {
    response.setHeader('Vary', 'Cookie');
  }
}

export function createApp() {
  const app = express();

  app.use(express.json());

  if (appConfig.derivativeMode === 'lazy') {
    app.use('/thumbnails', requireMediaAuthentication, lazyThumbnailsRouter);
    app.use('/previews', requireMediaAuthentication, lazyPreviewsRouter);
  } else {
    app.use('/thumbnails', requireMediaAuthentication, express.static(appConfig.thumbnailsDir, createProtectedStaticOptions()));
    app.use('/previews', requireMediaAuthentication, previewOriginalResolutionRouter, express.static(appConfig.previewsDir, createProtectedStaticOptions()));
  }

  app.use('/api', routeTimingMiddleware, (_request, response, next) => {
    applyApiNoStoreHeaders(response);
    next();
  });
  app.use('/api', blockPublicDemoMutations, requireTrustedMutationRequest, requireApiAuthentication, apiRouter);

  if (appConfig.nodeEnv === 'production') {
    const clientDist = path.join(repositoryRoot, 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get(/^(?!\/api|\/thumbnails|\/previews).*/, (_request, response) => {
        response.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, next: express.NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    if (error instanceof Error && 'status' in error && error.status === 416) {
      response.status(416).end();
      return;
    }

    const message = error instanceof Error ? error.message : 'Unexpected server error';
    response.status(400).json({ message });
  });

  return app;
}
