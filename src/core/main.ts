import "./core-editor.css";
import { startCombo } from "./combo.ts";
import { startEditor } from "./editor.ts";
import { startNameBadge } from "./name.ts";
import { readRound } from "./round.ts";

const round = readRound();

if (round) {
  const editor = startEditor(document.getElementById("editor")!);
  startNameBadge(round, editor);
  // Last: as in the original, code put in the editor before this doesn't count to the Combo.
  startCombo(editor);
} else {
  document.querySelector<HTMLElement>(".bare-template")!.hidden = false;
  document.querySelector<HTMLElement>(".streak-container")!.hidden = true;
}
