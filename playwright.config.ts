import { defineConfig, devices } from "@playwright/test";

// Runs against the built files in dist/ — run `npm run build` first.
export default defineConfig({
  testDir: "tests/e2e",
  forbidOnly: !!process.env.CI,
  // No retries: a request that escapes only sometimes must still fail the gate.
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
