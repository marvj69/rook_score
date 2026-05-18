const CACHE_NAME = "rook-cache-v2.0.7";
const OFFLINE_URL = "index.html"; // Use relative path

const moduleFiles = [
  "./js/modules/00-config.js",
  "./js/modules/01-state-and-win-prob-render.js",
  "./js/modules/02-win-prob-engine.js",
  "./js/modules/03-storage-icons-presets.js",
  "./js/modules/04-theme-ui-helpers.js",
  "./js/modules/05-game-state-management.js",
  "./js/modules/06-team-stats-helpers.js",
  "./js/modules/07-menu-modal.js",
  "./js/modules/08-game-actions-logic.js",
  "./js/modules/09-settings-validation-misc.js",
  "./js/modules/10-probability-breakdown.js",
  "./js/modules/11-rendering.js",
  "./js/modules/12-saved-games-and-stats-modals.js",
  "./js/modules/13-settings-loading.js",
  "./js/modules/14-initialization-and-exports.js"
];

const urlsToCache = [
  "./", // Root path
  "./index.html",
  "./css/tailwind.css",
  "./css/app.css",
  "./js/analytics.js",
  "./js/app.js",
  "./js/model_runtime_v1.json",
  "./js/firebase-init.js",
  "./manifest.json",
  "./icons/icon-192x192.png",
  "./icons/icon-512x512.png",
  "./service-worker.js",
  "./vendor/canvas-confetti.min.js"
].concat(moduleFiles);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin === self.location.origin && requestUrl.pathname.startsWith("/api/")) {
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
    event.respondWith(
     fetch(event.request)
       .then((networkResponse) => {
         // put fresh index.html in the current versioned cache
         return caches.open(CACHE_NAME).then((cache) => {
           cache.put(OFFLINE_URL, networkResponse.clone());
           return networkResponse;
         });
       })
       .catch(() => caches.match(OFFLINE_URL)) // offline fallback
   );
  } else {
    // Handle other assets (scripts, images, etc.)
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request).then((networkResponse) => {
          // Cache successful same-origin responses for future offline use
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        });
      })
    );
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
