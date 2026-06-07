import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type express from 'express';

import {
  APP_DEFAULT_LOCALE_SETTING_KEY,
  AUTH_PASSWORD_HASH_SETTING_KEY,
  AUTH_PASSWORD_SALT_SETTING_KEY,
  AUTH_SESSION_SECRET_SETTING_KEY,
  AUTH_SESSION_VERSION_SETTING_KEY,
  AUTH_VIEWER_ACCESS_MODE_SETTING_KEY,
  AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY,
  AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY
} from '../constants/app-setting-keys.js';
import { appSettingsRepository } from '../db/repositories.js';

export type AuthRole = 'admin' | 'viewer' | 'anonymous';
export type SessionRole = Exclude<AuthRole, 'anonymous'>;
export type ViewerAccessMode = 'off' | 'password' | 'public';
export type LikesMode = 'shared' | 'local';
type SupportedLocale = 'en' | 'es' | 'zh';

export interface AuthCapabilities {
  canManageLibrary: boolean;
  canDeleteMedia: boolean;
  canAccessSettings: boolean;
  canUseSharedLikes: boolean;
  canUseLocalFavorites: boolean;
  canUseSharedCollections: boolean;
  canUseLocalCollections: boolean;
}

interface AuthConfigSnapshot {
  enabled: boolean;
  adminPasswordHash: Buffer | null;
  adminPasswordSalt: Buffer | null;
  viewerPasswordHash: Buffer | null;
  viewerPasswordSalt: Buffer | null;
  sessionSecret: Buffer | null;
  sessionVersion: number;
  viewerAccessMode: ViewerAccessMode;
  defaultLocale: SupportedLocale | null;
}

interface SessionPayload {
  exp: number;
  role: SessionRole;
  sv: number;
}

export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  role: AuthRole;
  accessMode: ViewerAccessMode;
  likesMode: LikesMode;
  defaultLocale: SupportedLocale | null;
  capabilities: AuthCapabilities;
}

export const AUTH_SESSION_COOKIE_NAME = 'foldergram_session';
export const AUTH_PASSWORD_MIN_LENGTH = 8;
export const AUTH_PASSWORD_MAX_LENGTH = 256;
const PASSWORD_HASH_LENGTH = 64;
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;
const SUPPORTED_LOCALES = ['en', 'es', 'zh'] as const;

function parseSupportedLocale(value: string | null): SupportedLocale | null {
  if (!value) {
    return null;
  }

  return (SUPPORTED_LOCALES as readonly string[]).includes(value) ? (value as SupportedLocale) : null;
}

