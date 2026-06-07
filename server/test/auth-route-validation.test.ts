import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ApiModule = typeof import('../src/routes/api.js');

describe.sequential('auth route validation', () => {
  let tempRoot = '';
  let authRequestBodySchemas: ApiModule['authRequestBodySchemas'];
  let settingsRequestBodySchemas: ApiModule['settingsRequestBodySchemas'];
  let routeParamSchemas: ApiModule['routeParamSchemas'];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'insta-auth-route-validation-'));

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
    ({ authRequestBodySchemas, settingsRequestBodySchemas, routeParamSchemas } = await import('../src/routes/api.js'));
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.resetModules();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('rejects oversized login passwords before hashing them', async () => {
    expect(() =>
      authRequestBodySchemas.login.parse({
        password: 'x'.repeat(257)
      })
    ).toThrowError(/Password must be at most 256 characters\./);
  });

  it('rejects oversized current passwords on password-disable requests', async () => {
    expect(() =>
      authRequestBodySchemas.disablePassword.parse({
        currentPassword: 'x'.repeat(257)
      })
    ).toThrowError(/Current password must be at most 256 characters\./);
  });

  it('requires a viewer password when viewer access mode is password', async () => {
    expect(() =>
      authRequestBodySchemas.viewerAccess.parse({
        mode: 'password'
      })
    ).toThrowError(/Viewer password is required when viewer access mode is password\./);
  });

  it('accepts off mode without a viewer password', async () => {
    expect(
      authRequestBodySchemas.viewerAccess.parse({
        mode: 'off'
      })
    ).toEqual({
      mode: 'off'
    });
  });

  it('accepts public mode without a viewer password', async () => {
    expect(
      authRequestBodySchemas.viewerAccess.parse({
        mode: 'public'
      })
    ).toEqual({
      mode: 'public'
    });
  });

  it('rejects invalid home-feed default modes', async () => {
    expect(() =>
      settingsRequestBodySchemas.homeFeedDefault.parse({
        defaultMode: 'latest'
      })
    ).toThrowError();
  });

  it('accepts random as a valid home-feed default mode', async () => {
    expect(
      settingsRequestBodySchemas.homeFeedDefault.parse({
        defaultMode: 'random'
      })
    ).toEqual({
      defaultMode: 'random'
    });
  });

  it('accepts zh as a valid app locale default', async () => {
    expect(
      settingsRequestBodySchemas.appLocale.parse({
        defaultLocale: 'zh'
      })
    ).toEqual({
      defaultLocale: 'zh'
    });
  });

  it('rejects invalid app locale defaults', async () => {
    expect(() =>
      settingsRequestBodySchemas.appLocale.parse({
        defaultLocale: 'fr'
      })
    ).toThrowError();
  });

  it('rejects invalid reels-feed default modes', async () => {
    expect(() =>
      settingsRequestBodySchemas.reelsFeedDefault.parse({
        defaultMode: 'rediscover'
      })
    ).toThrowError();
  });

  it('accepts recommended as a valid reels-feed default mode', async () => {
    expect(
      settingsRequestBodySchemas.reelsFeedDefault.parse({
        defaultMode: 'recommended'
      })
    ).toEqual({
      defaultMode: 'recommended'
    });
  });

  it('rejects invalid folder image order defaults', async () => {
    expect(() =>
      settingsRequestBodySchemas.folderImageOrderDefault.parse({
        defaultOrder: 'recent'
      })
    ).toThrowError();
  });

  it('accepts oldest as a valid folder image order default', async () => {
    expect(
      settingsRequestBodySchemas.folderImageOrderDefault.parse({
        defaultOrder: 'oldest'
      })
    ).toEqual({
      defaultOrder: 'oldest'
    });
  });

  it('accepts parent-plus-folder as a valid nested folder title format', async () => {
    expect(
      settingsRequestBodySchemas.nestedFolderTitleFormat.parse({
        titleFormat: 'parent-plus-folder'
      })
    ).toEqual({
      titleFormat: 'parent-plus-folder'
    });
  });

  it('rejects invalid nested folder title formats', async () => {
    expect(() =>
      settingsRequestBodySchemas.nestedFolderTitleFormat.parse({
        titleFormat: 'full-path'
      })
    ).toThrowError();
  });

  it('accepts long story ids up to the folder-slug route limit', async () => {
    expect(
      routeParamSchemas.storyId.parse({
        id: 'story-'.repeat(40)
      })
    ).toEqual({
      id: 'story-'.repeat(40)
    });
  });
});
