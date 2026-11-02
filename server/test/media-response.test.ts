import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type AuthServiceModule = typeof import('../src/services/auth-service.js');
type MediaResponseModule = typeof import('../src/utils/media-response.js');

describe.sequential('original media response headers', () => {
  let tempRoot = '';
  let applyOriginalMediaHeaders: MediaResponseModule['applyOriginalMediaHeaders'];
  let authService: AuthServiceModule['authService'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'foldergram-media-response-'));

    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATA_ROOT', path.join(tempRoot, 'data'));
    vi.stubEnv('GALLERY_ROOT', path.join(tempRoot, 'gallery'));
    vi.stubEnv('DB_DIR', path.join(tempRoot, 'db'));
    vi.stubEnv('THUMBNAILS_DIR', path.join(tempRoot, 'thumbnails'));
    vi.stubEnv('PREVIEWS_DIR', path.join(tempRoot, 'previews'));
  });

  beforeEach(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    await Promise.all([
      fs.mkdir(path.join(tempRoot, 'db'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'gallery'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'thumbnails'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'previews'), { recursive: true })
    ]);

    vi.resetModules();
    ({ applyOriginalMediaHeaders } = await import('../src/utils/media-response.js'));
    ({ authService } = await import('../src/services/auth-service.js'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('allows public revalidation without cookie variation when auth is disabled', () => {
    const response = createResponse();

    applyOriginalMediaHeaders(response);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, no-cache');
    expect(response.setHeader).not.toHaveBeenCalledWith('Vary', 'Cookie');
  });

  it('uses private revalidation and varies by cookie when auth is enabled', () => {
    authService.setAdminPassword('admin12345');
    const response = createResponse();

    applyOriginalMediaHeaders(response);

    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-cache');
    expect(response.setHeader).toHaveBeenCalledWith('Vary', 'Cookie');
  });

  function createResponse() {
    return {
      setHeader: vi.fn()
    };
  }
});
