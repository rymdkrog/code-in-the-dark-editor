// The Stage's and Host console's side of References: taking dropped files, and reading back what
// this browser has loaded. See references.ts.

import { useEffect, useRef, useState } from "react";
import type { CompetitionSummary } from "../protocol/protocol.ts";
import { dropMessage, loadReferenceFiles, onReferencesChanged, storedReference, storedRoundIds } from "./references.ts";

/** How long what a drop loaded stays on screen. */
const NOTICE_MS = 8000;

const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;

/** Takes the Competition file or Round packages dropped anywhere on the page, and keeps their
 * References. Returns what the last drop loaded, for a few seconds. */
export function useReferenceDrop(rounds: CompetitionSummary["rounds"]): string | null {
  const [notice, setNotice] = useState<string | null>(null);
  const known = useRef(rounds);
  known.current = rounds;

  useEffect(() => {
    let hide: ReturnType<typeof setTimeout> | undefined;
    const show = (text: string) => {
      setNotice(text);
      clearTimeout(hide);
      hide = setTimeout(() => setNotice(null), NOTICE_MS);
    };
    // Without this the browser opens a dropped file in place of the page.
    const dragOver = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      loadReferenceFiles([...event.dataTransfer!.files]).then(
        (result) => show(dropMessage(result, known.current)),
        (error: unknown) => show(`Couldn't keep the References in this browser: ${String(error)}`),
      );
    };
    addEventListener("dragover", dragOver);
    addEventListener("drop", drop);
    return () => {
      removeEventListener("dragover", dragOver);
      removeEventListener("drop", drop);
      clearTimeout(hide);
    };
  }, []);
  return notice;
}

/** The Round's Reference as this browser has it, or null; it follows drops here and in other windows. */
export function useStoredReference(roundId: string | null): string | null {
  const stored = useStored(roundId, storedReference);
  return stored?.key === roundId ? stored.value : null;
}

/** The Round ids this browser has a Reference for; it follows drops here and in other windows. */
export function useStoredRoundIds(): string[] {
  return useStored("all", storedRoundIds)?.value ?? [];
}

/** What `read(key)` last gave, read again whenever this origin's References change; nothing while `key` is null. */
function useStored<T>(key: string | null, read: (key: string) => Promise<T>) {
  const [stored, setStored] = useState<{ key: string; value: T } | null>(null);
  useEffect(() => {
    if (key === null) return;
    let live = true;
    const reread = () =>
      read(key).then(
        (value) => live && setStored({ key, value }),
        () => {},
      );
    reread();
    const stop = onReferencesChanged(reread);
    return () => {
      live = false;
      stop();
    };
  }, [key, read]);
  return stored;
}
