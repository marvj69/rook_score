const CACHE_NAME = "rook-cache-v1.5.1-b1";
const OFFLINE_URL = "index.html"; // Use relative path

const urlsToCache = [
  "./", // Root path
  "./index.html",
  "./manifest.json",
  "./icons/icon-192x192.png",
  "./icons/icon-512x512.png",
  "./service-worker.js",
  "./vendor/tailwindcdn.js",
  "./vendor/canvas-confetti.min.js"
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
           cache.put("./index.html", networkResponse.clone());
           return networkResponse;
         });
       })
       .catch(() => caches.match("./index.html")) // offline fallback
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
