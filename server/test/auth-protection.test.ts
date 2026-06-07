import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthServiceModule = typeof import('../src/services/auth-service.js');
type AuthProtectionModule = typeof import('../src/middleware/auth-protection.js');

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  type: ReturnType<typeof vi.fn>;
  setHeader: ReturnType<typeof vi.fn>;
  cookie: ReturnType<typeof vi.fn>;
}

function createRequest(method: string, routePath: string, headers: Record<string, string | undefined> = {}): express.Request {
  const normalizedHeaders = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));

  return {
    method,
    path: routePath,
    secure: false,
    get(name: string) {
      return normalizedHeaders.get(name.toLowerCase());
    }
  } as unknown as express.Request;
}

function createResponse(): MockResponse {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    type: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    cookie: vi.fn().mockReturnThis()
  };
}

function extractCookieHeader(response: MockResponse): string {
  const [name, value] = response.cookie.mock.calls.at(-1) ?? [];
  if (typeof name !== 'string' || typeof value !== 'string') {
    throw new Error('Expected a session cookie to be set');
  }

  return `${name}=${value}`;
}

describe.sequential('auth protection', () => {
  let tempRoot = '';
  let authService: AuthServiceModule['authService'];
  let requireApiAuthentication: AuthProtectionModule['requireApiAuthentication'];
  let requireMediaAuthentication: AuthProtectionModule['requireMediaAuthentication'];
  let requireCapability: AuthProtectionModule['requireCapability'];
  let AUTH_REQUIRED_HEADER: AuthProtectionModule['AUTH_REQUIRED_HEADER'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-auth-protection-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    await (await import('../src/db/repositories.js')).initRepositories();
    ({ authService } = await import('../src/services/auth-service.js'));
    ({ requireApiAuthentication, requireMediaAuthentication, requireCapability, AUTH_REQUIRED_HEADER } = await import(
      '../src/middleware/auth-protection.js'
    ));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('allows protected routes when password protection is disabled', async () => {
    const request = createRequest('GET', '/feed');
    const response = createResponse();
    const next = vi.fn();

    requireApiAuthentication(request, response as unknown as express.Response, next);

    expect(authService.isEnabled()).toBe(false);
    expect(authService.getStatus(request)).toMatchObject({
      enabled: false,
      authenticated: true,
      role: 'admin',
      accessMode: 'off'
    });
    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });

  it('blocks protected API and media routes when password protection is enabled but the request has no session', async () => {
    await authService.setAdminPassword('password123');

    const apiRequest = createRequest('GET', '/feed');
    const apiResponse = createResponse();
    const apiNext = vi.fn();

    requireApiAuthentication(apiRequest, apiResponse as unknown as express.Response, apiNext);

    expect(apiNext).not.toHaveBeenCalled();
    expect(apiResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(apiResponse.setHeader).toHaveBeenCalledWith(AUTH_REQUIRED_HEADER, '1');
    expect(apiResponse.status).toHaveBeenCalledWith(401);

    const mediaRequest = createRequest('GET', '/thumbnails/example.webp');
    const mediaResponse = createResponse();
    const mediaNext = vi.fn();

    requireMediaAuthentication(mediaRequest, mediaResponse as unknown as express.Response, mediaNext);

    expect(mediaNext).not.toHaveBeenCalled();
    expect(mediaResponse.type).toHaveBeenCalledWith('text/plain');
    expect(mediaResponse.status).toHaveBeenCalledWith(401);

    const publicRequest = createRequest('GET', '/auth/status');
    const publicResponse = createResponse();
    const publicNext = vi.fn();

    requireApiAuthentication(publicRequest, publicResponse as unknown as express.Response, publicNext);

    expect(publicNext).toHaveBeenCalledOnce();
    expect(publicResponse.status).not.toHaveBeenCalled();
  });

  it('accepts a valid signed session cookie on protected requests', async () => {
    await authService.setAdminPassword('password123');

    const loginResponse = createResponse();
    authService.setAuthenticatedSession(
      loginResponse as unknown as express.Response,
      createRequest('POST', '/auth/login'),
      'admin'
    );

    const authenticatedRequest = createRequest('GET', '/feed', {
      cookie: extractCookieHeader(loginResponse)
    });
    const authenticatedResponse = createResponse();
    const next = vi.fn();

    requireApiAuthentication(authenticatedRequest, authenticatedResponse as unknown as express.Response, next);

    expect(authService.isAuthenticatedRequest(authenticatedRequest)).toBe(true);
    expect(authService.getStatus(authenticatedRequest)).toMatchObject({
      enabled: true,
      authenticated: true,
      role: 'admin'
    });
    expect(next).toHaveBeenCalledOnce();
    expect(authenticatedResponse.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(authenticatedResponse.setHeader).toHaveBeenCalledWith('Vary', 'Cookie');
  });

  it('accepts viewer sessions and blocks admin-only capabilities', async () => {
    await authService.setAdminPassword('password123');
    await authService.setViewerAccess('password', 'viewer123');

    const loginResponse = createResponse();
    authService.setAuthenticatedSession(
      loginResponse as unknown as express.Response,
      createRequest('POST', '/auth/login'),
      'viewer'
    );

    const viewerRequest = createRequest('POST', '/admin/rescan', {
      cookie: extractCookieHeader(loginResponse)
    });
    const viewerResponse = createResponse();
    const next = vi.fn();

    requireCapability('canManageLibrary', 'Admin access is required.')(
      viewerRequest,
      viewerResponse as unknown as express.Response,
      next
    );

    expect(authService.getStatus(viewerRequest)).toMatchObject({
      enabled: true,
      authenticated: true,
      role: 'viewer',
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: true
      }
    });
    expect(next).not.toHaveBeenCalled();
    expect(viewerResponse.status).toHaveBeenCalledWith(403);
    expect(viewerResponse.json).toHaveBeenCalledWith({
      message: 'Admin access is required.'
    });
  });

  it('allows anonymous read access in public viewer mode but still blocks protected mutations', async () => {
    await authService.setAdminPassword('password123');
    await authService.setViewerAccess('public');

    const publicReadRequest = createRequest('GET', '/feed');
    const publicReadResponse = createResponse();
    const publicReadNext = vi.fn();

    requireApiAuthentication(publicReadRequest, publicReadResponse as unknown as express.Response, publicReadNext);

    expect(publicReadNext).toHaveBeenCalledOnce();
    expect(authService.getStatus(publicReadRequest)).toMatchObject({
      enabled: true,
      authenticated: false,
      role: 'anonymous',
      accessMode: 'public',
      likesMode: 'local'
    });

    const mediaRequest = createRequest('GET', '/thumbnails/example.webp');
    const mediaResponse = createResponse();
    const mediaNext = vi.fn();

    requireMediaAuthentication(mediaRequest, mediaResponse as unknown as express.Response, mediaNext);

    expect(mediaNext).toHaveBeenCalledOnce();
    expect(mediaResponse.status).not.toHaveBeenCalled();

    const mutationRequest = createRequest('POST', '/images/42/like');
    const mutationResponse = createResponse();
    const mutationNext = vi.fn();

    requireApiAuthentication(mutationRequest, mutationResponse as unknown as express.Response, mutationNext);

    expect(mutationNext).not.toHaveBeenCalled();
    expect(mutationResponse.setHeader).toHaveBeenCalledWith(AUTH_REQUIRED_HEADER, '1');
    expect(mutationResponse.status).toHaveBeenCalledWith(401);
  });

  it('keeps admin unlock reachable without an authenticated session', async () => {
    await authService.setAdminPassword('password123');
    await authService.setViewerAccess('public');

    const request = createRequest('POST', '/auth/unlock-admin');
    const response = createResponse();
    const next = vi.fn();

    requireApiAuthentication(request, response as unknown as express.Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.status).not.toHaveBeenCalled();
  });
});
