// Offline support. Books that were opened once stay readable without a connection;
// reading positions are queued by the app and synced when the server is reachable again.
const CACHE = 'wortlauf-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add('/')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'clear') event.waitUntil(caches.delete(CACHE));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, fallback) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(fallback ?? request, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(fallback ?? request, { ignoreSearch: Boolean(fallback) });
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, '/'));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  } else if (/^\/api\/books\/[0-9a-f]+\/(doc|file)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request));
  } else if (!url.pathname.startsWith('/api/') || /^\/api\/(state|settings|books|plugins)/.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  }
});
