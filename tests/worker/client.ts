// A WebSocket client for the Worker's protocol, in plain Node: the seam-2 tests and the
// post-deploy smoke test both drive the Worker through it.

import { V, socketPath, type Role, type ServerMessage } from "../../src/protocol/protocol.ts";

/** A real WebSocket to the Worker, with the messages it has received queued up for `next()`. */
export interface TestSocket {
  send(message: object | string): void;
  /** The next message the Worker sends, within `within` ms (2 s by default). */
  next(within?: number): Promise<ServerMessage>;
  /** Resolves with the close code once the Worker closes the socket. */
  closed: Promise<number>;
  close(): void;
}

/** Opens a Competition's socket for one role on the Worker at `workerUrl` (http or https). */
export async function openSocket(
  workerUrl: string,
  joinCode: string,
  role: Role,
  headers: Record<string, string> = { Origin: "null" },
): Promise<TestSocket> {
  const socket = new WebSocket(new URL(socketPath(joinCode, role), workerUrl.replace(/^http/, "ws")), {
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
            setTimeout(() => {
              // Gives up its place, so the next message goes to the next `next()`.
              const at = waiting.indexOf(resolve);
              if (at === -1) return;
              waiting.splice(at, 1);
              reject(new Error(`No message from the Worker within ${within} ms`));
            }, within);
          }),
    closed,
    close: () => socket.close(),
  };
}
