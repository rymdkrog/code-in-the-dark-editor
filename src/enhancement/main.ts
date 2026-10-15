// The Enhancement inside a Round package. It is its own inline script after the Core's, so a
// throw in either never stops the other. It reads the Round data itself, starts once the editor
// is interactive, and puts this laptop on the Round's Roster: it sends presence only, never
// code, Combo or Power Mode. It receives Reactions only, and floats them up the screen. Without
// a Worker URL it never opens a socket.
//
// Every entry point is wrapped in try/catch, and nothing here touches the console or the page
// beyond the Reaction overlay: whatever the Worker does, the Contestant notices nothing else.

import { NAME_CHANGED, SEAT, TWO_TAB_BLOCKED } from "../round-package/events.ts";
import { socketOrigin } from "../round-package/fill-template.ts";
import type { RoundData } from "../round-package/round-data.ts";
import { isReaction, socketPath, V } from "../protocol/protocol.ts";
import { reactionOverlay } from "./reactions.ts";
import { connectSocket, type Socket } from "./socket.ts";

/** Waits this long at most for the browser to be idle. */
const IDLE_WITHIN_MS = 2000;

let round: RoundData | null = null;
let name: string | null = null;
let seat: string | null = null;
let blocked = false;
let socket: Socket | null = null;
const reactions = reactionOverlay();

/** Wraps an entry point so nothing it throws gets out. */
const guarded =
  <A extends unknown[]>(entry: (...args: A) => void) =>
  (...args: A) => {
    try {
      entry(...args);
    } catch {
      // The Contestant never notices the Enhancement failing.
    }
  };

/** The detail of one of the Core's events, if it is a string. */
const detail = (event: Event) => {
  const value: unknown = (event as CustomEvent).detail;
  return typeof value === "string" ? value : null;
};

const start = guarded(() => {
  round = readRound();
  connect();
});

/** Connects once the Round has a Worker URL and the Core has said who this laptop is. */
function connect() {
  const audience = round?.audience;
  if (!audience || blocked || socket || !seat || !name) return;
  // The origin the package's CSP lets it connect to.
  const url = socketOrigin(audience.workerUrl) + socketPath(audience.joinCode, "contestant");
  socket = connectSocket(url, { open: sendPresence, message: react });
}

/** The only message the laptop acts on: a Reaction, which floats up if it is one of the four
 * emoji. Anything else is ignored. */
function react(message: unknown) {
  const e = (message as { t?: unknown; e?: unknown } | null)?.t === "react" && (message as { e: unknown }).e;
  if (isReaction(e)) reactions.add(e);
}

/** Presence only: name, Round id, seat and Revision, with the Contestant token. */
function sendPresence() {
  if (!round?.audience || !seat || !name) return;
  const { roundId, revision } = round;
  socket?.send({ v: V, t: "presence", token: round.audience.contestantToken, roundId, seat, name, revision });
}

function readRound(): RoundData | null {
  const slot = document.getElementById("round");
  return slot?.textContent?.trim() ? (JSON.parse(slot.textContent) as RoundData) : null;
}

try {
  // Listening starts at once: the Core publishes as it starts, before the browser is idle.
  addEventListener(
    SEAT,
    guarded((event: Event) => {
      seat = detail(event);
      connect();
    }),
  );
  addEventListener(
    NAME_CHANGED,
    guarded((event: Event) => {
      name = detail(event);
      if (socket) sendPresence();
      else connect();
    }),
  );
  addEventListener(
    TWO_TAB_BLOCKED,
    guarded(() => {
      blocked = true;
      socket?.close();
    }),
  );
  if (typeof requestIdleCallback === "function") requestIdleCallback(start, { timeout: IDLE_WITHIN_MS });
  else setTimeout(start, IDLE_WITHIN_MS);
} catch {
  // An Enhancement that can't start stays out of the way.
}
