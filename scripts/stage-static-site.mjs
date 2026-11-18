import { cp, lstat, mkdir, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Copies the runtime app into a clean output directory:
//   node scripts/stage-static-site.mjs public
// Vercel serves that directory (see vercel.json) and GitHub Pages uploads it.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const staticSiteFiles = require("./static-site-files.cjs");

const outputName = process.argv[2];
if (!outputName || isAbsolute(outputName)
    || outputName.split(/[\\/]/).some(part => !part || part.startsWith("."))) {
  throw new Error("Use a named output directory inside the repository.");
}
const outputDir = join(rootDir, outputName);
// Never remove a source tree, unrelated output, or a directory reached through a symlink.
let parent = dirname(outputDir);
while (!(await lstat(parent).catch(() => null))) parent = dirname(parent);
if (await realpath(parent) !== parent) throw new Error("The output directory must be inside the repository.");
const target = await lstat(outputDir).catch(error => {
  if (error.code !== "ENOENT") throw error;
  return null;
});
if (target) {
  if (!target.isDirectory()) throw new Error("The staging destination must be a directory.");
  const allowed = new Set([".nojekyll", ...staticSiteFiles]);
  for (const name of staticSiteFiles) {
    for (let dir = dirname(name); dir !== "."; dir = dirname(dir)) allowed.add(dir);
  }
  const entries = await readdir(outputDir, { recursive: true, withFileTypes: true });
  const isPriorBuild = entries.some(entry => entry.name === ".nojekyll" && entry.isFile() && (entry.parentPath || entry.path) === outputDir);
  if (entries.length && (!isPriorBuild || entries.some(entry => entry.isSymbolicLink()
      || !allowed.has(relative(outputDir, join(entry.parentPath || entry.path, entry.name)).split(sep).join("/"))))) {
    throw new Error("The destination contains files outside a Rook Score build.");
  }
  await rm(outputDir, { recursive: true });
}
await mkdir(outputDir, { recursive: true });
for (const relativePath of staticSiteFiles) {
  const destination = join(outputDir, relativePath);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(rootDir, relativePath), destination);
}
// GitHub Pages must not run Jekyll over the output; Vercel ignores the marker.
await writeFile(join(outputDir, ".nojekyll"), "");
console.log(`Staged ${staticSiteFiles.length} files into ${outputName}/`);
