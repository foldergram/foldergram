import { defineStore } from 'pinia';

import {
  changePasswordProtection,
  configurePatternUnlock as configurePatternUnlockApi,
  disablePasswordProtection,
  enablePasswordProtection,
  fetchAuthStatus,
  loginWithPassword,
  resetPatternWithPassword as resetPatternWithPasswordApi,
  unlockWithPattern as unlockWithPatternApi,
  unlockAdmin as unlockAdminSession,
  updateViewerAccess,
  logout
} from '../api/gallery';
import type { AuthCapabilities, AuthRole, AuthStatus, LikesMode, ViewerAccessMode } from '../types/api';

const PATTERN_SESSION_STORAGE_KEY = 'foldergram-pattern-session';

interface AuthState {
  ready: boolean;
  loading: boolean;
  unlockDialogOpen: boolean;
  enabled: boolean;
  authenticated: boolean;
  role: AuthRole;
  accessMode: ViewerAccessMode;
  likesMode: LikesMode;
  defaultLocale: AuthStatus['defaultLocale'];
  patternUnlock: boolean;
  patternSessionUnlocked: boolean;
  capabilities: AuthCapabilities;
  error: string | null;
}

function createCapabilities(role: AuthRole): AuthCapabilities {
  if (role === 'admin') {
    return {
      canManageLibrary: true,
      canDeleteMedia: true,
      canAccessSettings: true,
      canUseSharedLikes: true,
      canUseLocalFavorites: false,
      canUseSharedCollections: true,
      canUseLocalCollections: false
    };
  }

  if (role === 'viewer') {
    return {
      canManageLibrary: false,
      canDeleteMedia: false,
      canAccessSettings: false,
      canUseSharedLikes: true,
      canUseLocalFavorites: false,
      canUseSharedCollections: true,
      canUseLocalCollections: false
    };
  }

  return {
    canManageLibrary: false,
    canDeleteMedia: false,
    canAccessSettings: false,
    canUseSharedLikes: false,
    canUseLocalFavorites: true,
    canUseSharedCollections: false,
    canUseLocalCollections: true
  };
}

function createAnonymousStatus(
  enabled: boolean,
  accessMode: ViewerAccessMode,
  defaultLocale: AuthStatus['defaultLocale'],
  patternUnlock = false
): AuthStatus {
  return {
    enabled,
    authenticated: false,
    role: 'anonymous',
    accessMode,
    likesMode: 'local',
    defaultLocale,
    patternUnlock,
    capabilities: createCapabilities('anonymous')
  };
}

function readPatternSessionUnlocked(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.sessionStorage.getItem(PATTERN_SESSION_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writePatternSessionUnlocked(unlocked: boolean): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (unlocked) {
      window.sessionStorage.setItem(PATTERN_SESSION_STORAGE_KEY, '1');
      return;
    }

    window.sessionStorage.removeItem(PATTERN_SESSION_STORAGE_KEY);
  } catch {
    // Private mode and blocked storage should still let the in-memory flag work.
  }
}

