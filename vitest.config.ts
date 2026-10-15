import { defineConfig } from "vitest/config";

// Unit tests (seam 3) and the Worker protocol tests (seam 2), which run the Worker in workerd.
// The browser suites in tests/e2e run under Playwright.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts", "tests/worker/**/*.test.ts"],
    globalSetup: ["tests/worker/build-once.ts"],
  },
});
