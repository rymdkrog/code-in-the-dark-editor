// Builds the Worker once for the whole run. Left to itself, the test harness runs the
// `[build]` step in every test file at once, and the parallel builds race on dist/worker/.

import { execFileSync } from "node:child_process";

export const PREBUILT_WORKER_DIR = ".wrangler/test-worker";

export default function setup() {
  execFileSync("npx", ["wrangler", "deploy", "--dry-run", "--outdir", PREBUILT_WORKER_DIR], { stdio: "ignore" });
}
