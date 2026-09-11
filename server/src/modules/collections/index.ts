import type express from 'express';
import { requireCapability } from '../../middleware/auth-protection.js';
import { galleryService } from '../../services/gallery-service.js';
import { imageIdSchema, paginationQuerySchema, slugSchema, collectionBodySchema } from '../../routes/api-schemas.js';

export function registerCollectionRoutes(router: express.Router): void {
  const sharedCollections = requireCapability('canUseSharedCollections', 'Authentication required.');
  router.get('/likes', requireCapability('canUseSharedLikes', 'Authentication required.'), (_request, response) => { response.json(galleryService.getLikes()); });
  router.get('/collections', sharedCollections, (_request, response) => { response.json(galleryService.getCollections()); });
  router.post('/collections', sharedCollections, (request, response) => {
    const body = collectionBodySchema.parse(request.body); const collection = galleryService.createCollection(body.name);
    if (!collection) { response.status(404).json({ message: 'Collection could not be created' }); return; }
    response.json({ ok: true, collection });
  });
  router.patch('/collections/:slug', sharedCollections, (request, response) => {
    const params = slugSchema.parse(request.params); const body = collectionBodySchema.parse(request.body); const collection = galleryService.updateCollection(params.slug, body.name);
    if (!collection) { response.status(404).json({ message: 'Collection not found' }); return; }
    response.json({ ok: true, collection });
  });
  router.delete('/collections/:slug', sharedCollections, (request, response) => {
    const params = slugSchema.parse(request.params); const collection = galleryService.deleteCollection(params.slug);
    if (!collection) { response.status(404).json({ message: 'Collection not found' }); return; }
    response.json({ ok: true, collection });
  });
  router.get('/collections/:slug/images', sharedCollections, (request, response) => {
    const params = slugSchema.parse(request.params); const query = paginationQuerySchema.parse(request.query); const payload = galleryService.getCollectionImages(params.slug, query.page, query.limit);
    if (!payload) { response.status(404).json({ message: 'Collection not found' }); return; }
    response.json(payload);
  });
  router.post(['/collections/:slug/posts/:id', '/collections/:slug/images/:id'], sharedCollections, (request, response) => {
    const params = slugSchema.merge(imageIdSchema).parse(request.params); const payload = galleryService.addImageToCollection(params.slug, params.id, { isLegacyImageAlias: request.path.includes('/images/') });
    if (!payload) { response.status(404).json({ message: 'Collection or image not found' }); return; }
    response.json({ ok: true, ...payload });
  });
  router.delete(['/collections/:slug/posts/:id', '/collections/:slug/images/:id'], sharedCollections, (request, response) => {
    const params = slugSchema.merge(imageIdSchema).parse(request.params); const payload = galleryService.removeImageFromCollection(params.slug, params.id, { isLegacyImageAlias: request.path.includes('/images/') });
    if (!payload) { response.status(404).json({ message: 'Collection or image not found' }); return; }
    response.json({ ok: true, ...payload });
  });
}