function decodeBase64Url(value: string | null): Buffer | null {
  if (!value) {
    return null;
  }

  try {
    const buffer = Buffer.from(value, 'base64url');
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

function parseSessionVersion(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function parseViewerAccessMode(value: string | null): ViewerAccessMode {
  if (value === 'password' || value === 'public') {
    return value;
  }

  return 'off';
}

function createCapabilities(role: AuthRole): AuthCapabilities {
  if (role === 'admin') {
    return {
      canManageLibrary: true,
      canDeleteMedia: true,
      canAccessSettings: true,
      canUseSharedLikes: true,
      canUseLocalFavorites: false,
      canUseSharedCollections: true,
      canUseLocalCollections: false
    };
  }

  if (role === 'viewer') {
    return {
      canManageLibrary: false,
      canDeleteMedia: false,
      canAccessSettings: false,
      canUseSharedLikes: true,
      canUseLocalFavorites: false,
      canUseSharedCollections: true,
      canUseLocalCollections: false
    };
  }

  return {
    canManageLibrary: false,
    canDeleteMedia: false,
    canAccessSettings: false,
    canUseSharedLikes: false,
    canUseLocalFavorites: true,
    canUseSharedCollections: false,
    canUseLocalCollections: true
  };
}

function createStatus(role: AuthRole, authenticated: boolean, enabled: boolean, accessMode: ViewerAccessMode): AuthStatus {
  const capabilities = authenticated ? createCapabilities(role) : createCapabilities('anonymous');

  return {
    enabled,
    authenticated,
    role,
    accessMode,
    likesMode: capabilities.canUseSharedLikes ? 'shared' : 'local',
    defaultLocale: authConfig.defaultLocale,
    capabilities
  };
}

async function loadAuthConfig(): Promise<AuthConfigSnapshot> {
  const adminPasswordHash = decodeBase64Url(await appSettingsRepository.get(AUTH_PASSWORD_HASH_SETTING_KEY));
  const adminPasswordSalt = decodeBase64Url(await appSettingsRepository.get(AUTH_PASSWORD_SALT_SETTING_KEY));
  const viewerPasswordHash = decodeBase64Url(await appSettingsRepository.get(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY));
  const viewerPasswordSalt = decodeBase64Url(await appSettingsRepository.get(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY));
  const sessionSecret = decodeBase64Url(await appSettingsRepository.get(AUTH_SESSION_SECRET_SETTING_KEY));
  const sessionVersion = parseSessionVersion(await appSettingsRepository.get(AUTH_SESSION_VERSION_SETTING_KEY));
  const enabled = adminPasswordHash !== null && adminPasswordSalt !== null && sessionSecret !== null && sessionVersion > 0;
  const rawViewerAccessMode = parseViewerAccessMode(await appSettingsRepository.get(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY));
  const viewerAccessMode =
    enabled && rawViewerAccessMode === 'password' && viewerPasswordHash !== null && viewerPasswordSalt !== null
      ? 'password'
      : enabled && rawViewerAccessMode === 'public'
        ? 'public'
        : 'off';
  const defaultLocale = parseSupportedLocale(await appSettingsRepository.get(APP_DEFAULT_LOCALE_SETTING_KEY));

  return {
    enabled,
    adminPasswordHash: enabled ? adminPasswordHash : null,
    adminPasswordSalt: enabled ? adminPasswordSalt : null,
    viewerPasswordHash: viewerAccessMode === 'password' ? viewerPasswordHash : null,
    viewerPasswordSalt: viewerAccessMode === 'password' ? viewerPasswordSalt : null,
    sessionSecret: enabled ? sessionSecret : null,
    sessionVersion: enabled ? sessionVersion : 0,
    viewerAccessMode,
    defaultLocale
  };
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, PASSWORD_HASH_LENGTH);
}

function signValue(value: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

function parseCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  const prefix = `${cookieName}=`;

  for (const chunk of cookieHeader.split(';')) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith(prefix)) {
      continue;
    }

    const rawValue = trimmed.slice(prefix.length);
    if (rawValue.length === 0) {
      return null;
    }

    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function parseSessionToken(token: string, secret: Buffer): SessionPayload | null {
  const separatorIndex = token.lastIndexOf('.');
  if (separatorIndex <= 0 || separatorIndex === token.length - 1) {
    return null;
  }

  const encodedPayload = token.slice(0, separatorIndex);
  const signature = token.slice(separatorIndex + 1);
  const expectedSignature = signValue(encodedPayload, secret);

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      (payload.role !== 'admin' && payload.role !== 'viewer') ||
      typeof payload.sv !== 'number' ||
      !Number.isInteger(payload.sv) ||
      payload.sv <= 0
    ) {
      return null;
    }

    return {
      exp: payload.exp,
      role: payload.role,
      sv: payload.sv
    };
  } catch {
    return null;
  }
}

function isSecureRequest(request: express.Request): boolean {
  if (request.secure) {
    return true;
  }

  const forwardedProto = request.get('x-forwarded-proto');
  if (!forwardedProto) {
    return false;
  }

  const firstValue = forwardedProto
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .find((entry) => entry.length > 0);

  return firstValue === 'https' || firstValue === 'https:';
}

let authConfig: AuthConfigSnapshot = {
  enabled: false,
  adminPasswordHash: null,
  adminPasswordSalt: null,
  viewerPasswordHash: null,
  viewerPasswordSalt: null,
  sessionSecret: null,
  sessionVersion: 0,
  viewerAccessMode: 'off',
  defaultLocale: null
};

