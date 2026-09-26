import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from './auth';

const {
  changePasswordProtectionMock,
  disablePasswordProtectionMock,
  enablePasswordProtectionMock,
  configurePatternUnlockMock,
  resetPatternWithPasswordMock,
  unlockWithPatternMock,
  fetchAuthStatusMock,
  loginWithPasswordMock,
  logoutMock,
  unlockAdminSessionMock,
  updateViewerAccessMock
} = vi.hoisted(() => ({
  changePasswordProtectionMock: vi.fn(),
  disablePasswordProtectionMock: vi.fn(),
  enablePasswordProtectionMock: vi.fn(),
  configurePatternUnlockMock: vi.fn(),
  resetPatternWithPasswordMock: vi.fn(),
  unlockWithPatternMock: vi.fn(),
  fetchAuthStatusMock: vi.fn(),
  loginWithPasswordMock: vi.fn(),
  logoutMock: vi.fn(),
  unlockAdminSessionMock: vi.fn(),
  updateViewerAccessMock: vi.fn()
}));

vi.mock('../api/gallery', () => ({
  changePasswordProtection: changePasswordProtectionMock,
  disablePasswordProtection: disablePasswordProtectionMock,
  enablePasswordProtection: enablePasswordProtectionMock,
  configurePatternUnlock: configurePatternUnlockMock,
  resetPatternWithPassword: resetPatternWithPasswordMock,
  unlockWithPattern: unlockWithPatternMock,
  fetchAuthStatus: fetchAuthStatusMock,
  loginWithPassword: loginWithPasswordMock,
  logout: logoutMock,
  unlockAdmin: unlockAdminSessionMock,
  updateViewerAccess: updateViewerAccessMock
}));

describe('auth store locale status', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    changePasswordProtectionMock.mockReset();
    disablePasswordProtectionMock.mockReset();
    enablePasswordProtectionMock.mockReset();
    configurePatternUnlockMock.mockReset();
    resetPatternWithPasswordMock.mockReset();
    unlockWithPatternMock.mockReset();
    window.sessionStorage.clear();
    fetchAuthStatusMock.mockReset();
    loginWithPasswordMock.mockReset();
    logoutMock.mockReset();
    unlockAdminSessionMock.mockReset();
    updateViewerAccessMock.mockReset();
  });

  it('stores the saved app default locale from public auth status', async () => {
    fetchAuthStatusMock.mockResolvedValue({
      enabled: true,
      authenticated: false,
      role: 'anonymous',
      accessMode: 'password',
      likesMode: 'local',
      defaultLocale: 'zh',
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: false,
        canUseLocalFavorites: true,
        canUseSharedCollections: false,
        canUseLocalCollections: true
      }
    });

    const authStore = useAuthStore();
    await authStore.initialize();

    expect(authStore.defaultLocale).toBe('zh');
    expect(authStore.requiresLogin).toBe(true);
  });

  it('preserves the saved app default locale when a session becomes unauthorized', () => {
    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      authenticated: true,
      role: 'viewer',
      accessMode: 'password',
      likesMode: 'shared',
      defaultLocale: 'zh',
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: true,
        canUseLocalFavorites: false,
        canUseSharedCollections: true,
        canUseLocalCollections: false
      }
    });

    authStore.handleUnauthorized();

    expect(authStore.authenticated).toBe(false);
    expect(authStore.defaultLocale).toBe('zh');
    expect(authStore.requiresLogin).toBe(true);
  });

  it('does not allow sign out when password protection is disabled', () => {
    const authStore = useAuthStore();
    authStore.$patch({
      enabled: false,
      authenticated: true,
      role: 'admin',
      accessMode: 'off',
      likesMode: 'shared',
      defaultLocale: null,
      patternUnlock: false,
      capabilities: {
        canManageLibrary: true,
        canDeleteMedia: true,
        canAccessSettings: true,
        canUseSharedLikes: true,
        canUseLocalFavorites: false,
        canUseSharedCollections: true,
        canUseLocalCollections: false
      }
    });

    expect(authStore.canSignOut).toBe(false);
  });

  it('allows sign out for authenticated admin and viewer sessions', () => {
    const authStore = useAuthStore();

    authStore.$patch({
      enabled: true,
      authenticated: true,
      role: 'admin',
      accessMode: 'off',
      likesMode: 'shared',
      defaultLocale: null,
      patternUnlock: false,
      capabilities: {
        canManageLibrary: true,
        canDeleteMedia: true,
        canAccessSettings: true,
        canUseSharedLikes: true,
        canUseLocalFavorites: false,
        canUseSharedCollections: true,
        canUseLocalCollections: false
      }
    });

    expect(authStore.canSignOut).toBe(true);

    authStore.$patch({
      role: 'viewer',
      accessMode: 'password',
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: true,
        canUseLocalFavorites: false,
        canUseSharedCollections: true,
        canUseLocalCollections: false
      }
    });

    expect(authStore.canSignOut).toBe(true);
  });

  it('only allows sign out in public mode after an authenticated admin unlock', () => {
    const authStore = useAuthStore();

    authStore.$patch({
      enabled: true,
      authenticated: false,
      role: 'anonymous',
      accessMode: 'public',
      likesMode: 'local',
      defaultLocale: null,
      patternUnlock: false,
      capabilities: {
        canManageLibrary: false,
        canDeleteMedia: false,
        canAccessSettings: false,
        canUseSharedLikes: false,
        canUseLocalFavorites: true,
        canUseSharedCollections: false,
        canUseLocalCollections: true
      }
    });

    expect(authStore.canSignOut).toBe(false);

    authStore.$patch({
      authenticated: true,
      role: 'admin',
      likesMode: 'shared',
      capabilities: {
        canManageLibrary: true,
        canDeleteMedia: true,
        canAccessSettings: true,
        canUseSharedLikes: true,
        canUseLocalFavorites: false,
        canUseSharedCollections: true,
        canUseLocalCollections: false
      }
    });

    expect(authStore.canSignOut).toBe(true);
  });
});

