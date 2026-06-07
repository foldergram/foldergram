import express from 'express';
import { z } from 'zod';

import { performance } from 'node:perf_hooks';

import { AUTH_PASSWORD_MAX_LENGTH, AUTH_PASSWORD_MIN_LENGTH, authService } from '../services/auth-service.js';
import { galleryService } from '../services/gallery-service.js';
import { requireCapability } from '../middleware/auth-protection.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
import { metricsService } from '../services/metrics-service.js';
import { LIBRARY_REBUILD_REQUIRED_MESSAGE, scannerService } from '../services/scanner-service.js';
import { storageService } from '../services/storage-service.js';
import { watcherService } from '../services/watcher-service.js';
import { databaseManager } from '../db/database.js';

const router = express.Router();

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
const feedQuerySchema = paginationQuerySchema.extend({
  mode: z.enum(['recent', 'rediscover', 'random']).default('random'),
  seed: z.coerce.number().int().nonnegative().optional()
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

export const authRequestBodySchemas = {
  login: loginBodySchema,
  configurePassword: configurePasswordBodySchema,
  changePassword: changePasswordBodySchema,
  disablePassword: disablePasswordBodySchema,
  viewerAccess: viewerAccessBodySchema
};

export const settingsRequestBodySchemas = {
  homeFeedDefault: homeFeedDefaultBodySchema,
  appLocale: appLocaleBodySchema,
  reelsFeedDefault: reelsFeedDefaultBodySchema,
  folderImageOrderDefault: folderImageOrderDefaultBodySchema,
  nestedFolderTitleFormat: nestedFolderTitleFormatBodySchema,
  storiesMode: storiesModeBodySchema,
  excludedFolders: excludedFoldersBodySchema
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

router.get('/db', requireCapability('canAccessSettings', 'Admin access required'), async (_request, response) => {
  const driver = await databaseManager.getConnection();
  const t = performance.now();
  let ok = false;
  let error: string | null = null;
  try {
    await driver.queryOne('SELECT 1');
    ok = true;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const latency_ms = Math.round(performance.now() - t);
  const stats = metricsService.getAllQueryStats();
  response.json({
    ok,
    dialect: driver.dialect,
    latency_ms,
    error,
    total_queries: stats.reduce((sum, s) => sum + s.count, 0),
    distinct_queries: stats.length
  });
});

router.get('/db/time', requireCapability('canAccessSettings', 'Admin access required'), (_request, response) => {
  response.json(metricsService.getAllQueryStats());
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

router.put('/auth/password', authRateLimiter, async (request, response) => {
  authService.setNoStoreHeaders(response);

  if (!authService.isEnabled()) {
    const body = configurePasswordBodySchema.parse(request.body);
    const auth = await authService.setAdminPassword(body.password);
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

  const auth = await authService.setAdminPassword(body.password);
  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth
  });
});

router.delete('/auth/password', authRateLimiter, async (request, response) => {
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

  const auth = await authService.disable();
  authService.clearAuthenticatedSession(response, request);
  response.json({
    ok: true,
    auth
  });
});

router.put('/auth/viewer-access', authRateLimiter, async (request, response) => {
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
  const auth = await authService.setViewerAccess(body.mode, body.viewerPassword ?? null);
  authService.setAuthenticatedSession(response, request, 'admin');
  response.json({
    ok: true,
    auth
  });
});

router.get('/feed', async (request, response) => {
  const query = feedQuerySchema.parse(request.query);
  response.json(await galleryService.getFeed(query.page, query.limit, query.mode, query.seed));
});

router.get('/reels', async (request, response) => {
  const query = reelsQuerySchema.parse(request.query);
  const recentOpenedFolderSlugs = query.recentFolders
    ? query.recentFolders
        .split(',')
        .map((slug) => slug.trim())
        .filter((slug, index, items) => slug.length > 0 && items.indexOf(slug) === index)
    : [];

  response.json(
    await galleryService.getReels(query.page, query.limit, query.mode, query.seed, {
      lastOpenedFolderSlug: query.lastFolder ?? null,
      recentOpenedFolderSlugs
    })
  );
});

router.get('/feed/search', async (request, response) => {
  const query = mediaSearchQuerySchema.parse(request.query);
  response.json(await galleryService.searchMedia(query.q, query.page, query.limit));
});

router.get('/status', async (_request, response) => {
  response.json(await galleryService.getStatus());
});

router.get('/scan-progress', async (_request, response) => {
  response.json(await galleryService.getScanProgress());
});

router.get('/admin/scan-progress', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => {
  response.json(await galleryService.getAdminScanProgress());
});

router.put(
  '/admin/settings/app-locale',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  async (request, response) => {
    const body = appLocaleBodySchema.parse(request.body);
    response.json(await galleryService.setDefaultLocale(body.defaultLocale));
  }
);

router.put(
  '/admin/settings/home-feed-default',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  async (request, response) => {
    const body = homeFeedDefaultBodySchema.parse(request.body);
    response.json(await galleryService.setDefaultHomeFeedMode(body.defaultMode));
  }
);

router.put(
  '/admin/settings/reels-feed-default',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  async (request, response) => {
    const body = reelsFeedDefaultBodySchema.parse(request.body);
    response.json(await galleryService.setDefaultReelsFeedMode(body.defaultMode));
  }
);

router.put(
  '/admin/settings/folder-image-order-default',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  async (request, response) => {
    const body = folderImageOrderDefaultBodySchema.parse(request.body);
    response.json(await galleryService.setDefaultFolderImageOrder(body.defaultOrder));
  }
);

router.put(
  '/admin/settings/nested-folder-title-format',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  async (request, response) => {
    const body = nestedFolderTitleFormatBodySchema.parse(request.body);
    response.json(await galleryService.setNestedFolderTitleFormat(body.titleFormat));
  }
);

router.put(
  '/admin/settings/stories-mode',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  async (request, response) => {
    const body = storiesModeBodySchema.parse(request.body);
    response.json(await galleryService.setTreatStoriesAsFolders(body.treatStoriesAsFolders));
  }
);

router.put(
  '/admin/settings/excluded-folders',
  requireCapability('canAccessSettings', 'Admin access is required.'),
  async (request, response) => {
    const body = excludedFoldersBodySchema.parse(request.body);
    response.json(await galleryService.setExcludedFolders(body.rules));
  }
);

router.get('/feed/moments', async (_request, response) => {
  response.json(await galleryService.listMoments());
});

router.get('/feed/moments/:id', async (request, response) => {
  const params = momentIdSchema.parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const payload = await galleryService.getMomentFeed(params.id, query.page, query.limit);

  if (!payload) {
    response.status(404).json({ message: 'Feed capsule not found' });
    return;
  }

  response.json(payload);
});

router.get('/folders', async (request, response) => {
  const query = paginationQuerySchema.parse(request.query);
  response.json(await galleryService.listFolders(query.page, query.limit));
});

router.get('/folders/:slug', async (request, response) => {
  const params = slugSchema.parse(request.params);
  const folder = await galleryService.getFolderBySlug(params.slug);

  if (!folder) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(folder);
});

router.patch('/folders/:slug', requireCapability('canManageLibrary', 'Admin access is required.'), async (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = patchFolderBodySchema.parse(request.body);
  const updated = await galleryService.updateFolderMetadata(params.slug, body.name, body.description ?? null);

  if (!updated) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(updated);
});

router.post('/folders/:slug/cover', requireCapability('canManageLibrary', 'Admin access is required.'), async (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = folderCoverBodySchema.parse(request.body);
  const success = await galleryService.setFolderAvatar(params.slug, body.imageId);

  if (!success) {
    response.status(404).json({ message: 'Folder or image not found' });
    return;
  }

  response.json({ ok: true });
});

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

router.get('/folders/:slug/images', async (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query);
  const payload = await galleryService.getFolderImages(params.slug, query.page, query.limit, query.mediaType);

  if (!payload) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(payload);
});

router.get('/places', async (_request, response) => {
  response.json({
    items: await galleryService.listPlaces()
  });
});

router.get('/places/:slug', async (request, response) => {
  const params = slugSchema.parse(request.params);
  const place = await galleryService.getPlaceBySlug(params.slug);

  if (!place) {
    response.status(404).json({ message: 'Place not found' });
    return;
  }

  response.json(place);
});

router.get('/places/:slug/images', async (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query);
  const payload = await galleryService.getPlaceImages(params.slug, query.page, query.limit, query.mediaType);

  if (!payload) {
    response.status(404).json({ message: 'Place not found' });
    return;
  }

  response.json(payload);
});

router.get('/folders/:slug/stories', async (request, response) => {
  const params = slugSchema.parse(request.params);
  const payload = await galleryService.getFolderStories(params.slug);

  if (!payload) {
    response.status(404).json({ message: 'Folder not found' });
    return;
  }

  response.json(payload);
});

router.get('/folders/:slug/stories/:id', async (request, response) => {
  const params = slugSchema.merge(storyIdSchema).parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const payload = await galleryService.getFolderStoryFeed(params.slug, params.id, query.page, query.limit);

  if (!payload) {
    response.status(404).json({ message: 'Story capsule not found' });
    return;
  }

  response.json(payload);
});

router.get('/likes/ids', requireCapability('canUseSharedLikes', 'Authentication required.'), async (_request, response) => {
  response.json(await galleryService.getLikeIds());
});

router.get('/likes', requireCapability('canUseSharedLikes', 'Authentication required.'), async (request, response) => {
  const query = paginationQuerySchema.parse(request.query);
  response.json(await galleryService.getLikes(query.page, query.limit));
});

router.get('/collections', requireCapability('canUseSharedCollections', 'Authentication required.'), async (_request, response) => {
  response.json(await galleryService.getCollections());
});

router.post('/collections', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const body = collectionBodySchema.parse(request.body);
  const collection = await galleryService.createCollection(body.name);

  if (!collection) {
    response.status(404).json({ message: 'Collection could not be created' });
    return;
  }

  response.json({
    ok: true,
    collection
  });
});

router.patch('/collections/:slug', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = slugSchema.parse(request.params);
  const body = collectionBodySchema.parse(request.body);
  const collection = await galleryService.updateCollection(params.slug, body.name);

  if (!collection) {
    response.status(404).json({ message: 'Collection not found' });
    return;
  }

  response.json({
    ok: true,
    collection
  });
});

router.delete('/collections/:slug', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = slugSchema.parse(request.params);
  const collection = await galleryService.deleteCollection(params.slug);

  if (!collection) {
    response.status(404).json({ message: 'Collection not found' });
    return;
  }

  response.json({
    ok: true,
    collection
  });
});

