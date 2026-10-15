// References reach the Stage locally: the Organizer drops the Competition file or Round packages
// on the Stage or the Host console, and the References are kept in this origin's IndexedDB, by
// Round id. Nothing here talks to the Worker, so it never gets an image, and phones never do.

import type { CompetitionSummary } from "../protocol/protocol.ts";
import { roundSlotJson } from "../round-package/fill-template.ts";
import { objectStore } from "./object-store.ts";
import { parseCompetitionFile } from "./prep/competition.ts";

export interface FoundReference {
  roundId: string;
  /** The Reference as a data: URI, or null when the Competition file says the Round has none. */
  reference: string | null;
}

/** The References in a Competition file, one per Round, or in a Round package; null if the text
 * is neither. */
export function referencesIn(text: string): FoundReference[] | null {
  const competition = parseCompetitionFile(text);
  if (competition) return competition.rounds.map(({ id, reference }) => ({ roundId: id, reference: reference?.dataUri ?? null }));
  const round = parseRoundSlot(text);
  return round && [round];
}

function parseRoundSlot(html: string): FoundReference | null {
  const json = roundSlotJson(html);
  if (!json) return null;
  let round: unknown;
  try {
    round = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof round !== "object" || round === null) return null;
  const { roundId, reference } = round as Record<string, unknown>;
  return typeof roundId === "string" && roundId && typeof reference === "string" && reference.startsWith("data:")
    ? { roundId, reference }
    : null;
}

/** What dropping some files loaded: the Round ids it stored, and the files that held no References. */
export interface DropResult {
  roundIds: string[];
  refused: string[];
}

/** Reads dropped files and keeps every Reference in them. A Competition file also clears the
 * Reference of each of its Rounds that has none any more. */
export async function loadReferenceFiles(files: File[]): Promise<DropResult> {
  const found: FoundReference[] = [];
  const refused: string[] = [];
  for (const file of files) {
    const references = referencesIn(await file.text()) ?? [];
    found.push(...references);
    if (!references.some(({ reference }) => reference)) refused.push(file.name);
  }
  if (found.length) await storeReferences(found);
  const loaded = found.filter(({ reference }) => reference).map(({ roundId }) => roundId);
  return { roundIds: [...new Set(loaded)], refused };
}

/** What a drop loaded, naming the Rounds this page knows: "Loaded the References for Heat 1 and Final." */
export function dropMessage({ roundIds, refused }: DropResult, rounds: CompetitionSummary["rounds"]): string {
  const known = roundIds.flatMap((id) => rounds.find((round) => round.id === id)?.name ?? []);
  const others = roundIds.length - known.length;
  const names = others ? [...known, `${others} other Round${others === 1 ? "" : "s"}`] : known;
  const loaded = names.length
    ? `Loaded the Reference${roundIds.length === 1 ? "" : "s"} for ${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names.at(-1)}.`
    : "";
  const none = refused.length ? `No References in ${refused.join(", ")}.` : "";
  return [loaded, none].filter(Boolean).join(" ");
}

const inTransaction = objectStore("citd-references", "references");
/** Tells this origin's other pages, a Stage in another window say, that References changed. */
const CHANNEL = "citd-references";
const announcer = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);

/** Keeps References by Round id, replacing or clearing any loaded before, and tells this origin's pages. */
export async function storeReferences(references: FoundReference[]): Promise<void> {
  await inTransaction("readwrite", (store) => {
    for (const { roundId, reference } of references) {
      if (reference) store.put(reference, roundId);
      else store.delete(roundId);
    }
  });
  announcer?.postMessage("changed");
}

/** The Round's Reference as a data: URI, or null when none is loaded. */
export async function storedReference(roundId: string): Promise<string | null> {
  const reference = await inTransaction<unknown>("readonly", (store) => store.get(roundId));
  return typeof reference === "string" ? reference : null;
}

/** The Round ids that have a Reference loaded. */
export async function storedRoundIds(): Promise<string[]> {
  const keys = await inTransaction("readonly", (store) => store.getAllKeys());
  return keys.filter((key) => typeof key === "string");
}

/** Calls `changed` whenever this origin's References change, here or in another window. */
export function onReferencesChanged(changed: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = changed;
  return () => channel.close();
}
