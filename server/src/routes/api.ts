import express from 'express';
import path from 'node:path';
import { z } from 'zod';

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, authService } from '../services/auth-service.js';
import {
  FOLDER_SHARE_PASSWORD_MAX_LENGTH,
  FOLDER_SHARE_PASSWORD_MIN_LENGTH,
  folderShareService
} from '../services/folder-share-service.js';
import { deletionJobService } from '../services/deletion-job-service.js';
import { galleryService } from '../services/gallery-service.js';
import { postShareService, type PostShareGrant } from '../services/post-share-service.js';
import { SHARE_PUBLIC_BASE_URL_SETTING_KEY } from '../constants/app-setting-keys.js';
import { appSettingsRepository } from '../db/repositories.js';
import { normalizePublicBaseUrl, resolveShareBaseUrl } from '../utils/share-url.js';
import { createVideoStreamRouter } from './video-stream.js';
import { requireCapability } from '../middleware/auth-protection.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { LIBRARY_REBUILD_REQUIRED_MESSAGE, scannerService } from '../services/scanner-service.js';
import { storageService } from '../services/storage-service.js';
import { watcherService } from '../services/watcher-service.js';
import { serveDerivativeForImage } from './lazy-derivatives.js';
import { applyNoStoreMediaHeaders } from '../utils/media-response.js';
import { videoStreamRouter } from './video-stream.js';
import { appConfig } from '../config/env.js';
import { fetchRemoteScanProgress, isRemoteScanWorkerEnabled, requestRemoteScan } from '../services/scan-worker-client.js';
import type { ScanProgressSnapshot } from '../services/scanner-service.js';

const router = express.Router();

router.use('/videos', videoStreamRouter);

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24)
});
const mediaTypeQuerySchema = z.object({
  mediaType: z.enum(['image', 'video']).optional()
});
const originalMediaQuerySchema = z.object({
  download: z.preprocess((value) => {
    if (value === undefined) {
      return false;
    }

    if (value === true || value === 1 || value === '1' || value === 'true') {
      return true;
    }

    if (value === false || value === 0 || value === '0' || value === 'false') {
      return false;
    }

    return value;
  }, z.boolean())
});
const deleteFolderQuerySchema = z.object({
  deleteSourceFolder: z.preprocess((value) => {
    if (value === undefined) {
      return false;
    }

    if (value === true || value === 'true') {
      return true;
    }

    if (value === false || value === 'false') {
      return false;
    }

    return value;
  }, z.boolean())
});
const MAX_EXCLUDED_FEED_IDS = 500;
const feedQuerySchema = paginationQuerySchema.extend({
  mode: z.enum(['recent', 'rediscover', 'random']).default('random'),
  seed: z.coerce.number().int().nonnegative().optional(),
  /**
   * Comma-separated post ids the client has already shown. Capped so a long session
   * cannot grow the query without bound; past the cap the rotated seed alone reshuffles.
   */
  exclude: z
    .string()
    .trim()
    .max(6000)
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((entry) => Number.parseInt(entry.trim(), 10))
            .filter((id) => Number.isInteger(id) && id > 0)
            .slice(0, MAX_EXCLUDED_FEED_IDS)
        : undefined
    )
});
const reelsQuerySchema = paginationQuerySchema.extend({
  mode: z.enum(['recommended', 'recent', 'random']).default('recommended'),
  seed: z.coerce.number().int().nonnegative().optional(),
  lastFolder: z.string().trim().min(1).max(240).optional(),
  recentFolders: z.string().trim().max(2400).optional()
});
const mediaSearchQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().min(1).max(160)
});
const homeFeedDefaultBodySchema = z.object({
  defaultMode: z.enum(['recent', 'rediscover', 'random'])
});
const appLocaleBodySchema = z.object({
  defaultLocale: z.enum(['en', 'es', 'zh'])
});
const reelsFeedDefaultBodySchema = z.object({
  defaultMode: z.enum(['recommended', 'recent', 'random'])
});
const folderImageOrderDefaultBodySchema = z.object({
  defaultOrder: z.enum(['newest', 'oldest'])
});
const nestedFolderTitleFormatBodySchema = z.object({
  titleFormat: z.enum(['folder', 'parent-plus-folder'])
});
const videoPlaybackQualityBodySchema = z.object({
  videoPlaybackQuality: z.enum(['auto', 'original', '1080p', '720p', '480p'])
});
const storiesModeBodySchema = z.object({
  treatStoriesAsFolders: z.boolean()
});
const excludedFoldersBodySchema = z.object({
  rules: z.array(z.string()).default([])
});
const collectionBodySchema = z.object({
  name: z.string().trim().min(1).max(80)
});

const slugSchema = z.object({
  slug: z.string().min(1).max(240)
});
const momentIdSchema = z.object({
  id: z.string().min(1).max(120)
});
const storyIdSchema = z.object({
  id: z.string().min(1).max(240)
});

const imageIdSchema = z.object({
  id: z.coerce.number().int().positive()
});
const permanentDeletionBatchBodySchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1).max(5000)
});
const shareLinkIdSchema = z.object({
  linkId: z.coerce.number().int().positive()
});
const shareTokenParamSchema = z.object({
  token: z.string().trim().min(1).max(512)
});
const publicBaseUrlBodySchema = z.object({
  publicBaseUrl: z
    .string()
    .trim()
    .max(512)
    .nullable()
    .transform((value) => (value === null || value.length === 0 ? null : value))
    .refine((value) => value === null || normalizePublicBaseUrl(value) !== null, {
      message: 'Public base URL must be an absolute http(s) URL.'
    })
});

export const patchFolderBodySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(300).nullable().optional()
});

