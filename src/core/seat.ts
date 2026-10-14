import { SEAT } from "../round-package/events.ts";
import { roundStorage } from "./round-storage.ts";

// This laptop's seat for the Round: random, minted once and kept in Round-prefixed storage, so
// a reload, or a re-exported Revision, comes back as the same Roster entry. Without storage
// every load is a new seat.
const KEY = "seat";

/** Publishes this laptop's seat id for the Round, minting it on the first open. */
export function publishSeat(roundId: string) {
  const storage = roundStorage(roundId);
  let seat = storage.get(KEY);
  if (!seat) {
    seat = Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    storage.set(KEY, seat);
  }
  window.dispatchEvent(new CustomEvent(SEAT, { detail: seat }));
}
