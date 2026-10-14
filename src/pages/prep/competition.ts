// The Competition the Organizer is preparing, and what a Round package is made from.

import { base64url, isJoinCode, JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH, type Claim } from "../../protocol/protocol.ts";
import type { RoundData } from "../../round-package/round-data.ts";

/** A Reference or an asset, read from the Organizer's file. */
export interface Asset {
  name: string;
  dataUri: string;
  /** Pixel dimensions, or null when the file isn't an image (a font, say). */
  width: number | null;
  height: number | null;
}

/** One export of a Round package. */
export interface Revision {
  n: number;
  /** The counter plus the UTC minute of the export, e.g. `3-202610121403`. */
  stamp: string;
  /** A fingerprint of what the package was made from, to tell whether the Round has changed since. */
  fingerprint: string;
}

export interface Round {
  /** Random, minted once when the Round is added, and kept across re-exports. */
  id: string;
  kind: "heat" | "final";
  name: string;
  reference: Asset | null;
  assets: Asset[];
  revisions: Revision[];
}

/** The Audience layer's settings and the credentials minted for it, locally. */
export interface Audience {
  enabled: boolean;
  workerUrl: string;
  /** Public: phones and the Stage join with it. */
  joinCode: string;
  /** Baked into every package, so only Contestants can register presence. */
  contestantToken: string;
  /** Only in the Host console link; required for every lifecycle change. */
  hostSecret: string;
}

export interface Competition {
  name: string;
  rules: string;
  rounds: Round[];
  audience: Audience;
}

const DEFAULT_RULES = [
  "Recreate the Reference using only HTML and CSS.",
  "You will not see your result until the Reveal at the end of the Round.",
  "No previews, no developer tools, no measuring, no looking things up.",
  "Use only the assets listed below, by file name, for example <img src=\"logo.png\">.",
  "When time is up, stop typing and wait for the Host.",
].join("\n");

/** Firefox ESR refuses data: URIs longer than this, so it couldn't show the image. */
export const DATA_URI_LIMIT = 32 * 1024 * 1024;

export function newCompetition(): Competition {
  return { name: "", rules: DEFAULT_RULES, rounds: [], audience: { enabled: false, workerUrl: "", ...mintCredentials() } };
}

export type Credentials = Pick<Audience, "joinCode" | "contestantToken" | "hostSecret">;

export function mintCredentials(): Credentials {
  const code = crypto.getRandomValues(new Uint32Array(JOIN_CODE_LENGTH));
  return {
    joinCode: [...code].map((n) => JOIN_CODE_ALPHABET[n % JOIN_CODE_ALPHABET.length]).join(""),
    contestantToken: longSecret(),
    hostSecret: longSecret(),
  };
}

/** 32 base64url characters: 192 random bits. */
const longSecret = () => base64url(crypto.getRandomValues(new Uint8Array(24)));

/** Changes the Audience settings. Every package carries them, so every Round's status follows. */
export const updateAudience = (competition: Competition, change: Partial<Audience>): Competition => ({
  ...competition,
  audience: { ...competition.audience, ...change },
});

/** The Worker's origin, or null when the URL isn't an http(s) URL. */
export function workerOrigin(workerUrl: string): string | null {
  const url = URL.canParse(workerUrl.trim()) ? new URL(workerUrl.trim()) : null;
  return url && (url.protocol === "https:" || url.protocol === "http:") ? url.origin : null;
}

/** The Worker origin Round packages connect to: the Audience layer is on, with a valid Worker URL. Else none. */
export const packageWorkerOrigin = ({ audience }: Competition) => (audience.enabled ? workerOrigin(audience.workerUrl) : null);

/** What the Host console link carries. */
export function claimOf(competition: Competition): Claim {
  const { joinCode, hostSecret, contestantToken } = competition.audience;
  return {
    competitionName: competition.name,
    joinCode,
    hostSecret,
    contestantToken,
    rounds: competition.rounds.map(({ id, name }) => ({ id, name })),
  };
}

/** Adds Heat N after the other Heats, or the Final at the end. A Competition has one Final. */
export function addRound(competition: Competition, kind: Round["kind"], id: string): Competition {
  const heats = competition.rounds.filter((round) => round.kind === "heat");
  const finals = competition.rounds.filter((round) => round.kind === "final");
  if (kind === "final" && finals.length) return competition;
  const round: Round = {
    id,
    kind,
    name: kind === "final" ? "Final" : `Heat ${heats.length + 1}`,
    reference: null,
    assets: [],
    revisions: [],
  };
  return { ...competition, rounds: kind === "final" ? [...heats, round] : [...heats, round, ...finals] };
}

export function updateRound(competition: Competition, id: string, change: (round: Round) => Round): Competition {
  return { ...competition, rounds: competition.rounds.map((round) => (round.id === id ? change(round) : round)) };
}