export const patchImageCaptionBodySchema = z
  .object({
    caption: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z.string().max(300).nullable().optional()
    )
  })
  .transform((body) => ({
    caption: body.caption === '' ? null : body.caption ?? null
  }));

export const folderCoverBodySchema = z.object({
  imageId: z.coerce.number().int().positive()
});

const submittedPasswordSchema = z
  .string()
  .min(1, 'Password is required.')
  .max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
const submittedCurrentPasswordSchema = z
  .string()
  .min(1, 'Current password is required.')
  .max(AUTH_PASSWORD_MAX_LENGTH, `Current password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`);
const passwordFieldSchema = z
  .string()
  .min(AUTH_PASSWORD_MIN_LENGTH, `Password must be at least ${AUTH_PASSWORD_MIN_LENGTH} characters.`)
  .max(AUTH_PASSWORD_MAX_LENGTH, `Password must be at most ${AUTH_PASSWORD_MAX_LENGTH} characters.`)
  .refine((value) => value.trim().length > 0, 'Password cannot be empty.');
const loginBodySchema = z.object({
  password: submittedPasswordSchema
});
const configurePasswordBodySchema = z.object({
  password: passwordFieldSchema
});
const changePasswordBodySchema = z.object({
  currentPassword: submittedCurrentPasswordSchema,
  password: passwordFieldSchema
});
const disablePasswordBodySchema = z.object({
  currentPassword: submittedCurrentPasswordSchema
});
const viewerAccessBodySchema = z
  .object({
    mode: z.enum(['off', 'password', 'public']),
    viewerPassword: passwordFieldSchema.optional()
  })
  .superRefine((body, context) => {
    if (body.mode === 'password' && !body.viewerPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Viewer password is required when viewer access mode is password.',
        path: ['viewerPassword']
      });
    }
  });
const createShareLinkBodySchema = z
  .object({
    expiresIn: z.enum(['1h', '24h', '7d', 'custom', 'unlimited']).default('24h'),
    customExpiresAt: z.string().datetime().nullable().optional(),
    unlimited: z.boolean().default(false)
  })
  .superRefine((body, context) => {
    if (body.unlimited || body.expiresIn === 'unlimited') {
      return;
    }

    if (body.expiresIn === 'custom' && !body.customExpiresAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Custom expiration date is required.',
        path: ['customExpiresAt']
      });
      return;
    }

    if (body.customExpiresAt && Date.parse(body.customExpiresAt) <= Date.now()) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Share links must expire in the future.',
        path: ['customExpiresAt']
      });
    }
  });
const shareTokenBodySchema = z.object({
  token: z.string().trim().min(1).max(512)
});
const sharePasswordBodySchema = z.object({
  password: z
    .string()
    .min(FOLDER_SHARE_PASSWORD_MIN_LENGTH, `Password must be at least ${FOLDER_SHARE_PASSWORD_MIN_LENGTH} characters.`)
    .max(FOLDER_SHARE_PASSWORD_MAX_LENGTH, `Password must be at most ${FOLDER_SHARE_PASSWORD_MAX_LENGTH} characters.`)
    .refine((value) => value.trim().length > 0, 'Password cannot be empty.')
});
const submittedSharePasswordBodySchema = z.object({
  password: z
    .string()
    .min(1, 'Password is required.')
    .max(FOLDER_SHARE_PASSWORD_MAX_LENGTH, `Password must be at most ${FOLDER_SHARE_PASSWORD_MAX_LENGTH} characters.`)
});
const scanFoldersBodySchema = z.object({
  folders: z.array(z.string().trim().min(1).max(2048)).max(5000)
});

export const authRequestBodySchemas = {
  login: loginBodySchema,
  configurePassword: configurePasswordBodySchema,
  changePassword: changePasswordBodySchema,
  disablePassword: disablePasswordBodySchema,
  viewerAccess: viewerAccessBodySchema
};

export const settingsRequestBodySchemas = {
  sharePublicBaseUrl: publicBaseUrlBodySchema,
  homeFeedDefault: homeFeedDefaultBodySchema,
  appLocale: appLocaleBodySchema,
  reelsFeedDefault: reelsFeedDefaultBodySchema,
  folderImageOrderDefault: folderImageOrderDefaultBodySchema,
  nestedFolderTitleFormat: nestedFolderTitleFormatBodySchema,
  storiesMode: storiesModeBodySchema,
  videoPlaybackQuality: videoPlaybackQualityBodySchema,
  excludedFolders: excludedFoldersBodySchema,
  scanFolders: scanFoldersBodySchema
};

export const routeParamSchemas = {
  slug: slugSchema,
  momentId: momentIdSchema,
  storyId: storyIdSchema,
  imageId: imageIdSchema
};

const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many authentication attempts. Please try again in a minute.'
});
const shareUnlockRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many share unlock attempts. Please try again in a minute.'
});

function resolveShareLinkExpiration(body: z.infer<typeof createShareLinkBodySchema>): Date | null {
  if (body.unlimited || body.expiresIn === 'unlimited') {
    return null;
  }

  if (body.expiresIn === 'custom') {
    return new Date(body.customExpiresAt as string);
  }

  const durationMs =
    body.expiresIn === '1h'
      ? 60 * 60 * 1000
      : body.expiresIn === '7d'
        ? 7 * 24 * 60 * 60 * 1000
        : 24 * 60 * 60 * 1000;

  return new Date(Date.now() + durationMs);
}

function setShareResponseHeaders(response: express.Response): void {
  response.setHeader('Cache-Control', 'private, no-store');
  response.vary('Cookie');
}

