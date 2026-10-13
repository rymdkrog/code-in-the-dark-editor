import "./core-editor.css";
import { startEditor } from "./editor.ts";
import { startNameBadge } from "./name.ts";
import { readRound } from "./round.ts";

const round = readRound();

if (round) {
  const editor = startEditor(document.getElementById("editor")!);
  startNameBadge(round, editor);
} else {
  document.querySelector<HTMLElement>(".bare-template")!.hidden = false;
}
