import type { RoundData } from "../round-package/round-data.ts";

/** The Round in this package's data slot, or null in the bare template. */
export function readRound(): RoundData | null {
  const slot = document.getElementById("round");
  try {
    return slot?.textContent?.trim() ? (JSON.parse(slot.textContent) as RoundData) : null;
  } catch {
    return null;
  }
}
