import type express from 'express';
import { requireCapability } from '../../middleware/auth-protection.js';
import { deletionJobService } from '../../services/deletion-job-service.js';
import { galleryService } from '../../services/gallery-service.js';
import { paginationQuerySchema, permanentDeletionBatchBodySchema } from '../../routes/api-schemas.js';

export function registerDeletionRoutes(router: express.Router): void {
  const canDelete = requireCapability('canDeleteMedia', 'Admin access is required.');
  router.get('/trash/images', canDelete, (request, response) => { const query = paginationQuerySchema.parse(request.query); response.json(galleryService.getTrashImages(query.page, query.limit)); });
  router.post('/posts/deletions/batch', canDelete, (request, response) => { const body = permanentDeletionBatchBodySchema.parse(request.body); response.json({ ok: true, job: deletionJobService.enqueue(body.ids) }); });
  router.get('/posts/deletions/batch', canDelete, (_request, response) => { response.json({ ok: true, job: deletionJobService.getSnapshot() }); });
  router.delete('/posts/deletions/batch', canDelete, (_request, response) => { response.json({ ok: true, job: deletionJobService.acknowledgeFinished() }); });
}
