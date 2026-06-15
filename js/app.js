"use strict";

// Node/CommonJS compatibility loader for tests. Browser runtime uses js/app.bundle.js.
if (typeof module !== "undefined" && module.exports) {
  const fs = require("node:fs");
  const path = require("node:path");
  const vm = require("node:vm");
  const moduleFiles = require(path.join(__dirname, "..", "scripts", "app-module-files.cjs"));

  const previousModule = globalThis.module;
  const previousExports = globalThis.exports;

  globalThis.module = module;
  globalThis.exports = module.exports;

  try {
    for (const relativePath of moduleFiles) {
      const absolutePath = path.join(__dirname, "..", relativePath);
      const code = fs.readFileSync(absolutePath, "utf8");
      vm.runInThisContext(code, { filename: absolutePath });
    }
  } finally {
    globalThis.module = previousModule;
    globalThis.exports = previousExports;
  }
}
