import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { editorVersion } from "./scripts/editor-version.ts";
import { licenceBannerPlugin } from "./scripts/licence-banner.ts";

// Builds the Core Editor template: one fully inlined .html with one Round slot.
export default defineConfig({
  root: "src/core",
  plugins: [viteSingleFile(), licenceBannerPlugin(editorVersion())],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: { input: "src/core/core-editor.html" },
  },
});
