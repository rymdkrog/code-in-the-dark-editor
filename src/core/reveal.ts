import type { Ace } from "ace-builds";
import type { RoundData } from "../round-package/round-data.ts";
import { rewriteAssets } from "./reveal-assets.ts";

// Published on `window` whether or not anyone listens. The Enhancement only ever listens.
export const REVEAL_STARTED = "citd:reveal-started";
export const REVEAL_ENDED = "citd:reveal-ended";

/**
 * The Reveal button, the dialog that asks for "yes", and the frame the result renders in. The
 * frame is sandboxed without scripts, so the Contestant's JavaScript never runs, and it takes
 * the package's CSP, so nothing external loads. Nothing about the Reveal is kept: a reload
 * goes back to the editor.
 */
export function setUpReveal(round: RoundData, editor: Ace.Editor, { onStart }: { onStart(): void }) {
  const button = document.querySelector<HTMLButtonElement>(".reveal-button")!;
  const dialog = document.querySelector<HTMLDialogElement>(".reveal-dialog")!;
  const input = dialog.querySelector<HTMLInputElement>("input")!;
  let result: HTMLIFrameElement | null = null;

  // The form won't submit without "yes", and the browser says why.
  const validate = () =>
    input.setCustomValidity(input.value.trim().toLowerCase() === "yes" ? "" : 'Type "yes" to reveal');
  input.addEventListener("input", validate);

  button.addEventListener("click", () => {
    input.value = "";
    validate();
    dialog.showModal();
  });
  dialog.querySelector(".reveal-dialog-cancel")!.addEventListener("click", () => dialog.close());
  dialog.addEventListener("submit", reveal);
  dialog.addEventListener("close", () => {
    if (!result) editor.focus();
  });

  function reveal() {
    editor.setReadOnly(true);
    editor.blur();
    // Made only now: until the Reveal there is no frame for anything to run or load in.
    result = document.createElement("iframe");
    result.className = "result";
    result.title = "Result";
    // Before it has a document: no allow-scripts, so no Contestant JavaScript runs.
    result.setAttribute("sandbox", "");
    result.srcdoc = rewriteAssets(editor.getValue(), round.assets);
    document.body.append(result);
    document.body.classList.add("revealing");
    onStart();
    window.dispatchEvent(new CustomEvent(REVEAL_STARTED));
  }

  // Leaving the page ends the Reveal, so a page the browser brings back shows the editor.
  window.addEventListener("pagehide", () => {
    if (!result) return;
    result.remove();
    result = null;
    document.body.classList.remove("revealing");
    editor.setReadOnly(false);
    window.dispatchEvent(new CustomEvent(REVEAL_ENDED));
  });

  return { isRevealed: () => !!result };
}
