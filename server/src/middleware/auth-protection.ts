import type express from 'express';

import { authService, type AuthCapabilities } from '../services/auth-service.js';
import { isPlaybackSessionMutation } from '../utils/playback-session-request.js';

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

  return (
    (method === 'GET' && (path === '/health' || path === '/auth/status' || path === '/appearance')) ||
    (method === 'POST' && (path === '/auth/login' || path === '/auth/logout' || path === '/auth/unlock-admin')) ||
    isShareReadRoute ||
    (path.startsWith('/share/') && isPlaybackSessionMutation(method, path)) ||
    isShareUnlockRoute
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

  if (authService.isPublicViewerAccessEnabled() &&
      (isSafeReadMethod(request.method.toUpperCase()) || isPlaybackSessionMutation(request.method, request.path))) {
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
