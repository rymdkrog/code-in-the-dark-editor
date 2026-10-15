// Keeps the one Competition being prepared in this browser's IndexedDB, so a reload or a later
// visit picks up where the Organizer left off.

import { objectStore } from "../object-store.ts";
import { parseCompetition, type Competition } from "./competition.ts";

const KEY = "current";
/** Where a saved Competition this page can't read is moved to, rather than being saved over. */
const UNREADABLE_KEY = "unreadable";
const inTransaction = objectStore("citd-prep", "competition");

/**
 * The Competition saved in this browser, or null when there is none. One this page can't read is
 * set aside first, so the next save doesn't destroy it.
 */
export async function loadCompetition(): Promise<Competition | null> {
  const stored = await inTransaction<unknown>("readonly", (store) => store.get(KEY));
  if (stored === undefined) return null;
  const competition = parseCompetition(stored);
  if (!competition) await inTransaction("readwrite", (store) => store.put(stored, UNREADABLE_KEY));
  return competition;
}

/** Replaces the Competition saved in this browser. */
export async function saveCompetition(competition: Competition): Promise<void> {
  await inTransaction("readwrite", (store) => store.put(competition, KEY));
}
