import express from 'express';
import { z } from 'zod';
import { requireCapability } from '../middleware/auth-protection.js';
import { databaseManager } from '../db/database.js';
import { postRepository } from '../db/repositories.js';
import { detectContent, getSource, removeSource, saveSource, sourceInputSchema, syncSource, sourceBootstrapError, updateSource } from './source-service.js';
import { getLocalSource, inspectLocalPath, LocalPathError } from '../sources/local-source.js';
import { createLocalSource, listManagedSources, listPublicSourceStatuses, localSourceInput, localSourcePatch, patchLocalSource, removeLocalSource } from '../sources/source-service.js';
import { scannerService } from '../services/scanner-service.js';
import { watcherService } from '../services/watcher-service.js';
import { clearSourceCache, serveRemoteMedia } from './media.js';
import type { ImageRecord } from '../types/models.js';
import { createRateLimiter } from '../middleware/rate-limit.js';
export const sourcesRouter = express.Router();
const admin = requireCapability('canAccessSettings', 'Admin access is required.');
const sourceId = z.coerce.number().int().positive();
const testLimit = createRateLimiter({ windowMs: 60000, max: 10, message: 'Too many connection tests. Try again shortly.' });
sourcesRouter.use('/admin/sources', admin);
sourcesRouter.get('/sources/status', async (request, response) => response.json({
    items: await listPublicSourceStatuses(request.query.retry === '1'),
    hasLocalPosts: postRepository.hasVisibleLocalPosts(),
    hasVisiblePosts: postRepository.hasVisiblePosts()
}));
sourcesRouter.get('/admin/sources', (_request, response) => response.json({ items: listManagedSources(), bootstrapError: sourceBootstrapError }));
sourcesRouter.post('/admin/sources/immich/test', testLimit, async (request, response) => {
    const input = z.object({ serverUrl: z.string().max(2048), apiKey: z.string().trim().min(1).max(4096).optional(), sourceId: sourceId.optional() }).parse(request.body);
    const source = input.sourceId ? getSource(input.sourceId) : undefined;
    if (input.sourceId && !source) return response.sendStatus(404);
    const detection = await detectContent(input.serverUrl, input.apiKey, source);
    response.json(detection);
});
const immichSaveInput = sourceInputSchema.extend({ kind: z.literal('immich').optional() });
const sourceCreateInput = z.union([localSourceInput, immichSaveInput]);

sourcesRouter.post('/admin/sources/local/test', testLimit, (request, response) => {
    const input = z.object({ rootPath: z.string().trim().min(1).max(4096) }).strict().parse(request.body);
    try {
        response.json(inspectLocalPath(input.rootPath));
    } catch (error) {
        if (!(error instanceof LocalPathError)) throw error;
        response.status(400).json({ field: 'rootPath', code: error.code, message: error.message });
    }
});

sourcesRouter.post('/admin/sources', async (request, response) => {
    const input = sourceCreateInput.parse(request.body);
    let id: number;
    if (input.kind === 'local') {
        try {
            id = await createLocalSource(input);
        } catch (error) {
            if (!(error instanceof LocalPathError)) throw error;
            response.status(400).json({ field: 'rootPath', code: error.code, message: error.message });
            return;
        }
        if (input.enabled) void scannerService.scanSource(id).then(() => watcherService.refresh()).catch(() => {});
    } else {
        id = saveSource(input);
        if (input.enabled) void syncSource(id).catch(() => {});
    }
    response.status(201).json(listManagedSources().find(source => source.id === id));
});

sourcesRouter.patch('/admin/sources/:id', async (request, response) => {
    const id = sourceId.parse(request.params.id);
    if (getLocalSource(id)) await patchLocalSource(id, localSourcePatch.parse(request.body));
    else await updateSource(immichSaveInput.parse(request.body), id);
    response.json(listManagedSources().find(source => source.id === id));
});

sourcesRouter.post('/admin/sources/:id/sync', (request, response) => {
    const id = sourceId.parse(request.params.id);
    const local = getLocalSource(id);
    if (!(local ?? getSource(id))?.enabled) {
        response.status(409).json({ message: 'Enable the source before syncing.' });
        return;
    }
    if (local) {
        const state = scannerService.getProgress().operation?.state;
        if (state === 'paused' || state === 'pausing' || state === 'cancelling') {
            response.status(409).json({ message: 'Resume the active scan or wait for it to stop before syncing this source.' });
            return;
        }
        const input = z.object({ confirmEmpty: z.boolean().optional() }).strict().parse(request.body ?? {});
        if (input.confirmEmpty && local.status !== 'empty_review') {
            response.status(409).json({ message: 'Sync the source before confirming an empty location.' });
            return;
        }
        void scannerService.scanSource(id, 'source', { confirmEmpty: input.confirmEmpty }).then(() => watcherService.refresh()).catch(() => {});
    } else {
        void syncSource(id).catch(() => {});
    }
    response.status(202).json({ ok: true });
});

sourcesRouter.delete('/admin/sources/:id', async (request, response) => {
    const id = sourceId.parse(request.params.id);
    if (getLocalSource(id)) await removeLocalSource(id);
    else await removeSource(id);
    response.json({ ok: true });
});
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
