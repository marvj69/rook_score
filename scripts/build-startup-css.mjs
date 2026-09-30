import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

// Include the utility foundation too: an external stylesheet before a head
// script can stop WebKit parsing before Home exists, even with inline Home CSS.
// The first screen has no external CSS dependency; interactive screens retain
// the full app stylesheet and its readiness gate.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const utilities = await readFile(join(rootDir, "css/tailwind.css"), "utf8");
const source = postcss.parse(await readFile(join(rootDir, "css/app.min.css"), "utf8"));
const sharedSelectors = new Set([
  ":root", "html", "body", "body.liquid-glass", "body.liquid-glass::before",
  "body.liquid-glass::after", "body.ios-standalone-safe-area-fallback", ".ui-icon",
  "body.liquid-glass button", "body.liquid-glass button:active",
]);
function pick(node) {
  if (node.type === "rule") {
    const selectors = node.selectors || [];
    return selectors.some(selector => sharedSelectors.has(selector.replace(/::?(before|after)\b/g, "::$1")) || /\.(home[-\w]|app-boot)/.test(selector))
      ? node.clone() : null;
  }
  if (node.type === "atrule" && node.nodes) {
    if (/keyframes$/i.test(node.name)) {
      return /^(blobFloat|blobFloatReverse|cardPopIn|homeFanIn)$/.test(node.params) ? node.clone() : null;
    }
    const children = node.nodes.map(pick).filter(Boolean);
    if (children.length) return node.clone({ nodes: children });
  }
  return null;
}
const critical = utilities + postcss.root({ nodes: source.nodes.map(pick).filter(Boolean) }).toString();
const htmlPath = join(rootDir, "index.html");
const html = await readFile(htmlPath, "utf8");
const pattern = /(<style id="rook-startup-styles">)[\s\S]*?(<\/style>)/;
if (!pattern.test(html)) throw new Error("index.html is missing its generated startup style slot.");
const next = html.replace(pattern, () => `<style id="rook-startup-styles">${critical}</style>`);
if (next !== html) await writeFile(htmlPath, next, "utf8");
console.log(`Inlined ${Buffer.byteLength(critical)} bytes of Home styles.`);
