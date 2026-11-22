import path from 'node:path';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { databaseManager } from '../db/database.js';
import { appConfig } from '../config/env.js';
import { decryptCredential, encryptCredential } from './credentials.js';
import { ImmichClient, ImmichError, albumSchema, type ImmichAsset, type ImmichAlbum, validateServerUrl } from './client.js';
import { placeResolutionService } from '../services/place-service.js';
const remoteId = z.string().regex(/^[a-zA-Z0-9-]+$/).max(100);
export const selectionSchema = z.object({
    mode: z.enum(['folders', 'albums', 'both']).default('folders'),
    initializedModes: z.array(z.enum(['folders', 'albums'])).max(2).optional(),
    roots: z.array(z.object({ libraryId: remoteId, path: z.string().min(1).max(4096).refine(p => p.startsWith('/') && path.posix.normalize(p) === p && !p.includes('\\'), 'Use a normalized absolute POSIX root path.') })).max(500).default([]),
    albumIds: z.array(remoteId).max(1000).default([]),
    exclusions: z.array(z.string().min(1).max(4096)).max(500).default([]),
    includeUnfiled: z.boolean().default(false),
    allowOriginals: z.boolean().default(false),
    intervalMinutes: z.number().int().min(0).max(525600).refine(n => n === 0 || n >= 5, 'Use zero or at least five minutes.').default(0)
});
export const sourceInputSchema = z.object({ name: z.string().trim().min(1).max(100), serverUrl: z.string().max(2048), apiKey: z.string().trim().min(1).max(4096).optional(), enabled: z.boolean().default(true), selection: selectionSchema });
export type Selection = z.infer<typeof selectionSchema>;
export interface SourceRecord {
    id: number;
    kind: 'immich';
    name: string;
    server_url: string;
    api_key_ciphertext: string;
    managed_by: string;
    enabled: number;
    config_json: string;
    status: string;
    last_error: string | null;
    last_success: string | null;
    progress: number;
    asset_count: number;
    folder_count: number;
    generation: number;
    updated_at: string;
}
const db = () => databaseManager.connection;
export const getSource = (id: number) => db().prepare('SELECT * FROM media_sources WHERE id = ? AND kind = \'immich\'').get(id) as unknown as SourceRecord | undefined;
export function listSources() {
    return (db().prepare('SELECT * FROM media_sources WHERE kind = \'immich\' ORDER BY id').all() as unknown as SourceRecord[]).map(source => {
        const { api_key_ciphertext, config_json, ...safe } = source;
        return { ...safe, hasApiKey: Boolean(api_key_ciphertext), selection: selectionSchema.parse(JSON.parse(config_json)), syncing: running.has(source.id) };
    });
}
export const sourceClient = (s: SourceRecord) => new ImmichClient(s.server_url, decryptCredential(s.api_key_ciphertext));
export function sameConnection(first: SourceRecord, second?: SourceRecord): boolean {
    return first.server_url === second?.server_url && first.api_key_ciphertext === second.api_key_ciphertext;
}
export function isWithinRoot(candidate: string, root: string): boolean { return candidate === root || candidate.startsWith(root === '/' ? '/' : `${root}/`); }
export function sourceVisible(id: number): boolean { const s = getSource(id); return Boolean(s?.enabled && s.status !== 'revoked'); }
export function revokeSource(id: number): void { db().prepare("UPDATE media_sources SET status = 'revoked', last_error = 'Immich API key was rejected. Update the key and sync to restore access.' WHERE id = ?").run(id); }
// Connectivity is independent of reconciliation and authorization. A healthy
// connection must never restore access to a revoked or deselected index.
const connections = new Map<number, { available: boolean; checkedAt: number; endpoint: string; revision: number; checking?: Promise<void> }>();
export function sourceAvailable(id: number): boolean { return connections.get(id)?.available !== false; }
export function markSourceUnavailable(id: number, endpoint = '/api/server/about'): void {
    const state = connections.get(id) ?? { available: true, checkedAt: 0, endpoint, revision: 0 };
    state.available = false;
    state.checkedAt = 0;
    state.endpoint = endpoint;
    state.revision++;
    connections.set(id, state);
}
async function checkConnection(source: SourceRecord, retry = false): Promise<void> {
    const state = connections.get(source.id) ?? { available: true, checkedAt: 0, endpoint: '/api/server/about', revision: 0 };
    connections.set(source.id, state);
    if (state.checking) return state.checking;
    if (!retry && Date.now() - state.checkedAt < (state.available ? 10000 : 2000)) return;
    const revision = state.revision;
    state.checking = (async () => {
        try {
            const upstream = await sourceClient(source).open(state.endpoint, { signal: AbortSignal.timeout(3000) });
            const status = upstream.statusCode ?? 502;
            upstream.destroy();
            if (status === 401 && connections.get(source.id) === state) revokeSource(source.id);
            if (state.revision === revision) state.available = status < 500;
        } catch {
            if (state.revision === revision) state.available = false;
        } finally {
            state.checkedAt = Date.now();
            state.checking = undefined;
        }
    })();
    return state.checking;
}
export async function sourceStatuses(retry = false) {
    const sources = db().prepare('SELECT * FROM media_sources WHERE kind = \'immich\' ORDER BY id').all() as unknown as SourceRecord[];
    await Promise.all(sources.filter(s => s.enabled && s.status !== 'revoked').map(s => checkConnection(s, retry && !sourceAvailable(s.id))));
    return (db().prepare('SELECT id,kind,name,enabled,status,generation,updated_at FROM media_sources WHERE kind = \'immich\' ORDER BY id').all() as Array<{ id: number; kind: 'immich'; name: string; enabled: number; status: string; generation: number; updated_at: string }>).map(s => ({ ...s, available: sourceAvailable(s.id), syncing: running.has(s.id) }));
}
function editableSource(id: number | undefined, managedBy: string): SourceRecord | undefined {
    const existing = id ? getSource(id) : undefined;
    if (id && !existing)
        throw new Error('Source not found.');
    if (running.has(id ?? -1))
        throw new Error('Wait for this source synchronization to finish before changing its configuration.');
    if (existing?.managed_by === 'environment' && managedBy !== 'environment')
        throw new Error('This source is managed by environment configuration.');
    return existing;
}
export function saveSource(input: z.infer<typeof sourceInputSchema>, id?: number, managedBy = 'settings'): number {
    const existing = editableSource(id, managedBy);
    const url = validateServerUrl(input.serverUrl);
    if (existing && existing.server_url !== url)
        throw new Error('Verify the new Immich address before saving.');
    return persistSource(input, url, managedBy, existing);
}
export async function updateSource(input: z.infer<typeof sourceInputSchema>, id: number, managedBy = 'settings'): Promise<number> {
    const existing = editableSource(id, managedBy)!;
    const url = validateServerUrl(input.serverUrl);
    if (existing.server_url !== url) {
        await verifyConnection(url, input.apiKey, existing);
        const current = editableSource(id, managedBy)!;
        if (!sameConnection(existing, current) || current.updated_at !== existing.updated_at || current.generation !== existing.generation)
            throw new Error('The source changed while verifying its new address. Reopen the source and try again.');
    }
    return persistSource(input, url, managedBy, existing);
}
function persistSource(input: z.infer<typeof sourceInputSchema>, url: string, managedBy: string, existing?: SourceRecord): number {
    if (!input.apiKey && !existing)
        throw new Error('An Immich API key is required.');
    let credentialChanged = Boolean(input.apiKey);
    if (existing && input.apiKey) {
        try {
            credentialChanged = decryptCredential(existing.api_key_ciphertext) !== input.apiKey;
        }
        catch { /* A replacement key can repair lost encryption state. */ }
    }
    const encrypted = credentialChanged && input.apiKey ? encryptCredential(input.apiKey) : existing!.api_key_ciphertext;
    const contentSelection = ({ allowOriginals, intervalMinutes, initializedModes, ...content }: Selection) => JSON.stringify(content);
    if (existing) {
        const connectionChanged = credentialChanged || existing.server_url !== url;
        const selectionChanged = contentSelection(input.selection) !== contentSelection(selectionSchema.parse(JSON.parse(existing.config_json)));
        db().exec('BEGIN IMMEDIATE');
        try {
            db().prepare("UPDATE media_sources SET name=?, server_url=?, api_key_ciphertext=?, enabled=?, config_json=?, status=CASE WHEN ? AND status!='revoked' THEN 'idle' ELSE status END, last_error=CASE WHEN ? AND status!='revoked' THEN NULL ELSE last_error END, updated_at=? WHERE id=?")
                .run(input.name, url, encrypted, Number(input.enabled), JSON.stringify(input.selection), Number(connectionChanged), Number(connectionChanged), new Date().toISOString(), existing.id);
            // Keep stale index rows hidden until a complete sync restores the current selection.
            if (connectionChanged || selectionChanged) hideSourceIndex(existing.id);
            db().exec('COMMIT');
        } catch (error) {
            db().exec('ROLLBACK');
            throw error;
        }
        if (connectionChanged) connections.delete(existing.id);
        return existing.id;
    }
    return Number(db().prepare('INSERT INTO media_sources(name,server_url,api_key_ciphertext,managed_by,enabled,config_json) VALUES(?,?,?,?,?,?)').run(input.name, url, encrypted, managedBy, Number(input.enabled), JSON.stringify(input.selection)).lastInsertRowid);
}
function hideSourceIndex(id: number): void {
    db().prepare('UPDATE images SET is_deleted=1 WHERE source_id=?').run(id);
    db().prepare('UPDATE posts SET is_deleted=1 WHERE source_id=?').run(id);
    db().prepare('UPDATE folders SET remote_visible=0 WHERE source_id=?').run(id);
}
export async function removeSource(id: number): Promise<void> {
    const source = getSource(id);
    if (!source)
        throw new Error('Source not found.');
    if (source.managed_by === 'environment')
        throw new Error('Remove environment configuration to remove this source.');
    if (running.has(id))
        throw new Error('Wait for synchronization to finish before removing the source.');
    db().exec('BEGIN IMMEDIATE');
    try {
        db().prepare('UPDATE folders SET avatar_image_id=NULL WHERE source_id=?').run(id);
        db().prepare('DELETE FROM posts WHERE source_id=?').run(id);
        db().prepare('DELETE FROM images WHERE source_id=?').run(id);
        db().prepare('DELETE FROM folders WHERE source_id=?').run(id);
        db().prepare('DELETE FROM media_sources WHERE id=?').run(id);
        db().exec('COMMIT');
    }
    catch (e) {
        db().exec('ROLLBACK');
        throw e;
    }
    const { clearSourceCache } = await import('./media.js');
    connections.delete(id);
    await clearSourceCache(id);
}
async function verifyVersion(client: ImmichClient): Promise<string> {
    const about = z.object({ version: z.string() }).safeParse(await client.json('/api/server/about'));
    const version = about.success ? about.data.version : '';
    const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[a-z0-9-]+(?:\.[a-z0-9-]+)*)?(?:\+[a-z0-9-]+(?:\.[a-z0-9-]+)*)?$/i.exec(version);
    if (!match)
        throw new Error('Immich did not report a valid server version. Check the server URL.');
    const [, majorText, minorText, patchText, prerelease] = match;
    const major = Number(majorText);
    const minor = Number(minorText);
    const isMinimumPrerelease = minor === 2 && patchText === '0' && prerelease;
    if (major < 3 || (major === 3 && (minor < 2 || isMinimumPrerelease)))
        throw new Error(`Immich ${version} is below the minimum supported version. Use Immich v3.2.0 or later.`);
    return version;
}
async function verifyConnection(serverUrl: string, apiKey?: string, source?: SourceRecord) {
    const url = validateServerUrl(serverUrl);
    const changedAddress = Boolean(source && source.server_url !== url);
    if (changedAddress && !apiKey)
        throw new Error('Enter an Immich API key to verify the new server address.');
    const key = apiKey ?? (source ? decryptCredential(source.api_key_ciphertext) : undefined);
    if (!key)
        throw new Error('Enter an Immich API key.');
    const client = new ImmichClient(url, key);
    const version = await verifyVersion(client);
    if (changedAddress && source) await verifyLibraryIdentity(client, source.id);
    return { client, version };
}
async function verifyLibraryIdentity(client: ImmichClient, sourceId: number): Promise<void> {
    const assets = db().prepare('SELECT external_asset_id AS id FROM images WHERE source_id=? AND external_asset_id IS NOT NULL ORDER BY is_deleted, id DESC LIMIT 12')
        .all(sourceId) as Array<{ id: string }>;
    if (!assets.length) return;

    // Immich asset IDs stay stable when the same database moves to another address.
    const metadata = z.object({ id: remoteId });
    for (const { id } of assets) {
        try {
            const match = metadata.safeParse(await client.json(`/api/assets/${id}`));
            if (match.success && match.data.id === id) return;
        } catch (error) {
            // Immich can return 400 for a missing asset as well as 403 or 404.
            if (!(error instanceof ImmichError) || ![400, 403, 404].includes(error.status)) throw error;
        }
    }
    throw new Error('Could not match this address to the existing Immich library. Check the URL and API key, or add a separate source for a different library.');
}
export async function detectContent(serverUrl: string, key?: string, source?: SourceRecord) {
    const { client, version } = await verifyConnection(serverUrl, key, source);
    const warnings: string[] = [];
    let libraries: Array<{
        id: string;
        name: string;
        importPaths: string[];
    }> = [];
    let albums: ImmichAlbum[] = [];
    try {
        libraries = z.array(z.object({ id: remoteId, name: z.string(), importPaths: z.array(z.string()) })).parse(await client.json('/api/libraries'));
    }
    catch (e) {
        if (!(e instanceof ImmichError) || e.status !== 403)
            throw e;
        warnings.push('Library discovery requires an Immich administrator and library.read. Accessible external directories are detected from asset search; select them or enter a library ID and root manually.');
    }
    try {
        albums = z.array(albumSchema).parse(await client.json('/api/albums'));
    }
    catch (e) {
        if (!(e instanceof ImmichError) || e.status !== 403)
            throw e;
        warnings.push('Album discovery unavailable: grant album.read to use album grouping.');
    }
    const roots = new Map<string, {
        libraryId: string;
        path: string;
        count: number;
    }>();
    let assetCount = 0;
    let uploadCount = 0;
    for await (const asset of client.assets()) {
        assetCount++;
        if (asset.libraryId) {
            const parent = path.posix.dirname(path.posix.normalize(asset.originalPath));
            const key = `${asset.libraryId}:${parent}`;
            const entry = roots.get(key) ?? { libraryId: asset.libraryId, path: parent, count: 0 };
            entry.count++;
            roots.set(key, entry);
        }
        else
            uploadCount++;
    }
    return { version, libraries, roots: [...roots.values()], albums, assetCount, uploadCount, warnings,
        suggestedMode: (roots.size && albums.length ? 'both' : albums.length ? 'albums' : 'folders') as Selection['mode'] };
}
interface Group {
    key: string;
    name: string;
    description: string | null;
    cover?: string | null;
    assets: string[];
}
const running = new Map<number, Promise<void>>();
export function syncSource(id: number): Promise<void> {
    const active = running.get(id);
    if (active)
        return active;
    const source = getSource(id);
    if (!source?.enabled)
        return Promise.reject(new Error('Source is disabled or missing.'));
    const task = synchronize(source).finally(() => running.delete(id));
    running.set(id, task);
    return task;
}
async function synchronize(source: SourceRecord): Promise<void> {
    db().prepare("UPDATE media_sources SET status=CASE WHEN status='revoked' THEN status ELSE 'syncing' END, progress=0, last_error=CASE WHEN status='revoked' THEN last_error ELSE NULL END WHERE id=?").run(source.id);
    try {
        const selection = selectionSchema.parse(JSON.parse(source.config_json));
        const client = sourceClient(source);
        await verifyVersion(client);
        const assets = new Map<string, ImmichAsset>();
        const groups = new Map<string, Group>();
        const add = (group: Group, asset: ImmichAsset) => {
            assets.set(asset.id, asset);
            group.assets.push(asset.id);
            if (assets.size > 1000000)
                throw new Error('Source exceeds the one-million-asset reconciliation limit. Select fewer roots or albums.');
            if (assets.size % 100 === 0)
                db().prepare('UPDATE media_sources SET progress=? WHERE id=?').run(assets.size, source.id);
        };
        if (selection.mode !== 'albums' && selection.roots.length) {
            for (const libraryId of new Set(selection.roots.map(r => r.libraryId))) {
                for await (const asset of client.assets({ libraryId: { eq: libraryId } })) {
                    if (asset.libraryId !== libraryId)
                        throw new Error('Immich ignored the library filter; synchronization stopped.');
                    const parent = path.posix.dirname(path.posix.normalize(asset.originalPath));
                    if (!selection.roots.some(r => r.libraryId === libraryId && isWithinRoot(parent, r.path)) || selection.exclusions.some(p => isWithinRoot(parent, p)))
                        continue;
                    const key = `directory:${libraryId}:${parent}`;
                    let group = groups.get(key);
                    if (!group) {
                        group = { key, name: path.posix.basename(parent) || 'External library', description: null, assets: [] };
                        groups.set(key, group);
                    }
                    add(group, asset);
                }
            }
        }
        if (selection.mode !== 'folders') {
            // Listing success confirms removed/shared-away albums; a failed list never reconciles anything.
            const available = z.array(albumSchema).parse(await client.json('/api/albums'));
            for (const albumId of new Set(selection.albumIds)) {
                const album = available.find(a => a.id === albumId);
                if (!album)
                    continue;
                const group: Group = { key: `album:${albumId}`, name: album.albumName, description: album.description ?? null, cover: album.albumThumbnailAssetId, assets: [] };
                groups.set(group.key, group);
                for await (const asset of client.assets({ albumIds: { any: [albumId] } }, album.order))
                    add(group, asset);
            }
        }
        if (selection.includeUnfiled) {
            const group: Group = { key: 'unfiled', name: 'Unfiled uploads', description: 'Uploaded media outside the selected albums', assets: [] };
            for await (const asset of client.assets())
                if (!asset.libraryId && !assets.has(asset.id))
                    add(group, asset);
            if (group.assets.length)
                groups.set(group.key, group);
        }
        commitIndex(source, assets, groups);
        connections.delete(source.id);
        // GPS uses the same local Places index as local media. Geodata preparation is optional.
        try {
            const remoteRows = db().prepare('SELECT id,exif_json FROM images WHERE source_id=? AND is_deleted=0').all(source.id) as Array<{
                id: number;
                exif_json: string | null;
            }>;
            for (const row of remoteRows)
                placeResolutionService.resolveImage(row);
        }
        catch { /* Places can be rebuilt independently in Settings. */ }
    }
    catch (error) {
        if (error instanceof ImmichError && error.status === 401)
            revokeSource(source.id);
        else
            db().prepare("UPDATE media_sources SET status=CASE WHEN status='revoked' THEN status ELSE 'error' END,last_error=? WHERE id=?").run(error instanceof z.ZodError ? 'Incompatible Immich metadata response. Previous index retained.' : error instanceof Error ? error.message : 'Immich synchronization failed.', source.id);
        if (error instanceof ImmichError && error.status >= 500) markSourceUnavailable(source.id);
        throw error;
    }
}
function timestamp(value: string | null | undefined, fallback: number): number { const n = Date.parse(value ?? ''); return Number.isFinite(n) ? n : fallback; }
function durationMs(value: unknown): number | null {
    if (typeof value === 'number')
        return value;
    if (typeof value !== 'string')
        return null;
    const pieces = value.split(':').map(Number);
    return pieces.every(Number.isFinite) ? pieces.reduce((n, v) => n * 60 + v, 0) * 1000 : null;
}
function commitIndex(source: SourceRecord, assets: Map<string, ImmichAsset>, groups: Map<string, Group>): void {
    const connection = db();
    const now = new Date().toISOString();
    const generation = source.generation + 1;
    connection.exec('BEGIN IMMEDIATE');
    try {
        connection.prepare('DELETE FROM folder_media_memberships WHERE folder_id IN (SELECT id FROM folders WHERE source_id=?)').run(source.id);
        connection.prepare('UPDATE folders SET remote_visible=0 WHERE source_id=?').run(source.id);
        const folders = new Map<string, number>();
        for (const group of groups.values()) {
            const synthetic = `immich/${source.id}/groups/${createHash('sha256').update(group.key).digest('hex').slice(0, 24)}`;
            connection.prepare(`INSERT INTO folders(slug,name,folder_path,description,source_id,external_id) VALUES(?,?,?,?,?,?) ON CONFLICT(source_id,external_id) WHERE source_id IS NOT NULL DO UPDATE SET name=CASE WHEN metadata_override=0 THEN excluded.name ELSE name END,description=CASE WHEN metadata_override=0 THEN excluded.description ELSE description END,remote_visible=1,updated_at=?`)
                .run(`immich-${source.id}-${createHash('sha256').update(group.key).digest('hex').slice(0, 24)}`, group.name, synthetic, group.description, source.id, group.key, now);
            const folder = connection.prepare('SELECT id FROM folders WHERE source_id=? AND external_id=?').get(source.id, group.key) as {
                id: number;
            };
            folders.set(group.key, folder.id);
        }
        const memberships = new Map<string, number[]>();
        for (const group of groups.values())
            for (const assetId of new Set(group.assets)) {
                const ids = memberships.get(assetId) ?? [];
                ids.push(folders.get(group.key)!);
                memberships.set(assetId, ids);
            }
        for (const asset of assets.values()) {
            const ids = memberships.get(asset.id)!;
            const folderId = ids[0];
            const relative = `immich/${source.id}/assets/${asset.id}`;
            const taken = timestamp(typeof asset.exifInfo?.dateTimeOriginal === 'string' ? asset.exifInfo.dateTimeOriginal : asset.fileCreatedAt, timestamp(asset.fileCreatedAt, 0));
            const exif = asset.exifInfo ?? {};
            const exifJson = JSON.stringify({ latitude: exif.latitude, longitude: exif.longitude, cameraMake: exif.make, cameraModel: exif.model, lensModel: exif.lensModel, iso: exif.iso, fNumber: exif.fNumber, focalLengthMm: exif.focalLength });
            const version = `${asset.updatedAt ?? ''}:${asset.thumbhash ?? ''}:${asset.checksum ?? ''}`;
            connection.prepare(`INSERT INTO images(folder_id,source_id,external_asset_id,remote_version,sync_generation,filename,extension,relative_path,absolute_path,file_size,width,height,media_type,mime_type,duration_ms,checksum_or_fingerprint,mtime_ms,first_seen_at,sort_timestamp,taken_at,taken_at_source,exif_json,thumbnail_path,preview_path,playback_strategy)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'preview')
        ON CONFLICT(source_id,external_asset_id) WHERE source_id IS NOT NULL DO UPDATE SET folder_id=excluded.folder_id,remote_version=excluded.remote_version,sync_generation=excluded.sync_generation,filename=excluded.filename,file_size=excluded.file_size,width=excluded.width,height=excluded.height,media_type=excluded.media_type,mime_type=excluded.mime_type,duration_ms=excluded.duration_ms,mtime_ms=excluded.mtime_ms,sort_timestamp=excluded.sort_timestamp,taken_at=excluded.taken_at,exif_json=excluded.exif_json,is_deleted=0,deleted_at=NULL,updated_at=?`)
                .run(folderId, source.id, asset.id, version, generation, asset.originalFileName, path.posix.extname(asset.originalFileName), relative, '', Number(exif.fileSizeInByte) || 0, asset.width ?? (Number(exif.exifImageWidth) || 1), asset.height ?? (Number(exif.exifImageHeight) || 1), asset.type === 'VIDEO' ? 'video' : 'image', asset.originalMimeType ?? (asset.type === 'VIDEO' ? 'video/mp4' : 'image/jpeg'), durationMs(asset.duration), version, timestamp(asset.fileModifiedAt, taken), now, taken, taken, 'exif', exifJson, relative + '/thumbnail', relative + '/preview', now);
            const image = connection.prepare('SELECT id,place_id FROM images WHERE source_id=? AND external_asset_id=?').get(source.id, asset.id) as {
                id: number;
                place_id: number | null;
            };
            connection.prepare(`INSERT INTO posts(folder_id,source_id,source_path,sort_timestamp,taken_at,taken_at_source,place_id) VALUES(?,?,?,?,?,'exif',?) ON CONFLICT(source_id,source_path) DO UPDATE SET folder_id=excluded.folder_id,sort_timestamp=excluded.sort_timestamp,taken_at=excluded.taken_at,place_id=excluded.place_id,is_deleted=0,deleted_at=NULL,updated_at=?`)
                .run(folderId, source.id, relative, taken, taken, image.place_id, now);
            const post = connection.prepare('SELECT id FROM posts WHERE source_id=? AND source_path=?').get(source.id, relative) as {
                id: number;
            };
            connection.prepare('INSERT OR IGNORE INTO post_items(post_id,image_id,position) VALUES(?,?,1)').run(post.id, image.id);
            ids.forEach(id => connection.prepare('INSERT INTO folder_media_memberships(folder_id,image_id) VALUES(?,?)').run(id, image.id));
        }
        connection.prepare(`UPDATE folders SET avatar_image_id=NULL,avatar_source='auto' WHERE source_id=? AND avatar_image_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM folder_media_memberships WHERE folder_id=folders.id AND image_id=folders.avatar_image_id)`).run(source.id);
        for (const group of groups.values()) {
            const folderId = folders.get(group.key)!;
            const cover = group.cover ? connection.prepare('SELECT id FROM images WHERE source_id=? AND external_asset_id=? AND id IN (SELECT image_id FROM folder_media_memberships WHERE folder_id=?)').get(source.id, group.cover, folderId) as {
                id: number;
            } | undefined : undefined;
            connection.prepare("UPDATE folders SET avatar_image_id=?,avatar_source='auto' WHERE id=? AND avatar_source!='manual'").run(cover?.id ?? null, folderId);
        }
        connection.prepare('UPDATE images SET is_deleted=1,deleted_at=? WHERE source_id=? AND sync_generation!=?').run(now, source.id, generation);
        connection.prepare('UPDATE posts SET is_deleted=1,deleted_at=? WHERE source_id=? AND id IN (SELECT post_id FROM post_items JOIN images ON images.id=post_items.image_id WHERE images.is_deleted=1)').run(now, source.id);
        connection.prepare("UPDATE media_sources SET status='ready',last_error=NULL,last_success=?,progress=?,asset_count=?,folder_count=?,generation=? WHERE id=?").run(now, assets.size, assets.size, groups.size, generation, source.id);
        connection.exec('COMMIT');
    }
    catch (error) {
        connection.exec('ROLLBACK');
        throw error;
    }
}
let scheduler: NodeJS.Timeout | undefined;
export let sourceBootstrapError: string | null = null;
export async function startSources(): Promise<void> {
    sourceBootstrapError = null;
    db().prepare("UPDATE media_sources SET status='error',last_error='Synchronization interrupted by server restart. Run sync again.' WHERE kind='immich' AND status='syncing'").run();
    if (process.env.IMMICH_URL) {
        const existing = db().prepare("SELECT id FROM media_sources WHERE kind='immich' AND managed_by='environment'").get() as {
            id: number;
        } | undefined;
        try {
            const key = process.env.IMMICH_API_KEY_FILE ? fs.readFileSync(process.env.IMMICH_API_KEY_FILE, 'utf8').trim() : process.env.IMMICH_API_KEY;
            const selection = selectionSchema.parse({ mode: process.env.IMMICH_SYNC_MODE || 'folders', roots: JSON.parse(process.env.IMMICH_ROOTS || '[]'), albumIds: (process.env.IMMICH_ALBUM_IDS || '').split(',').filter(Boolean), includeUnfiled: process.env.IMMICH_INCLUDE_UNFILED === 'true', allowOriginals: process.env.IMMICH_ALLOW_ORIGINALS === 'true', intervalMinutes: Number(process.env.IMMICH_SYNC_INTERVAL_MINUTES || 0) });
            const input = { name: process.env.IMMICH_NAME || 'Immich (environment)', serverUrl: process.env.IMMICH_URL, apiKey: key, enabled: true, selection };
            const id = existing ? await updateSource(input, existing.id, 'environment') : saveSource(input, undefined, 'environment');
            if (process.env.IMMICH_AUTO_SYNC === 'true')
                void syncSource(id).catch(() => { });
        }
        catch {
            sourceBootstrapError = 'Invalid environment Immich configuration. Check the URL, explicit selection JSON and API key file.';
            if (existing)
                db().prepare("UPDATE media_sources SET enabled=0,status='error',last_error='Invalid environment Immich configuration. Check the URL, selection JSON and API key file.' WHERE id=?").run(existing.id);
        }
    }
    else
        db().prepare("UPDATE media_sources SET enabled=0,managed_by='settings' WHERE kind='immich' AND managed_by='environment'").run();
    scheduler = setInterval(() => {
        for (const source of listSources())
            if (source.enabled && !source.syncing && source.selection.intervalMinutes && Date.now() - Date.parse(source.last_success ?? '1970-01-01') >= source.selection.intervalMinutes * 60000)
                void syncSource(source.id).catch(() => { });
    }, 60000);
    scheduler.unref();
}
export function stopSources(): void {
    if (scheduler)
        clearInterval(scheduler);
}
