import "./core-editor.css";
import { startEditor } from "./editor.ts";
import { readRound } from "./round.ts";

const round = readRound();

if (round) {
  void startEditor(document.getElementById("editor")!);
} else {
  document.querySelector<HTMLElement>(".bare-template")!.hidden = false;
}
