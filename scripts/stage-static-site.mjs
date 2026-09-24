import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Copies the runtime app into a clean output directory:
//   node scripts/stage-static-site.mjs public
// Vercel serves that directory (see vercel.json) and GitHub Pages uploads it.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const staticSiteFiles = require("./static-site-files.cjs");

const outputName = process.argv[2];
if (!outputName || outputName.includes("..") || outputName.startsWith("/")) {
  throw new Error("Usage: node scripts/stage-static-site.mjs <output-directory-inside-repo>");
}
const outputDir = join(rootDir, outputName);

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
for (const relativePath of staticSiteFiles) {
  const destination = join(outputDir, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(rootDir, relativePath), destination);
}
// GitHub Pages must not run Jekyll over the output; Vercel ignores the marker.
await writeFile(join(outputDir, ".nojekyll"), "");
console.log(`Staged ${staticSiteFiles.length} files into ${outputName}/`);
