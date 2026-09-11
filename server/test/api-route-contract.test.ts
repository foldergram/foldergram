import { describe, expect, it } from 'vitest';

import { apiRouter } from '../src/routes/api.js';

function listRoutes(): string[] {
  return (apiRouter.stack ?? []).flatMap((layer: any) => {
    if (!layer.route) return [];
    const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
    return Object.keys(layer.route.methods).flatMap((method) => paths.map((path) => `${method.toUpperCase()} ${path}`));
  }).sort();
}

const expectedRoutes = `
DELETE /admin/folders/:slug/share-links/:linkId
DELETE /admin/folders/:slug/share-password
DELETE /auth/password
DELETE /collections/:slug
DELETE /collections/:slug/images/:id
DELETE /collections/:slug/posts/:id
DELETE /folders/:slug
DELETE /images/:id
DELETE /images/:id/like
DELETE /images/:id/save
DELETE /posts/:id
DELETE /posts/:id/like
DELETE /posts/:id/save
DELETE /posts/deletions/batch
DELETE /share/posts/:id/links/:linkId
GET /admin/folders/:slug/share-links
GET /admin/places/status
GET /admin/scan-folders
GET /admin/scan-progress
GET /admin/stats
GET /auth/status
GET /collections
GET /collections/:slug/images
GET /feed
GET /feed/moments
GET /feed/moments/:id
GET /feed/search
GET /folders
GET /folders/:slug
GET /folders/:slug/images
GET /folders/:slug/stories
GET /folders/:slug/stories/:id
GET /health
GET /images/:id
GET /images/:id/collections
GET /likes
GET /originals/:id
GET /places
GET /places/:slug
GET /places/:slug/images
GET /posts/:id
GET /posts/:id/collections
GET /posts/deletions/batch
GET /reels
GET /scan-progress
GET /share/folders/:slug
GET /share/folders/:slug/access
GET /share/folders/:slug/images
GET /share/images/:id
GET /share/images/:id/preview
GET /share/images/:id/thumbnail
GET /share/post-links/:token
GET /share/post-links/:token/images/:id/preview
GET /share/post-links/:token/images/:id/thumbnail
GET /share/posts/:id
GET /share/posts/:id/links
GET /status
GET /trash/images
PATCH /collections/:slug
PATCH /folders/:slug
PATCH /images/:id/caption
PATCH /posts/:id/caption
POST /admin/folders/:slug/share-links
POST /admin/places/geodata/prepare
POST /admin/places/rebuild
POST /admin/rebuild-index
POST /admin/rebuild-thumbnails
POST /admin/rescan
POST /admin/settings/carousels-as-folders
POST /admin/settings/carousels-migration-decision
POST /auth/login
POST /auth/logout
POST /auth/unlock-admin
POST /collections
POST /collections/:slug/images/:id
POST /collections/:slug/posts/:id
POST /folders/:slug/cover
POST /images/:id/like
POST /images/:id/restore
POST /images/:id/save
POST /images/:id/trash
POST /posts/:id/like
POST /posts/:id/restore
POST /posts/:id/save
POST /posts/:id/trash
POST /posts/deletions/batch
POST /share/folders/:slug/unlock-link
POST /share/folders/:slug/unlock-password
POST /share/posts/:id
PUT /admin/folders/:slug/share-password
PUT /admin/settings/app-locale
PUT /admin/settings/excluded-folders
PUT /admin/settings/folder-image-order-default
PUT /admin/settings/home-feed-default
PUT /admin/settings/nested-folder-title-format
PUT /admin/settings/reels-feed-default
PUT /admin/settings/scan-folders
PUT /admin/settings/share-public-base-url
PUT /admin/settings/stories-mode
PUT /admin/settings/video-playback-quality
PUT /auth/password
PUT /auth/viewer-access
`.trim().split('\n');

describe('API route contract', () => {
  it('preserves every public method and path while routers are split', () => {
    expect(listRoutes()).toEqual(expectedRoutes);
  });
});