function sendShareAccessDenied(response: express.Response, status = 401): void {
  setShareResponseHeaders(response);
  response.status(status).json({ message: 'This folder share is expired, revoked, or locked.' });
}

/**
 * Post shares answer 404 rather than 401: a bad token should not confirm that some
 * other post exists behind it, and there is no unlock step to send the viewer to.
 */
function sendPostShareAccessDenied(response: express.Response): void {
  setShareResponseHeaders(response);
  response.status(404).json({ message: 'This share link is expired, revoked, or invalid.' });
}

function ensureShareFolderAccess(request: express.Request, response: express.Response, folderId: number): boolean {
  if (!folderShareService.getFolderGrant(request, folderId)) {
    sendShareAccessDenied(response);
    return false;
  }

  setShareResponseHeaders(response);
  return true;
}

const PUBLIC_SENSITIVE_MEDIA_KEYS = new Set([
  'absolutePath',
  'exif',
  'exifJson',
  'relativePath',
  'sourcePath'
]);

function redactPublicMediaMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactPublicMediaMetadata(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !PUBLIC_SENSITIVE_MEDIA_KEYS.has(key))
      .map(([key, item]) => [key, redactPublicMediaMetadata(item)])
  );
}

router.use((request, response, next) => {
  const isAnonymousPublicViewer =
    authService.isPublicViewerAccessEnabled() &&
    !authService.isAuthenticatedRequest(request);

  if (!isAnonymousPublicViewer || request.method.toUpperCase() !== 'GET') {
    next();
    return;
  }

  const sendJson = response.json.bind(response);
  response.json = ((body: unknown) => sendJson(redactPublicMediaMetadata(body))) as typeof response.json;
  next();
});

router.get('/health', (_request, response) => {
  const storageState = storageService.getState();
  response.json({
    ok: true,
    timestamp: new Date().toISOString(),
    storage: {
      available: storageState.libraryAvailable,
      reason: storageState.reason,
      usingInMemoryDatabase: storageState.usingInMemoryDatabase
    }
  });
});

router.get('/auth/status', (request, response) => {
  authService.setNoStoreHeaders(response);
  response.json(authService.getStatus(request));
});

router.post('/auth/login', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Password protection is not enabled.' });
    return;
  }

  const body = loginBodySchema.parse(request.body);
  const role = authService.authenticatePassword(body.password);
  if (!role) {
    response.status(401).json({ message: 'Incorrect password.' });
    return;
  }

  authService.setAuthenticatedSession(response, request, role);
  response.json({
    ok: true,
    auth: authService.getAuthenticatedStatus(role)
  });
});

router.post('/auth/unlock-admin', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Password protection is not enabled.' });
    return;
  }

  const body = loginBodySchema.parse(request.body);
  if (!authService.verifyAdminPassword(body.password)) {
    response.status(401).json({ message: 'Incorrect admin password.' });
    return;
  }

  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth: authService.getAuthenticatedStatus('admin')
  });
});

router.post('/auth/logout', (request, response) => {
  authService.setNoStoreHeaders(response);
  authService.clearAuthenticatedSession(response, request);
  response.json({
    ok: true,
    auth: authService.getLoggedOutStatus()
  });
});

router.put('/auth/password', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    const body = configurePasswordBodySchema.parse(request.body);
    const auth = authService.setAdminPassword(body.password);
    authService.setAuthenticatedSession(response, request, 'admin');
    response.json({
      ok: true,
      auth
    });
    return;
  }

  if (!authService.hasCapability(request, 'canAccessSettings')) {
    response.status(403).json({ message: 'Admin access is required.' });
    return;
  }

  const body = changePasswordBodySchema.parse(request.body);
  if (!authService.verifyAdminPassword(body.currentPassword)) {
    response.status(401).json({ message: 'Incorrect current password.' });
    return;
  }

  const auth = authService.setAdminPassword(body.password);
  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth
  });
});

router.delete('/auth/password', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Password protection is already disabled.' });
    return;
  }

  if (!authService.hasCapability(request, 'canAccessSettings')) {
    response.status(403).json({ message: 'Admin access is required.' });
    return;
  }

  const body = disablePasswordBodySchema.parse(request.body);
  if (!authService.verifyAdminPassword(body.currentPassword)) {
    response.status(401).json({ message: 'Incorrect current password.' });
    return;
  }

  const auth = authService.disable();
  authService.clearAuthenticatedSession(response, request);
  response.json({
    ok: true,
    auth
  });
});

router.put('/auth/viewer-access', authRateLimiter, (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    response.status(400).json({ message: 'Enable the admin password before configuring viewer access.' });
    return;
  }

  if (!authService.hasCapability(request, 'canAccessSettings')) {
    response.status(403).json({ message: 'Admin access is required.' });
    return;
  }

  const body = viewerAccessBodySchema.parse(request.body);
  const auth = authService.setViewerAccess(body.mode, body.viewerPassword ?? null);
  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth
  });
});

router.get('/feed', (request, response) => {
  const query = feedQuerySchema.parse(request.query);
  response.json(galleryService.getFeed(query.page, query.limit, query.mode, query.seed, query.exclude));
});

router.get('/reels', (request, response) => {
  const query = reelsQuerySchema.parse(request.query);
  const recentOpenedFolderSlugs = query.recentFolders
    ? query.recentFolders
        .split(',')
        .map((slug) => slug.trim())
        .filter((slug, index, items) => slug.length > 0 && items.indexOf(slug) === index)
    : [];

  response.json(
    galleryService.getReels(query.page, query.limit, query.mode, query.seed, {
      lastOpenedFolderSlug: query.lastFolder ?? null,
      recentOpenedFolderSlugs
    })
  );
});

