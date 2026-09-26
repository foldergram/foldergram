import type express from 'express';
import path from 'node:path';
import { appConfig } from '../../config/env.js';
import { requireCapability } from '../../middleware/auth-protection.js';
import { galleryService } from '../../services/gallery-service.js';
import { imageIdSchema, mediaTypeQuerySchema, originalMediaQuerySchema, patchImageCaptionBodySchema } from '../../routes/api-schemas.js';
import { applyOriginalMediaHeaders } from '../../utils/media-response.js';

export function registerLibraryRoutes(router: express.Router): void {
  router.get(['/posts/:id', '/images/:id'], (request, response) => {
    const params = imageIdSchema.parse(request.params); const query = mediaTypeQuerySchema.parse(request.query); const image = galleryService.getImageDetail(params.id, query.mediaType, { isLegacyImageAlias: request.path.includes('/images/') });
    if (!image) { response.status(404).json({ message: 'Post not found' }); return; }
    response.json(image);
  });
  router.patch(['/posts/:id/caption', '/images/:id/caption'], requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
    const params = imageIdSchema.parse(request.params); const body = patchImageCaptionBodySchema.parse(request.body); const image = galleryService.updateImageCaption(params.id, body.caption, { isLegacyImageAlias: request.path.includes('/images/') });
    if (!image) { response.status(404).json({ message: 'Post not found' }); return; }
    response.json({ ok: true, image });
  });
  router.get(['/posts/:id/collections', '/images/:id/collections'], requireCapability('canUseSharedCollections', 'Authentication required.'), (request, response) => {
    const params = imageIdSchema.parse(request.params); const payload = galleryService.getImageCollections(params.id, { isLegacyImageAlias: request.path.includes('/images/') });
    if (!payload) { response.status(404).json({ message: 'Post not found' }); return; }
    response.json(payload);
  });
  registerToggle(router, 'save', 'canUseSharedCollections', 'Authentication required.', 'saveImage', 'unsaveImage');
  registerToggle(router, 'like', 'canUseSharedLikes', 'Authentication required.', 'likeImage', 'unlikeImage');
  registerMutation(router, 'trash', 'trashImage');
  registerMutation(router, 'restore', 'restoreImage');
  router.delete(['/posts/:id', '/images/:id'], requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
    const params = imageIdSchema.parse(request.params); const deleted = await galleryService.deleteImage(params.id, { isLegacyImageAlias: request.path.includes('/images/') });
    if (!deleted) { response.status(404).json({ message: 'Post not found' }); return; }
    response.json({ ok: true, ...deleted });
  });
  router.get('/originals/:id', (request, response) => {
    const params = imageIdSchema.parse(request.params); const query = originalMediaQuerySchema.parse(request.query); const originalMedia = galleryService.getOriginalMediaFile(params.id);
    if (!originalMedia) { response.status(404).json({ message: 'Original media not found' }); return; }
    applyOriginalMediaHeaders(response);
    if (query.download) { response.download(originalMedia.path, originalMedia.filename); return; }
    if (appConfig.mediaAccelRedirectPrefix) {
      const relativePath = path.relative(appConfig.galleryRoot, originalMedia.path);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) { response.status(404).json({ message: 'Original media not found' }); return; }
      response.setHeader('X-Accel-Redirect', `${appConfig.mediaAccelRedirectPrefix}/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`); response.status(200).end(); return;
    }
    response.sendFile(originalMedia.path);
  });
}

type ImageMutation = 'trashImage' | 'restoreImage';
function registerMutation(router: express.Router, suffix: 'trash' | 'restore', mutation: ImageMutation): void {
  router.post([`/posts/:id/${suffix}`, `/images/:id/${suffix}`], requireCapability('canDeleteMedia', 'Admin access is required.'), (request, response) => {
    const params = imageIdSchema.parse(request.params); const payload = galleryService[mutation](params.id, { isLegacyImageAlias: request.path.includes('/images/') });
    if (!payload) { response.status(404).json({ message: 'Post not found' }); return; }
    response.json({ ok: true, ...payload });
  });
}

type ToggleMutation = 'saveImage' | 'unsaveImage' | 'likeImage' | 'unlikeImage';
function registerToggle(router: express.Router, suffix: 'save' | 'like', capability: 'canUseSharedCollections' | 'canUseSharedLikes', message: string, add: ToggleMutation, remove: ToggleMutation): void {
  const guard = requireCapability(capability, message);
  router.post([`/posts/:id/${suffix}`, `/images/:id/${suffix}`], guard, (request, response) => respondToggle(request, response, add));
  router.delete([`/posts/:id/${suffix}`, `/images/:id/${suffix}`], guard, (request, response) => respondToggle(request, response, remove));
}
function respondToggle(request: express.Request, response: express.Response, mutation: ToggleMutation): void {
  const params = imageIdSchema.parse(request.params); const payload = galleryService[mutation](params.id, { isLegacyImageAlias: request.path.includes('/images/') });
  if (!payload) { response.status(404).json({ message: 'Image not found' }); return; }
  response.json({ ok: true, ...payload });
}
