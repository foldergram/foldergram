import type express from 'express';
import { requireCapability } from '../../middleware/auth-protection.js';
import { galleryService } from '../../services/gallery-service.js';
import { scannerService } from '../../services/scanner-service.js';
import { appLocaleBodySchema, excludedFoldersBodySchema, folderImageOrderDefaultBodySchema, homeFeedDefaultBodySchema, nestedFolderTitleFormatBodySchema, publicBaseUrlBodySchema, reelsFeedDefaultBodySchema, scanFoldersBodySchema, storiesModeBodySchema, videoPlaybackModeBodySchema, videoPlaybackQualityBodySchema } from '../../routes/api-schemas.js';

export function registerSettingsRoutes(router: express.Router): void {
  const settings = requireCapability('canAccessSettings', 'Admin access is required.');
  router.put('/admin/settings/app-locale', settings, (request, response) => { const body = appLocaleBodySchema.parse(request.body); response.json(galleryService.setDefaultLocale(body.defaultLocale)); });
  router.put('/admin/settings/home-feed-default', settings, (request, response) => { const body = homeFeedDefaultBodySchema.parse(request.body); response.json(galleryService.setDefaultHomeFeedMode(body.defaultMode)); });
  router.put('/admin/settings/reels-feed-default', settings, (request, response) => { const body = reelsFeedDefaultBodySchema.parse(request.body); response.json(galleryService.setDefaultReelsFeedMode(body.defaultMode)); });
  router.put('/admin/settings/folder-image-order-default', settings, (request, response) => { const body = folderImageOrderDefaultBodySchema.parse(request.body); response.json(galleryService.setDefaultFolderImageOrder(body.defaultOrder)); });
  router.put('/admin/settings/nested-folder-title-format', settings, (request, response) => { const body = nestedFolderTitleFormatBodySchema.parse(request.body); response.json(galleryService.setNestedFolderTitleFormat(body.titleFormat)); });
  router.put('/admin/settings/video-playback-quality', settings, (request, response) => { const body = videoPlaybackQualityBodySchema.parse(request.body); response.json(galleryService.setVideoPlaybackQuality(body.videoPlaybackQuality)); });
  router.put('/admin/settings/video-playback-mode', settings, (request, response) => { const body = videoPlaybackModeBodySchema.parse(request.body); response.json(galleryService.setVideoPlaybackMode(body.videoPlaybackMode)); });
  router.put('/admin/settings/share-public-base-url', settings, (request, response) => { const body = publicBaseUrlBodySchema.parse(request.body); response.json(galleryService.setSharePublicBaseUrl(body.publicBaseUrl)); });
  router.put('/admin/settings/stories-mode', settings, (request, response) => { const body = storiesModeBodySchema.parse(request.body); response.json(galleryService.setTreatStoriesAsFolders(body.treatStoriesAsFolders)); });
  router.put('/admin/settings/excluded-folders', settings, (request, response) => { const body = excludedFoldersBodySchema.parse(request.body); response.json(galleryService.setExcludedFolders(body.rules)); });
  router.put('/admin/settings/scan-folders', requireCapability('canManageLibrary', 'Admin access is required.'), (request, response) => {
    const body = scanFoldersBodySchema.parse(request.body);
    try { response.json(scannerService.setSelectedScanFolders(body.folders)); } catch (error) { response.status(400).json({ message: error instanceof Error ? error.message : 'Invalid scan folders.' }); }
  });
}