router.get('/feed/search', (request, response) => {
  const query = mediaSearchQuerySchema.parse(request.query);
  response.json(galleryService.searchMedia(query.q, query.page, query.limit));
});

async function resolveScanProgress(): Promise<ScanProgressSnapshot> {
  if (!isRemoteScanWorkerEnabled()) {
    return scannerService.getProgress();
  }

  return fetchRemoteScanProgress();
}

router.get('/status', async (_request, response) => {
  const progress = await resolveScanProgress();
  response.json(galleryService.getStatus(galleryService.getScanProgress(progress)));
});

router.get('/scan-progress', async (_request, response) => {
  response.json(galleryService.getScanProgress(await resolveScanProgress()));
});

router.get('/admin/scan-progress', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => {
  response.json(galleryService.getAdminScanProgress(await resolveScanProgress()));
});

router.get('/admin/scan-folders', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => {
  response.json({
    folders: await scannerService.listAvailableScanFolders(),
    selectedFolders: scannerService.getSelectedScanFolders()
  });
});

router.put(
  '/admin/settings/app-locale',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = appLocaleBodySchema.parse(request.body);
    response.json(galleryService.setDefaultLocale(body.defaultLocale));
  }
);

router.put(
  '/admin/settings/home-feed-default',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = homeFeedDefaultBodySchema.parse(request.body);
    response.json(galleryService.setDefaultHomeFeedMode(body.defaultMode));
  }
);

router.put(
  '/admin/settings/reels-feed-default',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = reelsFeedDefaultBodySchema.parse(request.body);
    response.json(galleryService.setDefaultReelsFeedMode(body.defaultMode));
  }
);

router.put(
  '/admin/settings/folder-image-order-default',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = folderImageOrderDefaultBodySchema.parse(request.body);
    response.json(galleryService.setDefaultFolderImageOrder(body.defaultOrder));
  }
);

router.put(
  '/admin/settings/nested-folder-title-format',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = nestedFolderTitleFormatBodySchema.parse(request.body);
    response.json(galleryService.setNestedFolderTitleFormat(body.titleFormat));
  }
);

router.put(
  '/admin/settings/video-playback-quality',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = videoPlaybackQualityBodySchema.parse(request.body);
    response.json(galleryService.setVideoPlaybackQuality(body.videoPlaybackQuality));
  }
);

router.put(
  '/admin/settings/share-public-base-url',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = publicBaseUrlBodySchema.parse(request.body);
    response.json(galleryService.setSharePublicBaseUrl(body.publicBaseUrl));
  }
);

router.put(
  '/admin/settings/stories-mode',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = storiesModeBodySchema.parse(request.body);
    response.json(galleryService.setTreatStoriesAsFolders(body.treatStoriesAsFolders));
  }
);

router.put(
  '/admin/settings/excluded-folders',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  (request, response) => {
    const body = excludedFoldersBodySchema.parse(request.body);
    response.json(galleryService.setExcludedFolders(body.rules));
  }
);

router.put(
  '/admin/settings/scan-folders',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const body = scanFoldersBodySchema.parse(request.body);
    try {
      response.json(scannerService.setSelectedScanFolders(body.folders));
    } catch (error) {
      response.status(400).json({ message: error instanceof Error ? error.message : 'Invalid scan folders.' });
    }
  }
);

router.get('/feed/moments', (_request, response) => {
  response.json(galleryService.listMoments());
});

router.get('/feed/moments/:id', (request, response) => {
  const params = momentIdSchema.parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const payload = galleryService.getMomentFeed(params.id, query.page, query.limit);

  if (!payload) {
    response.status(404).json({ message: 'Feed capsule not found' });
    return;
  }

  response.json(payload);
});

router.get('/folders', (_request, response) => {
  response.json({
    items: galleryService.listFolders()
  });
});

router.get('/folders/:slug', (request, response) => {
  const params = slugSchema.parse(request.params);
  const folder = galleryService.getFolderBySlug(params.slug);

  if (!folder) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(folder);
});

router.patch('/folders/:slug', requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = patchFolderBodySchema.parse(request.body);
  const updated = galleryService.updateFolderMetadata(params.slug, body.name, body.description ?? null);

  if (!updated) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(updated);
});

router.post('/folders/:slug/cover', requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = folderCoverBodySchema.parse(request.body);
  const success = galleryService.setFolderAvatar(params.slug, body.imageId);

  if (!success) {
    response.status(404).json({ message: 'Folder or image not found' });
    return;
  }

  response.json({ ok: true });
});

router.get(
  '/admin/folders/:slug/share-links',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = slugSchema.parse(request.params);
    const payload = folderShareService.listLinks(params.slug);

    if (!payload) {
      response.status(404).json({ message: 'Folder not found' });
      return;
    }

    response.json({
      links: payload.links,
      password: payload.password,
      publicFolderUrl: `/folders/${encodeURIComponent(payload.folder.slug)}`,
      publicAccess: !authService.isEnabled() || authService.isPublicViewerAccessEnabled()
    });
  }
);

router.post(
  '/admin/folders/:slug/share-links',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = slugSchema.parse(request.params);
    const body = createShareLinkBodySchema.parse(request.body);
    const created = folderShareService.createLink(params.slug, {
      expiresAt: resolveShareLinkExpiration(body)
    });

    if (!created) {
      response.status(404).json({ message: 'Folder not found' });
      return;
    }

    response.status(201).json({
      ok: true,
      shareUrl: `/share/${encodeURIComponent(created.folder.slug)}#token=${encodeURIComponent(created.rawToken)}`,
      link: created.link
    });
  }
);

