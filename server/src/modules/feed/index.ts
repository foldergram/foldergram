import type express from 'express';
import { galleryService } from '../../services/gallery-service.js';
import { feedQuerySchema, mediaSearchQuerySchema, momentIdSchema, paginationQuerySchema, reelsQuerySchema } from '../../routes/api-schemas.js';

export function registerFeedRoutes(router: express.Router): void {
  router.get('/feed', (request, response) => {
    const query = feedQuerySchema.parse(request.query);
    response.json(galleryService.getFeed(query.page, query.limit, query.mode, query.seed, query.exclude));
  });
  router.get('/reels', (request, response) => {
    const query = reelsQuerySchema.parse(request.query);
    const recentOpenedFolderSlugs = query.recentFolders ? query.recentFolders.split(',').map((slug) => slug.trim()).filter((slug, index, items) => slug.length > 0 && items.indexOf(slug) === index) : [];
    response.json(galleryService.getReels(query.page, query.limit, query.mode, query.seed, { lastOpenedFolderSlug: query.lastFolder ?? null, recentOpenedFolderSlugs }));
  });
  router.get('/feed/search', (request, response) => {
    const query = mediaSearchQuerySchema.parse(request.query);
    response.json(galleryService.searchMedia(query.q, query.page, query.limit));
  });
}

export function registerFeedMomentRoutes(router: express.Router): void {
  router.get('/feed/moments', (_request, response) => { response.json(galleryService.listMoments()); });
  router.get('/feed/moments/:id', (request, response) => {
    const params = momentIdSchema.parse(request.params);
    const query = paginationQuerySchema.parse(request.query);
    const payload = galleryService.getMomentFeed(params.id, query.page, query.limit);
    if (!payload) { response.status(404).json({ message: 'Feed capsule not found' }); return; }
    response.json(payload);
  });
}
