import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AppModule = typeof import('../src/app.js');
type AuthServiceModule = typeof import('../src/services/auth-service.js');

describe.sequential('api cache control', () => {
  let tempRoot = '';
  let applyApiNoStoreHeaders: AppModule['applyApiNoStoreHeaders'];
  let authService: AuthServiceModule['authService'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-api-cache-control-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await fs.mkdir(tempRoot, { recursive: true });

    vi.resetModules();
    ({ applyApiNoStoreHeaders } = await import('../src/app.js'));
    ({ authService } = await import('../src/services/auth-service.js'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('marks API responses as no-store when auth is disabled', async () => {
    const response = {
      setHeader: vi.fn()
    };

    expect(authService.isEnabled()).toBe(false);

    applyApiNoStoreHeaders(response as never);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(response.setHeader).not.toHaveBeenCalledWith('Vary', 'Cookie');
  });
});
