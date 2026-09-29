import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

// Extract from the production stylesheet so Home's early paint and final layout
// always share one source. Keep the full sheet for every interactive screen.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const source = postcss.parse(await readFile(join(rootDir, "css/app.min.css"), "utf8"));
const sharedSelectors = new Set([
  ":root", "html", "body", "body.liquid-glass", "body.liquid-glass::before",
  "body.liquid-glass::after", "body.ios-standalone-safe-area-fallback", ".ui-icon",
  "body.liquid-glass button", "body.liquid-glass button:active",
]);
function pick(node) {
  if (node.type === "rule") {
    const selectors = node.selectors || [];
    return selectors.some(selector => sharedSelectors.has(selector.replace(/::?(before|after)\b/g, "::$1")) || /\.home[-\w]/.test(selector))
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
const critical = postcss.root({ nodes: source.nodes.map(pick).filter(Boolean) }).toString();
const htmlPath = join(rootDir, "index.html");
const html = await readFile(htmlPath, "utf8");
const pattern = /(<style id="rook-startup-styles">)[\s\S]*?(<\/style>)/;
if (!pattern.test(html)) throw new Error("index.html is missing its generated startup style slot.");
const next = html.replace(pattern, () => `<style id="rook-startup-styles">${critical}</style>`);
if (next !== html) await writeFile(htmlPath, next, "utf8");
console.log(`Inlined ${Buffer.byteLength(critical)} bytes of Home styles.`);
