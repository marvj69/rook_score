import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postcss from "postcss";

// Remove formatting and comments without rewriting colors, selectors, values,
// rule order, or browser fallbacks. The rendered app keeps the authored styles.
const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const css = postcss.parse(await readFile(join(rootDir, "css/app.css"), "utf8"));
css.walk(node => {
  if (node.type === "comment") {
    node.remove();
    return;
  }
  node.raws.before = "";
  node.raws.after = "";
  node.raws.between = node.type === "decl" ? ":" : "";
  delete node.raws.value;
});
css.raws.after = "";
await writeFile(join(rootDir, "css/app.min.css"), `${css.toString()}\n`, "utf8");
