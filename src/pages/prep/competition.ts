// The Competition the Organizer is preparing, and what a Round package is made from.

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

export interface Competition {
  name: string;
  rules: string;
  rounds: Round[];
}

export const DEFAULT_RULES = [
  "Recreate the Reference using only HTML and CSS.",
  "You will not see your result until the Reveal at the end of the Round.",
  "No previews, no developer tools, no measuring, no looking things up.",
  "Use only the assets listed below, by file name, for example <img src=\"logo.png\">.",
  "When time is up, stop typing and wait for the Host.",
].join("\n");

/** Firefox ESR refuses data: URIs longer than this, so it couldn't show the image. */
export const DATA_URI_LIMIT = 32 * 1024 * 1024;

export function newCompetition(): Competition {
  return { name: "", rules: DEFAULT_RULES, rounds: [] };
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

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `citd-<prefix>-<round-slug>.html`, the prefix derived from the Competition name. */
export function packageFileName(competition: Competition, round: Round): string {
  return `citd-${slugify(competition.name) || "competition"}-${slugify(round.name) || "round"}.html`;
}

const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Why a Round can't take an asset with this name, or null if it can. */
export function assetNameProblem(round: Round, name: string): string | null {
  if (!ASSET_NAME.test(name)) {
    return `Refused “${name}”: use only letters, digits, “.”, “-” and “_”, starting with a letter or digit. Rename it and add it again.`;
  }
  const clash = round.assets.find((asset) => asset.name.toLowerCase() === name.toLowerCase());
  if (clash) return `Refused “${name}”: it clashes with “${clash.name}”, and the Reveal matches names case-insensitively.`;
  return null;
}

/** The next Revision of a Round, stamped with the UTC minute of `now`. */
export function nextRevision(round: Round, now: Date): Revision {
  const n = (round.revisions.at(-1)?.n ?? 0) + 1;
  return { n, stamp: `${n}-${now.toISOString().slice(0, 16).replace(/[-T:]/g, "")}` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Rev 3 · 12 Oct 14:03", in UTC like the stamp. */
export function formatRevision({ n, stamp }: Revision): string {
  const [, month, day, hour, minute] = stamp.match(/-\d{4}(\d\d)(\d\d)(\d\d)(\d\d)$/)!;
  return `Rev ${n} · ${Number(day)} ${MONTHS[Number(month) - 1]} ${hour}:${minute}`;
}

/** What the Round package for one Revision of a Round carries in its data slot. */
export function roundData(competition: Competition, round: Round, revision: Revision, editorVersion: string): RoundData {
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
  };
}
