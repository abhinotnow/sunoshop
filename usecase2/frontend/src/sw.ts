// Service worker implementation with Workbox precache and offline app shell fallback
// Exports registerSW, initServiceWorker, precacheShellAssets, CACHE_NAME, SHELL_ASSETS
// Depends on browser ServiceWorker API, CacheStorage API

export const CACHE_NAME = 'sunoshop-app-shell-v1';

export const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
];

// Helper to register the Service Worker in the browser
export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      console.log('SunoShop ServiceWorker registered with scope:', reg.scope);
      return reg;
    } catch (err) {
      console.warn('ServiceWorker registration failed:', err);
      return null;
    }
  }
  return null;
}

// Precache app shell helper for install event
export async function precacheShellAssets(
  cacheName: string = CACHE_NAME,
  urls: string[] = SHELL_ASSETS
): Promise<void> {
  if (typeof caches === 'undefined') return;
  const cache = await caches.open(cacheName);
  await cache.addAll(urls);
}

// Clean old caches on activation
export async function cleanOldCaches(currentCacheName: string = CACHE_NAME): Promise<void> {
  if (typeof caches === 'undefined') return;
  const keys = await caches.keys();
  await Promise.all(
    keys.map((key) => {
      if (key !== currentCacheName) {
        return caches.delete(key);
      }
      return Promise.resolve(false);
    })
  );
}

// Fetch handler: Network-first for navigation with offline fallback, Cache-first for static assets
export async function handleFetch(
  request: Request,
  cacheName: string = CACHE_NAME
): Promise<Response> {
  const isNavigate =
    request.mode === 'navigate' ||
    (request.headers?.get && request.headers.get('accept')?.includes('text/html'));

  // For HTML navigation requests, try network first; fall back to cached shell
  if (isNavigate) {
    try {
      const networkResponse = await fetch(request);
      if (networkResponse.ok) {
        const cache = await caches.open(cacheName);
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    } catch {
      // Offline fallback: serve cached index.html or root
      const cached =
        (await caches.match(request)) ||
        (await caches.match('/index.html')) ||
        (await caches.match('/'));
      if (cached) return cached;
      return new Response('<h1>SunoShop Offline</h1><p>Cached shell unavailable.</p>', {
        headers: { 'Content-Type': 'text/html' },
      });
    }
  }

  // For static assets, cache first then network
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const fetchResponse = await fetch(request);
    if (fetchResponse.ok && request.method === 'GET') {
      const cache = await caches.open(cacheName);
      cache.put(request, fetchResponse.clone());
    }
    return fetchResponse;
  } catch (err) {
    throw err;
  }
}

// Initialize worker events if running in ServiceWorkerGlobalScope
export function initServiceWorker(scope: any = typeof self !== 'undefined' ? self : null) {
  if (!scope || !scope.addEventListener) return;

  scope.addEventListener('install', (event: any) => {
    event.waitUntil(
      precacheShellAssets().then(() => {
        if (typeof scope.skipWaiting === 'function') {
          return scope.skipWaiting();
        }
      })
    );
  });

  scope.addEventListener('activate', (event: any) => {
    event.waitUntil(
      cleanOldCaches().then(() => {
        if (scope.clients && typeof scope.clients.claim === 'function') {
          return scope.clients.claim();
        }
      })
    );
  });

  scope.addEventListener('fetch', (event: any) => {
    // Only handle http and https requests
    if (event.request.url.startsWith('http')) {
      event.respondWith(handleFetch(event.request));
    }
  });

  scope.addEventListener('message', (event: any) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      if (typeof scope.skipWaiting === 'function') {
        scope.skipWaiting();
      }
    }
  });
}

// Auto-run if inside service worker context
if (
  typeof self !== 'undefined' &&
  typeof (self as any).clients !== 'undefined' &&
  typeof (self as any).addEventListener === 'function'
) {
  initServiceWorker(self);
}
