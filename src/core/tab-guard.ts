// The two-tab guard. Two tabs of one Round would overwrite each other's autosave, so the first
// tab to open a Round holds a Web Lock named for it while it lives, and a tab that finds the
// lock taken stays out. The browser lets the lock go when the tab closes, refreshes or
// crashes. BroadcastChannel and the storage event never reach another file:// tab in WebKit;
// Web Locks reach it in every engine.
//
// It fails open: without Web Locks, or when they don't answer, the tab carries on as the only one.

// Browsers answer within a few milliseconds. The editor waits for the answer, so this caps how
// long a browser whose Web Locks hang keeps the Contestant from typing.
const ANSWER_WITHIN_MS = 1000;
// Published on `window` whether or not anyone listens: a blocked tab doesn't connect either.
const TWO_TAB_BLOCKED = "citd:two-tab-blocked";

/** Whether this tab has the Round to itself. Once it has, it keeps the Round until it goes. */
export function claimRound(roundId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const alone = () => resolve(true);
    const timeout = setTimeout(alone, ANSWER_WITHIN_MS);
    try {
      navigator.locks
        .request(`${roundId}:open`, { ifAvailable: true }, (lock) => {
          clearTimeout(timeout);
          resolve(lock !== null);
          // Never settles, so the lock is held until the page goes.
          return lock && new Promise<never>(() => {});
        })
        .catch(alone);
    } catch {
      alone();
    }
  });
}

/** Puts up the notice that the Round is open in another tab, for good: nothing else starts. */
export function showOpenElsewhere() {
  const dialog = document.querySelector<HTMLDialogElement>(".open-elsewhere")!;
  dialog.addEventListener("cancel", (event) => event.preventDefault());
  // Chromium closes a modal dialog on a second Esc even when the first was refused.
  dialog.addEventListener("close", () => dialog.showModal());
  dialog.showModal();
  window.dispatchEvent(new CustomEvent(TWO_TAB_BLOCKED));
}
