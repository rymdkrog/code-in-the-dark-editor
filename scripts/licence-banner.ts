import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

const BOM = "﻿";

const read = (path: string) => readFileSync(new URL(`../node_modules/${path}`, import.meta.url), "utf8").trim();

/**
 * The comment block every built .html starts with. A file that travels over AirDrop has no
 * sibling LICENSES.txt, so the ACE and Press Start 2P licences travel inside it.
 */
export function licenceBanner(version: string): string {
  const ace = JSON.parse(read("ace-builds/package.json")) as { version: string };
  const text = `
Code in the Dark Editor ${version}
https://github.com/rymdkrog/code-in-the-dark-editor (BSD-3-Clause)
Not affiliated with or endorsed by Tictail or Code in the Dark.

This file includes third-party software under these licences.

== ACE ${ace.version} (https://github.com/ajaxorg/ace) ==

${read("ace-builds/LICENSE")}

== Press Start 2P font (https://github.com/codeman38/PressStart2P) ==

${read("@fontsource/press-start-2p/LICENSE")}
`;
  if (/--!?>/.test(text)) throw new Error("A licence text would end the comment block early");
  return `<!--${text}-->\n`;
}

/** Vite plugin: starts every emitted .html with a byte order mark and the licence banner. */
export function licenceBannerPlugin(version: string): Plugin {
  return {
    name: "citd:licence-banner",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === "asset" && file.fileName.endsWith(".html")) {
          // The banner pushes <meta charset> past the 1024-byte encoding prescan,
          // so the byte order mark is what keeps the file UTF-8 from file://.
          file.source = BOM + licenceBanner(version) + String(file.source);
        }
      }
    },
  };
}
