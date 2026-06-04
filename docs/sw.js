const CACHE_NAME = 'orchestra-merger-static-v3';
const STATIC_ASSETS = ['./', './index.html', './style.css', './app.js', './manifest.json', './icon-192.png', './icon-512.png', './config/copilot-identities.json'];
const CORE_APP_PATHS = new Set(['./', './index.html', './app.js', './sw.js'].map((path) => new URL(path, self.registration.scope).pathname));
const GITHUB_API_ORIGIN = 'https://api.github.com';
const networkErrorResponse = () =>
  new Response('Network request failed.', {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(cacheNames.filter((cacheName) => cacheName !== CACHE_NAME).map((cacheName) => caches.delete(cacheName))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

async function putInCache(request, response) {
  if (!response || !response.ok) {
    return response;
  }
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    return await putInCache(request, response);
  } catch {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    if (request.mode === 'navigate') {
      const cachedIndex = await caches.match('./index.html');
      if (cachedIndex) {
        return cachedIndex;
      }
    }
    return networkErrorResponse();
  }
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  try {
    const response = await fetch(request);
    return await putInCache(request, response);
  } catch {
    return networkErrorResponse();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin === GITHUB_API_ORIGIN) {
    event.respondWith(fetch(event.request).catch(() => networkErrorResponse()));
    return;
  }

  const isCoreRequest = event.request.mode === 'navigate' || CORE_APP_PATHS.has(requestUrl.pathname);
  event.respondWith(isCoreRequest ? networkFirst(event.request) : cacheFirst(event.request));
});
