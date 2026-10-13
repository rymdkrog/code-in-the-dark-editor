import ace, { type Ace } from "ace-builds";
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

/**
 * The HTML mode, with `<!--` and `-->` tokenised as the comment between them, as the original's
 * ACE did. ACE then draws an HTML comment as one span, which `grow` scales as one.
 */
function htmlMode(): Ace.SyntaxMode {
  const { Mode } = ace.require("ace/mode/html");
  const mode = new Mode();
  const highlightRules = new mode.HighlightRules();
  for (const rules of Object.values<{ token?: unknown }[]>(highlightRules.getRules())) {
    for (const rule of rules) {
      if (rule.token === "comment.start.xml" || rule.token === "comment.end.xml") rule.token = "comment.xml";
    }
  }
  // The mode builds its tokenizer from these rules when it's first used.
  mode.$highlightRules = highlightRules;
  return mode;
}

export function startEditor(element: HTMLElement) {
  // Set up as the original was. ACE's behaviours stay on, so tags, brackets and indentation
  // are auto-completed exactly as in the original, quirks included.
  const editor = ace.edit(element, {
    // Before `mode`: options apply in order, and the HTML mode starts a lint worker otherwise.
    useWorker: false,
    mode: htmlMode(),
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

  // Pulses share one beat. ACE redraws a line whenever it changes, which restarts its pulses,
  // so starting each new pulse at the timeline's origin keeps it in step with the rest.
  const synced = new WeakSet<Element>();
  editor.renderer.on("afterRender", () => {
    for (const span of element.querySelectorAll(".ace_comment, .ace_string, .ace_constant")) {
      if (synced.has(span)) continue;
      synced.add(span);
      for (const animation of span.getAnimations()) animation.startTime = 0;
    }
  });

  editor.focus();
  return editor;
}
