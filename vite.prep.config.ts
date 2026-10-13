import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { coreTemplatePlugin } from "./scripts/core-template.ts";
import { editorVersion } from "./scripts/editor-version.ts";

// Builds the prep page into dist/prep/, with the Core Editor template beside it.
// Build the template first (vite.config.ts): it empties dist/.
export default defineConfig({
  root: "src/pages/prep",
  base: "./",
  plugins: [react(), coreTemplatePlugin()],
  define: { __EDITOR_VERSION__: JSON.stringify(editorVersion()) },
  build: { outDir: "../../../dist/prep", emptyOutDir: true },
  preview: { port: 4179, strictPort: true },
});
