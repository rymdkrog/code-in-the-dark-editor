import { existsSync, readFileSync } from "node:fs";
import type { Plugin } from "vite";

const TEMPLATE = new URL("../dist/core-editor.html", import.meta.url);
const NAME = "core-editor.html";

function readTemplate(): string {
  if (!existsSync(TEMPLATE)) throw new Error("dist/core-editor.html is missing: run `npm run build` first");
  return readFileSync(TEMPLATE, "utf8");
}

/**
 * Vite plugin: puts the Core Editor template, built first by vite.config.ts, beside the prep
 * page as a static asset. The page fetches it to fill Round packages.
 */
export function coreTemplatePlugin(): Plugin {
  return {
    name: "citd:core-template",
    configureServer(server) {
      server.middlewares.use(`/${NAME}`, (_request, response) => {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(readTemplate());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: NAME, source: readTemplate() });
    },
  };
}
