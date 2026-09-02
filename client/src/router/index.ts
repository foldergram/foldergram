import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';

// The dock destinations stay eagerly bundled: they are what the first tap hits, and
// they are the routes kept alive below. Everything else is split out so the initial
// download is the app shell instead of every screen in the product.
import HomeView from '../views/HomeView.vue';
import PostView from '../views/PostView.vue';
import LibraryView from '../views/LibraryView.vue';
import LikesView from '../views/LikesView.vue';
import CollectionsView from '../views/CollectionsView.vue';
import ExploreView from '../views/ExploreView.vue';
import FolderView from '../views/FolderView.vue';
import ReelsView from '../views/ReelsView.vue';
import { useAppStore } from '../stores/app';
import { useAuthStore } from '../stores/auth';
import { pinia } from '../stores/pinia';
import type { AuthCapabilities } from '../types/api';

const CollectionView = () => import('../views/CollectionView.vue');
const MomentView = () => import('../views/MomentView.vue');
const PlaceView = () => import('../views/PlaceView.vue');
const PlacesView = () => import('../views/PlacesView.vue');
const SettingsView = () => import('../views/SettingsView.vue');
const SharedFolderView = () => import('../views/SharedFolderView.vue');
const SharedPostView = () => import('../views/SharedPostView.vue');
const SharedTokenPostView = () => import('../views/SharedTokenPostView.vue');
const TrashView = () => import('../views/TrashView.vue');

/**
 * Component names whose instance survives navigation. Leaving the dock destinations
 * mounted is what removes the rebuild-on-every-tap stall: the grid, the scroll
 * position and the already-fetched feed are all still there when the user comes back.
 *
 * These are component names rather than route names because that is what `KeepAlive`
 * matches on; Vue infers them from the SFC filename.
 */
export const KEPT_ALIVE_VIEW_NAMES = [
  'HomeView',
  'ReelsView',
  'ExploreView',
  'LibraryView',
  'LikesView',
  'CollectionsView'
] as const;

type RouteCapability = keyof AuthCapabilities;
const KEPT_ALIVE_ROUTE_NAMES = new Set(['home', 'reels', 'explore', 'library', 'likes', 'collections']);
// Dock views are keyed by route name, not fullPath. A query/hash change must not
// make the same cached view lose its position when the user returns to it.
const keptRouteScrollPositions = new Map<string, { left: number; top: number }>();

function getKeptRouteScrollKey(route: Pick<RouteLocationNormalized, 'name'>): string | null {
  return typeof route.name === 'string' && KEPT_ALIVE_ROUTE_NAMES.has(route.name) ? route.name : null;
}