function getAnonymousStatus(): AuthStatus {
  return createStatus('anonymous', false, authConfig.enabled, authConfig.viewerAccessMode);
}

function createAuthenticatedStatus(role: SessionRole = 'admin'): AuthStatus {
  return createStatus(role, true, authConfig.enabled, authConfig.viewerAccessMode);
}

async function storeSessionConfig(nextSessionVersion: number): Promise<void> {
  const sessionSecret = randomBytes(32);
  await appSettingsRepository.set(AUTH_SESSION_SECRET_SETTING_KEY, sessionSecret.toString('base64url'));
  await appSettingsRepository.set(AUTH_SESSION_VERSION_SETTING_KEY, String(nextSessionVersion));
}

function getRequestSessionRole(request: express.Request): SessionRole | null {
  if (!authConfig.enabled || !authConfig.sessionSecret) {
    return 'admin';
  }

  const cookieHeader = request.get('cookie') ?? undefined;
  const token = parseCookieValue(cookieHeader, AUTH_SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const payload = parseSessionToken(token, authConfig.sessionSecret);
  if (!payload) {
    return null;
  }

  if (payload.exp <= Date.now()) {
    return null;
  }

  return payload.sv === authConfig.sessionVersion ? payload.role : null;
}

export const authService = {
  async initialize(): Promise<void> {
    authConfig = await loadAuthConfig();
  },

  async refresh(): Promise<void> {
    authConfig = await loadAuthConfig();
  },

  getViewerAccessMode(): ViewerAccessMode {
    return authConfig.viewerAccessMode;
  },

  isEnabled(): boolean {
    return authConfig.enabled;
  },

  isPublicViewerAccessEnabled(): boolean {
    return authConfig.enabled && authConfig.viewerAccessMode === 'public';
  },

  getStatus(request: express.Request): AuthStatus {
    if (!authConfig.enabled) {
      return createStatus('admin', true, false, 'off');
    }

    return this.getRequestAuthContext(request);
  },

  getLoggedOutStatus(): AuthStatus {
    return authConfig.enabled ? getAnonymousStatus() : createStatus('admin', true, false, 'off');
  },

  getAuthenticatedStatus(role: SessionRole = 'admin'): AuthStatus {
    return createAuthenticatedStatus(role);
  },

  getRequestAuthContext(request: express.Request): AuthStatus {
    if (!authConfig.enabled) {
      return createStatus('admin', true, false, 'off');
    }

    const role = getRequestSessionRole(request);
    return role ? createAuthenticatedStatus(role) : getAnonymousStatus();
  },

  isAuthenticatedRequest(request: express.Request): boolean {
    return this.getRequestAuthContext(request).authenticated;
  },

  hasCapability(request: express.Request, capability: keyof AuthCapabilities): boolean {
    return this.getRequestAuthContext(request).capabilities[capability];
  },

  verifyAdminPassword(password: string): boolean {
    if (!authConfig.enabled || !authConfig.adminPasswordHash || !authConfig.adminPasswordSalt) {
      return false;
    }

    const expectedHash = hashPassword(password, authConfig.adminPasswordSalt);
    return (
      expectedHash.length === authConfig.adminPasswordHash.length &&
      timingSafeEqual(expectedHash, authConfig.adminPasswordHash)
    );
  },

  verifyViewerPassword(password: string): boolean {
    if (authConfig.viewerAccessMode !== 'password' || !authConfig.viewerPasswordHash || !authConfig.viewerPasswordSalt) {
      return false;
    }

    const expectedHash = hashPassword(password, authConfig.viewerPasswordSalt);
    return (
      expectedHash.length === authConfig.viewerPasswordHash.length &&
      timingSafeEqual(expectedHash, authConfig.viewerPasswordHash)
    );
  },

  authenticatePassword(password: string): SessionRole | null {
    if (!authConfig.enabled) {
      return null;
    }

    if (this.verifyAdminPassword(password)) {
      return 'admin';
    }

    if (this.verifyViewerPassword(password)) {
      return 'viewer';
    }

    return null;
  },

  async setAdminPassword(password: string): Promise<AuthStatus> {
    if (authConfig.viewerAccessMode === 'password' && this.verifyViewerPassword(password)) {
      throw new Error('Viewer password must be different from the admin password.');
    }

    const salt = randomBytes(16);
    const passwordHash = hashPassword(password, salt);
    const nextSessionVersion = Math.max(1, authConfig.sessionVersion + 1);

    await appSettingsRepository.set(AUTH_PASSWORD_HASH_SETTING_KEY, passwordHash.toString('base64url'));
    await appSettingsRepository.set(AUTH_PASSWORD_SALT_SETTING_KEY, salt.toString('base64url'));

    if (!authConfig.enabled) {
      await appSettingsRepository.set(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY, 'off');
      await appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY);
      await appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY);
    }

    await storeSessionConfig(nextSessionVersion);

    await this.refresh();
    return createAuthenticatedStatus('admin');
  },

  async setViewerAccess(mode: ViewerAccessMode, viewerPassword: string | null = null): Promise<AuthStatus> {
    if (!authConfig.enabled) {
      throw new Error('Enable the admin password before configuring viewer access.');
    }

    if (mode === 'password') {
      if (!viewerPassword) {
        throw new Error('Viewer password is required when viewer access mode is password.');
      }

      if (this.verifyAdminPassword(viewerPassword)) {
        throw new Error('Viewer password must be different from the admin password.');
      }

      const viewerSalt = randomBytes(16);
      const viewerHash = hashPassword(viewerPassword, viewerSalt);
      await appSettingsRepository.set(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY, viewerHash.toString('base64url'));
      await appSettingsRepository.set(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY, viewerSalt.toString('base64url'));
    } else {
      await appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY);
      await appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY);
    }

    await appSettingsRepository.set(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY, mode);
    await storeSessionConfig(Math.max(1, authConfig.sessionVersion + 1));

    await this.refresh();
    return createAuthenticatedStatus('admin');
  },

  async disable(): Promise<AuthStatus> {
    await appSettingsRepository.remove(AUTH_PASSWORD_HASH_SETTING_KEY);
    await appSettingsRepository.remove(AUTH_PASSWORD_SALT_SETTING_KEY);
    await appSettingsRepository.remove(AUTH_SESSION_SECRET_SETTING_KEY);
    await appSettingsRepository.remove(AUTH_SESSION_VERSION_SETTING_KEY);
    await appSettingsRepository.remove(AUTH_VIEWER_ACCESS_MODE_SETTING_KEY);
    await appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_HASH_SETTING_KEY);
    await appSettingsRepository.remove(AUTH_VIEWER_PASSWORD_SALT_SETTING_KEY);

    await this.refresh();
    return createStatus('admin', true, false, 'off');
  },

  setAuthenticatedSession(response: express.Response, request: express.Request, role: SessionRole = 'admin'): void {
    if (!authConfig.enabled || !authConfig.sessionSecret) {
      return;
    }

    const payload: SessionPayload = {
      exp: Date.now() + SESSION_DURATION_MS,
      role,
      sv: authConfig.sessionVersion
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = signValue(encodedPayload, authConfig.sessionSecret);

    response.cookie(AUTH_SESSION_COOKIE_NAME, `${encodedPayload}.${signature}`, {
      encode: (value) => value,
      httpOnly: true,
      maxAge: SESSION_DURATION_MS,
      path: '/',
      sameSite: 'lax',
      secure: isSecureRequest(request)
    });
  },

  clearAuthenticatedSession(response: express.Response, request: express.Request): void {
    response.cookie(AUTH_SESSION_COOKIE_NAME, '', {
      encode: (value) => value,
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: isSecureRequest(request)
    });
  },

  setNoStoreHeaders(response: express.Response): void {
    response.setHeader('Cache-Control', 'no-store');
  }
};