const ID_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function mintRoundId(): string {
  return [...crypto.getRandomValues(new Uint8Array(10))].map((byte) => ID_ALPHABET[byte % 32]).join("");
}

function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** What the Competition's file names start with, derived from its name. */
const filePrefix = (competition: Competition) => slugify(competition.name) || "competition";

/** `citd-<prefix>-<round-slug>.html`. */
export function packageFileName(competition: Competition, round: Round): string {
  return `citd-${filePrefix(competition)}-${slugify(round.name) || "round"}.html`;
}

/** `<prefix>.citd-competition.json`. */
export const competitionFileName = (competition: Competition) => `${filePrefix(competition)}.citd-competition.json`;

const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Why an asset can't take this name beside the names already taken, or null if it can. */
export function assetNameProblem(taken: string[], name: string): string | null {
  if (!ASSET_NAME.test(name)) {
    return `Refused “${name}”: use only letters, digits, “.”, “-” and “_”, starting with a letter or digit. Rename it and add it again.`;
  }
  const clash = taken.find((other) => other.toLowerCase() === name.toLowerCase());
  if (clash) return `Refused “${name}”: it clashes with “${clash}”, and the Reveal matches names case-insensitively.`;
  return null;
}

/** Firefox ESR's limit is on the data: URI, which base64 makes a third bigger than the file. */
export const isOversized = (asset: Asset) => asset.dataUri.length > DATA_URI_LIMIT;

/** The size of the file an asset was read from. */
export const fileBytes = (asset: Asset) =>
  Math.floor(((asset.dataUri.length - asset.dataUri.indexOf(",") - 1) * 3) / 4);

/** Roughly how big a Round's package will be, given the template's size. */
export function estimatedPackageBytes(competition: Competition, round: Round, templateBytes: number): number {
  const files = round.reference ? [round.reference, ...round.assets] : round.assets;
  return templateBytes + competition.rules.length + files.reduce((sum, file) => sum + file.dataUri.length, 0);
}

/** The next Revision of a Round, stamped with the UTC minute of `now`. */
export function nextRevision(competition: Competition, round: Round, now: Date): Revision {
  const n = (round.revisions.at(-1)?.n ?? 0) + 1;
  return {
    n,
    stamp: `${n}-${now.toISOString().slice(0, 16).replace(/[-T:]/g, "")}`,
    fingerprint: packageFingerprint(competition, round),
  };
}

/** cyrb53: a fast 53-bit string hash. Not cryptographic; it only has to notice a change. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ char, 2654435761);
    h2 = Math.imul(h2 ^ char, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Hashing a 30 MB data: URI takes a while, and an Asset never changes, so each is hashed once.
const hashedAssets = new WeakMap<Asset, Asset>();

function hashedAsset(asset: Asset): Asset {
  let hashed = hashedAssets.get(asset);
  if (!hashed) hashedAssets.set(asset, (hashed = { ...asset, dataUri: hash(asset.dataUri) }));
  return hashed;
}

/**
 * A fingerprint of everything a Round's package is made from, bar its Revision: the same
 * fingerprint means exporting again would make the same package under the same file name.
 */
export function packageFingerprint(competition: Competition, round: Round): string {
  if (!round.reference) return "";
  const hashed = { ...round, reference: hashedAsset(round.reference), assets: round.assets.map(hashedAsset) };
  return hash(JSON.stringify([packageFileName(competition, round), roundData(competition, hashed, { stamp: "" }, "")]));
}

/** Another Round that would export to the same file name as this one. */
export const fileNameClash = (competition: Competition, round: Round): Round | undefined =>
  competition.rounds.find(
    (other) => other.id !== round.id && packageFileName(competition, other) === packageFileName(competition, round),
  );

/** Why a Round can't be exported yet. */
export function roundProblems(competition: Competition, round: Round): string[] {
  const problems: string[] = [];
  if (!round.reference) problems.push("It has no Reference yet.");
  const clash = fileNameClash(competition, round);
  if (clash) {
    problems.push(
      `It would export as ${packageFileName(competition, round)}, the same file as ${clash.name || "an unnamed Round"}. Rename one of them.`,
    );
  }
  return problems;
}

/** Whether a Round can't be exported, still needs exporting, or matches its last Revision. */
export type RoundStatus =
  | { kind: "problem"; problems: string[] }
  | { kind: "not exported" }
  | { kind: "changed"; last: Revision }
  | { kind: "exported"; last: Revision };

/** Where a Round stands; any change that reaches its package makes it "changed". */
export function roundStatus(competition: Competition, round: Round): RoundStatus {
  const problems = roundProblems(competition, round);
  if (problems.length) return { kind: "problem", problems };
  const last = round.revisions.at(-1);
  if (!last) return { kind: "not exported" };
  return last.fingerprint === packageFingerprint(competition, round)
    ? { kind: "exported", last }
    : { kind: "changed", last };
}