function shouldPreserveModalScroll(to: RouteLocationNormalized, from: RouteLocationNormalized) {
  const appStore = useAppStore(pinia);
  const backgroundPath = appStore.imageModalBackgroundPath;

  if (!backgroundPath) {
    return false;
  }

  const isOpeningModal = to.name === 'image' && from.fullPath === backgroundPath;
  const isClosingModal = from.name === 'image' && to.fullPath === backgroundPath;
  const isNavigatingWithinModal = to.name === 'image' && from.name === 'image';

  return isOpeningModal || isClosingModal || isNavigatingWithinModal;
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView
    },
    {
      path: '/post/:id',
      alias: '/image/:id',
      name: 'image',
      component: PostView,
      props: true
    },
    {
      path: '/library',
      name: 'library',
      component: LibraryView
    },
    {
      path: '/explore',
      name: 'explore',
      component: ExploreView,
      meta: {
        shell: 'explore'
      }
    },
    {
      path: '/reels',
      name: 'reels',
      component: ReelsView,
      meta: {
        shell: 'reels'
      }
    },
    {
      path: '/likes/posts',
      name: 'likes',
      component: LikesView,
      meta: {
        requiresSavedItems: true
      }
    },
    {
      path: '/collections',
      name: 'collections',
      component: CollectionsView,
      meta: {
        requiresSavedItems: true
      }
    },
    {
      path: '/collections/:slug',
      name: 'collection',
      component: CollectionView,
      props: true,
      meta: {
        requiresSavedItems: true
      }
    },
    {
      path: '/trash',
      name: 'trash',
      component: TrashView,
      meta: {
        requiredCapability: 'canDeleteMedia'
      }
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
      meta: {
        requiredCapability: 'canAccessSettings'
      }
    },
    {
      path: '/moments/:id',
      name: 'moment',
      component: MomentView,
      props: true
    },
    {
      path: '/places',
      name: 'places',
      component: PlacesView
    },
    {
      path: '/places/:slug',
      name: 'place',
      component: PlaceView,
      props: true
    },
    {
      path: '/f/:slug',
      alias: '/folders/:slug',
      name: 'folder',
      component: FolderView,
      props: true
    },
    {
      path: '/share/:slug',
      name: 'shared-folder',
      component: SharedFolderView,
      props: true,
      meta: {
        publicShare: true
      }
    },
    {
      path: '/share/:slug/posts/:id',
      name: 'shared-post',
      component: SharedPostView,
      props: true,
      meta: {
        publicShare: true
      }
    },
    {
      path: '/share/:slug/images/:id',
      name: 'shared-image',
      component: SharedPostView,
      props: true,
      meta: {
        publicShare: true
      }
    },
    {
      // Post-level share tokens. Short on purpose: this URL gets pasted into chats.
      path: '/s/:token',
      name: 'shared-token-post',
      component: SharedTokenPostView,
      props: true,
      meta: {
        publicShare: true
      }
    }
  ],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    }

    if (shouldPreserveModalScroll(to, from)) {
      return false;
    }

    if (typeof to.name === 'string' && typeof from.name === 'string' &&
        KEPT_ALIVE_ROUTE_NAMES.has(to.name) && KEPT_ALIVE_ROUTE_NAMES.has(from.name)) {
      const rememberedPosition = keptRouteScrollPositions.get(to.name);
      if (rememberedPosition !== undefined) {
        return rememberedPosition;
      }
      return false;
    }

    return { top: 0 };
  }
});

router.beforeEach((to, from) => {
  const key = getKeptRouteScrollKey(from);
  if (key) {
    keptRouteScrollPositions.set(key, { left: window.scrollX, top: window.scrollY });
  }

  return true;
});

router.afterEach((to) => {
  const key = getKeptRouteScrollKey(to);
  const rememberedPosition = key ? keptRouteScrollPositions.get(key) : undefined;
  if (rememberedPosition === undefined) {
    return;
  }

  // The shell and a kept-alive view can finish layout after scrollBehavior. Apply
  // the remembered position once more after navigation has fully settled.
  window.setTimeout(() => {
    window.scrollTo({ ...rememberedPosition, behavior: 'auto' });
  }, 160);
});

export function getRouteRequiredCapability(route: Pick<RouteLocationNormalized, 'meta'>): RouteCapability | null {
  const capability = route.meta.requiredCapability;
  return typeof capability === 'string' ? (capability as RouteCapability) : null;
}

export function routeRequiresSavedItems(route: Pick<RouteLocationNormalized, 'meta'>): boolean {
  return route.meta.requiresSavedItems === true;
}

export function routeAllowsPublicShareAccess(route: Pick<RouteLocationNormalized, 'meta'>): boolean {
  return route.meta.publicShare === true;
}

export function canAccessRoute(route: Pick<RouteLocationNormalized, 'meta'>): boolean {
  if (routeAllowsPublicShareAccess(route)) {
    return true;
  }

  const authStore = useAuthStore(pinia);
  const requiredCapability = getRouteRequiredCapability(route);

  if (requiredCapability) {
    return authStore.capabilities[requiredCapability] === true;
  }

  if (routeRequiresSavedItems(route)) {
    return authStore.canUseSavedItems;
  }

  return true;
}

router.beforeEach((to) => {
  const authStore = useAuthStore(pinia);
  if (!authStore.ready) {
    return true;
  }

  return canAccessRoute(to) ? true : { name: 'home' };
});
