import "./core-editor.css";
import { startAutosave } from "./autosave.ts";
import { startCombo } from "./combo.ts";
import { startEditor } from "./editor.ts";
import { setUpInstructions } from "./instructions.ts";
import { setUpMenu } from "./menu.ts";
import { startNameBadge } from "./name.ts";
import { setUpReference } from "./reference.ts";
import { startParticles } from "./particles.ts";
import { setUpReveal } from "./reveal.ts";
import { readRound } from "./round.ts";
import { startShake } from "./shake.ts";

const round = readRound();

if (round) {
  const editorElement = document.getElementById("editor")!;
  const editor = startEditor(editorElement);
  const reference = setUpReference(round.reference, editor);
  const instructions = setUpInstructions(round, editor);
  document.querySelector<HTMLElement>(".button-bar")!.hidden = false;

  const storageFailing = document.querySelector<HTMLElement>(".storage-failing")!;
  startAutosave(editor, round.roundId, (working) => (storageFailing.hidden = working));
  const nameBadge = startNameBadge(round, editor);
  const menu = setUpMenu(round, editor, { contestantName: nameBadge.name });
  // The way to a backup when autosave fails.
  storageFailing.addEventListener("click", menu.open);
  // Last: as in the original, code put in the editor before this doesn't count to the Combo.
  const combo = startCombo(editor);
  startParticles(editor, combo);
  if (round.shake) startShake(editor, editorElement, combo);
  // The Reveal shows no Power Mode.
  const reveal = setUpReveal(round, editor, { onStart: combo.end });

  // Esc reaches the window only if nothing nearer used it: ACE stops the Esc that closes its
  // search box, and a modal <dialog> closes on its own Esc.
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.repeat || event.defaultPrevented || reveal.isRevealed()) return;
    if (event.target instanceof Element && event.target.closest("dialog")) return;
    if (menu.isOpen()) menu.close();
    else if (instructions.isOpen()) instructions.close();
    else reference.toggle();
  });
} else {
  document.querySelector<HTMLElement>(".bare-template")!.hidden = false;
  document.querySelector<HTMLElement>(".streak-container")!.hidden = true;
}
