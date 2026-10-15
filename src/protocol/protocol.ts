// The Audience layer's wire protocol, shared by the Worker, the Enhancement and the pages.
// Every message is JSON and carries the protocol version `v`.

import { isNewerRevision } from "../round-package/revision.ts";

/** Bump only on breaking changes. The Worker accepts this and the previous version. */
export const V = 1;

/** The Worker closes a socket whose message carries a `v` it doesn't accept. Clients stop reconnecting. */
export const CLOSE_VERSION = 4001;

/** The Worker closes a Contestant socket whose presence comes before the claim. Clients retry,
 * so a laptop opened early appears once the Host claims. */
export const CLOSE_UNCLAIMED = 4002;
/** The Worker closes a Contestant socket whose presence lacks the Competition's Contestant token. */
export const CLOSE_TOKEN = 4003;

/** The app-level heartbeat. The Durable Object answers it without waking (`setWebSocketAutoResponse`). */
export const PING = JSON.stringify({ v: V, t: "ping" });
export const PONG = JSON.stringify({ v: V, t: "pong" });

/** Join codes avoid characters that are easy to confuse: no 0/O, no 1/I/L. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 6;

export const isJoinCode = (code: string) => new RegExp(`^[${JOIN_CODE_ALPHABET}]{${JOIN_CODE_LENGTH}}$`).test(code);

export const ROLES = ["host", "stage", "phone", "contestant"] as const;
export type Role = (typeof ROLES)[number];

/** The path of a Competition's socket for one role, e.g. `/socket/K7XQ2N/host`. */
export const socketPath = (joinCode: string, role: Role) => `/socket/${joinCode}/${role}`;

/** The Join code and role in a socket path, or null if the path isn't one. */
export function parseSocketPath(pathname: string): { joinCode: string; role: Role } | null {
  const [, joinCode = "", role = ""] = /^\/socket\/([^/]+)\/([^/]+)$/.exec(pathname) ?? [];
  return isJoinCode(joinCode) && ROLES.includes(role as Role) ? { joinCode, role: role as Role } : null;
}

/** base64url without padding, as used by the claim link and the minted secrets. */
export const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

export interface RoundRef {
  id: string;
  name: string;
}

/** What the Host console link carries in its `#fragment`, minted by the prep page. */
export interface Claim {
  competitionName: string;
  joinCode: string;
  hostSecret: string;
  contestantToken: string;
  rounds: RoundRef[];
}

/** What every Host sees of a claimed Competition. */
export interface CompetitionSummary {
  name: string;
  joinCode: string;
  rounds: RoundRef[];
}

export type ClaimRefusal =
  /** The Organizer key is wrong. */
  | "organizer-key"
  /** The Worker has no Organizer key set, so nothing can be claimed. */
  | "no-organizer-key"
  /** The Join code is already claimed with another Host secret. */
  | "claimed"
  /** The claim is missing a field. */
  | "invalid";

/** The phases of the Current Round, in the order the Host steps through them. `upcoming` is
 * "up next". The Reveal is not a phase: the Worker never knows about it. */
export const PHASES = ["upcoming", "running", "timesup", "voting", "results"] as const;
export type Phase = (typeof PHASES)[number];

/** A Round's duration until the Host sets another. */
export const DEFAULT_DURATION_MS = 15 * 60_000;
/** The Worker accepts any whole number of seconds up to this; the Host console sets whole minutes. */
export const MAX_DURATION_MS = 90 * 60_000;

/** The Current Round and where it is. The Durable Object stores it; every Host gets it. */
export interface Lifecycle {
  /** The Current Round's id, or null for the welcome screen. */
  current: string | null;
  /** Null exactly when there is no Current Round. */
  phase: Phase | null;
  /** How long a Round runs once started. Set while up next, and kept from Round to Round. */
  durationMs: number;
  /** When a running Round's time is up, in epoch ms. Set only while running. */
  endsAt: number | null;
}

/** The Host's lifecycle commands. Each needs a socket that has shown the Host secret. */
export type LifecycleCommand =
  /** Makes a Round current, up next; null clears to the welcome screen. */
  | { t: "make-current"; roundId: string | null }
  /** Whole seconds, up to 90 min. The Host console sets whole minutes. */
  | { t: "set-duration"; durationMs: number }
  | { t: "start" }
  | { t: "add-time"; ms: 30_000 | 60_000 }
  | { t: "end-early" }
  | { t: "open-voting" }
  | { t: "close-voting" }
  | { t: "reopen-voting" }
  | { t: "back-to-up-next" };