router.delete(
  '/admin/folders/:slug/share-links/:linkId',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = slugSchema.merge(shareLinkIdSchema).parse(request.params);
    const link = folderShareService.revokeLink(params.slug, params.linkId);

    if (!link) {
      response.status(404).json({ message: 'Share link not found' });
      return;
    }

    response.json({
      ok: true,
      link
    });
  }
);

router.put(
  '/admin/folders/:slug/share-password',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = slugSchema.parse(request.params);
    const body = sharePasswordBodySchema.parse(request.body);
    const password = folderShareService.setPassword(params.slug, body.password);

    if (!password) {
      response.status(404).json({ message: 'Folder not found' });
      return;
    }

    response.json({
      ok: true,
      password: {
        enabled: password.enabled,
        updatedAt: password.updatedAt
      }
    });
  }
);

router.delete(
  '/admin/folders/:slug/share-password',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = slugSchema.parse(request.params);
    const password = folderShareService.removePassword(params.slug);

    if (!password) {
      response.status(404).json({ message: 'Folder not found' });
      return;
    }

    response.json({
      ok: true,
      password: {
        enabled: false,
        updatedAt: null
      }
    });
  }
);

router.delete('/folders/:slug', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = deleteFolderQuerySchema.parse(request.query);
  const deleted = await galleryService.deleteFolder(params.slug, {
    deleteSourceFolder: query.deleteSourceFolder
  });

  if (!deleted) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json({
    ok: true,
    ...deleted
  });
});

router.get('/folders/:slug/images', (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query);
  const payload = galleryService.getFolderImages(params.slug, query.page, query.limit, query.mediaType);

  if (!payload) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(payload);
});

router.get('/share/folders/:slug/access', (request, response) => {
  const params = slugSchema.parse(request.params);
  const access = folderShareService.getAccessState(request, params.slug);

  if (!access.exists) {
    response.status(404).json({ message: 'Folder share not found' });
    return;
  }

  setShareResponseHeaders(response);
  response.json(access);
});

router.post('/share/folders/:slug/unlock-link', shareUnlockRateLimiter, (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = shareTokenBodySchema.parse(request.body);
  const grant = folderShareService.verifyLinkToken(params.slug, body.token);

  if (!grant) {
    folderShareService.clearShareSession(response, request);
    sendShareAccessDenied(response, 403);
    return;
  }

  folderShareService.setShareSession(response, request, grant);
  setShareResponseHeaders(response);
  response.json({ ok: true });
});

router.post('/share/folders/:slug/unlock-password', shareUnlockRateLimiter, (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = submittedSharePasswordBodySchema.parse(request.body);
  const grant = folderShareService.verifyPassword(params.slug, body.password);

  if (!grant) {
    folderShareService.clearShareSession(response, request);
    sendShareAccessDenied(response);
    return;
  }

  folderShareService.setShareSession(response, request, grant);
  setShareResponseHeaders(response);
  response.json({ ok: true });
});

router.get('/share/folders/:slug', (request, response) => {
  const params = slugSchema.parse(request.params);
  const folder = galleryService.getSharedFolderBySlug(params.slug);

  if (!folder) {
    response.status(404).json({ message: 'Folder share not found' });
    return;
  }

  if (!ensureShareFolderAccess(request, response, folder.id)) {
    return;
  }

  response.json(folder);
});

router.get('/share/folders/:slug/images', (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query);
  const payload = galleryService.getSharedFolderImages(params.slug, query.page, query.limit, query.mediaType);

  if (!payload) {
    response.status(404).json({ message: 'Folder share not found' });
    return;
  }

  if (!ensureShareFolderAccess(request, response, payload.folder.id)) {
    return;
  }

  response.json(payload);
});

router.get('/share/images/:id', (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const query = mediaTypeQuerySchema.parse(request.query);
  const image = galleryService.getSharedImageDetail(params.id, query.mediaType, { isLegacyImageAlias: true });

  if (!image) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  if (!ensureShareFolderAccess(request, response, image.folderId)) {
    return;
  }

  response.json(image);
});

router.get('/share/posts/:id', (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const query = mediaTypeQuerySchema.parse(request.query);
  const image = galleryService.getSharedImageDetail(params.id, query.mediaType);

  if (!image) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  if (!ensureShareFolderAccess(request, response, image.folderId)) {
    return;
  }

  response.json(image);
});

/**
 * Post-level share links.
 *
 * A folder token unlocks a whole album; these unlock exactly one post. The token stays
 * in the URL of every asset the shared page loads, so there is no unlock step and no
 * cookie: a link is self-contained and works for someone with no account at all.
 */
const POST_SHARE_GRANTS = new WeakMap<express.Request, PostShareGrant>();

function resolvePostShareGrant(request: express.Request): PostShareGrant | null {
  const cached = POST_SHARE_GRANTS.get(request);
  if (cached) {
    return cached;
  }

  const parsed = shareTokenParamSchema.safeParse(request.params);
  if (!parsed.success) {
    return null;
  }

  const grant = postShareService.verifyToken(parsed.data.token, { touch: true });
  if (grant) {
    POST_SHARE_GRANTS.set(request, grant);
  }

  return grant;
}

function getConfiguredSharePublicBaseUrl(): string | null {
  return normalizePublicBaseUrl(appSettingsRepository.get(SHARE_PUBLIC_BASE_URL_SETTING_KEY));
}

/**
 * A LAN address is only reachable on the LAN, and an external address cannot be guessed
 * from the request once a reverse proxy is in front, so links follow whichever entry
 * point the operator is actually using.
 */
