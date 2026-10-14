import type { Ace } from "ace-builds";
import { openCrashJournal, type Save } from "./crash-journal.ts";
import { roundStorage } from "./round-storage.ts";

const CODE = "code";
const SAVE_DELAY_MS = 300;

/**
 * Restores the Round's code into the editor, then keeps saving it: 300 ms after a change, and
 * at once when the page is hidden, left or loses focus. Tells `onStorageWorking` whether
 * storage works, after a self-test on open and after every save.
 */
export function startAutosave(
  editor: Ace.Editor,
  roundId: string,
  onStorageWorking: (working: boolean) => void,
) {
  const storage = roundStorage(roundId);
  onStorageWorking(storage.selfTest());
  const journal = openCrashJournal(roundId);
  let lastSavedAt = 0;
  // Whether the Contestant has changed the code since it was restored. Until then there is
  // nothing of theirs to save.
  let edited = false;

  const restore = (save: Save | null) => {
    if (!save) return;
    lastSavedAt = Math.max(lastSavedAt, save.savedAt);
    editor.setValue(save.code, -1);
    // Undo starts from the restored code, so it can't take the Contestant back to empty.
    editor.session.getUndoManager().reset();
    edited = false;
  };

  restore(parseSave(storage.get(CODE)));
  // The journal answers within milliseconds, before anyone types. It has the newer copy only
  // when the browser was killed before localStorage reached disk.
  void journal.read().then((save) => {
    if (save && save.savedAt > lastSavedAt && !edited) restore(save);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    // Writes even when nothing changed since the last save: Firefox can drop a write made
    // as the tab starts to close, and the one in pagehide is what survives.
    if (!edited) return;
    // Strictly increasing, even if the clock steps back.
    lastSavedAt = Math.max(Date.now(), lastSavedAt + 1);
    const save = { code: editor.getValue(), savedAt: lastSavedAt };
    onStorageWorking(storage.set(CODE, JSON.stringify(save)));
    journal.write(save);
  };

  // Saved 300 ms after the first unsaved change, not 300 ms after the last: steady typing
  // never pauses long enough for a plain debounce, and a crash may lose only 300 ms.
  editor.on("change", () => {
    edited = true;
    timer ??= setTimeout(flush, SAVE_DELAY_MS);
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("blur", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

function parseSave(stored: string | null): Save | null {
  if (stored === null) return null;
  try {
    const save = JSON.parse(stored) as Save;
    if (typeof save.code === "string" && typeof save.savedAt === "number") return save;
  } catch {
    // Not ours; leave it be.
  }
  return null;
}
