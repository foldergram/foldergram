import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { z } from 'zod';
import pLimit from 'p-limit';
const metadataLimit = pLimit(4);
export class ImmichError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export function validateServerUrl(value: string): string {
    let url: URL;
    try {
        url = new URL(value);
    }
    catch {
        throw new Error('Enter an absolute http:// or https:// Immich server URL.');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || /%|\\/.test(url.pathname)) {
        throw new Error('Immich URL must use HTTP(S), without credentials, query parameters, fragments, or encoded paths.');
    }
    if (url.pathname.split('/').includes('api'))
        throw new Error('Use the Immich server URL without /api.');
    return url.toString().replace(/\/+$/, '');
}
function blockedAddress(address: string): boolean {
    const a = address.replace(/^::ffff:/i, '');
    return /^(0\.|169\.254\.|127\.0\.0\.0$|100\.100\.100\.200$|168\.63\.129\.16$|2[2-5][0-9]\.)/.test(a) || /^(::|fe[89ab]|ff)/i.test(a) && a !== '::1';
}
const idPattern = '[a-zA-Z0-9-]+';
const allowedGet = new RegExp(`^/api/(server/about|libraries|albums|albums/${idPattern}|assets/${idPattern}|assets/${idPattern}/thumbnail\\?size=(thumbnail|preview)|assets/${idPattern}/video/playback|assets/${idPattern}/original)$`);
export function assertReadOperation(method: string, endpoint: string): void {
    if (!(method === 'GET' && allowedGet.test(endpoint)) && !(method === 'POST' && endpoint === '/api/search/metadata')) {
        throw new Error('Immich operation is outside the read-only allowlist.');
    }
}
export const assetSchema = z.object({
    id: z.string().regex(/^[a-zA-Z0-9-]+$/), type: z.enum(['IMAGE', 'VIDEO']),
    libraryId: z.string().nullable().optional(), originalPath: z.string(), originalFileName: z.string(),
    originalMimeType: z.string().optional(), fileCreatedAt: z.string().nullable().optional(),
    updatedAt: z.string().optional(), fileModifiedAt: z.string().nullable().optional(),
    width: z.number().nullable().optional(), height: z.number().nullable().optional(),
    duration: z.union([z.number(), z.string()]).nullable().optional(),
    thumbhash: z.string().nullable().optional(), checksum: z.string().optional(),
    visibility: z.string().optional(), isTrashed: z.boolean().optional(), isOffline: z.boolean().optional(),
    exifInfo: z.record(z.unknown()).nullable().optional()
}).passthrough();
export type ImmichAsset = z.infer<typeof assetSchema>;
export const albumSchema = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]+$/), albumName: z.string(), description: z.string().optional(), albumThumbnailAssetId: z.string().nullable().optional(), order: z.enum(['asc', 'desc']).optional(), shared: z.boolean().optional() }).passthrough();
export type ImmichAlbum = z.infer<typeof albumSchema>;
export class ImmichClient {
    readonly base: string;
    constructor(serverUrl: string, private key: string) { this.base = validateServerUrl(serverUrl); }
    async open(endpoint: string, options: {
        body?: unknown;
        range?: string;
        signal?: AbortSignal;
    } = {}): Promise<IncomingMessage> {
        const method = options.body === undefined ? 'GET' : 'POST';
        assertReadOperation(method, endpoint);
        const url = new URL(`${this.base}${endpoint}`);
        const hostname = url.hostname.replace(/^\[|\]$/g, '');
        const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await dns.lookup(hostname, { all: true });
        if (!addresses.length || addresses.some(({ address }) => blockedAddress(address)))
            throw new Error('Immich URL resolves to a reserved or metadata-service address.');
        const pinned = addresses[0];
        const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
        return new Promise((resolve, reject) => {
            const request = (url.protocol === 'https:' ? https : http).request(url, {
                method, signal: options.signal,
                lookup: ((_host: string, lookupOptions: any, callback: any) => lookupOptions.all
                    ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as any,
                headers: { 'x-api-key': this.key, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}), ...(options.range ? { Range: options.range } : {}) }
            }, response => {
                // Redirects are deliberately refused, including same-origin redirects. Never forward a key to another target.
                if ((response.statusCode ?? 0) >= 300 && (response.statusCode ?? 0) < 400) {
                    response.resume();
                    reject(new ImmichError(502, 'Immich redirected the request. Configure the final server URL.'));
                    return;
                }
                resolve(response);
            });
            request.setTimeout(60000, () => request.destroy(new Error('Immich request timed out.')));
            request.on('error', () => reject(new ImmichError(503, 'Immich is unavailable or timed out. Check the server URL and Docker network.')));
            request.end(payload);
        });
    }
    json(endpoint: string, body?: unknown): Promise<unknown> {
        return metadataLimit(() => this.requestJson(endpoint, body));
    }
    private async requestJson(endpoint: string, body?: unknown): Promise<unknown> {
        for (let attempt = 0;; attempt++) {
            try {
                const signal = AbortSignal.timeout(60000);
                const response = await this.open(endpoint, { body, signal });
                const status = response.statusCode ?? 502;
                if (status !== 200 && status !== 201) {
                    response.resume();
                    throw new ImmichError(status, status === 401 ? 'Invalid or revoked Immich API key. Update the API key.' : status === 403 ? `Missing Immich permission or account access for ${endpoint.split('?')[0]}. Check asset.read, album.read, asset.view and account ownership.` : status === 400 ? 'Incompatible Immich search API. This integration requires the v3.3.5 structured-filter and nextCursor contract.' : `Immich returned HTTP ${status}.`);
                }
                const chunks: Buffer[] = [];
                let size = 0;
                for await (const chunk of response) {
                    size += chunk.length;
                    if (size > 64 * 1024 * 1024) {
                        response.destroy();
                        throw new Error('Immich metadata response exceeds 64 MiB.');
                    }
                    chunks.push(chunk);
                }
                try {
                    return JSON.parse(Buffer.concat(chunks).toString());
                }
                catch {
                    throw new Error('Immich returned invalid JSON. Check the server URL and API version.');
                }
            }
            catch (error) {
                if (attempt >= 2 || !(error instanceof ImmichError) || (error.status < 500 && error.status !== 429))
                    throw error;
                await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
            }
        }
    }
    async *assets(filter: Record<string, unknown> = {}, direction: 'asc' | 'desc' = 'asc'): AsyncGenerator<ImmichAsset> {
        let cursor: string | undefined;
        const cursors = new Set<string>();
        do {
            const result = await this.json('/api/search/metadata', { size: 500, withExif: true,
                filter: { ...filter, visibility: { eq: 'timeline' } }, orderBy: { field: 'fileCreatedAt', direction }, ...(cursor ? { cursor } : {}) });
            const parsed = z.object({ assets: z.object({ items: z.array(assetSchema), nextCursor: z.string().nullable() }) }).safeParse(result);
            if (!parsed.success)
                throw new Error('Incompatible Immich asset search response: expected assets.items and assets.nextCursor (v3.3.5). Previous index retained.');
            for (const asset of parsed.data.assets.items)
                if (!asset.isTrashed && (!asset.visibility || asset.visibility === 'timeline'))
                    yield asset;
            cursor = parsed.data.assets.nextCursor ?? undefined;
            if (cursor && cursors.has(cursor))
                throw new Error('Immich repeated a pagination cursor. Previous index retained.');
            if (cursor)
                cursors.add(cursor);
        } while (cursor);
    }
}
