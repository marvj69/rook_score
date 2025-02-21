const CACHE_NAME = "rook-cache-v6";
const OFFLINE_URL = "index.html"; // Use relative path

const urlsToCache = [
  "./", // Root path
  "./index.html",
  "./manifest.json",
  "./icons/icon-192x192.png",
  "./icons/icon-512x512.png",
  "./service-worker.js"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(urlsToCache);
    })
  );
});

self.addEventListener("fetch", (event) => {
  // Handle navigation requests
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((cachedResponse) => {
        return cachedResponse || fetch(event.request).catch(() => {
          return caches.match(OFFLINE_URL);
        });
      })
    );
  } else {
    // Handle other assets
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        return cachedResponse || fetch(event.request);
      })
    );
  }
});

self.addEventListener("activate", (event) => {
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
