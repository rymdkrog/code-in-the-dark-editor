import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { editorVersion } from "./scripts/editor-version.ts";

// Builds the pages the Worker serves as static assets: the Host console, the Stage and the
// Audience phone page, into dist/worker/. `wrangler dev` and `wrangler deploy` run this first.
export default defineConfig({
  root: "src/pages",
  base: "/",
  plugins: [react()],
  define: { __EDITOR_VERSION__: JSON.stringify(editorVersion()) },
  build: {
    outDir: "../../dist/worker",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        host: "src/pages/host/index.html",
        stage: "src/pages/stage/index.html",
        join: "src/pages/join/index.html",
      },
    },
  },
});
