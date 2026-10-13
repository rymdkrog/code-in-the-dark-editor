import { defineConfig } from "vitest/config";

// Unit tests only (seam 3). The browser suites in tests/e2e run under Playwright.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
