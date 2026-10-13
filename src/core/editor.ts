import ace from "ace-builds";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/theme-vibrant_ink";
import "ace-builds/src-noconflict/ext-searchbox";

// Default commands that lazy-load ACE extensions we don't ship (settings menu, error
// marker, prompt). From file:// they would only fail, and settings aren't wanted anyway.
const UNSHIPPED_COMMANDS = [
  "showSettingsMenu",
  "goToNextError",
  "goToPreviousError",
  "gotoline",
  "openCommandPalette",
  "modeSelect",
];

export function startEditor(element: HTMLElement) {
  // Set up as the original was. ACE's behaviours stay on, so tags, brackets and indentation
  // are auto-completed exactly as in the original, quirks included.
  const editor = ace.edit(element, {
    // Before `mode`: options apply in order, and the HTML mode starts a lint worker otherwise.
    useWorker: false,
    mode: "ace/mode/html",
    theme: "ace/theme/vibrant_ink",
    // Code is in ACE's default monospace font, as in the original. Press Start 2P is for the
    // rest of the page (Combo, badge, buttons).
    fontSize: 20,
    showPrintMargin: false,
    highlightActiveLine: false,
    // The original has no fold widgets in the gutter.
    showFoldWidgets: false,
  });
  for (const name of UNSHIPPED_COMMANDS) editor.commands.removeCommand(name);

  editor.focus();
  return editor;
}
