// Keeps the one Competition being prepared in this browser's IndexedDB, so a reload or a later
// visit picks up where the Organizer left off.

import { parseCompetition, type Competition } from "./competition.ts";

const DATABASE = "citd-prep";
const STORE = "competition";
const KEY = "current";
/** Where a saved Competition this page can't read is moved to, rather than being saved over. */
const UNREADABLE_KEY = "unreadable";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function inTransaction<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

/**
 * The Competition saved in this browser, or null when there is none. One this page can't read is
 * set aside first, so the next save doesn't destroy it.
 */
export async function loadCompetition(): Promise<Competition | null> {
  const stored: unknown = await inTransaction("readonly", (store) => store.get(KEY));
  if (stored === undefined) return null;
  const competition = parseCompetition(stored);
  if (!competition) await inTransaction("readwrite", (store) => store.put(stored, UNREADABLE_KEY));
  return competition;
}

/** Replaces the Competition saved in this browser. */
export async function saveCompetition(competition: Competition): Promise<void> {
  await inTransaction("readwrite", (store) => store.put(competition, KEY));
}
