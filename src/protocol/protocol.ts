// The Audience layer's wire protocol, shared by the Worker, the Enhancement and the pages.
// Every message is JSON and carries the protocol version `v`.

/** Bump only on breaking changes. The Worker accepts this and the previous version. */
export const V = 1;

/** The Worker closes a socket whose message carries a `v` it doesn't accept. Clients stop reconnecting. */
export const CLOSE_VERSION = 4001;

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

export type HostMessage =
  /** Sent on every connect: who this Host is. */
  | { v: number; t: "host"; hostSecret: string }
  /** Claims an unclaimed Competition. The Organizer key is a Worker secret that nothing stores. */
  | { v: number; t: "claim"; organizerKey: string; claim: Claim };

/** Anything a client may send. */
export type ClientMessage = HostMessage | { v: number; t: "ping" };

export type ServerMessage =
  | { v: number; t: "pong" }
  /** The Competition hasn't been claimed yet. */
  | { v: number; t: "unclaimed" }
  /** The Host is in: the snapshot of the Competition. */
  | { v: number; t: "competition"; competition: CompetitionSummary }
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
