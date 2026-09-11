export { registerAdminPreludeRoutes, registerAdminStatusRoutes } from './prelude.js';

import type express from 'express';
import { z } from 'zod';
import { requireCapability } from '../../middleware/auth-protection.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { galleryService } from '../../services/gallery-service.js';
import { requestRemoteScan, isRemoteScanWorkerEnabled } from '../../services/scan-worker-client.js';
import { LIBRARY_REBUILD_REQUIRED_MESSAGE, scannerService } from '../../services/scanner-service.js';
import { watcherService } from '../../services/watcher-service.js';
import { requireNoScanInProgress, resolveScanProgress } from '../../routes/api-helpers.js';

const adminMutationRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, message: 'Too many administrative requests. Please try again in a minute.' });
export function registerAdminRoutes(router: express.Router): void {
  const manage = requireCapability('canManageLibrary', 'Admin access is required.');
  router.post('/admin/rescan', manage, adminMutationRateLimiter, requireNoScanInProgress, async (_request, response) => {
    try {
      if (isRemoteScanWorkerEnabled()) { response.status(202).json(await requestRemoteScan('manual')); return; }
      if (scannerService.isLibraryRebuildRequired()) { response.status(409).json({ message: LIBRARY_REBUILD_REQUIRED_MESSAGE }); return; }
      const lastScan = await scannerService.scanAll('manual'); await watcherService.start(); response.json({ ok: true, lastScan });
    } catch (error) { const message = error instanceof Error ? error.message : 'Unable to run a manual scan.'; response.status(/rebuild required/i.test(message) ? 409 : 500).json({ message }); }
  });
  router.post('/admin/rebuild-index', manage, adminMutationRateLimiter, requireNoScanInProgress, async (_request, response) => {
    if (isRemoteScanWorkerEnabled()) { response.status(202).json(await requestRemoteScan('rebuild')); return; }
    await watcherService.stop(); try { response.json({ ok: true, lastScan: await scannerService.rebuildLibraryIndex('rebuild') }); } finally { await watcherService.start(); }
  });
  router.post('/admin/rebuild-thumbnails', manage, adminMutationRateLimiter, requireNoScanInProgress, async (_request, response) => {
    if (isRemoteScanWorkerEnabled()) { response.status(202).json(await requestRemoteScan('rebuild-thumbnails')); return; }
    if (scannerService.isLibraryRebuildRequired()) { response.status(409).json({ message: LIBRARY_REBUILD_REQUIRED_MESSAGE }); return; }
    await watcherService.stop();
    try { response.json({ ok: true, lastScan: await scannerService.rebuildThumbnails('rebuild-thumbnails') }); }
    catch (error) { const message = error instanceof Error ? error.message : 'Unable to regenerate thumbnails.'; response.status(/rebuild required/i.test(message) ? 409 : 500).json({ message }); }
    finally { await watcherService.start(); }
  });
  router.get('/admin/places/status', requireCapability('canAccessSettings', 'Admin access is required.'), (_request, response) => { response.json(galleryService.getPlacesStatus()); });
  router.post('/admin/places/geodata/prepare', manage, adminMutationRateLimiter, async (_request, response) => {
    try { response.json({ ok: true, status: await galleryService.preparePlacesGeodata() }); } catch (error) { response.status(500).json({ message: error instanceof Error ? error.message : 'Unable to prepare offline place data.' }); }
  });
  router.post('/admin/places/rebuild', manage, adminMutationRateLimiter, (_request, response) => { response.json({ ok: true, ...galleryService.rebuildPlaces() }); });
  router.post('/admin/settings/carousels-as-folders', requireCapability('canAccessSettings', 'Admin access is required.'), adminMutationRateLimiter, (request, response) => respondSetting(response, () => galleryService.setTreatCarouselsAsFolders(z.object({ treatCarouselsAsFolders: z.boolean() }).parse(request.body).treatCarouselsAsFolders), 'Failed to update carousels mode.'));
  router.post('/admin/settings/carousels-migration-decision', requireCapability('canAccessSettings', 'Admin access is required.'), adminMutationRateLimiter, (request, response) => respondSetting(response, () => galleryService.setCarouselsMigrationDecision(z.object({ decision: z.enum(['restore', 'carousels']) }).parse(request.body).decision), 'Failed to update carousels migration decision.'));
  router.get('/admin/stats', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => { response.json(galleryService.getStats(galleryService.getAdminScanProgress(await resolveScanProgress()))); });
}
function respondSetting(response: express.Response, action: () => unknown, fallback: string): void { try { response.json(action()); } catch (error) { response.status(500).json({ message: error instanceof Error ? error.message : fallback }); } }
