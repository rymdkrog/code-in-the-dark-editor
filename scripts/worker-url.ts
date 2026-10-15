// The Worker URL guard the dev scripts share: they run against a local `wrangler dev`, never the
// e2e Worker, and against anything else only when asked to.

import { workerOrigin } from "../src/pages/prep/competition.ts";
import { WORKER_PORT as E2E_WORKER_PORT } from "../tests/e2e/worker.ts";

/** Why a dev script won't use the Worker at `workerUrl`, or null if it will. */
export function refusal(workerUrl: string, allowRemote: boolean): string | null {
  if (!workerOrigin(workerUrl)) return `Refusing ${workerUrl}: the Worker URL isn't an http(s) URL.`;
  const { hostname, port } = new URL(workerUrl);
  if (port === String(E2E_WORKER_PORT)) {
    return `Refusing ${workerUrl}: that's the port \`npm run test:e2e\` runs its Worker on.`;
  }
  if (!allowRemote && hostname !== "localhost" && hostname !== "127.0.0.1") {
    return `Refusing ${workerUrl}: it isn't local. Pass --allow-remote to use it anyway.`;
  }
  return null;
}
