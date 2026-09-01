<template>
  <section
    v-if="showAuthLoading"
    class="min-h-screen px-6 py-10 flex items-center justify-center"
    style="background: radial-gradient(circle at top, rgba(0,149,246,0.1), transparent 34%), linear-gradient(180deg, color-mix(in srgb, var(--bg) 90%, #ffffff 10%) 0%, var(--bg) 100%);"
  >
    <div class="card w-full max-w-[24rem] p-8 text-center">
      <p class="m-0 text-[0.78rem] font-bold uppercase tracking-[0.08em] text-accent-strong">{{ t('app.authLoading.eyebrow') }}</p>
      <h1 class="mt-3 mb-2 text-[1.45rem] font-semibold tracking-[-0.04em]">{{ t('app.authLoading.title') }}</h1>
      <p class="m-0 text-muted">{{ t('app.authLoading.description') }}</p>
    </div>
  </section>
  <RouterView v-else-if="isPublicShareRoute" />
  <AuthGate v-else-if="authStore.requiresLogin" />
  <AppShell v-else>
    <RouterView v-slot="{ Component }" :route="displayRoute">
      <!-- The dock destinations stay mounted so switching tabs restores the existing
           grid and scroll position instead of rebuilding the whole view. -->
      <KeepAlive :include="keptAliveViewNames">
        <component :is="Component" />
      </KeepAlive>
    </RouterView>
    <div v-if="showImageModal" class="app__image-modal-layer" @click.self="closeImageModal">
      <PostView :id="String(route.params.id ?? '')" modal @close="closeImageModal" />
    </div>
  </AppShell>
  <AdminUnlockDialog v-if="authStore.unlockDialogOpen" />
  <ImmersiveImageLayer />
  <ImmersiveVideoLayer />
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView, useRoute, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router';

import AppShell from './components/AppShell.vue';
import AdminUnlockDialog from './components/AdminUnlockDialog.vue';
import AuthGate from './components/AuthGate.vue';
import ImmersiveImageLayer from './components/ImmersiveImageLayer.vue';
import ImmersiveVideoLayer from './components/ImmersiveVideoLayer.vue';
import { canAccessRoute, routeAllowsPublicShareAccess, KEPT_ALIVE_VIEW_NAMES } from './router';
import PostView from './views/PostView.vue';
import { useAppStore } from './stores/app';
import { useAuthStore } from './stores/auth';
import { useCollectionsStore } from './stores/collections';
import { useExploreStore } from './stores/explore';
import { useLikesStore } from './stores/likes';
import { useFoldersStore } from './stores/folders';
import { useFeedStore } from './stores/feed';
import { useMomentsStore } from './stores/moments';
import { useImmersiveImageStore } from './stores/immersive-image';
import { useImmersiveVideoStore } from './stores/immersive-video';
import { useReelsStore } from './stores/reels';
import { useTrashStore } from './stores/trash';
import { useViewerStore } from './stores/viewer';

const { t } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const collectionsStore = useCollectionsStore();
const exploreStore = useExploreStore();
const feedStore = useFeedStore();
const likesStore = useLikesStore();
const foldersStore = useFoldersStore();
const momentsStore = useMomentsStore();
const immersiveImageStore = useImmersiveImageStore();
const immersiveVideoStore = useImmersiveVideoStore();
const reelsStore = useReelsStore();
const route = useRoute();
const router = useRouter();
const trashStore = useTrashStore();
const viewerStore = useViewerStore();
let lockedScrollX = 0;
let lockedScrollY = 0;
let modalScrollLocked = false;
const previousBodyStyles = {
  position: '',
  top: '',
  left: '',
  right: '',
  width: '',
  overflowY: '',
  paddingRight: ''
};

function resolveDisplayRoute(targetPath: string): RouteLocationNormalizedLoaded | null {
  const resolved = router.resolve(targetPath);
  const resolvedName = resolved.name;
  if (resolvedName === null) {
    return null;
  }

  const { href: _href, name: _ignoredName, ...displayRoute } = resolved;
  return {
    ...displayRoute,
    name: resolvedName
  };
}

const modalBackgroundRoute = computed<RouteLocationNormalizedLoaded | null>(() => {
  if (!appStore.imageModalBackgroundPath) {
    return null;
  }

  return resolveDisplayRoute(appStore.imageModalBackgroundPath);
});
const showImageModal = computed(
  () => route.name === 'image' && modalBackgroundRoute.value !== null && modalBackgroundRoute.value.fullPath !== route.fullPath
);
const isPublicShareRoute = computed(() => routeAllowsPublicShareAccess(route));
const displayRoute = computed<RouteLocationNormalizedLoaded | undefined>(() =>
  showImageModal.value ? modalBackgroundRoute.value ?? undefined : route
);
const showAuthLoading = computed(() => !authStore.ready && authStore.loading);
const keptAliveViewNames = [...KEPT_ALIVE_VIEW_NAMES];

