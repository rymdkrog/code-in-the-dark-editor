// The prep page's own Host socket: it lets the Organizer claim the Competition from prep, and keeps
// the Worker's Round list and Stage copies current as Rounds are added, renamed or given a new
// Reference. It never runs the Competition: lifecycle, Roster and tally messages are the Host console's.

import { useEffect, useEffectEvent, useState } from "react";
import { connectSocket, type Socket } from "../../enhancement/socket.ts";
import { socketPath, V, type ClaimRefusal, type RoundRef, type ServerMessage, type StageCopies } from "../../protocol/protocol.ts";
import { socketOrigin } from "../../round-package/fill-template.ts";
import { claimOf, stageCopyFingerprint, workerOrigin, type Audience, type Competition } from "./competition.ts";
import { makeStageCopy, stageCopyPlan, stageCopyProblem, type StageCopyRefusal, type StageCopySync } from "./stage-copy.ts";

/** Where the Competition stands, as far as prep knows. */
export type Standing =
  /** No socket: the Audience layer is off, or the Worker URL isn't one. */
  | { kind: "off" }
  /** Not open yet, or open and waiting for the Worker to answer. */
  | { kind: "connecting" }
  /** The socket is down; it keeps retrying. */
  | { kind: "unreachable" }
  /** Nobody has claimed the Join code. `refusal` is why the last claim from prep failed. */
  | { kind: "unclaimed"; refusal: ClaimRefusal | null }
  /** Claimed with another Host secret. */
  | { kind: "refused" }
  /** Claimed with this Host secret. `rounds` is the Worker's Round list, and `leftOut` the Current
   * Round prep's newer list left out, so the Worker kept its own. */
  | { kind: "claimed"; rounds: RoundRef[]; leftOut: string | null };

export const CONNECTING: Standing = { kind: "connecting" };
const OFF: Standing = { kind: "off" };

/** What happens to the socket: it opens or goes down, or the Worker says something. */
export type SocketEvent = { t: "open" } | { t: "down" } | ServerMessage;

/** The Host socket for the Competition's Join code, built from the Worker URL the way a Round
 * package builds its own; none while the Audience layer is off or the Worker URL isn't one. */
export function hostSocketUrl({ enabled, workerUrl, joinCode }: Pick<Audience, "enabled" | "workerUrl" | "joinCode">) {
  const origin = enabled ? workerOrigin(workerUrl) : null;
  return origin ? socketOrigin(origin) + socketPath(joinCode, "host") : null;
}

export function standingAfter(standing: Standing, event: unknown): Standing {
  const message = event as SocketEvent | null;
  switch (message?.t) {
    case "open":
      return CONNECTING;
    case "down":
      return { kind: "unreachable" };
    case "unclaimed":
      return { kind: "unclaimed", refusal: null };
    case "host-refused":
      return { kind: "refused" };
    case "competition":
      return { kind: "claimed", rounds: message.competition.rounds, leftOut: null };
    case "claim-refused":
      return standing.kind === "unclaimed" ? { ...standing, refusal: message.reason } : standing;
    case "rounds-refused":
      return standing.kind === "claimed" ? { ...standing, leftOut: message.roundId } : standing;
    default:
      return standing;
  }
}

/** How long the Worker URL must stay put before prep connects to it: it changes on every keystroke. */
const SETTLE = 500;

/**
 * Holds a Host socket to the Worker while the Audience layer is on with a valid Worker URL, and
 * sends the Round list on every connect and whenever a Round is added or renamed. Changed
 * credentials, Worker URL or layer reconnect, or close the socket.
 */
