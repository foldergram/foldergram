import type express from 'express';
import { requireCapability } from '../../middleware/auth-protection.js';
import { galleryService } from '../../services/gallery-service.js';
import { folderCoverBodySchema, mediaTypeQuerySchema, paginationQuerySchema, patchFolderBodySchema, slugSchema, storyIdSchema, deleteFolderQuerySchema } from '../../routes/api-schemas.js';

export function registerFolderRoutes(router: express.Router): void {
  router.get('/folders', (_request, response) => { response.json({ items: galleryService.listFolders() }); });
  router.get('/folders/:slug', (request, response) => {
    const params = slugSchema.parse(request.params); const folder = galleryService.getFolderBySlug(params.slug);
    if (!folder) { response.status(404).json({ message: 'Folder not found' }); return; }
    response.json(folder);
  });
  router.patch('/folders/:slug', requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
    const params = slugSchema.parse(request.params); const body = patchFolderBodySchema.parse(request.body); const updated = galleryService.updateFolderMetadata(params.slug, body.name, body.description ?? null);
    if (!updated) { response.status(404).json({ message: 'Folder not found' }); return; }
    response.json(updated);
  });
  router.post('/folders/:slug/cover', requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
    const params = slugSchema.parse(request.params); const body = folderCoverBodySchema.parse(request.body); const success = galleryService.setFolderAvatar(params.slug, body.imageId);
    if (!success) { response.status(404).json({ message: 'Folder or image not found' }); return; }
    response.json({ ok: true });
  });
}

export function registerFolderContentRoutes(router: express.Router): void {
  router.delete('/folders/:slug', requireCapability('canDeleteMedia', 'Admin access is required.'), async (request, response) => {
    const params = slugSchema.parse(request.params); const query = deleteFolderQuerySchema.parse(request.query); const deleted = await galleryService.deleteFolder(params.slug, { deleteSourceFolder: query.deleteSourceFolder });
    if (!deleted) { response.status(404).json({ message: 'Folder not found' }); return; }
    response.json({ ok: true, ...deleted });
  });
  router.get('/folders/:slug/images', (request, response) => {
    const params = slugSchema.parse(request.params); const query = paginationQuerySchema.merge(mediaTypeQuerySchema).parse(request.query); const payload = galleryService.getFolderImages(params.slug, query.page, query.limit, query.mediaType);
    if (!payload) { response.status(404).json({ message: 'Folder not found' }); return; }
    response.json(payload);
  });
}

export function registerFolderStoryRoutes(router: express.Router): void {
  router.get('/folders/:slug/stories', (request, response) => {
    const params = slugSchema.parse(request.params); const payload = galleryService.getFolderStories(params.slug);
    if (!payload) { response.status(404).json({ message: 'Folder not found' }); return; }
    response.json(payload);
  });
  router.get('/folders/:slug/stories/:id', (request, response) => {
    const params = slugSchema.merge(storyIdSchema).parse(request.params); const query = paginationQuerySchema.parse(request.query); const payload = galleryService.getFolderStoryFeed(params.slug, params.id, query.page, query.limit);
    if (!payload) { response.status(404).json({ message: 'Story capsule not found' }); return; }
    response.json(payload);
  });
}
