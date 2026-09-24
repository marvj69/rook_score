"use strict";

// Every file the browser app needs at runtime. Both the Vercel build and the
// GitHub Pages workflow stage exactly these files, so repository tooling, tests,
// source modules, and training data are never published.
module.exports = [
  "index.html",
  "manifest.json",
  "service-worker.js",
  "css/app.css",
  "css/tailwind.css",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
  "js/analytics.js",
  "js/app.bundle.js",
  "js/voice-score.bundle.js",
  "js/firebase-init.js",
  "js/model_runtime_v2.json",
  "vendor/canvas-confetti.min.js",
];
