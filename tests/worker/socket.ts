// Seam 2: the Worker, run in workerd by Wrangler's test harness, driven over real sockets.

import { createTestHarness } from "wrangler";
import { JOIN_CODE_ALPHABET, type Claim, type Role } from "../../src/protocol/protocol.ts";
import { openSocket, type TestSocket } from "./client.ts";

export type { TestSocket };

export const ORGANIZER_KEY = "test-organizer-key";

let codes = 0;

/** A fresh claim with its own Join code, so tests don't share a Durable Object. Each test file
 * passes its own two-letter prefix. */
export function newClaim(prefix: string): Claim {
  const n = codes++;
  const joinCode = `${prefix}${JOIN_CODE_ALPHABET[Math.floor(n / JOIN_CODE_ALPHABET.length)]}${JOIN_CODE_ALPHABET[n % JOIN_CODE_ALPHABET.length]}AA`;
  return {
    competitionName: "Gothenburg 2026",
    joinCode,
    hostSecret: `host-secret-${joinCode}`,
    contestantToken: `contestant-token-${joinCode}`,
    rounds: [
      { id: "heat1aaaaa", name: "Heat 1" },
      { id: "heat2aaaaa", name: "Heat 2" },
      { id: "finalaaaaa", name: "Final" },
    ],
  };
}

export function startWorker() {
  return createTestHarness({
    root: new URL("../..", import.meta.url).pathname,
    workers: [{ configPath: "wrangler.toml", secrets: { ORGANIZER_KEY } }],
  });
}

export type Worker = ReturnType<typeof startWorker>;

export async function connect(
  worker: Worker,
  joinCode: string,
  role: Role,
  headers: Record<string, string> = { Origin: "null" },
): Promise<TestSocket> {
  const { url } = await worker.listen();
  return openSocket(url.href, joinCode, role, headers);
}
