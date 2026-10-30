import { defineStore } from 'pinia';

import {
  changePasswordProtection,
  disablePasswordProtection,
  enablePasswordProtection,
  fetchAuthStatus,
  loginWithPassword,
  unlockAdmin as unlockAdminSession,
  updateViewerAccess,
  logout
} from '../api/gallery';
import { i18n } from '../locales';
import type { AuthCapabilities, AuthRole, AuthStatus, LikesMode, ViewerAccessMode } from '../types/api';

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
  defaultLocale: AuthStatus['defaultLocale']
): AuthStatus {
  return {
    enabled,
    authenticated: false,
    role: 'anonymous',
    accessMode,
    likesMode: 'local',
    defaultLocale,
    capabilities: createCapabilities('anonymous')
  };
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
    capabilities: createCapabilities('admin'),
    error: null
  }),
  getters: {
    accessGranted: (state) => !state.enabled || state.authenticated || state.accessMode === 'public',
    requiresLogin: (state) => state.enabled && state.accessMode !== 'public' && !state.authenticated,
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
      this.capabilities = status.capabilities;
      this.ready = true;
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

    handleUnauthorized(message = i18n.global.t('errors.sessionEnded')) {
      if (!this.enabled) {
        return;
      }

      this.ready = true;
      this.loading = false;
      this.applyStatus(createAnonymousStatus(this.enabled, this.accessMode, this.defaultLocale));
      this.unlockDialogOpen = false;
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
        this.error = error instanceof Error ? error.message : i18n.global.t('errors.loadAccessStatus');
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
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : i18n.global.t('auth.gate.unableToSignIn');
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
        this.error = null;
        await clearAppCaches();
      } catch (error) {
        this.error = error instanceof Error ? error.message : i18n.global.t('settings.access.danger.signOutError');
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
        this.error = error instanceof Error ? error.message : i18n.global.t('settings.access.enable.error');
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
        this.error = error instanceof Error ? error.message : i18n.global.t('settings.access.change.error');
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
        this.error = error instanceof Error ? error.message : i18n.global.t('settings.access.danger.error');
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
        this.error = error instanceof Error ? error.message : i18n.global.t('settings.access.viewer.error');
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
        this.error = error instanceof Error ? error.message : i18n.global.t('auth.adminUnlock.unableToUnlock');
        throw error;
      } finally {
        this.loading = false;
      }
    }
  }
});
