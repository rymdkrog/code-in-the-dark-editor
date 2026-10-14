// The hand-written reconnecting socket, used by the Enhancement and the Worker's pages.
// It never throws and never logs, and it keeps no queue: a message sent while the socket is
// down is dropped, because a stale message is worthless.

import { CLOSE_VERSION, PING, PONG } from "../protocol/protocol.ts";

const PING_EVERY = 25_000;
/** Silence this long means a half-open socket (a Wi-Fi change, say), or a handshake that hangs:
 * drop it and reconnect. */
const SILENCE = 60_000;
const FIRST_DELAY = 1_000;
const MAX_DELAY = 30_000;
/** A socket that stayed open this long was a real connection, so the backoff starts over. One
 * that closes sooner (refused presence, a server that closes at once) keeps backing off. */
const STABLE = 10_000;

export interface SocketHandlers {
  /** Connected, after the first connect and after every reconnect. */
  open?(): void;
  /** A message from the Worker, parsed but not checked. */
  message?(message: unknown): void;
  /** The connection was lost; it will retry unless the Worker refused the protocol version. */
  down?(): void;
}

export interface Socket {
  /** Sends now, or drops the message if the socket isn't open. Returns whether it was sent. */
  send(message: object): boolean;
  /** Disconnects for good. */
  close(): void;
}

export function connectSocket(url: string, on: SocketHandlers): Socket {
  let socket: WebSocket | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let heard = 0;
  let openedAt: number | undefined;
  let delay = FIRST_DELAY;
  let stopped = false;

  const call = <T>(handler: ((arg: T) => void) | undefined, arg: T) => {
    try {
      handler?.(arg);
    } catch {
      // A broken handler must not break the socket.
    }
  };

  function open() {
    try {
      if (stopped || socket) return;
      if (navigator.onLine === false) return addEventListener("online", open, { once: true });
      const ws = (socket = new WebSocket(url));
      heard = Date.now();
      openedAt = undefined;
      heartbeat = setInterval(beat, PING_EVERY);
      ws.onopen = () => {
        openedAt = heard = Date.now();
        call(on.open, undefined);
      };
      ws.onmessage = (event) => {
        heard = Date.now();
        if (event.data === PONG) return;
        try {
          call(on.message, JSON.parse(event.data as string) as unknown);
        } catch {
          // Not JSON: ignored.
        }
      };
      // An error is always followed by close.
      ws.onerror = () => {};
      ws.onclose = (event) => {
        if (event.code === CLOSE_VERSION) stopped = true;
        drop(ws);
      };
    } catch {
      socket = undefined;
      retry();
    }
  }

  function beat() {
    try {
      if (Date.now() - heard > SILENCE) drop(socket);
      else if (socket?.readyState === WebSocket.OPEN) socket.send(PING);
    } catch {
      drop(socket);
    }
  }

  /** Forgets a socket that has closed or gone silent, and schedules a reconnect. */
  function drop(ws: WebSocket | undefined) {
    try {
      if (!ws || ws !== socket) return;
      clearInterval(heartbeat);
      socket = undefined;
      if (openedAt !== undefined && Date.now() - openedAt >= STABLE) delay = FIRST_DELAY;
      ws.onopen = ws.onmessage = ws.onclose = null;
      ws.close();
    } catch {
      // Already closed.
    }
    call(on.down, undefined);
    retry();
  }

  function retry() {
    try {
      if (stopped) return;
      // Jittered, so a room of clients doesn't reconnect at once after a deploy.
      setTimeout(open, Math.min(MAX_DELAY, delay * (1 + Math.random())));
      delay = Math.min(MAX_DELAY, delay * 2);
    } catch {
      // Nothing to retry with.
    }
  }

  open();

  return {
    send(message) {
      try {
        if (socket?.readyState !== WebSocket.OPEN) return false;
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
    close() {
      stopped = true;
      const ws = socket;
      socket = undefined;
      clearInterval(heartbeat);
      try {
        ws?.close();
      } catch {
        // Already closed.
      }
    },
  };
}
