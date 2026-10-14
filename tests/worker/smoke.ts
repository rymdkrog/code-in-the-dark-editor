// The post-deploy smoke test: seam 2 against a deployed Worker. It connects with `Origin: null`,
// as every file:// page does, so it proves Cloudflare's edge lets Round packages in.
//
//   WORKER_URL=https://… ORGANIZER_KEY=… npm run smoke
//
// It claims a throwaway Competition under a random Join code and new secrets, so it can't touch
// a real one. Presence joins the round trip once Contestants send it (#34).

import { fileURLToPath } from "node:url";
import {
  base64url,
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  PING,
  ROLES,
  type Claim,
  type ServerMessage,
} from "../../src/protocol/protocol.ts";
import { openSocket, type TestSocket } from "./client.ts";

/** Runs every check against the Worker at `workerUrl` and returns what passed; throws on the first failure. */
export async function smoke(workerUrl: string, organizerKey: string): Promise<string[]> {
  const claim = throwawayClaim();
  const passed: string[] = [];
  const sockets: TestSocket[] = [];
  const open = async (role: (typeof ROLES)[number]) => {
    const socket = await openSocket(workerUrl, claim.joinCode, role, { Origin: "null" });
    sockets.push(socket);
    return socket;
  };
  try {
    const host = await open("host");
    host.send({ t: "claim", organizerKey, claim });
    expectMessage(await host.next(), "competition", "claiming a throwaway Competition");
    passed.push("a Host socket with Origin: null claimed a throwaway Competition");

    const later = await open("host");
    later.send({ t: "host", hostSecret: claim.hostSecret });
    expectMessage(await later.next(), "competition", "reading the claim back");
    passed.push("a second Host socket read the claim back");

    for (const role of ROLES) {
      const socket = await open(role);
      socket.send(PING);
      expectMessage(await socket.next(), "pong", `pinging the ${role} socket`);
    }
    passed.push("every role's socket answered a ping");
    return passed;
  } finally {
    for (const socket of sockets) socket.close();
  }
}

function expectMessage(message: ServerMessage, t: ServerMessage["t"], step: string) {
  if (message.t !== t) throw new Error(`${step}: expected "${t}", got ${JSON.stringify(message)}`);
}

function throwawayClaim(): Claim {
  const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));
  const joinCode = Array.from(random(JOIN_CODE_LENGTH), (byte) => JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length])
    .join("");
  return {
    competitionName: `Smoke test ${new Date().toISOString()}`,
    joinCode,
    hostSecret: base64url(random(32)),
    contestantToken: base64url(random(32)),
    rounds: [{ id: "smoketest0", name: "Smoke test" }],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const workerUrl = process.argv[2] ?? process.env.WORKER_URL;
  const organizerKey = process.env.ORGANIZER_KEY;
  if (!workerUrl || !organizerKey) {
    console.error("Usage: WORKER_URL=https://… ORGANIZER_KEY=… npm run smoke");
    process.exit(2);
  }
  try {
    for (const check of await smoke(workerUrl, organizerKey)) console.log(`✓ ${check}`);
  } catch (error) {
    console.error(`✗ Smoke test failed against ${workerUrl}: ${(error as Error).message}`);
    process.exit(1);
  }
}
