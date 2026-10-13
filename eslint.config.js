// @ts-check
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const REACT = ["react", "react-dom", "react/*", "react-dom/*"].map((name) => ({
  group: [name],
  message: "React belongs in pages/ only; the Core Editor and Enhancement are vanilla TS.",
}));

/** Forbids imports from the given top-level modules, however the relative path is spelled. */
const fromModules = (/** @type {string[]} */ modules, /** @type {string} */ message) => ({
  regex: `(^|/)(${modules.join("|")})(/|$)`,
  message,
});

export default defineConfig([
  globalIgnores(["dist/", "test-results/", "playwright-report/", ".wrangler/", ".claude/"]),
  tseslint.configs.recommended,

  // Module boundaries (spec: Modules and boundaries).
  {
    files: ["src/core/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...REACT,
            fromModules(
              ["enhancement", "pages", "protocol", "worker"],
              "The Core Editor stands alone: it imports nothing from enhancement, pages, protocol or worker.",
            ),
          ],
        },
      ],
    },
  },
  {
    files: ["src/enhancement/**"],
    rules: { "no-restricted-imports": ["error", { patterns: REACT }] },
  },
  {
    files: ["src/round-package/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            fromModules(
              ["core", "enhancement", "pages", "protocol", "worker"],
              "Round package code is shared by core, pages and the build; it depends on none of them.",
            ),
          ],
        },
      ],
      // Template filling has no DOM dependencies, so the build and a future CLI can use it.
      "no-restricted-globals": ["error", "window", "document", "navigator", "DOMParser", "localStorage"],
    },
  },
  {
    // Each file gets exactly one of these blocks: a later no-restricted-imports replaces an earlier one.
    files: ["src/**", "scripts/**"],
    ignores: ["src/core/**", "src/enhancement/**", "src/pages/**", "src/round-package/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [fromModules(["protocol"], "Only enhancement, pages and worker import protocol.")] },
      ],
    },
  },
]);
