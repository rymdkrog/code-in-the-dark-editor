// The pure parts of `npm run dev:crowd`: what the fake Contestants and phones are and what they
// pick. The sockets are in dev-crowd.ts.

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import type { Competition, Round } from "../src/pages/prep/competition.ts";
import { REACTIONS, type PublicEntry, type Reaction } from "../src/protocol/protocol.ts";
import { revisionNumber, revisionOf, withCounter } from "../src/round-package/revision.ts";

export const USAGE =
  "Usage: npm run dev:crowd -- <Competition file> [--contestants N] [--phones M] [--round <name|id>] [--stale K] [--allow-remote]";

export interface CrowdArgs {
  file: string;
  contestants: number;
  phones: number;
  /** A Round's name or id, or null for the first Heat. */
  round: string | null;
  /** How many of the Contestants have an older Revision. */
  stale: number;
  allowRemote: boolean;
}

export type Problem = { problem: string };

/** The command line after `--`, or what's wrong with it in one line. */
export function parseCrowdArgs(args: string[]): CrowdArgs | Problem {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      options: {
        contestants: { type: "string", default: "4" },
        phones: { type: "string", default: "12" },
        round: { type: "string" },
        stale: { type: "string", default: "0" },
        "allow-remote": { type: "boolean", default: false },
      },
    });
  } catch (error) {
    return { problem: `${(error as Error).message.split("\n")[0]} ${USAGE}` };
  }
  const { positionals, values } = parsed;
  if (positionals.length !== 1) return { problem: USAGE };
  const counts: Record<"contestants" | "phones" | "stale", number> = { contestants: 0, phones: 0, stale: 0 };
  for (const name of ["contestants", "phones", "stale"] as const) {
    const text = values[name];
    if (!/^\d+$/.test(text)) return { problem: `--${name} takes a whole number, not ${text}.` };
    counts[name] = Number(text);
  }
  if (counts.stale > counts.contestants) {
    return { problem: `--stale ${counts.stale} is more than the ${counts.contestants} Contestants.` };
  }
  return { file: positionals[0]!, ...counts, round: values.round ?? null, allowRemote: values["allow-remote"] };
}

/** The Round named or with the id `pick`, or by default the first Heat (the first Round if there
 * are no Heats). */
export function crowdRound(competition: Competition, pick: string | null): Round | Problem {
  const { rounds } = competition;
  if (!rounds.length) return { problem: "This Competition has no Rounds." };
  if (pick === null) return rounds.find((round) => round.kind === "heat") ?? rounds[0]!;
  const round = rounds.find((round) => round.id === pick) ?? rounds.find((round) => round.name === pick);
  if (round) return round;
  const names = rounds.map((round) => round.name);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return { problem: `There's no Round "${pick}" in this Competition: it has ${list}.` };
}

const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 20);

/** Fake Contestant `i`'s seat: the same on every run against the same Round, so a restart comes
 * back as the same Roster entries. */
export const seatOf = (joinCode: string, roundId: string, i: number) => `crowd-${hash(`${joinCode}/${roundId}/${i}`)}`;

/** Fake phone `i`'s voter id: the same on every run, so a restart doesn't add Votes. */
export const voterOf = (joinCode: string, i: number) => `crowd-${hash(`${joinCode}/voter/${i}`)}`;

const NAMES = [
  "Ada Ampersand",
  "Bo Border",
  "Cy Cascade",
  "Dot Div",
  "Eve Em",
  "Flo Flexbox",
  "Gus Grid",
  "Hal Hover",
  "Ivy Inline",
  "Jo Justify",
  "Kit Keyframe",
  "Liv Linear-gradient",
  "Mo Margin",
  "Nell Nth-child",
  "Ola Opacity",
  "Pip Padding",
  "Quinn Query",
  "Rex Rgba",
  "Sid Selector",
  "Tess Transform",
  "Uma Unset",
  "Vic Viewport",
  "Wren Wrap",
  "Zed Z-index",
];

/** Fake Contestant `i`'s name: made up, readable, and the same on every run. */
export const fakeName = (i: number) =>
  i < NAMES.length ? NAMES[i]! : `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`;

/** Each fake Contestant's Revision: the Round's last, and the last `stale` of them the one before.
 * A Round with one Revision gets a made-up older one, and one never exported a made-up last one:
 * the Worker only checks the format. */
export function crowdRevisions(round: Round, contestants: number, stale: number, now = new Date()): string[] {
  const latest = round.revisions.at(-1)?.stamp ?? revisionOf(1, now);
  const older = round.revisions.at(-2)?.stamp ?? withCounter(latest, revisionNumber(latest) - 1);
  return Array.from({ length: contestants }, (_, i) => (i < contestants - stale ? latest : older));
}

/** A random emoji for a random online entry that has a laptop, or null if there is none. */
export function pickReaction(roster: PublicEntry[], random: () => number): { seat: string; e: Reaction } | null {
  const targets = roster.filter((entry) => entry.online && !entry.handAdded);
  if (!targets.length) return null;
  const e = REACTIONS[Math.floor(random() * REACTIONS.length)]!;
  return { seat: targets[Math.floor(random() * targets.length)]!.id, e };
}

/** A Vote for any entry, weighted 1/n² by its place on the Roster, so the first entry clearly
 * leads. Null on an empty Roster. */
export function pickVote(roster: PublicEntry[], random: () => number): string | null {
  const weights = roster.map((_, i) => 1 / (i + 1) ** 2);
  let left = random() * weights.reduce((a, b) => a + b, 0);
  for (const [i, weight] of weights.entries()) {
    left -= weight;
    if (left < 0) return roster[i]!.id;
  }
  return roster.at(-1)?.id ?? null;
}
