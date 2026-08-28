import { createApp } from 'vue';

import App from './App.vue';
import { AUTH_REQUIRED_EVENT } from './api/http';
import { i18n } from './locales';
import { canAccessRoute, router } from './router';
import { useAppStore } from './stores/app';
import { useAuthStore } from './stores/auth';
import { pinia } from './stores/pinia';
import './styles/base.css';
import 'virtual:uno.css';

const DEV_SERVICE_WORKER_RESET_KEY = 'foldergram-dev-service-worker-reset';

async function disableServiceWorkerInDevelopment(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  const registrations = await navigator.serviceWorker.getRegistrations();
  if (registrations.length === 0) {
    window.sessionStorage.removeItem(DEV_SERVICE_WORKER_RESET_KEY);
    return false;
  }

  await Promise.all(registrations.map((registration) => registration.unregister()));

  if ('caches' in window) {
    const cacheKeys = await window.caches.keys();
    await Promise.all(cacheKeys.filter((key) => key.startsWith('foldergram-')).map((key) => window.caches.delete(key)));
  }

  if (navigator.serviceWorker.controller && window.sessionStorage.getItem(DEV_SERVICE_WORKER_RESET_KEY) !== '1') {
    window.sessionStorage.setItem(DEV_SERVICE_WORKER_RESET_KEY, '1');
    window.location.reload();
    return true;
  }

  window.sessionStorage.removeItem(DEV_SERVICE_WORKER_RESET_KEY);
  return false;
}

async function bootstrap() {
  if (import.meta.env.DEV && (await disableServiceWorkerInDevelopment())) {
    return;
  }

  const app = createApp(App);

  app.use(pinia);
  app.use(i18n);
  app.use(router);

  const appStore = useAppStore(pinia);
  const authStore = useAuthStore(pinia);

  appStore.initializeLocale();
  appStore.initializeTheme();

  if (typeof appStore.initializeVideoMuted === 'function') {
    appStore.initializeVideoMuted();
  }

  if (typeof appStore.initializeVideoPlaybackQuality === 'function') {
    appStore.initializeVideoPlaybackQuality();
  }

  appStore.initializeLastOpenedFolder();

  window.addEventListener(AUTH_REQUIRED_EVENT, () => {
    authStore.handleUnauthorized();
  });

  try {
    await authStore.initialize();
  } catch {
    // Keep the shell mountable so the auth gate can surface the error state.
  }

  if (!canAccessRoute(router.currentRoute.value)) {
    await router.replace({ name: 'home' });
  }

  router.afterEach((to) => {
    if (to.name === 'folder' && typeof to.params.slug === 'string') {
      appStore.recordOpenedFolder(to.params.slug);
    }
  });

  app.mount('#app');

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Ignore registration failures and keep the app usable without PWA features.
      });
    });
  }
}

void bootstrap();