export function useHostSocket(competition: Competition) {
  const { audience } = competition;
  const workerUrl = useSettled(audience.workerUrl, SETTLE);
  const url = hostSocketUrl({ ...audience, workerUrl });
  const { hostSecret } = audience;
  // The socket, and where it stands, belong to one URL and Host secret.
  const key = url && `${url} ${hostSecret}`;
  const [connection, setConnection] = useState<Connection | null>(null);
  const current = connection?.key === key ? connection : null;

  const sendRounds = (socket = current?.socket) => {
    const { hostSecret, rounds, roundsChangedAt } = claimOf(competition);
    socket?.send({ v: V, t: "host", hostSecret, rounds, roundsChangedAt });
  };
  const sendRoundsFromEffect = useEffectEvent(sendRounds);

  useEffect(() => {
    if (!url) return;
    const key = `${url} ${hostSecret}`;
    const on = (event: unknown) =>
      setConnection((was) => (was?.key === key ? { ...was, ...stageCopiesAfter(was, event), standing: standingAfter(was.standing, event) } : was));
    const socket = connectSocket(url, {
      open() {
        on({ t: "open" });
        sendRoundsFromEffect(socket);
      },
      down: () => on({ t: "down" }),
      message: on,
    });
    setConnection({ key, socket, standing: CONNECTING, held: null, sync: { sent: {}, refusals: {} }, latest: {} });
    return () => {
      socket.close();
      // Turned back on with the same URL and Host secret, it must not show the closed socket's standing.
      setConnection((was) => (was?.socket === socket ? null : was));
    };
  }, [url, hostSecret]);

  useEffect(() => sendRoundsFromEffect(), [competition.roundsChangedAt]);

  // Brings the Worker's Stage copies up to date whenever it says which it holds, or a Reference changes.
  useEffect(() => {
    if (!current?.held) return;
    const { socket, sync, latest } = current;
    const plan = stageCopyPlan(competition, current.held, sync);
    for (const roundId of plan.clear) {
      sync.sent[roundId] = latest[roundId] = null;
      socket.send({ v: V, t: "clear-stage-copy", roundId });
    }
    for (const { roundId, fingerprint, reference } of plan.set) {
      sync.sent[roundId] = latest[roundId] = fingerprint;
      makeStageCopy(reference.dataUri).then(
        // A copy made after the Reference was replaced or removed would put the old one back.
        (image) => latest[roundId] === fingerprint && socket.send({ v: V, t: "set-stage-copy", roundId, fingerprint, image }),
        () =>
          setConnection((was) => (was?.socket === socket ? refuse(was, roundId, fingerprint, "unreadable") : was)),
      );
    }
  }, [current, competition]);

  // The Worker tells nobody unadmitted about a claim, and a refused list isn't retried by itself.
  // Asking again on coming back to prep picks up a claim made on the Host console, or a Current
  // Round that has moved on.
  useEffect(() => {
    const again = () => sendRoundsFromEffect();
    addEventListener("focus", again);
    return () => removeEventListener("focus", again);
  }, []);

  return {
    standing: current?.standing ?? (key ? CONNECTING : OFF),
    /** Why a Round's Stage copy for its Reference as it is now didn't reach the Worker, or null. */
    stageCopyProblem: (roundId: string): string | null => {
      const reference = competition.rounds.find(({ id }) => id === roundId)?.reference;
      const refusal = current?.sync.refusals[roundId];
      return reference && refusal?.fingerprint === stageCopyFingerprint(reference) ? stageCopyProblem(refusal.reason) : null;
    },
    /** Sends the Round list again, say once the Current Round it left out is no longer current. */
    sendRounds: () => sendRounds(),
    /** Claims the Competition. The Organizer key goes into this one message and nowhere else. */
    claim: (organizerKey: string) =>
      current?.socket.send({ v: V, t: "claim", organizerKey, claim: claimOf(competition) }) ?? false,
  };
}

/** One socket to the Worker, and what prep knows over it. */
interface Connection {
  key: string;
  socket: Socket;
  standing: Standing;
  /** The fingerprints of the Stage copies the Worker holds, by Round id; null until it lets prep in. */
  held: StageCopies | null;
  /** Mutated in place: what has been sent is only for not sending it twice, and changes no screen. */
  sync: StageCopySync;
  /** What was last sent or about to be, by Round id, kept across `sync` resets; mutated in place. A
   * copy still being made is sent only if it is still the latest. */
  latest: Record<string, string | null>;
}

/** A Stage copy refused, by the Worker or by prep itself. */
function refuse(connection: Connection, roundId: string, fingerprint: string, reason: StageCopyRefusal): Connection {
  const refusals = { ...connection.sync.refusals, [roundId]: { fingerprint, reason } };
  return { ...connection, sync: { ...connection.sync, refusals } };
}

/** What the socket event changes about the Stage copies the Worker holds. */
function stageCopiesAfter(connection: Connection, event: unknown): Partial<Connection> {
  const message = event as SocketEvent | null;
  switch (message?.t) {
    // Nothing is sent until the Worker lets prep in again and says what it holds.
    case "open":
    case "down":
      return { held: null };
    case "competition": {
      // Everything is checked again against what it holds now. A Round it didn't list, or a
      // socket it hadn't let in, may be fine now; a copy it found too big or not an image isn't.
      const refusals = Object.fromEntries(
        Object.entries(connection.sync.refusals).filter(([, { reason }]) => reason !== "invalid" && reason !== "host-secret"),
      );
      return { held: message.stageCopies ?? {}, sync: { sent: {}, refusals } };
    }
    case "stage-copies":
      return { held: message.stageCopies };
    case "refused": {
      // A refused copy stays in `sent`, so it isn't sent again; its refusal says so.
      const { roundId, command, reason } = message;
      const fingerprint = roundId === undefined ? null : connection.sync.sent[roundId];
      return command === "set-stage-copy" && fingerprint ? refuse(connection, roundId!, fingerprint, reason) : {};
    }
    default:
      return {};
  }
}

/** The value once it has stayed the same for `ms`. The first value is settled already. */
function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

/** The prep page's Host socket, as the Audience pane uses it. */
export type HostConnection = ReturnType<typeof useHostSocket>;
