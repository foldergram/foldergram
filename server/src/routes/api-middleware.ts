import type express from 'express';
import { authService } from '../services/auth-service.js';

const PUBLIC_SENSITIVE_MEDIA_KEYS = new Set(['absolutePath', 'exif', 'exifJson', 'relativePath', 'sourcePath']);
function redactPublicMediaMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactPublicMediaMetadata(item));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([key]) => !PUBLIC_SENSITIVE_MEDIA_KEYS.has(key)).map(([key, item]) => [key, redactPublicMediaMetadata(item)]));
}

export function installPublicMetadataRedaction(router: express.Router): void {
  router.use((request, response, next) => {
    const isAnonymousPublicViewer = authService.isPublicViewerAccessEnabled() && !authService.isAuthenticatedRequest(request);
    if (!isAnonymousPublicViewer || request.method.toUpperCase() !== 'GET') { next(); return; }
    const sendJson = response.json.bind(response);
    response.json = ((body: unknown) => sendJson(redactPublicMediaMetadata(body))) as typeof response.json;
    next();
  });
}
