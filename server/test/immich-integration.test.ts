import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestTestApp as requestNative } from './http-test-utils.js';
const requestTestApp: typeof requestNative = (app, method, url, headers = {}, body) => requestNative(app, method, url, { Connection: 'close', ...headers }, body);
const photo = (id: string, parent = '/photos/Trips', libraryId: string | null = 'lib-one', type = 'IMAGE') => ({ id, type, libraryId, originalPath: `${parent}/${id}.jpg`, originalFileName: id === 'cover' ? 'cover.jpg' : `${id}.jpg`, originalMimeType: type === 'VIDEO' ? 'video/mp4' : 'image/jpeg', fileCreatedAt: '2025-01-01T00:00:00Z', fileModifiedAt: '2025-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', width: 800, height: 600, duration: type === 'VIDEO' ? 12000 : null, visibility: 'timeline', exifInfo: { fileSizeInByte: 1000, latitude: 34.9, longitude: -83.4 } });
describe.sequential('optional Immich sources', () => {
    let temp: string, base: string, server: http.Server;
    let data: any[], albums: any[], members: Record<string, string[]>, failCursor: boolean, librariesForbidden: boolean, permissionDenied: boolean, mediaFailure: number, searchCalls: number, mediaCalls: number, retryFailures: number;
    let slowVideo: boolean, mediaSize: number, version: string, unavailable: boolean, omitNextCursor: boolean;
    let sources: typeof import('../src/immich/source-service.js');
    let repos: typeof import('../src/db/repositories.js');
    let manager: typeof import('../src/db/database.js');
    let gallery: typeof import('../src/services/gallery-service.js');
    let scanner: typeof import('../src/services/scanner-service.js');
    let app: ReturnType<typeof import('../src/app.js')['createApp']>;
    const jsonHeaders = { 'x-foldergram-intent': '1' };
    beforeAll(async () => {
        temp = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-immich-'));
        vi.stubEnv('NODE_ENV', 'test');
        vi.stubEnv('DATA_ROOT', temp);
        vi.stubEnv('GALLERY_ROOT', path.join(temp, 'gallery'));
        vi.stubEnv('DB_DIR', path.join(temp, 'db'));
        vi.stubEnv('THUMBNAILS_DIR', path.join(temp, 'thumbnails'));
        vi.stubEnv('PREVIEWS_DIR', path.join(temp, 'previews'));
        vi.stubEnv('IMMICH_URL', '');
        server = http.createServer(async (req, res) => {
            if (unavailable) {
                res.writeHead(503);
                res.end();
                return;
            }
            if (req.headers['x-api-key'] !== 'fixture-secret') {
                res.writeHead(401);
                res.end();
                return;
            }
            if (permissionDenied) {
                res.writeHead(401);
                res.end();
                return;
            }
            res.setHeader('Content-Type', 'application/json');
            if (req.url === '/api/server/about') {
                res.end(JSON.stringify({ version }));
                return;
            }
            if (req.url === '/api/libraries') {
                if (librariesForbidden) {
                    res.writeHead(403);
                    res.end();
                    return;
                }
                res.end(JSON.stringify([{ id: 'lib-one', name: 'Photos', importPaths: ['/photos'], assetCount: 0 }]));
                return;
            }
            if (req.url === '/api/albums') {
                res.end(JSON.stringify(albums));
                return;
            }
            if (req.url === '/api/search/metadata') {
                searchCalls++;
                if (retryFailures-- > 0) {
                    res.writeHead(503);
                    res.end();
                    return;
                }
                let body = '';
                for await (const chunk of req)
                    body += chunk;
                const query = JSON.parse(body);
                if (query.cursor && failCursor) {
                    res.writeHead(503);
                    res.end();
                    return;
                }
                let found = data.filter(a => a.visibility === 'timeline' && !a.isTrashed);
                if (query.filter.libraryId)
                    found = found.filter(a => a.libraryId === query.filter.libraryId.eq);
                if (query.filter.albumIds)
                    found = found.filter(a => query.filter.albumIds.any.some((id: string) => (members[id] || []).includes(a.id)));
                const offset = Number(query.cursor || 0), items = found.slice(offset, offset + 2);
                const nextCursor = omitNextCursor && query.cursor ? undefined : offset + 2 < found.length ? String(offset + 2) : null;
                res.end(JSON.stringify({ assets: { items, total: items.length, nextCursor } }));
                return;
            }
            const assetId = /^\/api\/assets\/([\w-]+)$/.exec(req.url ?? '')?.[1];
            if (assetId) {
                const asset = data.find(item => item.id === assetId);
                res.statusCode = asset ? 200 : 404;
                res.end(asset && JSON.stringify(asset));
                return;
            }
            if (req.url?.startsWith('/api/assets/')) {
                mediaCalls++;
                if (mediaFailure) {
                    res.writeHead(mediaFailure);
                    res.end();
                    return;
                }
                const video = req.url.includes('/video/playback');
                const preview = req.url.includes('size=preview');
                const bytes = mediaSize ? Buffer.alloc(mediaSize, 65) : Buffer.from(video ? '0123456789abcdef' : preview ? 'fixture-jpeg' : 'fixture-webp');
                res.setHeader('Content-Type', video ? 'video/mp4' : preview ? 'image/jpeg' : 'image/webp');
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('ETag', '"fixture"');
                const range = req.headers.range;
                if (range) {
                    const match = /bytes=(\d+)-(\d*)/.exec(range);
                    const start = Number(match?.[1] || 0), end = Math.min(Number(match?.[2] || bytes.length - 1), bytes.length - 1);
                    if (start >= bytes.length) {
                        res.writeHead(416, { 'Content-Range': `bytes */${bytes.length}` });
                        res.end();
                        return;
                    }
                    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Length': end - start + 1 });
                    res.end(bytes.subarray(start, end + 1));
                    return;
                }
                res.setHeader('Content-Length', bytes.length);
                if (slowVideo && video) {
                    res.write(bytes.subarray(0, 4));
                    const timer = setTimeout(() => res.end(bytes.subarray(4)), 700);
                    res.once('close', () => clearTimeout(timer));
                    return;
                }
                setTimeout(() => res.end(bytes), 10);
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        base = `http://127.0.0.1:${(server.address() as any).port}`;
    });
    beforeEach(async () => {
        vi.resetModules();
        await fs.rm(temp, { recursive: true, force: true });
        await fs.mkdir(temp, { recursive: true });
        data = [photo('one'), photo('two', '/photos/Trips', 'lib-one', 'VIDEO'), photo('cover'), photo('upload', '/internal/upload', null), photo('outside', '/photos-extra/Trip')];
        albums = [{ id: 'album-a', albumName: 'Holiday', description: 'Shared adventures', albumThumbnailAssetId: 'one', shared: true }, { id: 'album-b', albumName: 'Favorites', albumThumbnailAssetId: 'upload' }];
        members = { 'album-a': ['one', 'two', 'upload'], 'album-b': ['one', 'upload'] };
        failCursor = false;
        librariesForbidden = false;
        permissionDenied = false;
        mediaFailure = 0;
        searchCalls = 0;
        mediaCalls = 0;
        retryFailures = 0;
        slowVideo = false;
        mediaSize = 0;
        version = '3.3.5';
        unavailable = false;
        omitNextCursor = false;
        manager = await import('../src/db/database.js');
        sources = await import('../src/immich/source-service.js');
        repos = await import('../src/db/repositories.js');
        gallery = await import('../src/services/gallery-service.js');
        scanner = await import('../src/services/scanner-service.js');
        app = (await import('../src/app.js')).createApp();
        repos.collectionRepository.ensureDefaultCollection();
    });
    afterAll(async () => { manager?.databaseManager.close(); await new Promise<void>(resolve => server.close(() => resolve())); await fs.rm(temp, { recursive: true, force: true }); vi.unstubAllEnvs(); });
    function add(mode: 'folders' | 'albums' | 'both' = 'both', extra: Record<string, unknown> = {}) { return sources.saveSource(sources.sourceInputSchema.parse({ name: 'Immich fixture', serverUrl: base, apiKey: 'fixture-secret', selection: { mode, roots: [{ libraryId: 'lib-one', path: '/photos' }], albumIds: ['album-a', 'album-b'], ...extra } })); }
    const feed = () => gallery.galleryService.getFeed(1, 60, 'recent');
    const rows = () => manager.databaseManager.connection.prepare('SELECT * FROM images WHERE source_id IN (SELECT id FROM media_sources WHERE kind = \'immich\') ORDER BY id').all() as any[];
    async function scan() { await scanner.scannerService.scanAll('immich-isolation-test'); }
    it('keeps local-only startup, scanner, and empty galleries usable', async () => {
        expect(sources.listSources()).toEqual([]);
        await scan();
        expect(feed().total).toBe(0);
        expect((await requestTestApp(app, 'GET', '/api/health')).status).toBe(200);
    });
    it('discovers non-admin content without trusting library counts or requiring albums', async () => {
        librariesForbidden = true;
        albums = [];
        const detected = await sources.detectContent(base, 'fixture-secret');
        expect(detected.assetCount).toBe(5);
        expect(detected.uploadCount).toBe(1);
        expect(detected.roots).toHaveLength(2);
        expect(detected.suggestedMode).toBe('folders');
        expect(detected.warnings.join(' ')).toContain('administrator');
    });
    it('indexes Both with one identity and post, every membership, album covers and correct media URLs', async () => {
        const id = add();
        await sources.syncSource(id);
        expect(rows()).toHaveLength(4);
        expect(feed().total).toBe(4);
        expect(feed().items.find((p: any) => p.filename === 'cover.jpg')).toBeTruthy();
        const folders = gallery.galleryService.listFolders();
        expect(folders).toHaveLength(3);
        const albumA = folders.find(f => f.name === 'Holiday')!, albumB = folders.find(f => f.name === 'Favorites')!;
        expect(albumA.imageCount).toBe(3);
        expect(albumA.videoCount).toBe(1);
        expect(albumA.description).toBe('Shared adventures');
        expect(albumB.imageCount).toBe(2);
        expect(gallery.galleryService.getFolderImages(albumA.slug, 1, 60)?.items).toHaveLength(3);
        expect(gallery.galleryService.getFolderImages(albumB.slug, 1, 60)?.items).toHaveLength(2);
        expect(gallery.galleryService.getFolderImages(albumA.slug, 1, 60, 'video')?.total).toBe(1);
        expect(albumA.avatarUrl).toMatch(/^\/api\/remote-media\//);
        expect(feed().items[0].previewUrl).toMatch(/^\/api\/remote-media\//);
        await sources.syncSource(id);
        expect(rows()).toHaveLength(4);
        expect(feed().total).toBe(4);
    });
    it('changes the port for the same indexed Immich library and preserves post identities', async () => {
        const id = add();
        await sources.syncSource(id);
        const post = feed().items[0];
        repos.likeRepository.upsert(post.id);
        const identities = rows().map(row => row.id);
        let movedRequests = 0;
        let sameLibrary = false;
        const handleFixture = server.listeners('request')[0] as http.RequestListener;
        const moved = http.createServer((req, res) => {
            movedRequests++;
            if (!sameLibrary && /^\/api\/assets\/[^/]+$/.test(req.url ?? '')) {
                res.writeHead(400).end();
                return;
            }
            handleFixture(req, res);
        });
        await new Promise<void>((resolve, reject) => { moved.once('error', reject); moved.listen(0, '127.0.0.1', resolve); });
        try {
            const address = moved.address();
            if (!address || typeof address === 'string') throw new Error('Test listener has no port.');
            const serverUrl = `http://127.0.0.1:${address.port}`;
            const testUrl = '/api/admin/sources/immich/test';
            const editUrl = `/api/admin/sources/${id}`;
            const before = sources.listSources()[0];
            const input = { name: before.name, serverUrl, selection: before.selection };
            const check = (apiKey?: string) => requestTestApp(app, 'POST', testUrl, jsonHeaders, { serverUrl, sourceId: id, apiKey });
            const patch = (apiKey?: string) => requestTestApp(app, 'PATCH', editUrl, jsonHeaders, { ...input, apiKey });

            expect((await check()).body.message).toContain('Enter an Immich API key');
            expect((await patch()).body.message).toContain('Enter an Immich API key');
            expect(movedRequests).toBe(0);

            expect((await check('fixture-secret')).body.message).toContain('existing Immich library');
            expect((await patch('fixture-secret')).body.message).toContain('existing Immich library');
            expect(sources.getSource(id)?.server_url).toBe(base);
            expect(feed().total).toBe(4);

            sameLibrary = true;
            expect((await check('fixture-secret')).status).toBe(200);
            expect((await patch('fixture-secret')).status).toBe(200);
            expect(sources.getSource(id)?.server_url).toBe(serverUrl);
            expect(feed().total).toBe(0);
            await sources.syncSource(id);
            expect(rows().map(row => row.id)).toEqual(identities);
            expect(feed().items.some(item => item.id === post.id)).toBe(true);
            expect(repos.likeRepository.getByPostId(post.id)).toBeTruthy();
            expect((await requestTestApp(app, 'GET', post.thumbnailUrl)).status).toBe(200);
        } finally {
            await new Promise<void>(resolve => moved.close(() => resolve()));
        }
    });
    it('enforces exact external roots and never maps internal upload directories', async () => {
        const id = add('folders');
        await sources.syncSource(id);
        expect(rows().map(a => a.external_asset_id)).toEqual(['one', 'two', 'cover']);
        expect(gallery.galleryService.listFolders().map(f => f.name)).toEqual(['Trips']);
    });
    it('supports album-only uploads and external assets, empty selections, and explicit unfiled uploads', async () => {
        const id = add('albums');
        await sources.syncSource(id);
        expect(rows()).toHaveLength(3);
        expect(feed().total).toBe(3);
        const source = sources.listSources()[0];
        sources.saveSource(sources.sourceInputSchema.parse({ name: source.name, serverUrl: base, selection: { mode: 'albums', albumIds: [], includeUnfiled: true } }), id);
        await sources.syncSource(id);
        expect(feed().total).toBe(1);
        expect(gallery.galleryService.listFolders()[0].name).toBe('Unfiled uploads');
        const current = sources.listSources()[0];
        sources.saveSource(sources.sourceInputSchema.parse({ name: current.name, serverUrl: base, selection: { mode: 'albums', albumIds: [] } }), id);
        await sources.syncSource(id);
        expect(feed().total).toBe(0);
        expect(gallery.galleryService.listFolders()).toHaveLength(0);
    });
    it('persists selection initialization without hiding unchanged media', async () => {
        const id = add('albums', { roots: [], initializedModes: ['albums'] });
        await sources.syncSource(id);
        const source = sources.listSources()[0];
        expect(source.selection.initializedModes).toEqual(['albums']);
        expect(feed().total).toBe(3);
        sources.saveSource(sources.sourceInputSchema.parse({ name: source.name, serverUrl: base, selection: { ...source.selection, initializedModes: ['albums', 'folders'] } }), id);
        expect(sources.listSources()[0].selection.initializedModes).toEqual(['albums', 'folders']);
        expect(feed().total).toBe(3);
    });
    it('defaults old Immich sources to Standard and updates Home feed quality without hiding indexed media', async () => {
        const id = add('albums');
        await sources.syncSource(id);
        const source = sources.listSources()[0];
        expect(source.selection.homeFeedImageQuality).toBe('standard');
        const { homeFeedImageQuality, ...legacySelection } = source.selection;
        manager.databaseManager.connection.prepare('UPDATE media_sources SET config_json=? WHERE id=?').run(JSON.stringify(legacySelection), id);
        expect(sources.listSources()[0].selection.homeFeedImageQuality).toBe('standard');
        const before = feed().items.map(item => item.id);
        expect(before.length).toBeGreaterThan(0);
        expect(feed().items.every(item => item.homeFeedImageQuality === 'standard')).toBe(true);
        sources.saveSource(sources.sourceInputSchema.parse({ name: source.name, serverUrl: base, selection: { ...source.selection, homeFeedImageQuality: 'high' } }), id);
        expect(sources.listSources()[0].selection.homeFeedImageQuality).toBe('high');
        expect(feed().items.map(item => item.id)).toEqual(before);
        expect(feed().items.every(item => item.homeFeedImageQuality === 'high')).toBe(true);
        expect(sources.selectionSchema.safeParse({ homeFeedImageQuality: 'invalid' }).success).toBe(false);
    });
    it('preserves the index after partial failures, retries, then reconciles memberships, visibility, deletions and moves', async () => {
        const id = add();
        await sources.syncSource(id);
        const one = rows().find(a => a.external_asset_id === 'one');
        const post = repos.postRepository.findByImageId(one.id)!;
        repos.likeRepository.upsert(post.id);
        repos.collectionRepository.saveToDefault(post.id);
        repos.postRepository.updateCaption(post.id, 'Local caption');
        failCursor = true;
        await expect(sources.syncSource(id)).rejects.toThrow();
        expect(feed().total).toBe(4);
        expect(sources.getSource(id)?.status).toBe('error');
        failCursor = false;
        retryFailures = 1;
        members['album-b'] = ['upload'];
        data = data.filter(a => a.id !== 'cover');
        data.find(a => a.id === 'two').visibility = 'hidden';
        data.find(a => a.id === 'one').originalPath = '/photos/Moved/one.jpg';
        await sources.syncSource(id);
        expect(feed().total).toBe(2);
        expect(rows().find(a => a.external_asset_id === 'one').id).toBe(one.id);
        expect(repos.postRepository.findById(post.id)?.caption).toBe('Local caption');
        expect(repos.likeRepository.getByPostId(post.id)).toBeTruthy();
        expect(repos.collectionRepository.isImageSaved(post.id)).toBe(true);
        const favorites = gallery.galleryService.listFolders().find(f => f.name === 'Favorites')!;
        expect(gallery.galleryService.getFolderImages(favorites.slug, 1, 60)?.items.map(p => p.filename)).toEqual(['upload.jpg']);
    });
    it('keeps scanner and sync isolated in both orders, including rebuild and path relocation', async () => {
        await fs.mkdir(path.join(temp, 'gallery', 'Local'), { recursive: true });
        await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).jpeg().toFile(path.join(temp, 'gallery', 'Local', 'local.jpg'));
        await scan();
        expect(feed().total).toBe(1);
        const id = add();
        await sources.syncSource(id);
        expect(feed().total).toBe(5);
        await scan();
        expect(feed().total).toBe(5);
        const paths = rows().map(a => a.absolute_path);
        repos.imageRepository.refreshAbsolutePathsForGalleryRoot(path.join(temp, 'new-root'));
        expect(rows().map(a => a.absolute_path)).toEqual(paths);
        repos.maintenanceRepository.resetLibraryIndex();
        expect(feed().total).toBe(4);
        await scan();
        expect(feed().total).toBe(5);
    });
    it('encrypts and redacts credentials; prevents remote trash, permanent deletion, and folder deletion', async () => {
        const id = add();
        await sources.syncSource(id);
        const source = sources.getSource(id)!;
        expect(source.api_key_ciphertext).not.toContain('fixture-secret');
        expect(JSON.stringify(sources.listSources())).not.toContain('fixture-secret');
        const item = feed().items[0];
        await expect(gallery.galleryService.deleteImage(item.id)).rejects.toThrow('read-only');
        expect(() => gallery.galleryService.trashImage(item.id)).toThrow('read-only');
        await expect(gallery.galleryService.deleteFolder(item.folderSlug, { deleteSourceFolder: true })).rejects.toThrow('read-only');
        const response = await requestTestApp(app, 'GET', '/api/admin/sources');
        expect(JSON.stringify(response.body)).not.toContain('fixture-secret');
        const { assertReadOperation, validateServerUrl } = await import('../src/immich/client.js');
        expect(() => assertReadOperation('POST', '/api/albums')).toThrow('allowlist');
        expect(() => assertReadOperation('DELETE', '/api/assets/one')).toThrow();
        expect(() => assertReadOperation('POST', '/api/search/metadata')).not.toThrow();
        expect(() => validateServerUrl('http://user:key@localhost:2283')).toThrow();
        expect(() => validateServerUrl('file:///etc/passwd')).toThrow();
    });
    it('serves formats, video ranges and coordinated caching, then pauses cached media after an outage', async () => {
        const id = add();
        await sources.syncSource(id);
        const items = feed().items;
        const image = items.find(p => p.filename === 'one.jpg')!, video = items.find(p => p.mediaType === 'video')!;
        const previews = await Promise.all([requestTestApp(app, 'GET', image.previewUrl), requestTestApp(app, 'GET', image.previewUrl)]);
        expect(previews.map(r => r.status)).toEqual([200, 200]);
        expect(previews[0].headers.get('content-type')).toBe('image/jpeg');
        expect(mediaCalls).toBe(1);
        const thumb = await requestTestApp(app, 'GET', image.thumbnailUrl);
        expect(thumb.headers.get('content-type')).toBe('image/webp');
        const range = await requestTestApp(app, 'GET', video.previewUrl, { Range: 'bytes=2-5' });
        expect(range.status).toBe(206);
        expect(range.body).toBe('2345');
        expect(range.headers.get('content-range')).toBe('bytes 2-5/16');
        mediaFailure = 503;
        expect((await requestTestApp(app, 'GET', image.previewUrl)).status).toBe(200);
        expect((await requestTestApp(app, 'GET', video.previewUrl, { Range: 'bytes=2-5' })).status).toBe(206);
        expect((await requestTestApp(app, 'GET', video.previewUrl, { Range: 'bytes=6-9' })).status).toBe(503);
        expect((await requestTestApp(app, 'GET', image.previewUrl)).status).toBe(503);
        expect((await requestTestApp(app, 'GET', video.previewUrl, { Range: 'bytes=2-5' })).status).toBe(503);
        const offline = await requestTestApp(app, 'GET', '/api/sources/status');
        expect(offline.body.hasLocalPosts).toBe(false);
        expect(offline.body.items.find((source: { id: number }) => source.id === id)).toMatchObject({ id, available: false });
        expect(offline.body.items.find((source: { id: number }) => source.id === id)).not.toHaveProperty('server_url');
        expect(offline.body.items.find((source: { id: number }) => source.id === id)).not.toHaveProperty('api_key_ciphertext');
        mediaFailure = 0;
        expect((await requestTestApp(app, 'GET', '/api/sources/status?retry=1')).body.items.find((source: { id: number }) => source.id === id).available).toBe(true);
        expect((await requestTestApp(app, 'GET', image.previewUrl)).status).toBe(200);
        const row = rows().find(r => r.external_asset_id === 'one');
        expect((await requestTestApp(app, 'GET', `/api/originals/${row.id}`)).status).toBe(403);
        const source = sources.listSources()[0];
        sources.saveSource(sources.sourceInputSchema.parse({ name: source.name, serverUrl: base, enabled: false, selection: source.selection }), id);
        expect((await requestTestApp(app, 'GET', image.previewUrl)).status).toBe(404);
        expect(feed().total).toBe(0);
    }, 30000);
    it('authorizes every secondary album membership before cached share media and denies cross-album access', async () => {
        const id = add();
        await sources.syncSource(id);
        const one = rows().find(r => r.external_asset_id === 'one'), video = rows().find(r => r.external_asset_id === 'two');
        const post = repos.postRepository.findByImageId(one.id)!;
        const favorites = gallery.galleryService.listFolders().find(f => f.name === 'Favorites')!;
        const { authService } = await import('../src/services/auth-service.js');
        const { folderShareService } = await import('../src/services/folder-share-service.js');
        authService.setAdminPassword('fixture-admin-password');
        authService.setViewerAccess('password', 'fixture-viewer-password');
        const share = folderShareService.createLink(favorites.slug, { expiresAt: null })!;
        const grant = folderShareService.verifyLinkToken(favorites.slug, share.rawToken)!;
        const response = { cookie: vi.fn(), setHeader: vi.fn() };
        folderShareService.setShareSession(response as any, { secure: false, get: () => undefined } as any, grant);
        const headers = { Cookie: `foldergram_share_session=${response.cookie.mock.calls.at(-1)![1]}` };
        expect((await requestTestApp(app, 'GET', `/api/share/images/${one.id}/thumbnail`, headers)).status).toBe(200);
        const detail = await requestTestApp(app, 'GET', `/api/share/posts/${post.id}`, headers);
        expect(detail.status).toBe(200);
        expect(detail.body.folderSlug).toBe(favorites.slug);
        expect(detail.body.nextImageId).toBeNull();
        expect((await requestTestApp(app, 'GET', `/api/share/images/${video.id}/thumbnail`, headers)).status).toBe(401);
        expect((await requestTestApp(app, 'GET', `/api/share/images/${one.id}/thumbnail`)).status).toBe(401);
        expect((await requestTestApp(app, 'GET', '/api/admin/sources', headers)).status).toBe(401);
        const viewerResponse = { cookie: vi.fn(), setHeader: vi.fn() };
        authService.setAuthenticatedSession(viewerResponse as any, { secure: false, get: () => undefined } as any, 'viewer');
        expect((await requestTestApp(app, 'GET', '/api/admin/sources', { Cookie: `foldergram_session=${viewerResponse.cookie.mock.calls.at(-1)![1]}` })).status).toBe(403);
        members['album-b'] = ['upload'];
        await sources.syncSource(id);
        expect((await requestTestApp(app, 'GET', `/api/share/images/${one.id}/thumbnail`, headers)).status).toBe(401);
    }, 30000);
    it('invalidates cache on changed metadata and removes index and cache without changing local records', async () => {
        const id = add();
        await sources.syncSource(id);
        const item = feed().items.find(p => p.filename === 'one.jpg')!;
        await requestTestApp(app, 'GET', item.thumbnailUrl);
        const calls = mediaCalls;
        data.find(a => a.id === 'one').updatedAt = '2026-11-13T00:00:00Z';
        await sources.syncSource(id);
        expect((await requestTestApp(app, 'GET', item.thumbnailUrl)).status).toBe(200);
        expect(mediaCalls).toBe(calls + 1);
        const remote = rows()[0], post = repos.postRepository.findByImageId(remote.id)!;
        repos.likeRepository.upsert(post.id);
        repos.collectionRepository.saveToDefault(post.id);
        await sources.removeSource(id);
        expect(rows()).toHaveLength(0);
        expect(feed().total).toBe(0);
        expect(sources.listSources()).toHaveLength(0);
        await expect(fs.stat(path.join(temp, 'db', 'immich-cache', String(id)))).rejects.toThrow();
    }, 20000);
    it('preserves local album names, descriptions, covers and captions across sync and clears invalid covers', async () => {
        const id = add();
        await sources.syncSource(id);
        const favorite = gallery.galleryService.listFolders().find(f => f.name === 'Favorites')!;
        const one = rows().find(r => r.external_asset_id === 'one');
        gallery.galleryService.updateFolderMetadata(favorite.slug, 'Local title', 'Local description');
        expect(gallery.galleryService.setFolderAvatar(favorite.slug, one.id)).toBe(true);
        albums.find(a => a.id === 'album-b').albumName = 'Remote rename';
        await sources.syncSource(id);
        const changed = gallery.galleryService.getFolderBySlug(favorite.slug)!;
        expect(changed.name).toBe('Local title');
        expect(changed.description).toBe('Local description');
        expect(changed.avatarImageId).toBe(one.id);
        members['album-b'] = ['upload'];
        await sources.syncSource(id);
        expect(gallery.galleryService.getFolderBySlug(favorite.slug)?.avatarImageId).not.toBe(one.id);
    });
    it('coordinates concurrent syncs and rejects invalid credentials without deleting the previous usable index', async () => {
        const id = add();
        const first = sources.syncSource(id);
        expect(sources.syncSource(id)).toBe(first);
        await first;
        const { decryptCredential } = await import('../src/immich/credentials.js');
        expect(decryptCredential(sources.getSource(id)!.api_key_ciphertext)).toBe('fixture-secret');
        const stat = await fs.stat(path.join(temp, 'db', 'immich-encryption.key'));
        expect(stat.mode & 0o777).toBe(0o600);
        expect((await requestTestApp(app, 'POST', '/api/admin/sources/immich/test', jsonHeaders, { serverUrl: base, apiKey: 'incorrect' })).body.message).toContain('API key');
        expect(feed().total).toBe(4);
    });
    it('streams the first video bytes before completion and discards cancelled cache writes', async () => {
        const id = add();
        await sources.syncSource(id);
        slowVideo = true;
        const video = feed().items.find(p => p.mediaType === 'video')!;
        const listener = http.createServer(app);
        await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
        const controller = new AbortController();
        try {
            const started = Date.now();
            const response = await fetch(`http://127.0.0.1:${(listener.address() as any).port}${video.previewUrl}`, { signal: controller.signal });
            const reader = response.body!.getReader();
            const first = await reader.read();
            expect(Buffer.from(first.value!).toString()).toBe('0123');
            expect(Date.now() - started).toBeLessThan(600);
            controller.abort();
            await new Promise(resolve => setTimeout(resolve, 80));
            const files = await fs.readdir(path.join(temp, 'db', 'immich-cache', String(id)));
            expect(files.filter(f => f.endsWith('.data') || f.endsWith('.part') || f.endsWith('.json'))).toHaveLength(0);
        }
        finally {
            listener.closeAllConnections();
            await new Promise<void>(resolve => listener.close(() => resolve()));
        }
    });
    it('serves cached full-video seeks and preserves unsatisfiable range status and length', async () => {
        const id = add();
        await sources.syncSource(id);
        const video = feed().items.find(p => p.mediaType === 'video')!;
        expect((await requestTestApp(app, 'GET', video.previewUrl)).status).toBe(200);
        await expect.poll(async () => (await fs.readdir(path.join(temp, 'db', 'immich-cache', String(id)))).some(f => f.endsWith('.json'))).toBe(true);
        const calls = mediaCalls;
        const suffix = await requestTestApp(app, 'GET', video.previewUrl, { Range: 'bytes=-4' });
        expect(suffix.status).toBe(206);
        expect(suffix.body).toBe('cdef');
        expect(mediaCalls).toBe(calls);
        const range = await requestTestApp(app, 'GET', video.previewUrl, { Range: 'bytes=99-100' });
        expect(range.status).toBe(416);
        expect(range.headers.get('content-range')).toBe('bytes */16');
    });
    it('bounds disk caching and evicts old data before fetching new derivatives', async () => {
        vi.stubEnv('IMMICH_CACHE_MAX_MB', '1');
        mediaSize = 200000;
        try {
            data = Array.from({ length: 8 }, (_, i) => photo('asset-' + i));
            const id = add('folders');
            await sources.syncSource(id);
            const items = feed().items;
            for (const item of items)
                expect((await requestTestApp(app, 'GET', item.thumbnailUrl)).status).toBe(200);
            const directory = path.join(temp, 'db', 'immich-cache', String(id));
            const files = await fs.readdir(directory);
            let bytes = 0;
            for (const file of files.filter(f => f.endsWith('.data')))
                bytes += (await fs.stat(path.join(directory, file))).size;
            expect(bytes).toBeLessThanOrEqual(1024 * 1024);
            const calls = mediaCalls;
            await requestTestApp(app, 'GET', items[0].thumbnailUrl);
            expect(mediaCalls).toBe(calls + 1);
        }
        finally {
            vi.stubEnv('IMMICH_CACHE_MAX_MB', '512');
        }
    });
    it('retains derivative access when optional original permission is missing', async () => {
        const id = add('folders', { allowOriginals: true });
        await sources.syncSource(id);
        const item = rows()[0];
        mediaFailure = 403;
        expect((await requestTestApp(app, 'GET', `/api/originals/${item.id}`)).status).toBe(403);
        expect(feed().total).toBe(3);
    });
    it('connects to the minimum Immich version', async () => {
        version = 'v3.2.0';
        await expect(sources.detectContent(base, 'fixture-secret')).resolves.toMatchObject({ version, assetCount: 5 });
    });
    it.each(['3.1.9', 'v3.2.0-rc.1'])('rejects Immich %s below the minimum before searching', async (reportedVersion) => {
        version = reportedVersion;
        await expect(sources.detectContent(base, 'fixture-secret')).rejects.toThrow('Immich v3.2.0 or later');
        expect(searchCalls).toBe(0);
    });
    it('reports an invalid Immich server version before searching', async () => {
        version = 'unavailable';
        await expect(sources.detectContent(base, 'fixture-secret')).rejects.toThrow('valid server version');
        expect(searchCalls).toBe(0);
    });
    it('syncs an existing source after minor and major Immich upgrades and preserves the index on incompatible pagination', async () => {
        const id = add();
        await sources.syncSource(id);
        const assetIds = rows().map(asset => asset.id);

        for (const upgradedVersion of ['3.4.1', 'v4.0.0-rc.1', 'v4.0.0']) {
            version = upgradedVersion;
            await sources.syncSource(id);
            expect(sources.getSource(id)?.status).toBe('ready');
            expect(rows().map(asset => asset.id)).toEqual(assetIds);
            expect(feed().total).toBe(4);
        }

        omitNextCursor = true;
        await expect(sources.syncSource(id)).rejects.toThrow('assets.nextCursor');
        expect(sources.getSource(id)).toMatchObject({ status: 'error', generation: 4 });
        expect(rows().map(asset => asset.id)).toEqual(assetIds);
        expect(feed().total).toBe(4);
    });
    it('blocks metadata-service URL requests', async () => {
        const { ImmichClient } = await import('../src/immich/client.js');
        await expect(new ImmichClient('http://169.254.169.254', 'fixture-secret').json('/api/server/about')).rejects.toThrow('reserved');
    });
    it('supports empty selected albums and remote browsing when the local gallery is unavailable', async () => {
        const id = add('albums');
        members['album-b'] = [];
        await sources.syncSource(id);
        const favorite = gallery.galleryService.listFolders().find(f => f.name === 'Favorites')!;
        expect(favorite.imageCount).toBe(0);
        await fs.rm(path.join(temp, 'gallery'), { recursive: true, force: true });
        await fs.writeFile(path.join(temp, 'gallery'), 'unavailable local directory');
        expect(feed().total).toBe(3);
        expect(gallery.galleryService.getStatus().storage.available).toBe(true);
        await scan();
        expect(feed().total).toBe(3);
    });
    it('bootstraps an environment-managed source with key-file precedence and explicit selections', async () => {
        const keyfile = path.join(temp, 'fixture-key');
        await fs.writeFile(keyfile, 'fixture-secret', { mode: 0o600 });
        vi.stubEnv('IMMICH_URL', base);
        vi.stubEnv('IMMICH_API_KEY', 'invalid-inline-key');
        vi.stubEnv('IMMICH_API_KEY_FILE', keyfile);
        vi.stubEnv('IMMICH_SYNC_MODE', 'folders');
        vi.stubEnv('IMMICH_ROOTS', JSON.stringify([{ libraryId: 'lib-one', path: '/photos' }]));
        vi.stubEnv('IMMICH_AUTO_SYNC', 'false');
        vi.stubEnv('IMMICH_SYNC_INTERVAL_MINUTES', '0');
        try {
            await sources.startSources();
            const source = sources.listSources()[0];
            expect(source.managed_by).toBe('environment');
            expect(source.asset_count).toBe(0);
            await sources.syncSource(source.id);
            expect(feed().total).toBe(3);
            expect(() => sources.saveSource(sources.sourceInputSchema.parse({ name: 'Edit', serverUrl: base, selection: { mode: 'folders' } }), source.id)).toThrow();
        }
        finally {
            sources.stopSources();
            vi.stubEnv('IMMICH_URL', '');
            vi.stubEnv('IMMICH_API_KEY_FILE', '');
        }
    });
    it('keeps post navigation and cover attribution inside a secondary album', async () => {
        const id = add();
        await sources.syncSource(id);
        const favorite = gallery.galleryService.listFolders().find(f => f.name === 'Favorites')!;
        const trips = gallery.galleryService.listFolders().find(f => f.name === 'Trips')!;
        const one = rows().find(r => r.external_asset_id === 'one');
        const upload = rows().find(r => r.external_asset_id === 'upload');
        const post = repos.postRepository.findByImageId(one.id)!;
        const response = await requestTestApp(app, 'GET', `/api/posts/${post.id}?folder=${favorite.slug}`);
        expect(response.status).toBe(200);
        expect(response.body.folderSlug).toBe(favorite.slug);
        const memberIds = new Set(gallery.galleryService.getFolderImages(favorite.slug, 1, 60)!.items.map(p => p.id));
        for (const neighbor of [response.body.nextImageId, response.body.previousImageId])
            if (neighbor !== null)
                expect(memberIds.has(neighbor)).toBe(true);
        const uploadedPost = repos.postRepository.findByImageId(upload.id)!;
        expect((await requestTestApp(app, 'GET', `/api/posts/${uploadedPost.id}?folder=${trips.slug}`)).status).toBe(404);
    });
    it('keeps cached indexing usable when the same credential is supplied again', async () => {
        const id = add();
        await sources.syncSource(id);
        const source = sources.listSources()[0];
        sources.saveSource(sources.sourceInputSchema.parse({ name: source.name, serverUrl: base, apiKey: 'fixture-secret', selection: source.selection }), id);
        expect(feed().total).toBe(4);
        expect(sources.getSource(id)!.status).toBe('ready');
    });
    it('keeps revocation through pending and failed retries until successful reconciliation', async () => {
        const id = add();
        await sources.syncSource(id);
        const item = feed().items[0];
        expect((await requestTestApp(app, 'GET', item.previewUrl)).status).toBe(200);
        permissionDenied = true;
        await expect(sources.syncSource(id)).rejects.toThrow('API key');
        expect(sources.getSource(id)?.status).toBe('revoked');
        expect(feed().total).toBe(0);
        expect((await requestTestApp(app, 'GET', item.previewUrl)).status).toBe(404);
        permissionDenied = false;
        failCursor = true;
        const retry = sources.syncSource(id);
        expect(sources.getSource(id)?.status).toBe('revoked');
        expect(feed().total).toBe(0);
        expect((await requestTestApp(app, 'GET', item.previewUrl)).status).toBe(404);
        await expect(retry).rejects.toThrow();
        expect(sources.getSource(id)?.status).toBe('revoked');
        expect(feed().total).toBe(0);
        expect((await requestTestApp(app, 'GET', item.previewUrl)).status).toBe(404);
        failCursor = false;
        await sources.syncSource(id);
        expect(sources.getSource(id)?.status).toBe('ready');
        expect(feed().total).toBe(4);
        expect((await requestTestApp(app, 'GET', item.previewUrl)).status).toBe(200);
    });
    it('keeps missing derivatives retryable without deleting the image or post', async () => {
        const id = add();
        await sources.syncSource(id);
        const item = feed().items.find(p => p.filename === 'one.jpg')!;
        mediaFailure = 404;
        expect((await requestTestApp(app, 'GET', item.thumbnailUrl)).status).toBe(404);
        expect((await requestTestApp(app, 'GET', item.previewUrl)).status).toBe(404);
        expect(rows().find(r => r.external_asset_id === 'one').is_deleted).toBe(0);
        expect(repos.postRepository.findById(item.id)?.is_deleted).toBe(0);
        expect(feed().total).toBe(4);
        expect(sources.getSource(id)?.status).toBe('ready');
        mediaFailure = 0;
        expect((await requestTestApp(app, 'GET', item.thumbnailUrl)).status).toBe(200);
        expect((await requestTestApp(app, 'GET', item.previewUrl)).status).toBe(200);
    });
    it('detects outages even with fully cached remote media, preserves local browsing, and recovers without syncing', async () => {
        await fs.mkdir(path.join(temp, 'gallery', 'Local'), { recursive: true });
        await sharp({ create: { width: 16, height: 16, channels: 3, background: '#123456' } }).jpeg().toFile(path.join(temp, 'gallery', 'Local', 'local.jpg'));
        await scan();
        const id = add();
        await sources.syncSource(id);
        const remote = feed().items.find(p => p.sourceId === id)!;
        const local = feed().items.find(p => p.sourceKind === 'local')!;
        expect((await requestTestApp(app, 'GET', remote.previewUrl)).status).toBe(200);
        unavailable = true;
        const status = await requestTestApp(app, 'GET', '/api/sources/status');
        expect(status.body.items.find((source: { id: number }) => source.id === id).available).toBe(false);
        expect(status.body.hasLocalPosts).toBe(true);
        expect((await requestTestApp(app, 'GET', remote.previewUrl)).status).toBe(503);
        expect((await requestTestApp(app, 'GET', local.previewUrl)).status).toBe(200);
        expect(feed().total).toBe(5);
        unavailable = false;
        expect((await requestTestApp(app, 'GET', '/api/sources/status?retry=1')).body.items.find((source: { id: number }) => source.id === id).available).toBe(true);
        expect((await requestTestApp(app, 'GET', remote.previewUrl)).status).toBe(200);
        expect(sources.getSource(id)?.generation).toBe(1);
    });
});
