import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type express from 'express';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe.sequential('instance appearance persistence and permissions', () => {
  let tempRoot: string;
  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-appearance-'));
    for (const [key, directory] of Object.entries({
      DATA_ROOT: 'data', GALLERY_ROOT: 'gallery', DB_DIR: 'db', THUMBNAILS_DIR: 'thumbnails', PREVIEWS_DIR: 'previews'
    })) vi.stubEnv(key, path.join(tempRoot, directory));
    vi.stubEnv('NODE_ENV', 'test');
    vi.resetModules();
  });
  afterAll(async () => {
    const { databaseManager } = await import('../src/db/database.js');
    databaseManager.close();
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });
  it('defaults to system/blue and retains a saved selection after reopening the database', async () => {
    const service = await import('../src/services/appearance-service.js');
    expect(service.getAppearance()).toEqual({ theme: 'system', accent: 'blue' });
    service.saveAppearance({ theme: 'dark', accent: 'purple' });
    const { databaseManager } = await import('../src/db/database.js');
    databaseManager.close();
    expect(service.getAppearance()).toEqual({ theme: 'dark', accent: 'purple' });
    expect(() => service.saveAppearance({ theme: 'invalid', accent: 'purple' })).toThrow();
    expect(() => service.saveAppearance({ theme: 'light', accent: 'url(evil)' })).toThrow();
    expect(() => service.saveAppearance({ theme: 'light', accent: 'blue', css: 'anything' })).toThrow();
    expect(service.getAppearance()).toEqual({ theme: 'dark', accent: 'purple' });
  });
  it('exposes appearance before login but rejects unauthenticated changes', async () => {
    const { authService } = await import('../src/services/auth-service.js');
    const { requireApiAuthentication, requireCapability } = await import('../src/middleware/auth-protection.js');
    authService.setAdminPassword('test-password-123');
    const request = { method: 'GET', path: '/appearance', get: () => undefined } as unknown as express.Request;
    const response = {
      setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn()
    };
    const next = vi.fn();
    requireApiAuthentication(request, response as unknown as express.Response, next);
    expect(next).toHaveBeenCalledOnce();
    next.mockClear();
    requireCapability('canAccessSettings')(request, response as unknown as express.Response, next);
    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(401);
  });
});