/** The Host's Roster commands. Each needs a socket that has shown the Host secret. */
export type RosterCommand =
  /** Adds a Contestant whose laptop never connects: votable, but it gets no Reactions. */
  | { t: "add-by-hand"; roundId: string; name: string }
  /** Removes an entry. If its laptop is still connected, it stays hidden for the rest of the Round. */
  | { t: "remove-entry"; roundId: string; seat: string };

/** Every command a Host sends once it is in. */
export type HostCommand = LifecycleCommand | RosterCommand;

export type CommandRefusal =
  /** The socket hasn't shown the Host secret. */
  | "host-secret"
  /** The command isn't a transition from where the Current Round is, or its fields are invalid. */
  | "transition"
  /** A Roster command names a Round or entry that isn't there, or an empty name. */
  | "invalid";

export type HostMessage =
  /** Sent on every connect: who this Host is. */
  | { v: number; t: "host"; hostSecret: string }
  /** Claims an unclaimed Competition. The Organizer key is a Worker secret that nothing stores. */
  | { v: number; t: "claim"; organizerKey: string; claim: Claim }
  | ({ v: number } & HostCommand);

/** What a Contestant's laptop says about itself: everything the Roster knows of it. */
export interface Presence {
  /** The Round id in the laptop's Round package. */
  roundId: string;
  /** Random, minted once per laptop per Round. */
  seat: string;
  name: string;
  revision: string;
}

/** The four emoji an Audience member can send a Contestant. The set is fixed by the software. */
export const REACTIONS = ["🔥", "👏", "😂", "😱"] as const;
export type Reaction = (typeof REACTIONS)[number];
export const isReaction = (e: unknown): e is Reaction => REACTIONS.includes(e as Reaction);

/** The phases in which phones may react: up next, running and time's up. */
export const REACTION_PHASES: readonly Phase[] = ["upcoming", "running", "timesup"];

/** A phone's random voter id, kept in its `localStorage`. The Worker keeps one Vote per voter id
 * per Round, and the last one wins. */
export const isVoterId = (voter: unknown): voter is string =>
  typeof voter === "string" && voter.length > 0 && voter.length <= 64;

/** Each Roster entry's votes in one Round, by seat. An entry nobody voted for is left out. */
export type Tally = Record<string, number>;

/** One tap on a Roster entry's emoji, with no coalescing. The Worker relays it as is to that
 * seat's laptop, and nowhere else. */
export interface ReactionMessage {
  v: number;
  t: "react";
  /** The Roster entry's id: its laptop's seat. */
  seat: string;
  e: Reaction;
}

/** The Enhancement's only message. Sent on every connect and whenever the name changes. */
export type ContestantMessage = { v: number; t: "presence"; token: string } & Presence;

/** Anything a client may send. */
export type ClientMessage =
  | HostMessage
  | ContestantMessage
  /** Sent by the Stage and Audience phones on every connect: they follow the Current Round,
   * read-only. A phone says which voter it is, so its snapshot carries its own Vote. */
  | { v: number; t: "follow"; voter?: string }
  /** Sent by Audience phones only. */
  | ReactionMessage
  /** A phone's Vote for a Current Round's Roster entry, only while voting. The last one wins. */
  | { v: number; t: "vote"; seat: string }
  | { v: number; t: "ping" };

/** A Roster entry as the Stage and phones see it. */
export interface PublicEntry {
  id: string;
  name: string;
  /** Whether its laptop is connected now, so it can be reacted to. */
  online: boolean;
  /** Set on an entry the Host added by hand: it has no laptop, so it gets no Reactions. */
  handAdded?: true;
}

/** What the Stage and phones see of a claimed Competition: no secrets, and only the Current
 * Round's Roster. */
