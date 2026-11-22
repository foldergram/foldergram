import type express from 'express';

import { appConfig } from '../config/env.js';
import { isPlaybackSessionMutation } from '../utils/playback-session-request.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const PUBLIC_DEMO_DISABLED_MESSAGE = 'Disabled in public demo.';

export function blockPublicDemoMutations(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
): void {
  if (!appConfig.publicDemoMode || !MUTATING_METHODS.has(request.method.toUpperCase()) ||
      isPlaybackSessionMutation(request.method, request.path)) {
    next();
    return;
  }

  response.status(403).json({ message: PUBLIC_DEMO_DISABLED_MESSAGE });
}
