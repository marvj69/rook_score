"use strict";

// Every file the browser app needs at runtime. Both the Vercel build and the
// GitHub Pages workflow stage exactly these files, so repository tooling, tests,
// source modules, and training data are never published.
module.exports = [
  "index.html",
  "manifest.json",
  "service-worker.js",
  "css/app.min.css",
  // Keep the previous URL while cached HTML/CDN copies move to app.min.css.
  "css/app.css",
  "css/tailwind.css",
  "css/probability-explanation.css",
  "icons/icon-192x192.png",
  "icons/icon-512x512.png",
  ...require("./ios-launch-screens.cjs").flatMap(([width, height, scale]) => [
    `icons/startup-${width * scale}x${height * scale}.png`,
    `icons/startup-${height * scale}x${width * scale}.png`,
  ]),
  "js/analytics.js",
  "js/app.bundle.js",
  "js/voice-score.bundle.js",
  "js/probability-explanation.bundle.js",
  "js/firebase-init.js",
  "js/model_runtime_v2.json",
  "vendor/canvas-confetti.min.js",
];
