// Offline support. All books and reading data already live in the browser; this worker keeps
// the app itself available without a connection. Paths are relative to the worker's own
// location, so the app works under any sub-path such as a GitHub Pages project site.
const CACHE = 'wortlauf-v2';
const ROOT = new URL('./', self.location).href;

/** The start page plus the scripts and styles it references. */
async function precache() {
  const cache = await caches.open(CACHE);
  const response = await fetch(ROOT, { cache: 'no-cache' });
  if (!response.ok) return;
  await cache.put(ROOT, response.clone());
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], ROOT))
    .filter((url) => url.origin === self.location.origin && url.href.startsWith(ROOT));
  await Promise.all(assets.map((url) => cache.add(url).catch(() => {})));
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, key = request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(key, response.clone());
    return response;
  } catch (error) {
    const hit = await cache.match(key, { ignoreSearch: true });
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !request.url.startsWith(ROOT)) return;
  if (request.mode === 'navigate') event.respondWith(networkFirst(request, ROOT));
  // built files carry a content hash in their name and never change
  else if (request.url.startsWith(`${ROOT}assets/`)) event.respondWith(cacheFirst(request));
  else event.respondWith(networkFirst(request));
});
