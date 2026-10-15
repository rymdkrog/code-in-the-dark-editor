// The last valid Worker URL typed in this browser, so a new Competition's Audience layer starts
// with it. It belongs to the browser, not the Competition: it's never in the Competition file or
// its IndexedDB record, and only typing changes it.

import { workerOrigin, type Audience } from "./competition.ts";

const KEY = "citd-prep:worker-url";

type KeyValueStore = Pick<Storage, "getItem" | "setItem">;

/** Remembers typed Worker URLs and fills them in, in `localStorage` unless another store is given. */
export function workerUrlMemory(store: () => KeyValueStore = () => localStorage) {
  // Storage can be off, full or throwing, and even reaching `localStorage` can throw. Without it
  // nothing is remembered or filled.
  const load = () => {
    try {
      const workerUrl = store().getItem(KEY) ?? "";
      return workerOrigin(workerUrl) ? workerUrl : null;
    } catch {
      return null;
    }
  };

  return {
    /** Remembers a typed Worker URL, trimmed, if it's valid. Anything else leaves the last one. */
    remember(workerUrl: string) {
      if (!workerOrigin(workerUrl)) return;
      try {
        store().setItem(KEY, workerUrl.trim());
      } catch {
        // Not remembered.
      }
    },
    /** The Audience change, with the remembered URL filled in when it turns the layer on over an empty Worker URL. */
    fill(audience: Audience, change: Partial<Audience>): Partial<Audience> {
      const turnedOn = !audience.enabled && change.enabled === true;
      const empty = (change.workerUrl ?? audience.workerUrl).trim() === "";
      const remembered = turnedOn && empty ? load() : null;
      return remembered ? { ...change, workerUrl: remembered } : change;
    },
  };
}
