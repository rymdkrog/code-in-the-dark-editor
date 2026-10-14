// Seam 2: the Worker, run in workerd by Wrangler's test harness, driven over real sockets.

import { createTestHarness } from "wrangler";
import { JOIN_CODE_ALPHABET, V, socketPath, type Claim, type Role, type ServerMessage } from "../../src/protocol/protocol.ts";

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

/** A real WebSocket to the Worker, with the messages it has received queued up for `next()`. */
export interface TestSocket {
  send(message: object | string): void;
  /** The next message the Worker sends, within `within` ms (2 s by default). */
  next(within?: number): Promise<ServerMessage>;
  /** Resolves with the close code once the Worker closes the socket. */
  closed: Promise<number>;
  close(): void;
}

export async function connect(
  worker: Worker,
  joinCode: string,
  role: Role,
  headers: Record<string, string> = { Origin: "null" },
): Promise<TestSocket> {
  const { url } = await worker.listen();
  const socket = new WebSocket(new URL(socketPath(joinCode, role), url.href.replace(/^http/, "ws")), {
    headers,
  } as unknown as string[]);
  const received: ServerMessage[] = [];
  const waiting: ((message: ServerMessage) => void)[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    const waiter = waiting.shift();
    if (waiter) waiter(message);
    else received.push(message);
  });
  const closed = new Promise<number>((resolve) => socket.addEventListener("close", (event) => resolve(event.code)));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error(`Couldn't connect to ${socketPath(joinCode, role)}`)));
  });
  return {
    send: (message) => socket.send(typeof message === "string" ? message : JSON.stringify({ v: V, ...message })),
    next: (within = 2000) =>
      received.length
        ? Promise.resolve(received.shift()!)
        : new Promise((resolve, reject) => {
            waiting.push(resolve);
            setTimeout(() => reject(new Error(`No message from the Worker within ${within} ms`)), within);
          }),
    closed,
    close: () => socket.close(),
  };
}
