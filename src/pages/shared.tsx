// Small pieces the prep page and the Worker's pages share.

import { useEffect, useReducer, useState } from "react";
import type { ClaimRefusal, Lifecycle, Phase, Tally } from "../protocol/protocol.ts";
import { EDITOR_VERSION } from "./version.ts";

export const VersionFooter = ({ className }: { className?: string }) => (
  <footer className={className}>Code in the Dark editor {EDITOR_VERSION}</footer>
);

/** Copies text to the clipboard, and says so for a moment. */
export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className={className} onClick={copy}>
      {copied ? "Copied" : label}
    </button>
  );
}

/** A secret's first characters, enough to tell two apart, and the rest masked. */
export const maskSecret = (secret: string) => `${secret.slice(0, 4)}${"•".repeat(16)}`;

const CLAIM_REFUSALS: Record<ClaimRefusal, string> = {
  "organizer-key": "That Organizer key is wrong.",
  "no-organizer-key": "This Worker has no Organizer key set, so nothing can be claimed. Set the ORGANIZER_KEY secret on the Worker.",
  claimed:
    "This Join code is already claimed with another Host secret. Use the Host console link of the Competition that claimed it.",
  invalid: "This link's claim is incomplete. Copy the Host console link from the prep page again.",
};

/** Why the Worker refused a claim, worded the same on the prep page and the Host console. */
export const claimRefusal = (reason: ClaimRefusal) => CLAIM_REFUSALS[reason] ?? CLAIM_REFUSALS.invalid;

/** How many phones voted: each counts once. */
export const turnoutOf = (tally: Tally) => Object.values(tally).reduce((sum, n) => sum + n, 0);

export const votesWord = (n: number) => (n === 1 ? "vote" : "votes");
/** "1 vote", "3 votes". */
export const voteCount = (n: number) => `${n} ${votesWord(n)}`;

/** An entry's votes in a tally, whether it leads (the most votes, if anyone voted), and its
 * votes as a share of the leaders'. */
export function entryVotes(tally: Tally, seat: string) {
  const most = Math.max(0, ...Object.values(tally));
  const count = tally[seat] ?? 0;
  return { count, lead: most > 0 && count === most, share: most ? count / most : 0 };
}

export const PHASE_LABELS: Record<Phase, string> = {
  upcoming: "Up next",
  running: "Running",
  timesup: "Time's up",
  voting: "Voting",
  results: "Results",
};

export const PhaseChip = ({ phase }: { phase: Phase }) => (
  <span className={`chip ph-${phase}`}>{PHASE_LABELS[phase]}</span>
);

/** The Round clock: the time left while running, counted from `endsAt` so it keeps going while
 * offline; the duration while up next; and 00:00 once time is up. Amber in the last minute, red
 * or pink (the page's CSS decides) in the last 10 s. */
export function RoundClock({ lifecycle, className }: { lifecycle: Lifecycle; className: string }) {
  const { text, urgency } = useRoundClock(lifecycle);
  return (
    <div className={`clock ${className} ${urgency}`} role="timer" aria-label="Clock">
      {text}
    </div>
  );
}

function useRoundClock(lifecycle: Lifecycle) {
  const [, tick] = useReducer((ticks: number) => ticks + 1, 0);
  const running = lifecycle.phase === "running";
  useEffect(() => {
    if (!running) return;
    const ticking = setInterval(tick, 200);
    return () => clearInterval(ticking);
  }, [running]);

  const left = running
    ? Math.max(0, lifecycle.endsAt! - Date.now())
    : lifecycle.phase === "upcoming"
      ? lifecycle.durationMs
      : 0;
  const urgency = !running ? "" : left <= 10_000 ? "last-ten" : left <= 60_000 ? "last-min" : "";
  return { text: formatClock(left), urgency };
}

/** mm:ss, rounding up, so the clock shows 00:00 only once time is up. */
export function formatClock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
