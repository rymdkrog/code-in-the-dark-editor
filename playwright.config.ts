import { defineConfig, devices } from "@playwright/test";

// Runs against the built files in dist/ — run `npm run build` first. The prep page is served
// from dist/prep/ by `vite preview`; Round packages open from file://.
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  // No retries: a request that escapes only sometimes must still fail the gate.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4179" },
  webServer: {
    command: "npx vite preview -c vite.prep.config.ts",
    url: "http://localhost:4179",
    // Never a preview server from another checkout.
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
