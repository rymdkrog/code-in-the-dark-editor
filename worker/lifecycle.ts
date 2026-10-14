// The Round lifecycle's transition table (spec: Round lifecycle). Pure: the Durable Object
// stores what it returns and sets the alarm for `endsAt`.

import {
  DEFAULT_DURATION_MS,
  MAX_DURATION_MS,
  type Lifecycle,
  type LifecycleCommand,
  type RoundRef,
} from "../src/protocol/protocol.ts";

export const WELCOME: Lifecycle = { current: null, phase: null, durationMs: DEFAULT_DURATION_MS, endsAt: null };

export const isLifecycleCommand = (message: { t: unknown }): message is LifecycleCommand =>
  typeof message.t === "string" && Object.hasOwn(COMMANDS, message.t);

type Transition = (from: Lifecycle, command: never, rounds: RoundRef[], now: number) => Lifecycle | null;

/** Each command's transition, or null where the table has none. A command's fields arrive
 * unchecked, so each transition checks the ones it reads. */
const COMMANDS: Record<LifecycleCommand["t"], Transition> = {
  "make-current": (from, { roundId }: { roundId: unknown }, rounds) => {
    if (roundId === from.current) return null;
    if (roundId === null) return { ...WELCOME, durationMs: from.durationMs };
    if (!rounds.some((round) => round.id === roundId)) return null;
    return { current: roundId as string, phase: "upcoming", durationMs: from.durationMs, endsAt: null };
  },
  "set-duration": (from, { durationMs }: { durationMs: unknown }) =>
    from.phase === "upcoming" &&
    typeof durationMs === "number" &&
    Number.isInteger(durationMs / 1000) &&
    durationMs >= 1000 &&
    durationMs <= MAX_DURATION_MS
      ? { ...from, durationMs }
      : null,
  start: (from, _, __, now) =>
    from.phase === "upcoming" ? { ...from, phase: "running", endsAt: now + from.durationMs } : null,
  "add-time": (from, { ms }: { ms: unknown }) =>
    from.phase === "running" && (ms === 30_000 || ms === 60_000) ? { ...from, endsAt: from.endsAt! + ms } : null,
  "end-early": (from) => (from.phase === "running" ? timesUp(from) : null),
  "open-voting": (from) => (from.phase === "timesup" ? { ...from, phase: "voting" } : null),
  "close-voting": (from) => (from.phase === "voting" ? { ...from, phase: "results" } : null),
  "reopen-voting": (from) => (from.phase === "results" ? { ...from, phase: "voting" } : null),
  "back-to-up-next": (from) =>
    from.phase === "timesup" || from.phase === "results" ? { ...from, phase: "upcoming", endsAt: null } : null,
};

/** The lifecycle after a Host's command, or null if the command isn't a transition from here. */
export function transition(from: Lifecycle, command: LifecycleCommand, rounds: RoundRef[], now: number) {
  return COMMANDS[command.t](from, command as never, rounds, now);
}

/** The running Round's time is up. */
export const timesUp = (from: Lifecycle): Lifecycle => ({ ...from, phase: "timesup", endsAt: null });
