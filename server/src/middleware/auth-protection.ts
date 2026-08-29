import type express from 'express';

import { authService, type AuthCapabilities } from '../services/auth-service.js';

export const AUTH_REQUIRED_MESSAGE = 'Authentication required.';
export const AUTH_REQUIRED_HEADER = 'x-foldergram-auth-required';
export const AUTH_FORBIDDEN_MESSAGE = 'You do not have permission to perform this action.';

function isPublicApiRoute(request: express.Request): boolean {
  const method = request.method.toUpperCase();
  const path = request.path;
  const isShareReadRoute = path.startsWith('/share/') && isSafeReadMethod(method);
  const isShareUnlockRoute =
    method === 'POST' &&
    path.startsWith('/share/folders/') &&
    (path.endsWith('/unlock-link') || path.endsWith('/unlock-password'));
  // Segment warm-up is shaped like a mutation but only ever primes the transcode cache
  // for the one post a share token already unlocks, so a token holder may call it.
  const isPostShareWarmRoute =
    method === 'POST' && path.startsWith('/share/post-links/') && path.endsWith('/warm');

  return (
    (method === 'GET' && (path === '/health' || path === '/auth/status')) ||
    (method === 'POST' && (path === '/auth/login' || path === '/auth/logout' || path === '/auth/unlock-admin')) ||
    isShareReadRoute ||
    isShareUnlockRoute ||
    isPostShareWarmRoute
  );
}

function isSafeReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

export function requireApiAuthentication(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
): void {
  if (!authService.isEnabled()) {
    next();
    return;
  }

  if (isPublicApiRoute(request)) {
    next();
    return;
  }

  if (authService.isAuthenticatedRequest(request)) {
    authService.setNoStoreHeaders(response);
    response.setHeader('Vary', 'Cookie');
    next();
    return;
  }

  if (authService.isPublicViewerAccessEnabled() && isSafeReadMethod(request.method.toUpperCase())) {
    authService.setNoStoreHeaders(response);
    response.setHeader('Vary', 'Cookie');
    next();
    return;
  }

  authService.setNoStoreHeaders(response);
  response.setHeader(AUTH_REQUIRED_HEADER, '1');
  response.status(401).json({ message: AUTH_REQUIRED_MESSAGE });
}

export function requireMediaAuthentication(
  request: express.Request,
  response: express.Response,
  next: express.NextFunction
): void {
  if (!authService.isEnabled()) {
    next();
    return;
  }

  if (authService.isAuthenticatedRequest(request)) {
    authService.setNoStoreHeaders(response);
    response.setHeader('Vary', 'Cookie');
    next();
    return;
  }

  if (authService.isPublicViewerAccessEnabled()) {
    authService.setNoStoreHeaders(response);
    response.setHeader('Vary', 'Cookie');
    next();
    return;
  }

  authService.setNoStoreHeaders(response);
  response.setHeader(AUTH_REQUIRED_HEADER, '1');
  response.status(401).type('text/plain').send(AUTH_REQUIRED_MESSAGE);
}

export function requireCapability(
  capability: keyof AuthCapabilities,
  message = AUTH_FORBIDDEN_MESSAGE
): express.RequestHandler {
  return (request, response, next) => {
    if (!authService.isAuthenticatedRequest(request)) {
      authService.setNoStoreHeaders(response);
      response.setHeader(AUTH_REQUIRED_HEADER, '1');
      response.status(401).json({ message: AUTH_REQUIRED_MESSAGE });
      return;
    }

    if (!authService.hasCapability(request, capability)) {
      authService.setNoStoreHeaders(response);
      response.status(403).json({ message });
      return;
    }

    authService.setNoStoreHeaders(response);
    response.setHeader('Vary', 'Cookie');
    next();
  };
}
