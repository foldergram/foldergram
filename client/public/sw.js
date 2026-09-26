// Bumping the version invalidates every previous cache on activate.
const CACHE_VERSION = 'foldergram-v21';
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const MEDIA_CACHE = `${CACHE_VERSION}-media`;
const IS_LOCALHOST = self.location.hostname === 'localhost' || self.location.hostname === '127.0.0.1';
const APP_SHELL_URLS = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-180.png',
  '/icon-192.png',
  '/icon-512.png',
];

/**
 * Content-hashed build output. A new deploy emits new filenames, so these can be
 * served from cache immediately and never revalidated.
 */
function isImmutableAsset(url) {
  return url.pathname.startsWith('/assets/');
}

/**
 * Precaches the current bundle so a cold PWA start does not wait on the network for
 * the ~1 MB app shell. The asset names are read out of the live index.html, which is
 * the only place that knows the current hashes.
 */
async function precacheAppShell() {
  const cache = await caches.open(APP_SHELL_CACHE);
  await cache.addAll(APP_SHELL_URLS);

  try {
    const indexResponse = await cache.match('/');
    if (!indexResponse) {
      return;
    }

    const html = await indexResponse.clone().text();
    const assetPaths = new Set();
    const pattern = /(?:src|href)="(\/assets\/[^"]+)"/g;
    let match = pattern.exec(html);
    while (match !== null) {
      assetPaths.add(match[1]);
      match = pattern.exec(html);
    }

    if (assetPaths.size > 0) {
      // Individually, so one missing file cannot fail the whole install.
      await Promise.all(
        [...assetPaths].map((assetPath) =>
          cache.add(assetPath).catch(() => {
            // A precache miss just means this asset is fetched on demand.
          })
        )
      );
    }
  } catch {
    // The shell is already cached; missing bundle hints only cost a network trip.
  }
}

self.addEventListener('install', (event) => {
  if (IS_LOCALHOST) {
    self.skipWaiting();
    return;
  }

  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== APP_SHELL_CACHE && key !== RUNTIME_CACHE && key !== MEDIA_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/**
 * Serves the cached app shell right away and refreshes it in the background, so a
 * launch renders from disk instead of waiting on a round trip. Falling back to the
 * network keeps a first-ever visit working.
 */
async function respondWithStaleWhileRevalidate(request, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  const key = cacheKey ?? request;
  const cached = await cache.match(key);

  const networkUpdate = fetch(request)
    .then((response) => {
      if (response.ok && response.type !== 'opaque' && !response.headers.get('cache-control')?.includes('no-store')) {
        void cache.put(key, response.clone());
      }

      return response;
    })
    .catch(() => null);

  if (cached) {
    // Deliberately not awaited: the refresh lands in the cache for the next launch.
    void networkUpdate;
    return cached;
  }

  const response = await networkUpdate;
  return response ?? Response.error();
}

/**
 * Thumbnails and preview stills are immutable once generated (the server versions
 * them), and they dominate first-paint cost. Cache-first with an entry cap: the
 * oldest insertions fall out once the feed has grown past the limit.
 */
const MEDIA_CACHE_MAX_ENTRIES = 2000;

function isCachedMediaAsset(url) {
  return url.pathname.startsWith('/thumbnails/') || url.pathname.startsWith('/previews/');
}

async function respondMediaCacheFirst(request) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  // Only successful full responses: a 401 while logged out or a partial range
  // response must never poison the cache.
  if (!response.ok || response.status === 206 || response.type === 'opaque') {
    return response;
  }

  void cache.put(request, response.clone()).then(async () => {
    const keys = await cache.keys();
    const excess = keys.length - MEDIA_CACHE_MAX_ENTRIES;
    for (let index = 0; index < excess; index += 1) {
      await cache.delete(keys[index]);
    }
  });
  return response;
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (IS_LOCALHOST) {
    return;
  }

  const url = new URL(event.request.url);

  if (url.origin !== self.location.origin) {
    return;
  }

  if (isCachedMediaAsset(url) && !event.request.headers.has('range')) {
    event.respondWith(respondMediaCacheFirst(event.request));
    return;
  }

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/originals/') ||
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    event.request.headers.has('range')
  ) {
    return;
  }

  // Navigations render the cached shell immediately and revalidate behind it. Every
  // client route resolves to the same index.html, so '/' is the cache key.
  if (event.request.mode === 'navigate') {
    event.respondWith(respondWithStaleWhileRevalidate(event.request, APP_SHELL_CACHE, '/'));
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.match(event.request).then(async (cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        const response = await fetch(event.request);
        if (response.ok && response.type !== 'opaque') {
          const cache = await caches.open(APP_SHELL_CACHE);
          void cache.put(event.request, response.clone());
        }

        return response;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(async (cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      const response = await fetch(event.request);

      if (
        !response.ok ||
        response.type === 'opaque' ||
        response.status === 206 ||
        response.headers.has('content-range') ||
        response.headers.get('cache-control')?.includes('no-store')
      ) {
        return response;
      }

      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(event.request, response.clone());
      return response;
    })
  );
});
