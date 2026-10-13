import ace from "ace-builds";
import "ace-builds/src-noconflict/mode-html";
import "ace-builds/src-noconflict/theme-vibrant_ink";
import "ace-builds/src-noconflict/ext-searchbox";

const FONT = '20px "Press Start 2P"';

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

export async function startEditor(element: HTMLElement) {
  // ACE measures glyph width once, so the font must be ready before it starts.
  await fontLoaded();

  const editor = ace.edit(element, {
    // Before `mode`: options apply in order, and the HTML mode starts a lint worker otherwise.
    useWorker: false,
    mode: "ace/mode/html",
    theme: "ace/theme/vibrant_ink",
    fontSize: 20,
    fontFamily: '"Press Start 2P", monospace',
    showPrintMargin: false,
    highlightActiveLine: false,
    // The editor may move text you've written, but never writes anything for you:
    // no auto-closing tags, brackets or quotes.
    behavioursEnabled: false,
    enableAutoIndent: true,
  });
  for (const name of UNSHIPPED_COMMANDS) editor.commands.removeCommand(name);

  // Enter keeps the previous line's indentation and nothing more. HTML mode already does
  // that, but the embedded CSS and JavaScript modes would indent after `{`.
  const mode = editor.session.getMode() as unknown as { $getIndent(line: string): string };
  Object.assign(mode, { getNextLineIndent: (_state: string, line: string) => mode.$getIndent(line) });

  editor.focus();
  return editor;
}

function fontLoaded(): Promise<unknown> {
  // Never let a font problem keep the Contestant from typing.
  const giveUp = new Promise((resolve) => setTimeout(resolve, 3000));
  return Promise.race([document.fonts.load(FONT), giveUp]).catch(() => undefined);
}