/** "problem", "not exported", "changed since Rev N" or "Rev N exported". */
export function statusLabel(status: RoundStatus): string {
  switch (status.kind) {
    case "problem":
    case "not exported":
      return status.kind;
    case "changed":
      return `changed since Rev ${status.last.n}`;
    case "exported":
      return `Rev ${status.last.n} exported`;
  }
}

/** What Export N changed downloads: every ready Round that's new or changed since its last export. */
export const changedRounds = (competition: Competition): Round[] =>
  competition.rounds.filter((round) => {
    const { kind } = roundStatus(competition, round);
    return kind === "not exported" || kind === "changed";
  });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Rev 3 · 12 Oct 14:03", in UTC like the stamp. */
export function formatRevision({ n, stamp }: Revision): string {
  const [, month, day, hour, minute] = stamp.match(/-\d{4}(\d\d)(\d\d)(\d\d)(\d\d)$/)!;
  return `Rev ${n} · ${Number(day)} ${MONTHS[Number(month) - 1]} ${hour}:${minute}`;
}

/** What the Round package for one Revision of a Round carries in its data slot. */
export function roundData(
  competition: Competition,
  round: Round,
  revision: Pick<Revision, "stamp">,
  editorVersion: string,
): RoundData {
  if (!round.reference) throw new Error(`${round.name} has no Reference`);
  return {
    competitionName: competition.name,
    roundName: round.name,
    roundId: round.id,
    revision: revision.stamp,
    editorVersion,
    shake: true,
    instructions: { rules: competition.rules, note: "", colours: [] },
    reference: round.reference.dataUri,
    assets: round.assets.map(({ name, width, height, dataUri }) => ({ name, width, height, dataUri })),
    ...audienceData(competition),
  };
}

/** The connection details a package carries, or none at all: no Worker URL means pure offline. */
function audienceData(competition: Competition): Pick<RoundData, "audience"> {
  const origin = packageWorkerOrigin(competition);
  if (!origin) return {};
  const { joinCode, contestantToken } = competition.audience;
  return { audience: { workerUrl: origin, joinCode, contestantToken } };
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isAsset = (value: unknown): value is Asset =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.dataUri === "string" &&
  value.dataUri.startsWith("data:") &&
  (typeof value.width === "number" || value.width === null) &&
  (typeof value.height === "number" || value.height === null);

const isRevision = (value: unknown): value is Revision =>
  isRecord(value) &&
  typeof value.n === "number" &&
  typeof value.stamp === "string" &&
  typeof value.fingerprint === "string";

const isAudience = (value: unknown): value is Audience =>
  isRecord(value) &&
  typeof value.enabled === "boolean" &&
  typeof value.workerUrl === "string" &&
  typeof value.joinCode === "string" &&
  isJoinCode(value.joinCode) &&
  typeof value.contestantToken === "string" &&
  typeof value.hostSecret === "string";

const isRound = (value: unknown): value is Round =>
  isRecord(value) &&
  typeof value.id === "string" &&
  (value.kind === "heat" || value.kind === "final") &&
  typeof value.name === "string" &&
  (value.reference === null || isAsset(value.reference)) &&
  Array.isArray(value.assets) &&
  value.assets.every(isAsset) &&
  Array.isArray(value.revisions) &&
  value.revisions.every(isRevision);

/** A Competition read back from this browser or a Competition file, or null if it isn't one. */
export function parseCompetition(value: unknown): Competition | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !(value.rules === undefined || typeof value.rules === "string") ||
    !Array.isArray(value.rounds) ||
    !value.rounds.every(isRound) ||
    !(value.audience === undefined || isAudience(value.audience))
  ) {
    return null;
  }
  // Defaults first, so a Competition saved before a setting existed still opens.
  return { ...newCompetition(), ...value } as Competition;
}

/** Nothing would be lost by replacing it: it's just as a new Competition starts, bar its fresh credentials. */
export function isUntouched(competition: Competition): boolean {
  const { joinCode, contestantToken, hostSecret } = competition.audience;
  const fresh = newCompetition();
  const untouched = { ...fresh, audience: { ...fresh.audience, joinCode, contestantToken, hostSecret } };
  return !competition.rounds.length && JSON.stringify(competition) === JSON.stringify(untouched);
}

const FILE_FORMAT = "citd-competition";

/** The Competition file: everything in the Competition, so it opens again exactly as it was. */
export const competitionFile = (competition: Competition) =>
  JSON.stringify({ format: FILE_FORMAT, formatVersion: 1, competition });

/** The Competition in a Competition file, or null if the text isn't one. */
export function parseCompetitionFile(text: string): Competition | null {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  return isRecord(file) && file.format === FILE_FORMAT ? parseCompetition(file.competition) : null;
}
