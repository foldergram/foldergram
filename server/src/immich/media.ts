import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import pLimit from 'p-limit';
import type express from 'express';
import { appConfig } from '../config/env.js';
import { isSourceVisible } from '../sources/local-source.js';
import { databaseManager } from '../db/database.js';
import { imageRepository } from '../db/repositories.js';
import { authService } from '../services/auth-service.js';
import { folderShareService } from '../services/folder-share-service.js';
import type { ImageRecord } from '../types/models.js';
import { getSource, markSourceUnavailable, revokeSource, sameConnection, selectionSchema, sourceAvailable, sourceClient } from './source-service.js';
export type RemoteMediaKind = 'thumbnail' | 'preview' | 'original';
const concurrency = Math.floor(Math.max(1, Math.min(16, Number(process.env.IMMICH_FETCH_CONCURRENCY) || 4)));
const limit = pLimit(concurrency);
const inflight = new Map<string, Promise<void>>();
const completing = new Set<string>();
// Serialize filesystem publication and clearing, never the network stream.
const cacheMutation = pLimit(1);
const cacheEpochs = new Map<number, number>();
const clearingSources = new Set<number>();
const activeTemporaryFiles = new Set<string>();
const cacheRoot = () => path.join(appConfig.dbDir, 'immich-cache');
const maxBytes = () => Math.min(262144, Math.max(1, Number(process.env.IMMICH_CACHE_MAX_MB) || 512)) * 1024 * 1024;
const ttlMs = () => Math.min(8760, Math.max(1, Number(process.env.IMMICH_CACHE_TTL_HOURS) || 168)) * 3600000;
const allowedTypes = /^(image\/(jpeg|png|webp|avif|gif|heic|heif)|video\/(mp4|webm|quicktime|x-matroska)|application\/octet-stream)(;|$)/i;
interface CacheMetadata {
    headers: Record<string, string>;
    status: number;
    created: number;
    size: number;
}
export function imageFolderIds(imageId: number): number[] {
    const rows = databaseManager.connection.prepare(`SELECT folder_id FROM images WHERE id=? UNION SELECT folder_id FROM folder_media_memberships WHERE image_id=?`).all(imageId, imageId) as Array<{
        folder_id: number;
    }>;
    return rows.map(r => r.folder_id);
}
export function authorizedImage(request: express.Request, image: ImageRecord, shareOnly = false): boolean {
    if (image.is_deleted || image.is_trashed || !isSourceVisible(image.source_id))
        return false;
    if (!shareOnly && (!authService.isEnabled() || authService.isAuthenticatedRequest(request) || authService.isPublicViewerAccessEnabled()))
        return true;
    return imageFolderIds(image.id).some(id => Boolean(folderShareService.getFolderGrant(request, id)));
}
export function imageBelongsToFolder(imageId: number, folderId: number): boolean { return imageFolderIds(imageId).includes(folderId); }
async function cached(filename: string): Promise<CacheMetadata | null> {
    try {
        const metadata: CacheMetadata = JSON.parse(await fs.promises.readFile(filename + '.json', 'utf8'));
        const stat = await fs.promises.stat(filename + '.data');
        if (!stat.size || stat.size !== metadata.size || Date.now() - metadata.created > ttlMs())
            return null;
        return metadata;
    }
    catch {
        return null;
    }
}
// Serialized reservation avoids concurrent fetches exceeding the configured disk budget.
let reservations = 0;
let evictionTail: Promise<unknown> = Promise.resolve();
async function reserve(bytes: number): Promise<void> {
    const next = evictionTail.then(async () => {
        await fs.promises.mkdir(cacheRoot(), { recursive: true });
        const entries: Array<{
            file: string;
            size: number;
            time: number;
        }> = [];
        for (const directory of await fs.promises.readdir(cacheRoot(), { withFileTypes: true })) {
            if (!directory.isDirectory())
                continue;
            for (const entry of await fs.promises.readdir(path.join(cacheRoot(), directory.name))) {
                const file = path.join(cacheRoot(), directory.name, entry);
                const stat = await fs.promises.stat(file).catch(() => null);
                if (!stat)
                    continue;
                if ((entry.endsWith('.part') || entry.endsWith('.part.json')) && !activeTemporaryFiles.has(file.replace(/\.json$/, ''))) {
                    await fs.promises.rm(file, { force: true });
                    continue;
                }
                if (entry.endsWith('.data')) {
                    const metadata = await fs.promises.stat(file.replace(/\.data$/, '.json')).catch(() => null);
                    entries.push({ file, size: stat.size + (metadata?.size ?? 0), time: stat.mtimeMs });
                }
            }
        }
        let used = entries.reduce((n, e) => n + e.size, 0);
        let entryCount = entries.length;
        for (const entry of entries.sort((a, b) => a.time - b.time)) {
            if (used + reservations + bytes <= maxBytes() && entryCount < 10000 && Date.now() - entry.time <= ttlMs())
                break;
            await fs.promises.rm(entry.file, { force: true });
            await fs.promises.rm(entry.file.replace(/\.data$/, '.json'), { force: true });
            used -= entry.size;
            entryCount--;
        }
        reservations += bytes;
    });
    evictionTail = next.catch(() => { });
    await next;
}
export async function clearSourceCache(id: number): Promise<void> {
    clearingSources.add(id);
    cacheEpochs.set(id, (cacheEpochs.get(id) ?? 0) + 1);
    try {
        await cacheMutation(() => fs.promises.rm(path.join(cacheRoot(), String(id)), { recursive: true, force: true, maxRetries: 3 }));
    }
    finally {
        clearingSources.delete(id);
    }
}
export async function serveRemoteMedia(request: express.Request, response: express.Response, image: ImageRecord, kind: RemoteMediaKind, shareOnly = false): Promise<void> {
    response.setHeader('Cache-Control', 'private, no-store');
    response.vary('Cookie');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const source = getSource(image.source_id);
    const connectionIsCurrent = () => Boolean(source && sameConnection(source, getSource(source.id)));
    const current = () => {
        if (!connectionIsCurrent()) return null;
        const row = imageRepository.getById(image.id);
        return row && authorizedImage(request, row, shareOnly) ? row : null;
    };
    if (!source || !image.external_asset_id || !current()) {
        response.status(404).end();
        return;
    }
    const endpoint = `/api/assets/${image.external_asset_id}/${kind === 'original' ? 'original' : kind === 'preview' && image.media_type === 'video' ? 'video/playback' : `thumbnail?size=${kind}`}`;
    const cacheEpoch = cacheEpochs.get(source.id) ?? 0;
    const canWriteCache = () => !clearingSources.has(source.id) && cacheEpoch === (cacheEpochs.get(source.id) ?? 0);
    if (kind === 'original' && (!selectionSchema.parse(JSON.parse(source.config_json)).allowOriginals || shareOnly)) {
        response.status(403).json({ message: 'Original downloads are disabled for this source.' });
        return;
    }
    if (!sourceAvailable(source.id)) {
        response.status(503).json({ message: 'Immich is unavailable. Check that your Immich server is running, then try again.' });
        return;
    }
    const range = typeof request.headers.range === 'string' ? request.headers.range : undefined;
    if (range && (!/^bytes=(\d+-\d*|-\d+)$/.test(range) || range.length > 100)) {
        response.status(416).end();
        return;
    }
    const identity = `${image.external_asset_id}:${image.remote_version}:${kind}`;
    const full = path.join(cacheRoot(), String(source.id), createHash('sha256').update(identity).digest('hex'));
    const filename = range ? `${full}-${createHash('sha256').update(range).digest('hex')}` : full;
    const sendCached = async (): Promise<boolean> => {
        const fullMeta = await cached(full);
        const metadata = fullMeta ?? await cached(filename);
        if (!metadata || !current())
            return false;
        const file = (fullMeta ? full : filename) + '.data';
        // Pin the complete file before sending headers; eviction can unlink its path safely.
        const handle = await fs.promises.open(file, 'r').catch(() => null);
        if (!handle)
            return false;
        try {
            let start = 0, end = metadata.size - 1, status = metadata.status;
            const headers = { ...metadata.headers };
            if (metadata.status === 200 && range) {
                const [first, last] = range.slice(6).split('-');
                if (!first)
                    start = Math.max(0, metadata.size - Number(last));
                else {
                    start = Number(first);
                    if (last)
                        end = Math.min(end, Number(last));
                }
                if (start >= metadata.size || end < start || (!first && Number(last) === 0)) {
                    response.setHeader('Content-Range', `bytes */${metadata.size}`);
                    response.status(416).end();
                    return true;
                }
                status = 206;
                headers['content-range'] = `bytes ${start}-${end}/${metadata.size}`;
            }
            headers['content-length'] = String(end - start + 1);
            for (const [name, value] of Object.entries(headers))
                response.setHeader(name, value);
            response.status(status);
            await handle.utimes(new Date(), new Date()).catch(() => { });
            if (request.method === 'HEAD')
                response.end();
            else
                await pipeline(handle.createReadStream({ start, end }), response);
            return true;
        }
        finally {
            await handle.close().catch(() => { });
        }
    };
    try {
        if (await sendCached())
            return;
        const prior = inflight.get(filename) ?? (completing.has(full) ? inflight.get(full) : undefined);
        if (prior) {
            await prior;
            if (response.destroyed)
                return;
            if (await sendCached())
                return;
        }
        // Register before entering the concurrency queue, so waiters also share queued work.
        if (limit.pendingCount >= 100) {
            response.status(429).json({ message: 'Immich media queue is full. Try again shortly.' });
            return;
        }
        const work = limit(async () => {
            if (!current() || response.destroyed) {
                if (!response.destroyed)
                    response.status(404).end();
                return;
            }
            const controller = new AbortController();
            const abort = () => {
                if (!response.writableEnded && !completing.has(filename))
                    controller.abort();
            };
            response.once('close', abort);
            const timeout = setTimeout(() => controller.abort(), 120000);
            timeout.unref();
            const budget = Math.floor(maxBytes() / concurrency);
            let reserved = false;
            let handle: fs.promises.FileHandle | undefined;
            let size = 0;
            let cacheable = kind !== 'original';
            const temporary = filename + '.' + randomUUID() + '.part';
            try {
                const client = sourceClient(source);
                const upstream = await client.open(endpoint, { range, signal: controller.signal });
                if (!connectionIsCurrent()) {
                    upstream.destroy();
                    response.status(404).end();
                    return;
                }
                const status = upstream.statusCode ?? 502;
                if (status === 401)
                    revokeSource(source.id);
                if (status === 403)
                    databaseManager.connection.prepare("UPDATE media_sources SET status=CASE WHEN status='revoked' THEN status ELSE 'error' END,last_error=? WHERE id=?").run(kind === 'original' ? 'Immich denied original download. Grant asset.download or disable originals.' : 'Immich denied asset viewing. Check asset.view and account/album access, then sync.', source.id);
                if (status >= 500) markSourceUnavailable(source.id, endpoint);
                if (kind !== 'original' && status === 403) {
                    databaseManager.connection.prepare('UPDATE images SET is_deleted=1 WHERE id=?').run(image.id);
                    databaseManager.connection.prepare('UPDATE posts SET is_deleted=1 WHERE id IN (SELECT post_id FROM post_items WHERE image_id=?)').run(image.id);
                }
                if (!current() || ![200, 206, 416].includes(status)) {
                    upstream.resume();
                    const retryAfter = upstream.headers['retry-after'];
                    if (typeof retryAfter === 'string')
                        response.setHeader('Retry-After', retryAfter);
                    response.status(status === 401 ? 403 : status >= 400 && status <= 599 ? status : 502).json({ message: 'Immich media is unavailable. Check source status in Settings.' });
                    return;
                }
                const headers: Record<string, string> = {};
                for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
                    const value = upstream.headers[name];
                    if (typeof value === 'string')
                        headers[name] = value;
                }
                if (status === 416) {
                    upstream.resume();
                    if (headers['content-range'])
                        response.setHeader('Content-Range', headers['content-range']);
                    response.status(416).end();
                    return;
                }
                if (!allowedTypes.test(headers['content-type'] ?? '')) {
                    upstream.destroy();
                    throw new Error('Immich returned an unsupported media Content-Type.');
                }
                if (range && status === 206 && !headers['content-range']) {
                    upstream.destroy();
                    throw new Error('Immich range response is missing Content-Range.');
                }
                if (status === 206 && !range)
                    cacheable = false;
                if (Number(headers['content-length'] ?? 0) > budget - 8192 || Buffer.byteLength(JSON.stringify(headers)) > 4096)
                    cacheable = false;
                if (cacheable) {
                    await cacheMutation(async () => {
                        if (!canWriteCache()) {
                            cacheable = false;
                            return;
                        }
                        await reserve(budget);
                        reserved = true;
                        await fs.promises.mkdir(path.dirname(filename), { recursive: true });
                        activeTemporaryFiles.add(temporary);
                        handle = await fs.promises.open(temporary, 'wx', 0o600);
                    }).catch(() => { cacheable = false; });
                }
                if (!current()) {
                    upstream.destroy();
                    response.status(404).end();
                    return;
                }
                response.status(status);
                for (const [name, value] of Object.entries(headers))
                    response.setHeader(name, value);
                for await (const chunk of upstream) {
                    timeout.refresh();
                    size += chunk.length;
                    if (handle && size <= budget - 8192)
                        await handle.write(chunk);
                    else if (handle) {
                        await handle.close();
                        handle = undefined;
                        cacheable = false;
                        await fs.promises.rm(temporary, { force: true });
                    }
                    if (headers['content-length'] && size >= Number(headers['content-length']))
                        completing.add(filename);
                    if (!response.write(chunk))
                        await once(response, 'drain', { signal: controller.signal });
                }
                if (headers['content-length'] && size !== Number(headers['content-length']))
                    throw new Error('Incomplete Immich media response.');
                if (handle) {
                    await handle.close();
                    handle = undefined;
                }
                if (cacheable && size) {
                    await cacheMutation(async () => {
                        if (!canWriteCache() || !current())
                            return;
                        await fs.promises.rename(temporary, filename + '.data');
                        const metaTemp = temporary + '.json';
                        await fs.promises.writeFile(metaTemp, JSON.stringify({ headers, status, created: Date.now(), size } satisfies CacheMetadata), { mode: 0o600 });
                        await fs.promises.rename(metaTemp, filename + '.json');
                    }).catch(() => { });
                }
                response.end();
            }
            finally {
                completing.delete(filename);
                activeTemporaryFiles.delete(temporary);
                clearTimeout(timeout);
                controller.abort();
                response.off('close', abort);
                await handle?.close().catch(() => { });
                await fs.promises.rm(temporary, { force: true }).catch(() => { });
                await fs.promises.rm(temporary + '.json', { force: true }).catch(() => { });
                if (reserved)
                    reservations -= budget;
            }
        });
        inflight.set(filename, work);
        try {
            await work;
        }
        finally {
            if (inflight.get(filename) === work)
                inflight.delete(filename);
        }
    }
    catch (error) {
        if (!response.destroyed && connectionIsCurrent() && error instanceof Error && error.name !== 'AbortError') markSourceUnavailable(source.id, endpoint);
        if (response.headersSent)
            response.destroy();
        else if (!response.destroyed)
            response.status(503).json({ message: 'Immich is unavailable. Check that your Immich server is running, then try again.' });
    }
}