export interface PublicSnapshot {
  competition: CompetitionSummary;
  lifecycle: Lifecycle;
  roster: PublicEntry[];
  /** How many phones have voted in the Current Round's run. */
  turnout: number;
  /** A phone's own Vote in the Current Round, or null: sent to that phone only. */
  vote?: string | null;
  /** Each entry's votes, sent to the Stage only and only at results. Phones never see a ranking. */
  tally?: Tally;
}

/** One laptop on a Round's Roster, or a Contestant the Host added by hand. It stays listed for
 * the rest of the Round once it appears. */
export interface RosterEntry {
  seat: string;
  name: string;
  /** The laptop's Revision, or null for an entry added by hand: it has no laptop. */
  revision: string | null;
  /** Whether the laptop is connected now. */
  online: boolean;
}

export interface Roster {
  /** In the order they first appeared. */
  entries: RosterEntry[];
  /** The newest Revision seen for the Round, or null before anyone appears. */
  newest: string | null;
}

/** The Roster of a Round nobody has opened yet. */
export const EMPTY_ROSTER: Roster = { entries: [], newest: null };

/** Whether the Host added the entry by hand: it is votable, but no laptop gets its Reactions. */
export const isByHand = (entry: Pick<RosterEntry, "revision">) => entry.revision === null;

/** "Stale" means older than the newest Revision seen for that Round. An entry added by hand has
 * no Revision, so it is never stale. */
export const isStale = (entry: RosterEntry, roster: Roster) =>
  entry.revision !== null && roster.newest !== null && isNewerRevision(roster.newest, entry.revision);

export type ServerMessage =
  | { v: number; t: "pong" }
  /** A Reaction for this laptop: the only message a Contestant's laptop acts on. */
  | ReactionMessage
  /** The Competition hasn't been claimed yet. */
  | { v: number; t: "unclaimed" }
  /** The Host is in: the snapshot of the Competition, sent on every connect. Every Round's
   * Roster and live tally, keyed by Round id. */
  | {
      v: number;
      t: "competition";
      competition: CompetitionSummary;
      lifecycle: Lifecycle;
      rosters: Record<string, Roster>;
      tallies: Record<string, Tally>;
    }
  /** A Round's Roster changed. Sent to every Host. */
  | { v: number; t: "roster"; roundId: string; roster: Roster }
  /** A Round's votes changed: cast, discarded with an entry, or cleared by a re-run. Sent to every
   * Host, and only to Hosts. */
  | { v: number; t: "tally"; roundId: string; tally: Tally }
  /** The Stage's and phones' snapshot. Sent when they follow, and again on every change. */
  | ({ v: number; t: "public" } & PublicSnapshot)
  /** The lifecycle changed. Sent to every Host. */
  | { v: number; t: "lifecycle"; lifecycle: Lifecycle }
  /** A Host command changed nothing. */
  | { v: number; t: "refused"; command: HostCommand["t"]; reason: CommandRefusal }
  | { v: number; t: "claim-refused"; reason: ClaimRefusal }
  /** The Competition is claimed, but not with this Host secret. */
  | { v: number; t: "host-refused" };

/** Encodes the claim for the Host console link's `#fragment`: base64url JSON. */
export function encodeClaim(claim: Claim): string {
  return base64url(new TextEncoder().encode(JSON.stringify(claim)));
}

/** Decodes a Host console link's fragment, or returns null if it isn't a whole claim. */
export function decodeClaim(fragment: string): Claim | null {
  try {
    const binary = atob(fragment.replace(/^#/, "").replaceAll("-", "+").replaceAll("_", "/"));
    const claim: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    return isClaim(claim) ? claim : null;
  } catch {
    return null;
  }
}

export function isClaim(value: unknown): value is Claim {
  if (typeof value !== "object" || value === null) return false;
  const claim = value as Record<string, unknown>;
  return (
    typeof claim.competitionName === "string" &&
    typeof claim.joinCode === "string" &&
    isJoinCode(claim.joinCode) &&
    typeof claim.hostSecret === "string" &&
    claim.hostSecret.length > 0 &&
    typeof claim.contestantToken === "string" &&
    claim.contestantToken.length > 0 &&
    Array.isArray(claim.rounds) &&
    claim.rounds.every(
      (round: unknown) =>
        typeof round === "object" &&
        round !== null &&
        typeof (round as RoundRef).id === "string" &&
        typeof (round as RoundRef).name === "string",
    )
  );
}
