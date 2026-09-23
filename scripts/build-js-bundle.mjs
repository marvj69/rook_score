import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "terser";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const moduleFiles = require("./app-module-files.cjs");
// Voice modules load lazily, in this order, as one bundle.
const lazyVoiceModulePaths = ["js/modules/09-voice-tools.js", "js/modules/09-voice-scoring.js"];

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

  // Classic scripts share globals with inline HTML handlers and the lazy voice
  // bundle. Only shorten local names; never rename or remove that public surface.
  const result = await minify(`${banner}${chunks.join("")}`, {
    module: false,
    toplevel: false,
    compress: { toplevel: false },
    mangle: { toplevel: false },
    keep_fnames: true,
    format: {
      comments: false,
      preamble: `// Generated ${description} by scripts/build-js-bundle.mjs. Edit source modules instead.`,
    },
  });
  if (!result.code) throw new Error(`Empty bundle: ${outputPath}`);
  await writeFile(join(rootDir, outputPath), `${result.code}\n`, "utf8");
}

const coreModuleFiles = moduleFiles.filter(relativePath => !lazyVoiceModulePaths.includes(relativePath));
const voiceModuleFiles = moduleFiles.filter(relativePath => lazyVoiceModulePaths.includes(relativePath));

if (voiceModuleFiles.join() !== lazyVoiceModulePaths.join()) {
  throw new Error(`Expected lazy voice modules ${lazyVoiceModulePaths.join(", ")}, found ${voiceModuleFiles.join(", ")}.`);
}

await Promise.all([
  buildBundle(coreModuleFiles, "js/app.bundle.js", "core app bundle"),
  buildBundle(voiceModuleFiles, "js/voice-score.bundle.js", "lazy voice bundle"),
]);
