import type { Ace } from "ace-builds";
import type { RoundData } from "../round-package/round-data.ts";
import { revisionTime } from "../round-package/revision.ts";
import { slugify } from "../round-package/slug.ts";
import { typedConfirm } from "./typed-confirm.ts";

/**
 * The ⋯ menu: Download backup, Restore from backup… and Reset Round, and which Revision this
 * is, for the Host to check. Like the Instructions, it closes on a click beside its panel.
 */
export function setUpMenu(round: RoundData, editor: Ace.Editor, { contestantName }: { contestantName(): string | null }) {
  const button = document.querySelector<HTMLButtonElement>(".menu-button")!;
  const overlay = document.querySelector<HTMLElement>(".menu")!;
  const panel = overlay.querySelector<HTMLElement>(".menu-panel")!;
  const items = [...panel.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];
  const [download, restore, reset] = items as [HTMLButtonElement, HTMLButtonElement, HTMLButtonElement];

  const versionLine = overlay.querySelector<HTMLElement>(".menu-version")!;
  versionLine.textContent = `Revision ${revisionTime(round.revision)}`;
  // The editor's version is there for whoever needs it, without competing with the Revision.
  versionLine.title = `Editor ${round.editorVersion} · Revision ${round.revision}`;

  const open = () => {
    overlay.hidden = false;
    button.setAttribute("aria-expanded", "true");
    download.focus();
  };
  const close = () => {
    overlay.hidden = true;
    button.setAttribute("aria-expanded", "false");
    editor.focus();
  };
  button.addEventListener("click", open);
  overlay.addEventListener("click", (event) => {
    if (!panel.contains(event.target as Node)) close();
  });
  panel.addEventListener("keydown", (event) => {
    // Tab leaves the menu, back to the editor, so the menu never stays open over it.
    if (event.key === "Tab") {
      event.preventDefault();
      close();
      return;
    }
    // Up and down move between the items, as in any menu.
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items.at((at + step) % items.length)!.focus();
  });

  download.addEventListener("click", () => {
    close();
    const name = [round.filePrefix, slugify(round.roundName), slugify(contestantName() ?? ""), "backup"];
    saveFile(`${name.filter(Boolean).join("-")}.txt`, editor.getValue());
  });

  // Undo starts from the new code, so it can't bring back what was replaced.
  const replaceCode = (code: string) => {
    editor.setValue(code, -1);
    editor.session.getUndoManager().reset();
  };

  const file = document.querySelector<HTMLInputElement>(".restore-file")!;
  const restoreDialog = document.querySelector<HTMLDialogElement>(".restore-dialog")!;
  restore.addEventListener("click", () => {
    close();
    // Picking the same file again must still count as a change.
    file.value = "";
    file.click();
  });
  file.addEventListener("change", () => {
    if (!file.files?.[0]) return;
    restoreDialog.querySelector(".restore-dialog-file")!.textContent = file.files[0].name;
    restoreDialog.showModal();
  });
  restoreDialog.querySelector(".dialog-cancel")!.addEventListener("click", () => restoreDialog.close());
  // Any text file is taken, whichever Round it came from: the Contestant has seen its name.
  restoreDialog.addEventListener("submit", async () => {
    const chosen = file.files?.[0];
    if (!chosen) return;
    try {
      replaceCode(await chosen.text());
    } catch {
      // The file went away or can't be read; the code stays as it was.
    }
  });
  restoreDialog.addEventListener("close", () => editor.focus());

  const resetDialog = document.querySelector<HTMLDialogElement>(".reset-dialog")!;
  const openReset = typedConfirm(resetDialog, "reset", 'Type "reset" to empty the Round');
  reset.addEventListener("click", () => {
    close();
    openReset();
  });
  resetDialog.addEventListener("submit", () => replaceCode(""));
  resetDialog.addEventListener("close", () => editor.focus());

  return { open, close, isOpen: () => !overlay.hidden };
}

/**
 * Saves text through a plain download link, which every browser supports from file:// and
 * which never asks where to save. As `.txt`, a backup can't open as a preview of the result.
 */
function saveFile(name: string, text: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  link.download = name;
  link.click();
  // Firefox reads the blob after the click returns.
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}
