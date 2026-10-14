import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { editorVersion } from "./scripts/editor-version.ts";
import { enhancementScriptPlugin } from "./scripts/enhancement-script.ts";
import { licenceBannerPlugin } from "./scripts/licence-banner.ts";

// Builds the Core Editor template: one fully inlined .html with one Round slot, and two inline
// scripts, the Core's then the Enhancement's.
export default defineConfig({
  root: "src/core",
  plugins: [viteSingleFile(), enhancementScriptPlugin(), licenceBannerPlugin(editorVersion())],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    rollupOptions: { input: "src/core/core-editor.html" },
  },
});
