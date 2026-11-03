import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App.vue';
import type { AppStatus, FolderDirectoryPayload } from './types/api';
import { useAppStore } from './stores/app';
import { useAuthStore } from './stores/auth';

const { fetchDirectoryMock, fetchStatusMock } = vi.hoisted(() => ({
  fetchDirectoryMock: vi.fn(),
  fetchStatusMock: vi.fn()
}));

vi.mock('./api/gallery', () => ({
  fetchFolderDirectory: fetchDirectoryMock,
  fetchStats: fetchStatusMock
}));

vi.mock('./router', () => ({
  canAccessRoute: () => true,
  routeAllowsPublicShareAccess: () => false
}));

vi.mock('vue-router', () => {
  const route = {
    name: 'home',
    fullPath: '/',
    params: {},
    query: {},
    meta: {}
  };

  return {
    RouterView: {
      name: 'RouterView',
      template: '<div data-test="router-view" />'
    },
    useRoute: () => route,
    useRouter: () => ({
      replace: vi.fn(async () => undefined),
      resolve: () => route
    })
  };
});

vi.mock('./components/AppShell.vue', () => ({
  default: {
    name: 'AppShell',
    template: '<div data-test="app-shell"><slot /></div>'
  }
}));

vi.mock('./components/AuthGate.vue', () => ({
  default: {
    name: 'AuthGate',
    template: '<div data-test="auth-gate" />'
  }
}));

vi.mock('./components/AdminUnlockDialog.vue', () => ({
  default: {
    name: 'AdminUnlockDialog',
    template: '<div data-test="admin-unlock-dialog" />'
  }
}));

vi.mock('./views/PostView.vue', () => ({
  default: {
    name: 'PostView',
    template: '<div data-test="post-view" />'
  }
}));

function createAppStatus(): AppStatus {
  return {
    folders: 3,
    indexedImages: 18,
    indexedVideos: 6,
    scan: {
      isScanning: false,
      scanReason: null,
      phase: 'idle',
      startedAt: null,
      lastCompletedScan: null
    },
    storage: {
      available: true,
      reason: null
    },
    libraryIndex: {
      rebuildRequired: false,
      reason: null,
      ignoredRootMediaCount: 0
    },
    preferences: {
      defaultLocale: null
    }
  } as unknown as AppStatus;
}

function createDeferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason?: unknown) => void = () => {};
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function grantAccess(authStore: ReturnType<typeof useAuthStore>) {
  authStore.$patch({
    ready: true,
    enabled: true,
    authenticated: true,
    role: 'viewer',
    accessMode: 'password',
    capabilities: {
      canManageLibrary: false,
      canDeleteMedia: false,
      canAccessSettings: false,
      canUseSharedLikes: false,
      canUseLocalFavorites: false,
      canUseSharedCollections: false,
      canUseLocalCollections: false
    }
  });
}

function revokeAccess(authStore: ReturnType<typeof useAuthStore>) {
  authStore.$patch({ authenticated: false });
}

describe('App protected bootstrap', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    window.localStorage.clear();
    fetchDirectoryMock.mockReset();
    fetchStatusMock.mockReset();
  });

  it('re-runs the protected bootstrap after access is revoked and granted again', async () => {
    const status = createAppStatus();
    const delayedFolders = createDeferred<FolderDirectoryPayload>();
    fetchStatusMock.mockResolvedValue(status);
    fetchDirectoryMock.mockImplementation(() => delayedFolders.promise);

    const authStore = useAuthStore();
    grantAccess(authStore);

    const wrapper = mount(App);
    await flushPromises();

    const appStore = useAppStore();
    expect(fetchStatusMock).toHaveBeenCalledTimes(1);
    expect(fetchDirectoryMock).toHaveBeenCalledWith({ page: 1, limit: 24, sort: 'recent-desc' });
    expect(appStore.stats).not.toBeNull();

    revokeAccess(authStore);
    await flushPromises();

    expect(appStore.stats).toBeNull();

    grantAccess(authStore);
    await flushPromises();

    expect(fetchStatusMock).toHaveBeenCalledTimes(2);
    expect(appStore.stats).not.toBeNull();

    delayedFolders.resolve({ items: [], page: 1, limit: 24, total: 0, hasMore: false });
    await flushPromises();

    expect(appStore.stats).not.toBeNull();

    wrapper.unmount();
  });
});
