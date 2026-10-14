import { build, type Plugin, type Rollup } from "vite";

const ENTRY = new URL("../src/enhancement/main.ts", import.meta.url).pathname;

/** The Enhancement, bundled on its own into one classic script. */
async function bundleEnhancement(): Promise<string> {
  const result = (await build({
    configFile: false,
    logLevel: "warn",
    build: {
      write: false,
      minify: true,
      rollupOptions: { input: ENTRY, output: { format: "iife" } },
    },
  })) as Rollup.RollupOutput[] | Rollup.RollupOutput;
  const [output] = Array.isArray(result) ? result : [result];
  const chunk = output!.output.find((file) => file.type === "chunk");
  if (!chunk) throw new Error("The Enhancement bundle is empty");
  if (/<\/script/i.test(chunk.code)) throw new Error("The Enhancement would end its inline <script> early");
  return chunk.code;
}

/**
 * Vite plugin: adds the Enhancement to the Core Editor template as its own inline `<script>`,
 * after the Core's, so a syntax error or top-level throw in one doesn't stop the other. Unlike
 * the Core's module script it runs as the page is parsed, so it is listening before the Core
 * publishes anything.
 */
export function enhancementScriptPlugin(): Plugin {
  return {
    name: "citd:enhancement-script",
    enforce: "post",
    async generateBundle(_options, bundle) {
      const script = `<script>${await bundleEnhancement()}</script>\n`;
      for (const file of Object.values(bundle)) {
        if (file.type === "asset" && file.fileName.endsWith(".html")) {
          const html = String(file.source);
          if (!html.includes("</body>")) throw new Error(`${file.fileName} has no </body> for the Enhancement`);
          file.source = html.replace("</body>", () => `${script}</body>`);
        }
      }
    },
  };
}
