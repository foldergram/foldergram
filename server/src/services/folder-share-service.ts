import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import type express from 'express';

import { SHARE_SESSION_SECRET_SETTING_KEY } from '../constants/app-setting-keys.js';
import {
  appSettingsRepository,
  folderRepository,
  folderShareLinkRepository,
  folderSharePasswordRepository
} from '../db/repositories.js';
import type { FolderRecord, FolderShareLinkRecord, FolderSharePasswordRecord } from '../types/models.js';
import { authService } from './auth-service.js';

export const FOLDER_SHARE_SESSION_COOKIE_NAME = 'foldergram_share_session';
export const FOLDER_SHARE_PASSWORD_MIN_LENGTH = 8;
export const FOLDER_SHARE_PASSWORD_MAX_LENGTH = 256;

const TOKEN_BYTE_LENGTH = 32;
const TOKEN_PREFIX_LENGTH = 8;
const PASSWORD_HASH_LENGTH = 64;
const SHARE_SESSION_DURATION_MS = 24 * 60 * 60 * 1000;
const SHARE_SESSION_VERSION = 1;

interface LinkShareSessionPayload {
  exp: number;
  folderId: number;
  kind: 'link';
  linkId: number;
  sv: number;
}

interface PasswordShareSessionPayload {
  exp: number;
  folderId: number;
  kind: 'password';
  sv: number;
  version: number;
}

type ShareSessionPayload = LinkShareSessionPayload | PasswordShareSessionPayload;

export interface PublicFolderShareLink {
  id: number;
  folderId: number;
  tokenPrefix: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  status: 'active' | 'expired' | 'revoked';
}

export interface FolderShareGrant {
  folderId: number;
  kind: 'global' | 'link' | 'password';
  linkId?: number;
}

interface LinkGrant {
  expiresAt: string | null;
  folderId: number;
  kind: 'link';
  linkId: number;
}

interface PasswordGrant {
  folderId: number;
  kind: 'password';
  version: number;
}

