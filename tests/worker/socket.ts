// Seam 2: the Worker, run in workerd by Wrangler's test harness, driven over real sockets.

import { createTestHarness } from "wrangler";
import { V, socketPath, type Role, type ServerMessage } from "../../src/protocol/protocol.ts";

export const ORGANIZER_KEY = "test-organizer-key";

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
  /** The next message the Worker sends. */
  next(): Promise<ServerMessage>;
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
    next: () =>
      received.length
        ? Promise.resolve(received.shift()!)
        : new Promise((resolve, reject) => {
            waiting.push(resolve);
            setTimeout(() => reject(new Error("No message from the Worker within 2 s")), 2000);
          }),
    closed,
    close: () => socket.close(),
  };
}