describe('auth store pattern session', () => {
  const adminCapabilities = {
    canManageLibrary: true,
    canDeleteMedia: true,
    canAccessSettings: true,
    canUseSharedLikes: true,
    canUseLocalFavorites: false,
    canUseSharedCollections: true,
    canUseLocalCollections: false
  };

  beforeEach(() => {
    setActivePinia(createPinia());
    window.sessionStorage.clear();
    unlockWithPatternMock.mockReset();
    configurePatternUnlockMock.mockReset();
    resetPatternWithPasswordMock.mockReset();
    logoutMock.mockReset();
  });

  it('asks for the pattern again after the tab session is cleared', () => {
    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      authenticated: true,
      patternUnlock: true,
      patternSessionUnlocked: false,
      capabilities: adminCapabilities
    });

    expect(authStore.patternRequired).toBe(true);
  });

  it('keeps the pattern unlocked for the current tab after a successful draw', async () => {
    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      authenticated: false,
      patternUnlock: true,
      patternSessionUnlocked: false,
      capabilities: adminCapabilities
    });
    unlockWithPatternMock.mockResolvedValue({
      ok: true,
      auth: {
        enabled: true,
        authenticated: true,
        role: 'admin',
        accessMode: 'off',
        likesMode: 'shared',
        defaultLocale: null,
        patternUnlock: true,
        capabilities: adminCapabilities
      }
    });

    await authStore.unlockPattern('0-1-2');

    expect(authStore.patternRequired).toBe(false);
    expect(window.sessionStorage.getItem('foldergram-pattern-session')).toBe('1');
  });

  it('requires the pattern again after sign out', async () => {
    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      authenticated: true,
      patternUnlock: true,
      patternSessionUnlocked: true,
      capabilities: adminCapabilities
    });
    window.sessionStorage.setItem('foldergram-pattern-session', '1');
    logoutMock.mockResolvedValue({
      ok: true,
      auth: {
        enabled: true,
        authenticated: false,
        role: 'anonymous',
        accessMode: 'off',
        likesMode: 'local',
        defaultLocale: null,
        patternUnlock: true,
        capabilities: {
          canManageLibrary: false,
          canDeleteMedia: false,
          canAccessSettings: false,
          canUseSharedLikes: false,
          canUseLocalFavorites: true,
          canUseSharedCollections: false,
          canUseLocalCollections: true
        }
      }
    });

    await authStore.logout();

    expect(authStore.patternRequired).toBe(true);
    expect(window.sessionStorage.getItem('foldergram-pattern-session')).toBeNull();
  });

  it('locks the pattern again after the app is sent to the background', () => {
    const authStore = useAuthStore();
    authStore.$patch({
      enabled: true,
      authenticated: true,
      patternUnlock: true,
      patternSessionUnlocked: true,
      capabilities: adminCapabilities
    });
    window.sessionStorage.setItem('foldergram-pattern-session', '1');

    authStore.lockPatternIfBackgrounded();

    expect(authStore.patternRequired).toBe(true);
    expect(window.sessionStorage.getItem('foldergram-pattern-session')).toBeNull();
  });
});