function buildPostShareUrl(request: express.Request, token: string): string {
  const path = `/s/${encodeURIComponent(token)}`;
  const baseUrl = resolveShareBaseUrl(
    {
      forwardedHost: request.get('x-forwarded-host'),
      forwardedProto: request.get('x-forwarded-proto'),
      host: request.get('host'),
      secure: request.secure
    },
    getConfiguredSharePublicBaseUrl()
  );

  return baseUrl ? `${baseUrl}${path}` : path;
}

router.get(
  '/share/posts/:id/links',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = imageIdSchema.parse(request.params);
    const payload = postShareService.listLinks(params.id);

    if (!payload) {
      response.status(404).json({ message: 'Post not found' });
      return;
    }

    response.json({
      links: payload.links,
      publicBaseUrl: getConfiguredSharePublicBaseUrl()
    });
  }
);

router.post(
  '/share/posts/:id',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = imageIdSchema.parse(request.params);
    const body = createShareLinkBodySchema.parse(request.body ?? {});
    const created = postShareService.createLink(params.id, {
      expiresAt: resolveShareLinkExpiration(body)
    });

    if (!created) {
      response.status(404).json({ message: 'Post not found' });
      return;
    }

    response.status(201).json({
      ok: true,
      link: created.link,
      shareUrl: buildPostShareUrl(request, created.rawToken),
      sharePath: `/s/${encodeURIComponent(created.rawToken)}`
    });
  }
);

router.delete(
  '/share/posts/:id/links/:linkId',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  (request, response) => {
    const params = imageIdSchema.merge(shareLinkIdSchema).parse(request.params);
    const link = postShareService.revokeLink(params.id, params.linkId);

    if (!link) {
      response.status(404).json({ message: 'Share link not found' });
      return;
    }

    response.json({ ok: true, link });
  }
);

router.get('/share/post-links/:token', (request, response) => {
  const grant = resolvePostShareGrant(request);
  if (!grant) {
    sendPostShareAccessDenied(response);
    return;
  }

  const params = shareTokenParamSchema.parse(request.params);
  const assetBasePath = `/api/share/post-links/${encodeURIComponent(params.token)}/images`;
  const streamBasePath = `/api/share/post-links/${encodeURIComponent(params.token)}/videos`;
  const detail = galleryService.getTokenSharedPostDetail(grant.postId, assetBasePath, streamBasePath);

  if (!detail) {
    sendPostShareAccessDenied(response);
    return;
  }

  setShareResponseHeaders(response);
  response.json(detail);
});

router.get('/share/post-links/:token/images/:id/thumbnail', async (request, response) => {
  const grant = resolvePostShareGrant(request);
  const params = imageIdSchema.parse(request.params);

  if (!grant || !postShareService.grantCoversImage(grant, params.id)) {
    sendPostShareAccessDenied(response);
    return;
  }

  const image = galleryService.getShareDerivativeImage(params.id);
  if (!image) {
    response.status(404).json({ message: 'Thumbnail not found' });
    return;
  }

  setShareResponseHeaders(response);
  await serveDerivativeForImage(response, image, 'thumbnail', { noStore: true });
});

router.get('/share/post-links/:token/images/:id/preview', async (request, response) => {
  const grant = resolvePostShareGrant(request);
  const params = imageIdSchema.parse(request.params);

  if (!grant || !postShareService.grantCoversImage(grant, params.id)) {
    sendPostShareAccessDenied(response);
    return;
  }

  const image = galleryService.getShareDerivativeImage(params.id);
  if (!image) {
    response.status(404).json({ message: 'Preview not found' });
    return;
  }

  setShareResponseHeaders(response);

  if (image.media_type === 'video') {
    const originalMedia = galleryService.getOriginalMediaFile(image.id);

    if (!originalMedia) {
      response.status(404).json({ message: 'Preview not found' });
      return;
    }

    applyNoStoreMediaHeaders(response);
    response.sendFile(originalMedia.path);
    return;
  }

  await serveDerivativeForImage(response, image, 'preview', { noStore: true });
});

router.use(
  '/share/post-links/:token/videos',
  createVideoStreamRouter({
    authorizeImage: (request, imageId) => {
      // `request.params` here belongs to the mount path, so the token is still visible.
      const grant = resolvePostShareGrant(request);
      return Boolean(grant && postShareService.grantCoversImage(grant, imageId));
    },
    buildPlaylistPath: (request, imageId, quality) => {
      const token = String((request.params as { token?: string }).token ?? '');
      return `/api/share/post-links/${encodeURIComponent(token)}/videos/${imageId}/hls/${quality}/index.m3u8`;
    }
  })
);

router.get('/share/images/:id/thumbnail', async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const image = galleryService.getShareDerivativeImage(params.id);

  if (!image) {
    response.status(404).json({ message: 'Thumbnail not found' });
    return;
  }

  if (!ensureShareFolderAccess(request, response, image.folder_id)) {
    return;
  }

  await serveDerivativeForImage(response, image, 'thumbnail', { noStore: true });
});

router.get('/share/images/:id/preview', async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const image = galleryService.getShareDerivativeImage(params.id);

  if (!image) {
    response.status(404).json({ message: 'Preview not found' });
    return;
  }

  if (!ensureShareFolderAccess(request, response, image.folder_id)) {
    return;
  }

  if (image.media_type === 'video') {
    // Videos have no preview derivative; shared links stream the original file,
    // which Express serves with range support so seeking still works.
    const originalMedia = galleryService.getOriginalMediaFile(image.id);

    if (!originalMedia) {
      response.status(404).json({ message: 'Preview not found' });
      return;
    }

    applyNoStoreMediaHeaders(response);
    response.sendFile(originalMedia.path);
    return;
  }

  await serveDerivativeForImage(response, image, 'preview', { noStore: true });
});

