import type { Ace } from "ace-builds";

// The original's constants, verbatim.
const POWER_MODE_ACTIVATION_THRESHOLD = 200;
const COMBO_TIMEOUT = 10 * 1000;
const EXCLAMATION_EVERY = 10;
const EXCLAMATIONS = ["Super!", "Radical!", "Fantastic!", "Great!", "OMG",
  "Whoah!", ":O", "Nice!", "Splendid!", "Wild!", "Grand!", "Impressive!",
  "Stupendous!", "Extreme!", "Awesome!"];

/**
 * How much one insertion adds to the Combo. The original's ACE split an insertion over several
 * lines into a change for the first line's text, one for the line break, one for the whole lines
 * between and one for the last line's text, and the original counted each change but the whole
 * lines. So typing counts 1, and Enter between nested tags or a multi-line paste counts 2 or 3.
 */
function insertionWorth(lines: string[]) {
  if (lines.length === 1) return 1;
  return (lines[0] ? 1 : 0) + 1 + (lines.at(-1) ? 1 : 0);
}

/**
 * Makes the browser take in the styles set so far, so the next ones restart a transition or an
 * animation. The original left this to a 1 ms timeout, which a busy browser can beat.
 */
const flushStyles = (element: HTMLElement) => void getComputedStyle(element).transform;

/** The Combo as Power Mode's effects read it. */
export interface Combo {
  count(): number;
  isPowerMode(): boolean;
  powerModeThreshold: number;
}

/**
 * Counts the Combo from the editor's insertions and enters Power Mode, as the original does.
 * Listeners added to the editor's changes after this one see the Combo with the change counted.
 */
export function startCombo(editor: Ace.Editor): Combo {
  const counter = document.querySelector<HTMLElement>(".streak-container .counter")!;
  const bar = document.querySelector<HTMLElement>(".streak-container .bar")!;
  const exclamations = document.querySelector<HTMLElement>(".streak-container .exclamations")!;
  let combo = 0;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  function render() {
    counter.textContent = String(combo);
    // Restart the bump.
    counter.classList.remove("bump");
    flushStyles(counter);
    counter.classList.add("bump");
  }

  /** Fills the bar, then lets it shrink to nothing over the time left. */
  function refreshBar() {
    bar.style.transform = "scaleX(1)";
    bar.style.transition = "none";
    flushStyles(bar);
    bar.style.transform = "";
    bar.style.transition = `all ${COMBO_TIMEOUT}ms linear`;
  }

  function showExclamation() {
    const exclamation = document.createElement("span");
    exclamation.className = "exclamation";
    exclamation.textContent = EXCLAMATIONS[Math.floor(Math.random() * EXCLAMATIONS.length)]!;
    exclamations.prepend(exclamation);
    setTimeout(() => exclamation.remove(), 3000);
  }

  function end() {
    combo = 0;
    render();
    document.body.classList.remove("power-mode");
  }

  editor.session.on("change", (delta) => {
    if (delta.action !== "insert") return;
    // One at a time, as the original counted its changes, so no multiple of 10 is skipped.
    for (let i = insertionWorth(delta.lines); i > 0; i--) {
      combo++;
      if (combo % EXCLAMATION_EVERY === 0) showExclamation();
    }
    if (combo >= POWER_MODE_ACTIVATION_THRESHOLD) document.body.classList.add("power-mode");
    refreshBar();
    render();
    clearTimeout(endTimer);
    endTimer = setTimeout(end, COMBO_TIMEOUT);
  });

  return {
    count: () => combo,
    isPowerMode: () => combo >= POWER_MODE_ACTIVATION_THRESHOLD,
    powerModeThreshold: POWER_MODE_ACTIVATION_THRESHOLD,
  };
}
