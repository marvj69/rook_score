const CACHE_NAME = "rook-cache-v2.1.10";
const OFFLINE_URL = "index.html"; // Use relative path

const urlsToCache = [
  "./", // Root path
  "./index.html",
  "./css/tailwind.css",
  "./css/app.css",
  "./js/analytics.js",
  "./js/app.bundle.js",
  "./js/model_runtime_v1.json",
  "./js/firebase-init.js",
  "./manifest.json",
  "./icons/icon-192x192.png",
  "./icons/icon-512x512.png",
  "./service-worker.js",
  "./vendor/canvas-confetti.min.js"
];

async function getCachedOfflineShell() {
  return (await caches.match(OFFLINE_URL))
    || (await caches.match("./index.html"))
    || (await caches.match("./"));
}

function fetchAndCache(request, cacheRequest = request) {
  return fetch(request).then((networkResponse) => {
    if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
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
  const networkPromise = fetchAndCache(request).catch(() => null);

  if (cachedResponse) {
    event.waitUntil(networkPromise.then(() => undefined));
    return cachedResponse;
  }

  const networkResponse = await networkPromise;
  if (networkResponse) return networkResponse;
  return new Response("", { status: 504, statusText: "Offline" });
}

async function navigationResponse(event) {
  const cachedShell = await getCachedOfflineShell();
  const networkPromise = fetchAndCache(event.request, OFFLINE_URL).catch(() => null);
  event.waitUntil(networkPromise.then(() => undefined));

  if (cachedShell) return cachedShell;
  const networkResponse = await networkPromise;
  return networkResponse || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(urlsToCache))
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

  if (event.request.url.endsWith(".map")) {
    event.respondWith(
      Promise.resolve(new Response("", { status: 204, headers: { "Content-Type": "application/json" } }))
    );
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
  self.clients.claim();
    event.waitUntil(
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
          })
        );
      })
    );
  });