async function clearAppCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) {
    return;
  }

  const cacheKeys = await window.caches.keys();
  await Promise.all(cacheKeys.filter((key) => key.startsWith('foldergram-')).map((key) => window.caches.delete(key)));
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    ready: false,
    loading: false,
    unlockDialogOpen: false,
    enabled: false,
    authenticated: true,
    role: 'admin',
    accessMode: 'off',
    likesMode: 'shared',
    defaultLocale: null,
    patternUnlock: false,
    patternSessionUnlocked: readPatternSessionUnlocked(),
    capabilities: createCapabilities('admin'),
    error: null
  }),
  getters: {
    accessGranted: (state) => !state.enabled || state.authenticated || state.accessMode === 'public',
    requiresLogin: (state) => state.enabled && state.accessMode !== 'public' && !state.authenticated,
    // The pattern gate sits on top of password protection: whenever a pattern is
    // configured, closing the tab or leaving the web app must ask for it again.
    patternRequired: (state) => state.enabled && state.patternUnlock && !state.patternSessionUnlocked,
    isAdmin: (state) => state.capabilities.canAccessSettings,
    canSignOut: (state) => state.enabled && state.authenticated,
    canManageLibrary: (state) => state.capabilities.canManageLibrary,
    canDeleteMedia: (state) => state.capabilities.canDeleteMedia,
    canAccessSettings: (state) => state.capabilities.canAccessSettings,
    canUseSharedLikes: (state) => state.capabilities.canUseSharedLikes,
    canUseLocalFavorites: (state) => state.capabilities.canUseLocalFavorites,
    canUseSharedCollections: (state) => state.capabilities.canUseSharedCollections === true,
    canUseLocalCollections: (state) => state.capabilities.canUseLocalCollections === true,
    canUseSavedItems: (state) =>
      state.capabilities.canUseSharedLikes ||
      state.capabilities.canUseLocalFavorites ||
      state.capabilities.canUseSharedCollections === true ||
      state.capabilities.canUseLocalCollections === true,
    canUnlockAdmin: (state) => state.enabled && !state.capabilities.canAccessSettings
  },
  actions: {
    applyStatus(status: AuthStatus) {
      this.enabled = status.enabled;
      this.authenticated = status.authenticated;
      this.role = status.role;
      this.accessMode = status.accessMode;
      this.likesMode = status.likesMode;
      this.defaultLocale = status.defaultLocale;
      this.patternUnlock = status.patternUnlock;
      this.capabilities = status.capabilities;
      this.ready = true;
      if (!status.patternUnlock) {
        this.clearPatternSession();
      }
    },

    clearError() {
      this.error = null;
    },

    openUnlockDialog() {
      if (!this.enabled || this.capabilities.canAccessSettings) {
        return;
      }

      this.unlockDialogOpen = true;
      this.error = null;
    },

    closeUnlockDialog() {
      this.unlockDialogOpen = false;
    },

    markPatternSessionUnlocked() {
      this.patternSessionUnlocked = true;
      writePatternSessionUnlocked(true);
    },

    clearPatternSession() {
      this.patternSessionUnlocked = false;
      writePatternSessionUnlocked(false);
    },

    lockPatternIfBackgrounded() {
      if (!this.enabled || !this.patternUnlock || !this.patternSessionUnlocked) {
        return;
      }

      this.clearPatternSession();
    },

    handleUnauthorized(message = 'Your session ended. Log in again.') {
      if (!this.enabled) {
        return;
      }

      this.ready = true;
      this.loading = false;
      this.applyStatus(createAnonymousStatus(this.enabled, this.accessMode, this.defaultLocale, this.patternUnlock));
      this.unlockDialogOpen = false;
      this.clearPatternSession();
      this.error = this.accessMode === 'public' ? null : message;
    },

    async initialize(force = false) {
      if (this.loading) {
        return;
      }

      if (this.ready && !force) {
        return;
      }

      this.loading = true;

      try {
        const status = await fetchAuthStatus();
        this.applyStatus(status);
        this.error = null;
      } catch (error) {
        this.ready = true;
        this.error = error instanceof Error ? error.message : 'Unable to load access protection status.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async login(password: string) {
      this.loading = true;

      try {
        const payload = await loginWithPassword(password);
        this.applyStatus(payload.auth);
        this.unlockDialogOpen = false;
        this.markPatternSessionUnlocked();
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to sign in.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async logout() {
      this.loading = true;

      try {
        const payload = await logout();
        this.applyStatus(payload.auth);
        this.unlockDialogOpen = false;
        this.clearPatternSession();
        this.error = null;
        await clearAppCaches();
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to sign out.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async enablePassword(password: string) {
      this.loading = true;

      try {
        const payload = await enablePasswordProtection(password);
        this.applyStatus(payload.auth);
        this.unlockDialogOpen = false;
        this.error = null;
        await clearAppCaches();
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to enable password protection.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async changePassword(currentPassword: string, password: string) {
      this.loading = true;

      try {
        const payload = await changePasswordProtection(currentPassword, password);
        this.applyStatus(payload.auth);
        this.unlockDialogOpen = false;
        this.error = null;
        await clearAppCaches();
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to change the password.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async disablePassword(currentPassword: string) {
      this.loading = true;

      try {
        const payload = await disablePasswordProtection(currentPassword);
        this.applyStatus(payload.auth);
        this.unlockDialogOpen = false;
        this.error = null;
        await clearAppCaches();
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to disable password protection.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async configureViewerAccess(mode: ViewerAccessMode, viewerPassword?: string) {
      this.loading = true;

      try {
        const payload = await updateViewerAccess(mode, viewerPassword);
        this.applyStatus(payload.auth);
        this.unlockDialogOpen = false;
        this.error = null;
        await clearAppCaches();
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to update viewer access.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async unlockAdmin(password: string) {
      this.loading = true;

      try {
        const payload = await unlockAdminSession(password);
        this.applyStatus(payload.auth);
        this.unlockDialogOpen = false;
        this.error = null;
        await clearAppCaches();
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to unlock admin access.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async configurePatternUnlock(
      pattern: string | null,
      proof?: { currentPattern?: string; currentPassword?: string }
    ) {
      this.loading = true;

      try {
        const payload = await configurePatternUnlockApi(pattern, proof);
        this.applyStatus(payload.auth);
        if (pattern) {
          this.markPatternSessionUnlocked();
        }
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Unable to update the pattern unlock.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async unlockPattern(pattern: string) {
      this.loading = true;

      try {
        const payload = await unlockWithPatternApi(pattern);
        this.applyStatus(payload.auth);
        this.markPatternSessionUnlocked();
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Incorrect pattern.';
        throw error;
      } finally {
        this.loading = false;
      }
    },

    async resetPatternWithPassword(password: string) {
      this.loading = true;

      try {
        const payload = await resetPatternWithPasswordApi(password);
        this.applyStatus(payload.auth);
        this.markPatternSessionUnlocked();
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : 'Incorrect admin password.';
        throw error;
      } finally {
        this.loading = false;
      }
    }
  }
});
