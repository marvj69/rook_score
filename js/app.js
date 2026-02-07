"use strict";

// Node/CommonJS compatibility loader for split browser modules.
// Browser runtime now loads module files directly from index.html.
if (typeof module !== "undefined" && module.exports) {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");

  const moduleFiles = [
    "modules/00-config.js",
    "modules/01-state-and-win-prob-render.js",
    "modules/02-win-prob-engine.js",
    "modules/03-storage-icons-presets.js",
    "modules/04-theme-ui-helpers.js",
    "modules/05-game-state-management.js",
    "modules/06-team-stats-helpers.js",
    "modules/07-menu-modal.js",
    "modules/08-game-actions-logic.js",
    "modules/09-settings-validation-misc.js",
    "modules/10-probability-breakdown.js",
    "modules/11-rendering.js",
    "modules/12-saved-games-and-stats-modals.js",
    "modules/13-settings-loading.js",
    "modules/14-initialization-and-exports.js",
  ];

  const previousModule = globalThis.module;
  const previousExports = globalThis.exports;

  globalThis.module = module;
  globalThis.exports = module.exports;

  try {
    for (const relativePath of moduleFiles) {
      const absolutePath = path.join(__dirname, relativePath);
      const code = fs.readFileSync(absolutePath, "utf8");
      vm.runInThisContext(code, { filename: absolutePath });
    }
  } finally {
    globalThis.module = previousModule;
    globalThis.exports = previousExports;
  }
}
