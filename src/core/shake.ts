import type { Ace } from "ace-builds";
import type { Combo } from "./combo.ts";

// The original's constants, verbatim.
const SHAKE_THROTTLE = 100;
const SHAKE_DURATION = 75;

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Power Mode's screen shake: every change jolts the editor, harder the higher the Combo. It
 * moves with a transform, not the original's margin, which would make ACE measure and redraw
 * everything. Off when the Round turns it off or the Contestant prefers reduced motion.
 */
export function startShake(
  editor: Ace.Editor,
  element: HTMLElement,
  { count, isPowerMode, powerModeThreshold }: Combo,
) {
  let lastShake = -Infinity;
  let endTimer: ReturnType<typeof setTimeout> | undefined;

  editor.session.on("change", () => {
    if (!isPowerMode() || reducedMotion.matches) return;
    const now = performance.now();
    if (now - lastShake < SHAKE_THROTTLE) return;
    lastShake = now;

    const intensity = 1 + 2 * Math.random() * Math.floor((count() - powerModeThreshold) / 100);
    const x = intensity * (Math.random() > 0.5 ? -1 : 1);
    const y = intensity * (Math.random() > 0.5 ? -1 : 1);
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    clearTimeout(endTimer);
    endTimer = setTimeout(() => (element.style.transform = ""), SHAKE_DURATION);
  });
}
