import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { editorVersion } from "./scripts/editor-version.ts";

// Builds the pages the Worker serves as static assets: the Host console, the Stage and the
// Audience phone page, into dist/worker/. `wrangler dev` and `wrangler deploy` run this first.
// The dev-only control room (src/pages/dev/) is in only when CITD_CONTROL_ROOM=1, as `npm run
// worker:dev` sets it; `npm run build` and `wrangler deploy` leave it out.
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
        ...(process.env.CITD_CONTROL_ROOM === "1" && { dev: "src/pages/dev/index.html" }),
      },
    },
  },
});