router.get('/places', (_request, response) => {
  response.json({
    items: galleryService.listPlaces()
  });
});

router.get('/places/:slug', (request, response) => {
  const params = slugSchema.parse(request.params);
  const place = galleryService.getPlaceBySlug(params.slug);

  if (!place) {
    response.status(404).json({ message: 'Place not found' });
    return;
  }

  response.json(place);
});

router.get('/places/:slug/images', (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query);
  const payload = galleryService.getPlaceImages(params.slug, query.page, query.limit, query.mediaType);

  if (!payload) {
    response.status(404).json({ message: 'Place not found' });
    return;
  }

  response.json(payload);
});

router.get('/folders/:slug/stories', (request, response) => {
  const params = slugSchema.parse(request.params);
  const payload = galleryService.getFolderStories(params.slug);

  if (!payload) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(payload);
});

router.get('/folders/:slug/stories/:id', (request, response) => {
  const params = slugSchema.merge(storyIdSchema).parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const payload = galleryService.getFolderStoryFeed(params.slug, params.id, query.page, query.limit);

  if (!payload) {
    response.status(404).json({ message: 'Story capsule not found' });
    return;
  }

  response.json(payload);
});

router.get('/likes', requireCapability('canUseSharedLikes', 'Authentication required.'), (_request, response) => {
  response.json(galleryService.getLikes());
});

router.get('/collections', requireCapability('canUseSharedCollections', 'Authentication required.'), (_request, response) => {
  response.json(galleryService.getCollections());
});

router.post('/collections', requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const body = collectionBodySchema.parse(request.body);
  const collection = galleryService.createCollection(body.name);

  if (!collection) {
    response.status(404).json({ message: 'Collection could not be created' });
    return;
  }

  response.json({
    ok: true,
    collection
  });
});

router.patch('/collections/:slug', requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = collectionBodySchema.parse(request.body);
  const collection = galleryService.updateCollection(params.slug, body.name);

  if (!collection) {
    response.status(404).json({ message: 'Collection not found' });
    return;
  }

  response.json({
    ok: true,
    collection
  });
});

router.delete('/collections/:slug', requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = slugSchema.parse(request.params);
  const collection = galleryService.deleteCollection(params.slug);

  if (!collection) {
    response.status(404).json({ message: 'Collection not found' });
    return;
  }

  response.json({
    ok: true,
    collection
  });
});

router.get('/collections/:slug/images', requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const payload = galleryService.getCollectionImages(params.slug, query.page, query.limit);

  if (!payload) {
    response.status(404).json({ message: 'Collection not found' });
    return;
  }

  response.json(payload);
});