function resetProtectedState() {
  unlockModalScroll();
  immersiveImageStore.reset();
  immersiveVideoStore.reset();
  appStore.resetProtectedState();
  feedStore.resetForRebuild();
  foldersStore.resetForRebuild();
  likesStore.resetForRebuild();
  collectionsStore.resetForRebuild();
  momentsStore.resetForRebuild();
  reelsStore.reset();
  exploreStore.reset();
  trashStore.reset();
  viewerStore.reset();
}

async function loadProtectedState(force = false) {
  const tasks: Array<Promise<unknown>> = [appStore.fetchStats(force ? { background: true } : {}), foldersStore.fetchFolders(force)];

  if (authStore.canUseSavedItems) {
    tasks.push(likesStore.initialize(force));
    tasks.push(collectionsStore.initialize(force));
  } else {
    likesStore.resetForRebuild();
    collectionsStore.resetForRebuild();
  }

  await Promise.all(tasks);
}

function lockModalScroll() {
  if (modalScrollLocked) {
    return;
  }

  lockedScrollX = window.scrollX;
  lockedScrollY = window.scrollY;

  previousBodyStyles.position = document.body.style.position;
  previousBodyStyles.top = document.body.style.top;
  previousBodyStyles.left = document.body.style.left;
  previousBodyStyles.right = document.body.style.right;
  previousBodyStyles.width = document.body.style.width;
  previousBodyStyles.overflowY = document.body.style.overflowY;
  previousBodyStyles.paddingRight = document.body.style.paddingRight;

  const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);

  document.body.style.position = 'fixed';
  document.body.style.top = `-${lockedScrollY}px`;
  document.body.style.left = `-${lockedScrollX}px`;
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflowY = 'hidden';

  if (scrollbarWidth > 0) {
    document.body.style.paddingRight = `${scrollbarWidth}px`;
  }

  modalScrollLocked = true;
}

function unlockModalScroll() {
  if (!modalScrollLocked) {
    return;
  }

  document.body.style.position = previousBodyStyles.position;
  document.body.style.top = previousBodyStyles.top;
  document.body.style.left = previousBodyStyles.left;
  document.body.style.right = previousBodyStyles.right;
  document.body.style.width = previousBodyStyles.width;
  document.body.style.overflowY = previousBodyStyles.overflowY;
  document.body.style.paddingRight = previousBodyStyles.paddingRight;
  window.scrollTo(lockedScrollX, lockedScrollY);

  modalScrollLocked = false;
}

onUnmounted(() => {
  unlockModalScroll();
  appStore.stopStatsPolling();
});

watch(
  () => authStore.defaultLocale,
  (defaultLocale) => {
    appStore.syncLocaleFromAuthStatus(defaultLocale);
  },
  {
    immediate: true
  }
);

watch(
  () => appStore.stats?.folders ?? 0,
  async (folderCount) => {
    if (appStore.isLibraryUnavailable || folderCount === 0 || folderCount === foldersStore.items.length) {
      return;
    }

    await foldersStore.fetchFolders(true);
  }
);

watch(
  () => [authStore.accessGranted, authStore.likesMode] as const,
  async ([accessGranted, likesMode], previous) => {
    const hadAccess = previous?.[0] ?? false;
    const previousLikesMode = previous?.[1] ?? null;

    if (!accessGranted) {
      resetProtectedState();
      return;
    }

    if (!hadAccess || !appStore.stats || likesMode !== previousLikesMode) {
      await loadProtectedState(Boolean(hadAccess));
    }
  },
  {
    immediate: true
  }
);

watch(
  () =>
    [
      route.fullPath,
      authStore.ready,
      authStore.capabilities.canAccessSettings,
      authStore.capabilities.canDeleteMedia,
      authStore.capabilities.canUseSharedLikes,
      authStore.capabilities.canUseLocalFavorites,
      authStore.capabilities.canUseSharedCollections,
      authStore.capabilities.canUseLocalCollections
    ] as const,
  async () => {
    if (!authStore.ready) {
      return;
    }

    if (canAccessRoute(route)) {
      return;
    }

    await router.replace({ name: 'home' });
  },
  {
    immediate: true
  }
);

watch(
  showImageModal,
  async (isVisible, wasVisible) => {
    if (isVisible) {
      lockModalScroll();
      return;
    }

    if (!wasVisible) {
      return;
    }

    await nextTick();
    unlockModalScroll();

    requestAnimationFrame(() => {
      if (route.name !== 'image') {
        appStore.clearImageModalBackground();
      }
    });
  },
  {
    immediate: true
  }
);

async function closeImageModal() {
  const targetPath = appStore.imageModalBackgroundPath ?? '/';
  await router.replace(targetPath);
}
</script>

<style scoped>
.app__image-modal-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: stretch;
  justify-content: center;
  padding:
    max(0.85rem, env(safe-area-inset-top))
    max(0.85rem, env(safe-area-inset-right))
    max(0.85rem, env(safe-area-inset-bottom))
    max(0.85rem, env(safe-area-inset-left));
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.72);
  overscroll-behavior: contain;
}

@media (min-width: 769px) {
  .app__image-modal-layer {
    align-items: center;
    padding: 2rem;
  }
}
</style>
