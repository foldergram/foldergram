import express from 'express';
import { z } from 'zod';
import { requireCapability } from '../middleware/auth-protection.js';
import { databaseManager } from '../db/database.js';
import { postRepository } from '../db/repositories.js';
import { decryptCredential } from './credentials.js';
import { detectContent, getSource, listSources, removeSource, saveSource, sourceInputSchema, syncSource, sourceBootstrapError, sourceStatuses } from './source-service.js';
import { clearSourceCache, serveRemoteMedia } from './media.js';
import type { ImageRecord } from '../types/models.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
export const sourcesRouter = express.Router();
const admin = requireCapability('canAccessSettings', 'Admin access is required.');
const sourceId = z.coerce.number().int().positive();
const testLimit = createRateLimiter({ windowMs: 60000, max: 10, message: 'Too many connection tests. Try again shortly.' });
sourcesRouter.use('/admin/sources', admin);
sourcesRouter.get('/sources/status', async (request, response) => response.json({
    items: await sourceStatuses(request.query.retry === '1'),
    hasLocalPosts: postRepository.hasVisibleLocalPosts()
}));
sourcesRouter.get('/admin/sources', (_request, response) => response.json({ items: listSources(), bootstrapError: sourceBootstrapError }));
sourcesRouter.post('/admin/sources/immich/test', testLimit, async (request, response) => {
    const input = z.object({ serverUrl: z.string().max(2048), apiKey: z.string().min(1).max(4096).optional(), sourceId: sourceId.optional() }).parse(request.body);
    const source = input.sourceId ? getSource(input.sourceId) : undefined;
    const key = input.apiKey ?? (source ? decryptCredential(source.api_key_ciphertext) : undefined);
    if (!key)
        throw new Error('Enter an Immich API key.');
    const detection = await detectContent(input.serverUrl, key);
    response.json(detection);
});
sourcesRouter.post('/admin/sources', (request, response) => {
    const id = saveSource(sourceInputSchema.parse(request.body));
    void syncSource(id).catch(() => { });
    response.status(201).json(listSources().find(s => s.id === id));
});
sourcesRouter.patch('/admin/sources/:id', (request, response) => {
    const id = sourceId.parse(request.params.id);
    saveSource(sourceInputSchema.parse(request.body), id);
    response.json(listSources().find(s => s.id === id));
});
sourcesRouter.post('/admin/sources/:id/sync', (request, response) => {
    const id = sourceId.parse(request.params.id);
    const source = getSource(id);
    if (!source?.enabled) {
        response.status(409).json({ message: 'Enable the source before syncing.' });
        return;
    }
    void syncSource(id).catch(() => { });
    response.status(202).json({ ok: true });
});
sourcesRouter.delete('/admin/sources/:id', async (request, response) => { await removeSource(sourceId.parse(request.params.id)); response.json({ ok: true }); });
sourcesRouter.delete('/admin/sources/:id/cache', async (request, response) => {
    const id = sourceId.parse(request.params.id);
    if (!getSource(id))
        throw new Error('Source not found.');
    await clearSourceCache(id);
    response.json({ ok: true });
});
sourcesRouter.get('/remote-media/:sourceId/:assetId/:kind', async (request, response) => {
    const id = sourceId.parse(request.params.sourceId);
    const assetId = z.string().regex(/^[a-zA-Z0-9-]+$/).parse(request.params.assetId);
    const kind = z.enum(['thumbnail', 'preview']).parse(request.params.kind);
    const image = databaseManager.connection.prepare('SELECT * FROM images WHERE source_id=? AND external_asset_id=?').get(id, assetId) as unknown as ImageRecord | undefined;
    if (!image) {
        response.status(404).end();
        return;
    }
    await serveRemoteMedia(request, response, image, kind);
});
