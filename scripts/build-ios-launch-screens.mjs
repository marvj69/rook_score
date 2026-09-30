import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

// Native iOS launch images use the manifest background. Generate compact RGB
// PNGs without external image tools, text, or a second source of theme colors.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const screens = require("./ios-launch-screens.cjs");
const { background_color: background } = JSON.parse(await readFile(join(rootDir, "manifest.json"), "utf8"));
if (!/^#[0-9a-f]{6}$/i.test(background)) throw new Error("Launch background must be a six-digit hex color.");
const rgb = Buffer.from(background.slice(1), "hex");
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const payload = Buffer.concat([Buffer.from(type), data]);
  let crc = 0xffffffff;
  for (const byte of payload) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  const result = Buffer.alloc(payload.length + 8);
  result.writeUInt32BE(data.length, 0);
  payload.copy(result, 4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
function png(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2; // Eight-bit RGB, no alpha.
  const row = Buffer.alloc(1 + width * 3);
  row.fill(rgb, 1); // Filter byte stays zero.
  const pixels = Buffer.alloc(row.length * height);
  for (let y = 0; y < height; y++) row.copy(pixels, y * row.length);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const links = [];
for (const [width, height, scale] of screens) {
  for (const orientation of ["portrait", "landscape"]) {
    const [w, h] = orientation === "portrait" ? [width * scale, height * scale] : [height * scale, width * scale];
    const href = `icons/startup-${w}x${h}.png`;
    const output = png(w, h);
    const outputPath = join(rootDir, href);
    const previous = await readFile(outputPath).catch(() => null);
    if (!previous?.equals(output)) await writeFile(outputPath, output);
    const media = `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${scale}) and (orientation: ${orientation})`;
    links.push(`  <link rel="apple-touch-startup-image" href="${href}" media="${media}" />`);
  }
}
const htmlPath = join(rootDir, "index.html");
const html = await readFile(htmlPath, "utf8");
const pattern = /  <!-- ios-launch-images:start -->[\s\S]*?  <!-- ios-launch-images:end -->/;
if (!pattern.test(html)) throw new Error("index.html is missing its iOS launch-image slot.");
const next = html.replace(pattern, () => `  <!-- ios-launch-images:start -->\n${links.join("\n")}\n  <!-- ios-launch-images:end -->`);
if (next !== html) await writeFile(htmlPath, next, "utf8");
console.log(`Generated ${links.length} iPhone launch backgrounds.`);
