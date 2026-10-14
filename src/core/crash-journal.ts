// A second copy of every save, in IndexedDB. Chromium and Firefox hold localStorage writes in
// memory for seconds before they reach disk, so a killed browser loses them; an IndexedDB
// commit is on disk within milliseconds. localStorage stays the main store because only a
// synchronous write is sure to finish during `pagehide`.
//
// Best effort: when IndexedDB is missing or failing (Firefox can't open it from long file
// paths), the journal does nothing and localStorage carries on alone. It never throws.

export interface Save {
  code: string;
  /** Orders saves across both stores; the newest wins on open. */
  savedAt: number;
}

export interface CrashJournal {
  /** The last save that reached the journal, or null. */
  read(): Promise<Save | null>;
  write(save: Save): void;
}

const DATABASE = "citd-autosave";
const STORE = "saves";

export function openCrashJournal(roundId: string): CrashJournal {
  const key = `${roundId}:code`;
  const database = openDatabase();

  return {
    async read() {
      const db = await database;
      if (!db) return null;
      return new Promise((resolve) => {
        try {
          const request = db.transaction(STORE).objectStore(STORE).get(key);
          request.onsuccess = () => resolve(isSave(request.result) ? request.result : null);
          request.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      });
    },
    write(save) {
      void database.then((db) => {
        try {
          db?.transaction(STORE, "readwrite").objectStore(STORE).put(save, key);
        } catch {
          // The localStorage copy stands.
        }
      });
    },
  };
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const isSave = (value: unknown): value is Save =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Save).code === "string" &&
  typeof (value as Save).savedAt === "number";