router.get('/collections/:slug/images', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = slugSchema.parse(request.params);
  const query = paginationQuerySchema.parse(request.query);
  const payload = await galleryService.getCollectionImages(params.slug, query.page, query.limit);

  if (!payload) {
    response.status(404).json({ message: 'Collection not found' });
    return;
  }

  response.json(payload);
});

router.post('/collections/:slug/images/:id', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = slugSchema.merge(imageIdSchema).parse(request.params);
  const payload = await galleryService.addImageToCollection(params.slug, params.id);

  if (!payload) {
    response.status(404).json({ message: 'Collection or image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete('/collections/:slug/images/:id', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = slugSchema.merge(imageIdSchema).parse(request.params);
  const payload = await galleryService.removeImageFromCollection(params.slug, params.id);

  if (!payload) {
    response.status(404).json({ message: 'Collection or image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.get('/trash/images', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const query = paginationQuerySchema.parse(request.query);
  response.json(await galleryService.getTrashImages(query.page, query.limit));
});

router.get('/images/:id', async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const query = mediaTypeQuerySchema.parse(request.query);
  const image = await galleryService.getImageDetail(params.id, query.mediaType);

  if (!image) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json(image);
});

router.patch('/images/:id/caption', requireCapability('canManageLibrary', 'Admin access is required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const body = patchImageCaptionBodySchema.parse(request.body);
  const image = await galleryService.updateImageCaption(params.id, body.caption);

  if (!image) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    image
  });
});

router.get('/images/:id/collections', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = await galleryService.getImageCollections(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json(payload);
});

router.post('/images/:id/save', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = await galleryService.saveImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete('/images/:id/save', requireCapability('canUseSharedCollections', 'Authentication required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = await galleryService.unsaveImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post('/images/:id/like', requireCapability('canUseSharedLikes', 'Authentication required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = await galleryService.likeImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete('/images/:id/like', requireCapability('canUseSharedLikes', 'Authentication required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = await galleryService.unlikeImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post('/images/:id/trash', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = await galleryService.trashImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.post('/images/:id/restore', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const payload = await galleryService.restoreImage(params.id);

  if (!payload) {
    response.status(404).json({ message: 'Post not found' });
    return;
  }

  response.json({
    ok: true,
    ...payload
  });
});

router.delete('/images/:id', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const deleted = await galleryService.deleteImage(params.id);

  if (!deleted) {
    response.status(404).json({ message: 'Image not found' });
    return;
  }

  response.json({
    ok: true,
    ...deleted
  });
});

router.get('/originals/:id', async (request, response) => {
  const params = imageIdSchema.parse(request.params);
  const query = originalMediaQuerySchema.parse(request.query);
  const originalMedia = await galleryService.getOriginalMediaFile(params.id);

  if (!originalMedia) {
    response.status(404).json({ message: 'Original media not found' });
    return;
  }

  if (query.download) {
    response.download(originalMedia.path, originalMedia.filename);
    return;
  }

  response.sendFile(originalMedia.path);
});

const adminMutationRateLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many administrative requests. Please try again in a minute.'
});

const requireNoScanInProgress = (_request: express.Request, response: express.Response, next: express.NextFunction) => {
  if (scannerService.getProgress().isScanning) {
    response.status(429).json({
      message: 'A scan or rebuild is already in progress.'
    });
    return;
  }
  next();
};

router.post(
  '/admin/rescan',
  requireCapability('canManageLibrary', 'Admin access is required.'),
  adminMutationRateLimiter,
  requireNoScanInProgress,
  async (_request, response) => {
  try {
    if (await scannerService.isLibraryRebuildRequired()) {
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
  if (await scannerService.isLibraryRebuildRequired()) {
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

router.get('/admin/stats', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => {
  response.json(await galleryService.getStats());
});

export { router as apiRouter };
