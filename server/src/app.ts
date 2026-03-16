import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import { ZodError } from 'zod';

import { appConfig, repositoryRoot } from './config/env.js';
import { requireTrustedMutationRequest } from './middleware/csrf-protection.js';
import { apiRouter } from './routes/api.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  app.use('/thumbnails', express.static(appConfig.thumbnailsDir, { fallthrough: false, immutable: true, maxAge: '7d' }));
  app.use('/previews', express.static(appConfig.previewsDir, { fallthrough: false, immutable: true, maxAge: '7d' }));

  app.use('/api', requireTrustedMutationRequest, apiRouter);

  if (appConfig.nodeEnv === 'production') {
    const clientDist = path.join(repositoryRoot, 'client', 'dist');
    if (fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));
      app.get(/^(?!\/api|\/thumbnails|\/previews).*/, (_request, response) => {
        response.sendFile(path.join(clientDist, 'index.html'));
      });
    }
  }

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      response.status(400).json({ message: 'Validation error', errors: error.errors });
      return;
    }

    if (error instanceof Error) {
      console.error(error.stack);
    } else {
      console.error(error);
    }

    response.status(500).json({ message: 'Unexpected server error' });
  });

  return app;
}
