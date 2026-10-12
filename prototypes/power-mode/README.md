# PROTOTYPE — Power Mode on ACE 1.44 (throwaway)

Answers [Does Power Mode feel the same on the new engine?](https://github.com/rymdkrog/code-in-the-dark-editor/issues/8). Not the Core Editor.

Double-click `power-mode-prototype.html` (fully inlined, works from `file://` offline). Rebuild with `npm install && npm run build`.

Variants (bottom bar ◀ ▶, or `?variant=A|B|C`; switching keeps your text and Combo):

- **A — Original**: the 2016 effects ported verbatim. Per-frame physics (×0.96 alpha per frame), a rAF loop that never stops, the canvas sized once at load, and a margin shake (ACE's ResizeObserver is off, as in 2016).
- **B — v2**: the same constants, with physics normalised to 60 Hz by elapsed time, a loop that idles with no particles, a canvas that tracks window size and DPR, and a transform shake that honours reduced motion.
- **C — v2 + synced pulses**: B, but pulsing strings/comments share one beat instead of restarting when their line re-renders.

`stats` toggles the HUD: key→frame latency, loop state, frames/s, ACE re-renders and resizes, plus shortcuts (Combo → 195/500/800, a robo-typist, a 30 fps cap, pretend reduced motion).
