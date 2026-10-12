// PROTOTYPE — inlines ACE + font into one double-clickable power-mode-prototype.html
import { readFileSync, writeFileSync } from "node:fs";

const here = (p) => new URL(p, import.meta.url);
const ace = ["ace.js", "mode-html.js", "theme-vibrant_ink.js", "ext-searchbox.js"]
  .map((f) => readFileSync(here(`node_modules/ace-builds/src-min-noconflict/${f}`), "utf8"))
  .join("\n;\n")
  .replaceAll("</script", "<\\/script");
const font = readFileSync(
  here("node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2"),
).toString("base64");

const out = readFileSync(here("template.html"), "utf8")
  .replace("/*__ACE__*/", () => ace)
  .replace("__FONT__", () => font);
writeFileSync(here("power-mode-prototype.html"), out);
console.log(`power-mode-prototype.html — ${(out.length / 1024).toFixed(0)} KB`);
