import { defineConfig, devices } from "@playwright/test";
import { WORKER_ORGANIZER_KEY, WORKER_PORT, WORKER_URL } from "./tests/e2e/worker.ts";

// Runs against the built files in dist/ — run `npm run build` first. The prep page is served
// from dist/prep/ by `vite preview`; Round packages open from file://. The Worker and its pages
// run under `wrangler dev`, which builds the pages itself.
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  // No retries: a request that escapes only sometimes must still fail the gate.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: "http://localhost:4179" },
  // Never a server from another checkout.
  webServer: [
    {
      command: "npx vite preview -c vite.prep.config.ts",
      url: "http://localhost:4179",
      reuseExistingServer: false,
    },
    {
      command: `npx wrangler dev --port ${WORKER_PORT} --var ORGANIZER_KEY:${WORKER_ORGANIZER_KEY} --show-interactive-dev-session=false`,
      url: `${WORKER_URL}/host/`,
      reuseExistingServer: false,
      // CITD_CONTROL_ROOM puts the dev-only control room in the pages wrangler builds.
      env: { WRANGLER_SEND_METRICS: "false", CITD_CONTROL_ROOM: "1" },
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
