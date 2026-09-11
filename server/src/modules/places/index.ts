import type express from 'express';
import { galleryService } from '../../services/gallery-service.js';
import { mediaTypeQuerySchema, paginationQuerySchema, slugSchema } from '../../routes/api-schemas.js';

export function registerPlaceRoutes(router: express.Router): void {
  router.get('/places', (_request, response) => { response.json({ items: galleryService.listPlaces() }); });
  router.get('/places/:slug', (request, response) => {
    const params = slugSchema.parse(request.params); const place = galleryService.getPlaceBySlug(params.slug);
    if (!place) { response.status(404).json({ message: 'Place not found' }); return; }
    response.json(place);
  });
  router.get('/places/:slug/images', (request, response) => {
    const params = slugSchema.parse(request.params); const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query); const payload = galleryService.getPlaceImages(params.slug, query.page, query.limit, query.mediaType);
    if (!payload) { response.status(404).json({ message: 'Place not found' }); return; }
    response.json(payload);
  });
}