router.post(['/collections/:slug/posts/:id', '/collections/:slug/images/:id'], requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = slugSchema.merge(imageIdSchema).parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.addImageToCollection(params.slug, params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Collection or image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete(['/collections/:slug/posts/:id', '/collections/:slug/images/:id'], requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = slugSchema.merge(imageIdSchema).parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.removeImageFromCollection(params.slug, params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Collection or image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.get('/trash/images', requireCapability('canDeleteMedia', 'Admin access is required.'), (request, response) => {
  const query = paginationQuerySchema.parse(request.query);
  response.json(galleryService.getTrashImages(query.page, query.limit));
});

// Batch deletion runs server-side so closing the app does not stop it.
router.post(
  '/posts/deletions/batch',
  requireCapability('canDeleteMedia', 'Admin access is required.'),
  (request, response) => {
    const body = permanentDeletionBatchBodySchema.parse(request.body);
    response.json({
      ok: true,
      job: deletionJobService.enqueue(body.ids)
    });
  }
);

router.get(
  '/posts/deletions/batch',
  requireCapability('canDeleteMedia', 'Admin access is required.'),
  (_request, response) => {
    response.json({
      ok: true,
      job: deletionJobService.getSnapshot()
    });
  }
);

router.delete(
  '/posts/deletions/batch',
  requireCapability('canDeleteMedia', 'Admin access is required.'),
  (_request, response) => {
    response.json({
      ok: true,
      job: deletionJobService.acknowledgeFinished()
    });
  }
);

router.get(['/posts/:id', '/images/:id'], (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const query = mediaTypeQuerySchema.parse(request.query);
  const isLegacyImageAlias = request.path.includes('/images/');
  const image = galleryService.getImageDetail(params.id, query.mediaType, { isLegacyImageAlias });

  if (!image) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json(image);
});

router.patch(['/posts/:id/caption', '/images/:id/caption'], requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const body = patchImageCaptionBodySchema.parse(request.body);
  const isLegacyImageAlias = request.path.includes('/images/');
  const image = galleryService.updateImageCaption(params.id, body.caption, { isLegacyImageAlias });

  if (!image) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    image
  });
});

router.get(['/posts/:id/collections', '/images/:id/collections'], requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.getImageCollections(params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json(payload);
});

router.post(['/posts/:id/save', '/images/:id/save'], requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.saveImage(params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete(['/posts/:id/save', '/images/:id/save'], requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.unsaveImage(params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post(['/posts/:id/like', '/images/:id/like'], requireCapability('canUseSharedLikes', 'Authentication required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.likeImage(params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete(['/posts/:id/like', '/images/:id/like'], requireCapability('canUseSharedLikes', 'Authentication required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.unlikeImage(params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post(['/posts/:id/trash', '/images/:id/trash'], requireCapability('canDeleteMedia', 'Admin access is required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.trashImage(params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post(['/posts/:id/restore', '/images/:id/restore'], requireCapability('canDeleteMedia', 'Admin access is required.'), (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const payload = galleryService.restoreImage(params.id, { isLegacyImageAlias });

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete(['/posts/:id', '/images/:id'], requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const isLegacyImageAlias = request.path.includes('/images/');
  const deleted = await galleryService.deleteImage(params.id, { isLegacyImageAlias });

  if (!deleted) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    ...deleted
  });
});

router.get('/originals/:id', (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const query = originalMediaQuerySchema.parse(request.query);
  const originalMedia = galleryService.getOriginalMediaFile(params.id);

  if (!originalMedia) {
    response.status(404).json({ message: 'Original media not found' });
    return;
  }

  if (query.download) {
    response.download(originalMedia.path, originalMedia.filename);
    return;
  }

  if (appConfig.mediaAccelRedirectPrefix) {
    const relativePath = path.relative(appConfig.galleryRoot, originalMedia.path);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      response.status(404).json({ message: 'Original media not found' });
      return;
    }

    const encodedPath = relativePath.split(path.sep).map(encodeURIComponent).join('/');
    response.setHeader('X-Accel-Redirect', `${appConfig.mediaAccelRedirectPrefix}/${encodedPath}`);
    response.status(200).end();
    return;
  }

  response.sendFile(originalMedia.path);
});

const adminMutationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many administrative requests. Please try again in a minute.'
});

const requireNoScanInProgress = async (_request: express.Request, response: express.Response, next: express.NextFunction) => {
  try {
    if (!(await resolveScanProgress()).isScanning) {
      next();
      return;
    }

    response.status(429).json({
      message: 'A scan or rebuild is already in progress.'
    });
  } catch (error) {
    response.status(503).json({
      message: error instanceof Error ? error.message : 'The scan worker is unavailable.'
    });
  }
};

router.post(
  '/admin/rescan',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  requireNoScanInProgress,
  async (_request, response) => {
  try {
    if (isRemoteScanWorkerEnabled()) {
      const requested = await requestRemoteScan('manual');
      response.status(202).json(requested);
      return;
    }

    if (scannerService.isLibraryRebuildRequired()) {
      response.status(409).json({
        message: LIBRARY_REBUILD_REQUIRED_MESSAGE
      });
      return;
    }

    const lastScan = await scannerService.scanAll('manual');
    await watcherService.start();
    response.json({
      ok: true,
      lastScan
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to run a manual scan.';
    const status = /rebuild required/i.test(message) ? 409 : 500;
    response.status(status).json({ message });
  }
});

router.post(
  '/admin/rebuild-index',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  requireNoScanInProgress,
  async (_request, response) => {
  if (isRemoteScanWorkerEnabled()) {
    const requested = await requestRemoteScan('rebuild');
    response.status(202).json(requested);
    return;
  }

  await watcherService.stop();

  try {
    const lastScan = await scannerService.rebuildLibraryIndex('rebuild');
    response.json({
      ok: true,
      lastScan
    });
  } finally {
    await watcherService.start();
  }
});

router.post(
  '/admin/rebuild-thumbnails',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  requireNoScanInProgress,
  async (_request, response) => {
  if (isRemoteScanWorkerEnabled()) {
    const requested = await requestRemoteScan('rebuild-thumbnails');
    response.status(202).json(requested);
    return;
  }

  if (scannerService.isLibraryRebuildRequired()) {
    response.status(409).json({
      message: LIBRARY_REBUILD_REQUIRED_MESSAGE
    });
    return;
  }

  await watcherService.stop();

  try {
    const lastScan = await scannerService.rebuildThumbnails('rebuild-thumbnails');
    response.json({
      ok: true,
      lastScan
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to regenerate thumbnails.';
    const status = /rebuild required/i.test(message) ? 409 : 500;
    response.status(status).json({ message });
  } finally {
    await watcherService.start();
  }
});

router.get('/admin/places/status', requireCapability('canAccessSettings', 'Admin access is required.'), (_request, response) => {
  response.json(galleryService.getPlacesStatus());
});

router.post(
  '/admin/places/geodata/prepare',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  async (_request, response) => {
  try {
    response.json({
      ok: true,
      status: await galleryService.preparePlacesGeodata()
    });
  } catch (error) {
    response.status(500).json({
      message: error instanceof Error ? error.message : 'Unable to prepare offline place data.'
    });
  }
});

router.post(
  '/admin/places/rebuild',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  (_request, response) => {
  response.json({
    ok: true,
    ...galleryService.rebuildPlaces()
  });
});

router.post('/admin/settings/carousels-as-folders', requireCapability('canAccessSettings', 'Admin access is required.'), adminMutationRateLimiter, (request, response) => {
  const payloadSchema = z.object({
    treatCarouselsAsFolders: z.boolean()
  });

  const body = payloadSchema.parse(request.body);

  try {
    const stats = galleryService.setTreatCarouselsAsFolders(body.treatCarouselsAsFolders);
    response.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update carousels mode.';
    response.status(500).json({ message });
  }
});

router.post('/admin/settings/carousels-migration-decision', requireCapability('canAccessSettings', 'Admin access is required.'), adminMutationRateLimiter, (request, response) => {
  const payloadSchema = z.object({
    decision: z.enum(['restore', 'carousels'])
  });

  const body = payloadSchema.parse(request.body);

  try {
    const stats = galleryService.setCarouselsMigrationDecision(body.decision);
    response.json(stats);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update carousels migration decision.';
    response.status(500).json({ message });
  }
});

router.get('/admin/stats', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => {
  response.json(galleryService.getStats(galleryService.getAdminScanProgress(await resolveScanProgress())));
});

export { router as apiRouter };
