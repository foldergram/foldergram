<template>
  <section
    v-if="showAuthLoading"
    class="min-h-screen px-6 py-10 flex items-center justify-center"
    style="background: radial-gradient(circle at top, rgba(var(--accent-rgb),0.1), transparent 34%), linear-gradient(180deg, color-mix(in srgb, var(--bg) 90%, #ffffff 10%) 0%, var(--bg) 100%);"
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
    <div class="app__background-route" :inert="showReelModal" :aria-hidden="showReelModal ? 'true' : undefined">
      <RouterView :key="displayRoute?.name === 'settings' ? 'settings' : sourcesStore.contentRevision" :route="displayRoute" />
    </div>
    <div
      v-if="showReelModal"
      ref="reelModalElement"
      class="app__reel-modal-layer"
      role="dialog"
      aria-modal="true"
      :aria-label="t('nav.reels')"
      tabindex="-1"
      @keydown="trapReelModalFocus"
    >
      <ReelsView :key="sourcesStore.contentRevision" />
    </div>
    <div v-if="showImageModal" class="app__image-modal-layer" @click.self="closeImageModal">
      <PostView :key="sourcesStore.contentRevision" :id="String(route.params.id ?? '')" modal @close="closeImageModal" />
    </div>
  </AppShell>
  <AdminUnlockDialog v-if="authStore.unlockDialogOpen" />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterView, useRoute, useRouter, type RouteLocationNormalizedLoaded } from 'vue-router';

import AppShell from './components/AppShell.vue';
import AdminUnlockDialog from './components/AdminUnlockDialog.vue';
import AuthGate from './components/AuthGate.vue';
import { canAccessRoute, routeAllowsPublicShareAccess } from './router';
import PostView from './views/PostView.vue';
import ReelsView from './views/ReelsView.vue';
import { useAppStore } from './stores/app';
import { useAuthStore } from './stores/auth';
import { useCollectionsStore } from './stores/collections';
import { useExploreStore } from './stores/explore';
import { useLikesStore } from './stores/likes';
import { useFoldersStore } from './stores/folders';
import { useFeedStore } from './stores/feed';
import { useMomentsStore } from './stores/moments';
import { useReelsStore } from './stores/reels';
import { useTrashStore } from './stores/trash';
import { useViewerStore } from './stores/viewer';
import { useSourcesStore } from './stores/sources';

const { t } = useI18n();
const appStore = useAppStore();
const authStore = useAuthStore();
const collectionsStore = useCollectionsStore();
const exploreStore = useExploreStore();
const feedStore = useFeedStore();
const likesStore = useLikesStore();
const foldersStore = useFoldersStore();
const momentsStore = useMomentsStore();
const reelsStore = useReelsStore();
const route = useRoute();
const router = useRouter();
const trashStore = useTrashStore();
const viewerStore = useViewerStore();
const sourcesStore = useSourcesStore();
let lockedScrollX = 0;
let lockedScrollY = 0;
let modalScrollLocked = false;
const reelModalElement = ref<HTMLElement | null>(null);
let reelModalOpener: HTMLElement | null = null;

function focusReelModal() {
  const dialog = reelModalElement.value;
  if (!dialog) return;
  (dialog.querySelector<HTMLElement>('.reels-view__close') ?? dialog).focus({ preventScroll: true });
}

function trapReelModalFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || !reelModalElement.value) return;

  const focusable = Array.from(reelModalElement.value.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(element => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden');

  if (!focusable.length) {
    event.preventDefault();
    reelModalElement.value.focus();
    return;
  }

  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !reelModalElement.value.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !reelModalElement.value.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}
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
const reelBackgroundRoute = computed<RouteLocationNormalizedLoaded | null>(() =>
  appStore.reelModalBackgroundPath ? resolveDisplayRoute(appStore.reelModalBackgroundPath) : null
);
const showReelModal = computed(() => route.name === 'reels' && route.query.from === 'home' && reelBackgroundRoute.value?.name === 'home');
const isPublicShareRoute = computed(() => routeAllowsPublicShareAccess(route));
const displayRoute = computed<RouteLocationNormalizedLoaded | undefined>(() =>
  showReelModal.value ? reelBackgroundRoute.value ?? undefined : showImageModal.value ? modalBackgroundRoute.value ?? undefined : route
);
const showAuthLoading = computed(() => !authStore.ready && authStore.loading);

let protectedStateGeneration = 0;
let protectedStateLoadPromise: Promise<void> | null = null;
let protectedStateLoadGeneration = -1;

function resetProtectedState() {
  protectedStateGeneration += 1;
  protectedStateLoadPromise = null;
  protectedStateLoadGeneration = -1;
  unlockModalScroll();
  appStore.resetProtectedState();
  sourcesStore.stop();
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

async function startProtectedStateLoad(force: boolean): Promise<void> {
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

async function loadProtectedState(force = false) {
  if (!force && protectedStateLoadPromise && protectedStateLoadGeneration === protectedStateGeneration) {
    await protectedStateLoadPromise;
    return;
  }

  const loadGeneration = protectedStateGeneration;
  const load = startProtectedStateLoad(force);
  protectedStateLoadPromise = load;
  protectedStateLoadGeneration = loadGeneration;

  try {
    await load;
  } finally {
    if (protectedStateLoadPromise === load) {
      protectedStateLoadPromise = null;
      protectedStateLoadGeneration = -1;
    }
  }
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

function refreshVisibleScanStatus() {
  if (authStore.accessGranted && !route.meta.publicShare) appStore.refreshVisibleScanStatus();
}

onMounted(() => {
  window.addEventListener('focus', refreshVisibleScanStatus);
  document.addEventListener('visibilitychange', refreshVisibleScanStatus);
});

onUnmounted(() => {
  window.removeEventListener('focus', refreshVisibleScanStatus);
  document.removeEventListener('visibilitychange', refreshVisibleScanStatus);
  unlockModalScroll();
  appStore.stopStatsPolling();
  sourcesStore.stop();
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
  () => [appStore.stats?.folders, appStore.stats?.scan.lastCompletedScan?.id] as const,
  async ([folderCount, scanId], previous) => {
    if (appStore.isLibraryUnavailable || folderCount === undefined) return;
    const scanChanged = previous?.[1] !== undefined && scanId !== previous[1];
    if ((!foldersStore.loadingList && folderCount !== foldersStore.total) || scanChanged) {
      await foldersStore.fetchFolders(true);
    }
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
      sourcesStore.start();
      await loadProtectedState(Boolean(hadAccess));
      if (authStore.accessGranted && !route.meta.publicShare) appStore.startStatsPolling();
    }
  },
  {
    immediate: true
  }
);

watch(isPublicShareRoute, (publicShare) => {
  if (publicShare) appStore.stopStatsPolling();
  else refreshVisibleScanStatus();
});

watch(
  () => authStore.canAccessSettings,
  () => {
    appStore.resetScanCapability();
    refreshVisibleScanStatus();
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

watch(showReelModal, async (isVisible, wasVisible) => {
  if (isVisible) {
    reelModalOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await nextTick();
    if (showReelModal.value) focusReelModal();
    return;
  }

  if (!wasVisible) return;
  const opener = reelModalOpener;
  reelModalOpener = null;
  await nextTick();
  requestAnimationFrame(() => {
    if (route.name !== 'home') return;
    // Source refreshes can replace the original card while the viewer is open.
    // Prefer the exact opener; otherwise return focus to a current Home control.
    const target = opener?.isConnected
      ? opener
      : document.querySelector<HTMLElement>(
        '.app__background-route .feed-card__video-shell[role="button"], .app__background-route .home-layout button:not([disabled]), .sidebar a[href="/"]'
      );
    target?.focus({ preventScroll: true });
  });
}, { flush: 'sync' });

// A source revision replaces the keyed Reel view while the overlay remains open.
watch(() => sourcesStore.contentRevision, async () => {
  // Source replacement invalidates saved Reels queues, including a mounted
  // modal's cursor. Its keyed replacement must fetch the new generation.
  reelsStore.reset();
  if (!showReelModal.value) return;
  await nextTick();
  if (showReelModal.value) focusReelModal();
}, { flush: 'post' });

watch(
  () => showImageModal.value || showReelModal.value,
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
      if (route.name !== 'image') appStore.clearImageModalBackground();
      // Keep the Reel background for Forward navigation back to the viewer.
      if (route.name !== 'home' && route.name !== 'reels') appStore.clearReelModalBackground();
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
/* The wrapper has no layout box: Home retains its DOM and exact geometry
   while inert keeps its controls outside the modal's focus/navigation tree. */
.app__background-route {
  display: contents;
}

.app__reel-modal-layer {
  position: fixed;
  inset: 0;
  /* Full-viewport Home viewer: cover the mounted Home sidebar without
     unmounting Home or changing the standalone Reels page. */
  z-index: 45;
  height: 100dvh;
  overflow: hidden;
  background: var(--bg);
  container-type: size;
  overscroll-behavior: contain;
}

.app__reel-modal-layer :deep(.reels-view) {
  height: 100%;
}

.app__image-modal-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  min-height: 100dvh;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.72);
  overscroll-behavior: contain;
}

</style>
