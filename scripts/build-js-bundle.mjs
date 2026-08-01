import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const moduleFiles = require("./app-module-files.cjs");
const lazyVoiceModulePath = "js/modules/09-voice-scoring.js";

async function buildBundle(relativePaths, outputPath, description) {
  const chunks = await Promise.all(
    relativePaths.map(async (relativePath) => {
      const source = await readFile(join(rootDir, relativePath), "utf8");
      return `\n// ---- ${relativePath} ----\n${source.trim()}\n`;
    }),
  );

  const banner = [
    '"use strict";',
    `// Generated ${description} by scripts/build-js-bundle.mjs. Edit source modules instead.`,
    "",
  ].join("\n");

  const bundle = `${banner}${chunks.join("")}`.trimEnd();
  await writeFile(join(rootDir, outputPath), `${bundle}\n`, "utf8");
}

const coreModuleFiles = moduleFiles.filter(relativePath => relativePath !== lazyVoiceModulePath);
const voiceModuleFiles = moduleFiles.filter(relativePath => relativePath === lazyVoiceModulePath);

if (voiceModuleFiles.length !== 1) {
  throw new Error(`Expected one lazy voice module, found ${voiceModuleFiles.length}.`);
}

await Promise.all([
  buildBundle(coreModuleFiles, "js/app.bundle.js", "core app bundle"),
  buildBundle(voiceModuleFiles, "js/voice-score.bundle.js", "lazy voice bundle"),
]);
