// Storage for one Round. Chromium and Safari share one store across every local file, so
// every key is prefixed with the Round id, and nothing here ever calls `clear()`.
// Storage can be missing, full or throwing; these never throw, they report failure.

export interface RoundStorage {
  /** The full storage key for a name: the name under the Round id. */
  key(name: string): string;
  /** The stored value, or null when there is none or storage can't be read. */
  get(name: string): string | null;
  /** Whether the write succeeded. */
  set(name: string, value: string): boolean;
  /** Whether storage works: writes, reads back and deletes a probe key. */
  selfTest(): boolean;
}

export function roundStorage(roundId: string): RoundStorage {
  const key = (name: string) => `${roundId}:${name}`;
  const storage = {
    key,
    get(name: string) {
      try {
        return localStorage.getItem(key(name));
      } catch {
        return null;
      }
    },
    set(name: string, value: string) {
      try {
        localStorage.setItem(key(name), value);
        return true;
      } catch {
        return false;
      }
    },
    selfTest() {
      const probe = String(Math.random());
      if (!storage.set("probe", probe) || storage.get("probe") !== probe) return false;
      try {
        localStorage.removeItem(key("probe"));
        return true;
      } catch {
        return false;
      }
    },
  };
  return storage;
}
