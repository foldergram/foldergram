import type express from 'express';
import { authService } from '../../services/auth-service.js';
import { requireCapability } from '../../middleware/auth-protection.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { galleryService } from '../../services/gallery-service.js';
import { scannerService } from '../../services/scanner-service.js';
import { storageService } from '../../services/storage-service.js';
import { changePasswordBodySchema, configurePasswordBodySchema, disablePasswordBodySchema, loginBodySchema, viewerAccessBodySchema } from '../../routes/api-schemas.js';
import { resolveScanProgress } from '../../routes/api-helpers.js';

const authRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, message: 'Too many authentication attempts. Please try again in a minute.' });
export function registerAdminPreludeRoutes(router: express.Router): void {
  router.get('/health', (_request, response) => { const state = storageService.getState(); response.json({ ok: true, timestamp: new Date().toISOString(), storage: { available: state.libraryAvailable, reason: state.reason, usingInMemoryDatabase: state.usingInMemoryDatabase } }); });
  router.get('/auth/status', (request, response) => { authService.setNoStoreHeaders(response); response.json(authService.getStatus(request)); });
  router.post('/auth/login', authRateLimiter, (request, response) => authenticate(request, response, false));
  router.post('/auth/unlock-admin', authRateLimiter, (request, response) => authenticate(request, response, true));
  router.post('/auth/logout', (request, response) => { authService.setNoStoreHeaders(response); authService.clearAuthenticatedSession(response, request); response.json({ ok: true, auth: authService.getLoggedOutStatus() }); });
  router.put('/auth/password', authRateLimiter, (request, response) => {
    authService.setNoStoreHeaders(response);
    if (!authService.isEnabled()) { const body = configurePasswordBodySchema.parse(request.body); const auth = authService.setAdminPassword(body.password); authService.setAuthenticatedSession(response, request, 'admin'); response.json({ ok: true, auth }); return; }
    if (!authService.hasCapability(request, 'canAccessSettings')) { response.status(403).json({ message: 'Admin access is required.' }); return; }
    const body = changePasswordBodySchema.parse(request.body); if (!authService.verifyAdminPassword(body.currentPassword)) { response.status(401).json({ message: 'Incorrect current password.' }); return; }
    const auth = authService.setAdminPassword(body.password); authService.setAuthenticatedSession(response, request, 'admin'); response.json({ ok: true, auth });
  });
  router.delete('/auth/password', authRateLimiter, (request, response) => {
    authService.setNoStoreHeaders(response); if (!authService.isEnabled()) { response.status(400).json({ message: 'Password protection is already disabled.' }); return; }
    if (!authService.hasCapability(request, 'canAccessSettings')) { response.status(403).json({ message: 'Admin access is required.' }); return; }
    const body = disablePasswordBodySchema.parse(request.body); if (!authService.verifyAdminPassword(body.currentPassword)) { response.status(401).json({ message: 'Incorrect current password.' }); return; }
    const auth = authService.disable(); authService.clearAuthenticatedSession(response, request); response.json({ ok: true, auth });
  });
  router.put('/auth/viewer-access', authRateLimiter, (request, response) => {
    authService.setNoStoreHeaders(response); if (!authService.isEnabled()) { response.status(400).json({ message: 'Enable the admin password before configuring viewer access.' }); return; }
    if (!authService.hasCapability(request, 'canAccessSettings')) { response.status(403).json({ message: 'Admin access is required.' }); return; }
    const body = viewerAccessBodySchema.parse(request.body); const auth = authService.setViewerAccess(body.mode, body.viewerPassword ?? null); authService.setAuthenticatedSession(response, request, 'admin'); response.json({ ok: true, auth });
  });
}
export function registerAdminStatusRoutes(router: express.Router): void {
  router.get('/status', async (_request, response) => { const progress = await resolveScanProgress(); response.json(galleryService.getStatus(galleryService.getScanProgress(progress))); });
  router.get('/scan-progress', async (_request, response) => { response.json(galleryService.getScanProgress(await resolveScanProgress())); });
  router.get('/admin/scan-progress', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => { response.json(galleryService.getAdminScanProgress(await resolveScanProgress())); });
  router.get('/admin/scan-folders', requireCapability('canAccessSettings', 'Admin access is required.'), async (_request, response) => { response.json({ folders: await scannerService.listAvailableScanFolders(), selectedFolders: scannerService.getSelectedScanFolders() }); });
}
function authenticate(request: express.Request, response: express.Response, adminOnly: boolean): void {
  authService.setNoStoreHeaders(response); if (!authService.isEnabled()) { response.status(400).json({ message: 'Password protection is not enabled.' }); return; }
  const body = loginBodySchema.parse(request.body); const role = adminOnly ? (authService.verifyAdminPassword(body.password) ? 'admin' : null) : authService.authenticatePassword(body.password);
  if (!role) { response.status(401).json({ message: adminOnly ? 'Incorrect admin password.' : 'Incorrect password.' }); return; }
  authService.setAuthenticatedSession(response, request, role); response.json({ ok: true, auth: authService.getAuthenticatedStatus(role) });
}
