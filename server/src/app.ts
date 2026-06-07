import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import express from 'express';

import { appConfig, repositoryRoot } from './config/env.js';
import { requireApiAuthentication, requireMediaAuthentication } from './middleware/auth-protection.js';
import { requireTrustedMutationRequest } from './middleware/csrf-protection.js';
import { blockPublicDemoMutations } from './middleware/public-demo-mode.js';
import { apiRouter } from './routes/api.js';
import { authService } from './services/auth-service.js';
import { log } from './services/log-service.js';
import { metricsService } from './services/metrics-service.js';
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

  app.use(express.json());

  if (appConfig.derivativeMode === 'lazy') {
    app.use('/thumbnails', requireMediaAuthentication, lazyThumbnailsRouter);
    app.use('/previews', requireMediaAuthentication, lazyPreviewsRouter);
  } else {
    app.use('/thumbnails', requireMediaAuthentication, express.static(appConfig.thumbnailsDir, createProtectedStaticOptions()));
    app.use('/previews', requireMediaAuthentication, express.static(appConfig.previewsDir, createProtectedStaticOptions()));
  }

  app.use('/api', (request, response, next) => {
    applyApiNoStoreHeaders(response);
    const startedAt = performance.now();
    response.on('finish', () => {
      const elapsed = Math.round(performance.now() - startedAt);
      metricsService.recordRequest(request.method, request.path, response.statusCode, elapsed);
      const meta = { status: response.statusCode, elapsed: `${elapsed}ms` };
      if (response.statusCode >= 500) {
        log.error(`${request.method} ${request.path}`, meta);
      } else {
        log.info(`${request.method} ${request.path}`, meta);
      }
    });
    next();
  });
  app.use('/api', blockPublicDemoMutations, requireTrustedMutationRequest, requireApiAuthentication, apiRouter);
  app.get('/api/metrics', requireApiAuthentication, (_request, response) => {
    response.json(metricsService.getSummary());
  });
  app.post('/api/metrics/reset', requireApiAuthentication, (_request, response) => {
    metricsService.reset();
    response.json({ ok: true });
  });

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

    const message = error instanceof Error ? error.message : 'Unexpected server error';
    log.error('Unhandled request error', error instanceof Error ? error.stack : message);
    response.status(500).json({ message });
  });

  return app;
}