export function decodeBase64Url(value: string | null): Buffer | null {
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

export function getShareSessionSecret(): Buffer {
  const existing = decodeBase64Url(appSettingsRepository.get(SHARE_SESSION_SECRET_SETTING_KEY));
  if (existing) {
    return existing;
  }

  const secret = randomBytes(32);
  appSettingsRepository.set(SHARE_SESSION_SECRET_SETTING_KEY, secret.toString('base64url'));
  return secret;
}

export function signValue(value: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function parseCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
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

function parseSessionToken(token: string, secret: Buffer): ShareSessionPayload | null {
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
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as Partial<ShareSessionPayload>;
    if (
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp) ||
      typeof payload.folderId !== 'number' ||
      !Number.isInteger(payload.folderId) ||
      payload.folderId <= 0 ||
      typeof payload.sv !== 'number' ||
      payload.sv !== SHARE_SESSION_VERSION
    ) {
      return null;
    }

    if (payload.kind === 'link') {
      if (typeof payload.linkId !== 'number' || !Number.isInteger(payload.linkId) || payload.linkId <= 0) {
        return null;
      }

      return {
        exp: payload.exp,
        folderId: payload.folderId,
        kind: 'link',
        linkId: payload.linkId,
        sv: payload.sv
      };
    }

    if (payload.kind === 'password') {
      if (typeof payload.version !== 'number' || !Number.isInteger(payload.version) || payload.version <= 0) {
        return null;
      }

      return {
        exp: payload.exp,
        folderId: payload.folderId,
        kind: 'password',
        sv: payload.sv,
        version: payload.version
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function isSecureRequest(request: express.Request): boolean {
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

export function hashShareToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function hashPassword(password: string, salt: Buffer): Buffer {
  return scryptSync(password.normalize('NFKC'), salt, PASSWORD_HASH_LENGTH);
}

function isLinkExpired(link: Pick<FolderShareLinkRecord, 'expires_at'>, now = Date.now()): boolean {
  if (!link.expires_at) {
    return false;
  }

  const expiresAt = Date.parse(link.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

function isLinkUsable(link: FolderShareLinkRecord, now = Date.now()): boolean {
  return link.revoked_at === null && !isLinkExpired(link, now);
}

function mapShareLink(link: FolderShareLinkRecord, now = new Date()): PublicFolderShareLink {
  return {
    id: link.id,
    folderId: link.folder_id,
    tokenPrefix: link.token_prefix,
    expiresAt: link.expires_at,
    revokedAt: link.revoked_at,
    createdAt: link.created_at,
    lastUsedAt: link.last_used_at,
    status: link.revoked_at ? 'revoked' : isLinkExpired(link, now.getTime()) ? 'expired' : 'active'
  };
}

function getGlobalGrant(request: express.Request, folderId: number): FolderShareGrant | null {
  if (!authService.isEnabled() || authService.isAuthenticatedRequest(request) || authService.isPublicViewerAccessEnabled()) {
    return {
      folderId,
      kind: 'global'
    };
  }

  return null;
}

function getSessionCookieMaxAge(grant: LinkGrant | PasswordGrant): number {
  if (grant.kind === 'password' || !grant.expiresAt) {
    return SHARE_SESSION_DURATION_MS;
  }

  return Math.max(0, Math.min(SHARE_SESSION_DURATION_MS, Date.parse(grant.expiresAt) - Date.now()));
}

function createSignedSessionToken(payload: ShareSessionPayload): string {
  const secret = getShareSessionSecret();
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function validateSessionPayload(payload: ShareSessionPayload): LinkGrant | PasswordGrant | null {
  if (payload.exp <= Date.now()) {
    return null;
  }

  if (payload.kind === 'link') {
    const link = folderShareLinkRepository.getById(payload.linkId);
    if (!link || link.folder_id !== payload.folderId || !isLinkUsable(link)) {
      return null;
    }

    return {
      expiresAt: link.expires_at,
      folderId: link.folder_id,
      kind: 'link',
      linkId: link.id
    };
  }

  const password = folderSharePasswordRepository.get(payload.folderId);
  if (!password || password.version !== payload.version) {
    return null;
  }

  return {
    folderId: payload.folderId,
    kind: 'password',
    version: payload.version
  };
}

function getShareSessionGrant(request: express.Request): LinkGrant | PasswordGrant | null {
  const token = parseCookieValue(request.get('cookie') ?? undefined, FOLDER_SHARE_SESSION_COOKIE_NAME);
  if (!token) {
    return null;
  }

  const payload = parseSessionToken(token, getShareSessionSecret());
  return payload ? validateSessionPayload(payload) : null;
}

function getPasswordRecord(folderId: number): FolderSharePasswordRecord | undefined {
  return folderSharePasswordRepository.get(folderId);
}

export const folderShareService = {
  listLinks(slug: string): { folder: FolderRecord; links: PublicFolderShareLink[]; password: { enabled: boolean; updatedAt: string | null } } | null {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const password = getPasswordRecord(folder.id);
    return {
      folder,
      links: folderShareLinkRepository.listByFolder(folder.id).map((link) => mapShareLink(link)),
      password: {
        enabled: Boolean(password),
        updatedAt: password?.updated_at ?? null
      }
    };
  },

  createLink(slug: string, options: { expiresAt: Date | null }): {
    folder: FolderRecord;
    link: PublicFolderShareLink;
    rawToken: string;
  } | null {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const rawToken = randomBytes(TOKEN_BYTE_LENGTH).toString('base64url');
    const link = folderShareLinkRepository.create({
      folderId: folder.id,
      tokenHash: hashShareToken(rawToken),
      tokenPrefix: rawToken.slice(0, TOKEN_PREFIX_LENGTH),
      expiresAt: options.expiresAt ? options.expiresAt.toISOString() : null
    });

    return {
      folder,
      link: mapShareLink(link),
      rawToken
    };
  },

  revokeLink(slug: string, linkId: number): PublicFolderShareLink | null {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const link = folderShareLinkRepository.revoke(linkId, folder.id);
    return link && link.folder_id === folder.id ? mapShareLink(link) : null;
  },

  verifyLinkToken(slug: string, token: string): LinkGrant | null {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const normalizedToken = token.trim();
    if (normalizedToken.length === 0 || normalizedToken.length > 512) {
      return null;
    }

    const link = folderShareLinkRepository.getByTokenHash(hashShareToken(normalizedToken));
    if (!link || link.folder_id !== folder.id || !isLinkUsable(link)) {
      return null;
    }

    folderShareLinkRepository.touchLastUsed(link.id);

    return {
      expiresAt: link.expires_at,
      folderId: folder.id,
      kind: 'link',
      linkId: link.id
    };
  },

  setPassword(slug: string, password: string): { folder: FolderRecord; enabled: true; updatedAt: string } | null {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const salt = randomBytes(16);
    const passwordHash = hashPassword(password, salt);
    const record = folderSharePasswordRepository.upsert({
      folderId: folder.id,
      passwordHash: passwordHash.toString('base64url'),
      passwordSalt: salt.toString('base64url')
    });

    return {
      folder,
      enabled: true,
      updatedAt: record.updated_at
    };
  },

  removePassword(slug: string): { folder: FolderRecord; enabled: false } | null {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    folderSharePasswordRepository.remove(folder.id);
    return {
      folder,
      enabled: false
    };
  },

  verifyPassword(slug: string, password: string): PasswordGrant | null {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return null;
    }

    const record = getPasswordRecord(folder.id);
    const expectedHash = decodeBase64Url(record?.password_hash ?? null);
    const salt = decodeBase64Url(record?.password_salt ?? null);
    if (!record || !expectedHash || !salt) {
      return null;
    }

    const submittedHash = hashPassword(password, salt);
    if (
      submittedHash.length !== expectedHash.length ||
      !timingSafeEqual(submittedHash, expectedHash)
    ) {
      return null;
    }

    return {
      folderId: folder.id,
      kind: 'password',
      version: record.version
    };
  },

  getAccessState(request: express.Request, slug: string): {
    exists: boolean;
    granted: boolean;
    hasPassword: boolean;
    publicAccess: boolean;
  } {
    const folder = folderRepository.getNormalBySlug(slug);
    if (!folder) {
      return {
        exists: false,
        granted: false,
        hasPassword: false,
        publicAccess: false
      };
    }

    const publicAccess = !authService.isEnabled() || authService.isPublicViewerAccessEnabled();

    return {
      exists: true,
      granted: Boolean(this.getFolderGrant(request, folder.id)),
      hasPassword: Boolean(getPasswordRecord(folder.id)),
      publicAccess
    };
  },

  setShareSession(response: express.Response, request: express.Request, grant: LinkGrant | PasswordGrant): void {
    const maxAge = getSessionCookieMaxAge(grant);
    if (maxAge <= 0) {
      return;
    }

    const payload: ShareSessionPayload =
      grant.kind === 'link'
        ? {
            exp: Date.now() + maxAge,
            folderId: grant.folderId,
            kind: 'link',
            linkId: grant.linkId,
            sv: SHARE_SESSION_VERSION
          }
        : {
            exp: Date.now() + maxAge,
            folderId: grant.folderId,
            kind: 'password',
            sv: SHARE_SESSION_VERSION,
            version: grant.version
          };

    response.cookie(FOLDER_SHARE_SESSION_COOKIE_NAME, createSignedSessionToken(payload), {
      encode: (value) => value,
      httpOnly: true,
      maxAge,
      path: '/',
      sameSite: 'lax',
      secure: isSecureRequest(request)
    });
  },

  clearShareSession(response: express.Response, request: express.Request): void {
    response.cookie(FOLDER_SHARE_SESSION_COOKIE_NAME, '', {
      encode: (value) => value,
      expires: new Date(0),
      httpOnly: true,
      maxAge: 0,
      path: '/',
      sameSite: 'lax',
      secure: isSecureRequest(request)
    });
  },

  getFolderGrant(request: express.Request, folderId: number): FolderShareGrant | null {
    const globalGrant = getGlobalGrant(request, folderId);
    if (globalGrant) {
      return globalGrant;
    }

    const shareGrant = getShareSessionGrant(request);
    if (!shareGrant || shareGrant.folderId !== folderId) {
      return null;
    }

    return shareGrant.kind === 'link'
      ? {
          folderId,
          kind: 'link',
          linkId: shareGrant.linkId
        }
      : {
          folderId,
          kind: 'password'
        };
  }
};
