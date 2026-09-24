import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Derives the service worker cache name from the contents of every runtime
// asset, so a changed asset always ships with a new cache (and an unchanged
// build leaves the file untouched). Run through `npm run build`.
//   node scripts/stamp-service-worker.mjs          # rewrite service-worker.js
//   node scripts/stamp-service-worker.mjs --check  # exit 1 when it is stale
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const staticSiteFiles = require("./static-site-files.cjs");
const SERVICE_WORKER_PATH = "service-worker.js";
const CACHE_NAME_PATTERN = /const CACHE_NAME = "rook-cache-[^"]+";/;

export async function computeCacheName() {
  const hash = createHash("sha256");
  for (const relativePath of staticSiteFiles) {
    if (relativePath === SERVICE_WORKER_PATH) continue;
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(join(rootDir, relativePath)));
    hash.update("\0");
  }
  // The worker's own logic is part of the cache identity too, minus the stamp.
  const workerSource = (await readFile(join(rootDir, SERVICE_WORKER_PATH), "utf8"))
    .replace(CACHE_NAME_PATTERN, 'const CACHE_NAME = "rook-cache-";');
  hash.update(workerSource);
  return `rook-cache-${hash.digest("hex").slice(0, 16)}`;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const source = await readFile(join(rootDir, SERVICE_WORKER_PATH), "utf8");
  if (!CACHE_NAME_PATTERN.test(source)) {
    throw new Error("service-worker.js is missing its CACHE_NAME declaration.");
  }
  const cacheName = await computeCacheName();
  const stamped = source.replace(CACHE_NAME_PATTERN, `const CACHE_NAME = "${cacheName}";`);
  if (process.argv.includes("--check")) {
    if (stamped !== source) {
      console.error(`service-worker.js is stale: expected ${cacheName}. Run npm run build.`);
      process.exit(1);
    }
    console.log(`service-worker.js is current (${cacheName}).`);
  } else if (stamped !== source) {
    await writeFile(join(rootDir, SERVICE_WORKER_PATH), stamped, "utf8");
    console.log(`Stamped service-worker.js with ${cacheName}.`);
  } else {
    console.log(`service-worker.js already carries ${cacheName}.`);
  }
}
