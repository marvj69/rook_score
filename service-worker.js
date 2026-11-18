// CACHE_NAME is stamped by scripts/stamp-service-worker.mjs from the contents
// of the files below, so any runtime change ships a fresh cache automatically.
const CACHE_NAME = "rook-cache-f76d5036d6def44c";
const CACHE_NAME_PREFIX = "rook-cache-";
const OFFLINE_URL = "index.html"; // Use relative path

const urlsToCache = [
  "./index.html",
  "./css/tailwind.css",
  "./css/app.min.css",
  "./css/probability-explanation.css",
  "./css/stats.css",
  "./js/analytics.js",
  "./js/app.bundle.js",
  "./js/probability-explanation.bundle.js",
  "./js/stats.bundle.js",
  "./js/voice-score.bundle.js",
  "./js/model_runtime_v2.json",
  "./js/firebase-init.js",
  "./manifest.json",
  "./icons/icon-192x192.png",
  "./icons/icon-512x512.png",
  "./vendor/canvas-confetti.min.js"
];

// The app shell lives at the scope root; any other same-origin navigation
// (a direct hit on a script, style, or image) must never overwrite it.
function isAppShellUrl(url) {
  const scopePath = new URL(self.registration.scope).pathname;
  return url.pathname === scopePath || url.pathname === `${scopePath}${OFFLINE_URL}`;
}

// Look only in this version's cache. caches.match() would search every cache
// on the origin, and other apps on the shared GitHub Pages origin keep theirs.
async function matchAppCache(request) {
  const cache = await caches.open(CACHE_NAME);
  return cache.match(request);
}

async function getCachedOfflineShell() {
  return matchAppCache(OFFLINE_URL);
}

// The shell and its lazy code form one release. Only installation populates
// these URLs; background network refreshes could mix two releases in one tab.
async function releaseAsset(request) {
  const cachedResponse = await matchAppCache(request);
  return cachedResponse || Response.error();
}

async function navigationResponse(event) {
  const cachedShell = await getCachedOfflineShell();
  return cachedShell || fetch(event.request);
}

// iOS requests only the launch screen for this device. Keep that image offline.
async function launchScreen(request) {
  const cache = await caches.open(CACHE_NAME);
  const existing = await cache.match(request);
  if (existing) return existing;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      // Always install from the origin server, never from a stale HTTP cache.
      .then((cache) => cache.addAll(urlsToCache.map((url) => new Request(url, { cache: "reload" }))))
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    if (isAppShellUrl(requestUrl)) event.respondWith(navigationResponse(event));
    return;
  }
  // Leave other Pages projects and server routes to the browser.
  const releaseUrl = new URL(requestUrl.pathname, self.location.origin);
  if (urlsToCache.some(path => new URL(path, self.registration.scope).href === releaseUrl.href)) {
    event.respondWith(releaseAsset(releaseUrl.href));
  } else if (releaseUrl.href.startsWith(self.registration.scope)
      && /^icons\/startup-\d+x\d+\.png$/.test(releaseUrl.href.slice(self.registration.scope.length))) {
    event.respondWith(launchScreen(releaseUrl.href));
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
