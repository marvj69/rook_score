// CACHE_NAME is stamped by scripts/stamp-service-worker.mjs from the contents
// of the files below, so any runtime change ships a fresh cache automatically.
const CACHE_NAME = "rook-cache-0460493f174ef9f6";
const CACHE_NAME_PREFIX = "rook-cache-";
const OFFLINE_URL = "index.html"; // Use relative path

const urlsToCache = [
  "./index.html",
  "./css/tailwind.css",
  "./css/app.css",
  "./js/analytics.js",
  "./js/app.bundle.js",
  "./js/model_runtime_v2.json",
  "./js/firebase-init.js",
  "./manifest.json",
  "./icons/icon-192x192.png",
  "./vendor/canvas-confetti.min.js"
];

function isCacheableResponse(response) {
  return Boolean(response) && response.status === 200 && response.type === "basic";
}

function isHtmlResponse(response) {
  const contentType = response.headers.get("Content-Type") || "";
  return contentType.toLowerCase().includes("text/html");
}

// The app shell lives at the scope root; any other same-origin navigation
// (a direct hit on a script, style, or image) must never overwrite it.
function isAppShellUrl(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  return url.pathname === scopePath || url.pathname === `${scopePath}${OFFLINE_URL}`;
}

async function getCachedOfflineShell() {
  return caches.match(OFFLINE_URL);
}

// Bypass the HTTP cache for background refreshes so a stale CDN copy (GitHub
// Pages serves assets with a ten-minute max-age) can never repopulate the
// cache after a deploy.
function fetchAndCache(request, cacheRequest = request, { revalidate = false } = {}) {
  const networkRequest = revalidate ? new Request(request, { cache: "no-cache" }) : request;
  return fetch(networkRequest).then((networkResponse) => {
    if (isCacheableResponse(networkResponse)) {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(cacheRequest, networkResponse.clone());
        return networkResponse;
      });
    }
    return networkResponse;
  });
}

async function staleWhileRevalidate(event) {
  const { request } = event;
  const cachedResponse = await caches.match(request);

  if (cachedResponse) {
    event.waitUntil(fetchAndCache(request, request, { revalidate: true }).catch(() => undefined));
    return cachedResponse;
  }

  const networkResponse = await fetchAndCache(request).catch(() => null);
  if (networkResponse) return networkResponse;
  return new Response("", { status: 504, statusText: "Offline" });
}

async function navigationResponse(event) {
  const requestUrl = new URL(event.request.url);
  if (!isAppShellUrl(requestUrl)) {
    return fetch(event.request);
  }

  const cachedShell = await getCachedOfflineShell();
  const networkPromise = fetch(new Request(event.request, { cache: "no-cache" }))
    .then((networkResponse) => {
      if (isCacheableResponse(networkResponse) && isHtmlResponse(networkResponse)) {
        return caches.open(CACHE_NAME).then((cache) => {
          cache.put(OFFLINE_URL, networkResponse.clone());
          return networkResponse;
        });
      }
      return networkResponse;
    })
    .catch(() => null);
  event.waitUntil(networkPromise.then(() => undefined));

  if (cachedShell) return cachedShell;
  const networkResponse = await networkPromise;
  return networkResponse || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Always install from the origin server, never from a stale HTTP cache.
      .then((cache) => cache.addAll(urlsToCache.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) return;

  if (requestUrl.pathname.startsWith("/api/")) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (requestUrl.pathname.endsWith(".map")) {
    // Source maps are not shipped; answer quietly instead of hitting the network.
    event.respondWith(new Response(null, { status: 204 }));
    return;
  }

  // Handle navigation requests
  if (event.request.mode === "navigate") {
    event.respondWith(navigationResponse(event));
  } else {
    event.respondWith(staleWhileRevalidate(event));
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => Promise.all(
        cacheNames
          // Only this app's previous versions; other apps on the origin keep their caches.
          .filter((cacheName) => cacheName.startsWith(CACHE_NAME_PREFIX) && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      ))
      .then(() => self.clients.claim())
  );
});
