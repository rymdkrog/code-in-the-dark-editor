# PROTOTYPE — Reactions on the Contestant's screen (throwaway)

**Verdict:** A — Float up, but full-width along the bottom edge, rising at most 200 px, with 40 px emoji, **behind** the name badge and the Reference thumbnail. Reactions are kept over the Reveal. The drawing cap is 200. These are now the defaults below. The details are in the resolution on the issue.

Answers [How do reactions look on a Contestant's screen?](https://github.com/rymdkrog/code-in-the-dark-editor/issues/15). Not the Core Editor.

Double-click `reactions-prototype.html` (fully inlined, works from `file://` offline). Rebuild with `npm install && npm run build`.

It sits on the winning Power Mode from [Does Power Mode feel the same on the new engine?](https://github.com/rymdkrog/code-in-the-dark-editor/issues/8) (v2 + synced pulses), so you judge reactions next to the real effects. A simulated crowd is already reacting at 20/s when it opens.

## Variants (top bar ◀ ▶, or `?variant=A|B|C|D`)

- **A — Float up** (the winner): each Reaction rises from anywhere along the bottom edge, at most the *rise* height (200 px), wobbles, and fades within ~2 s. It was first built in the badge-to-buttons band, rising ~3 s at 56 px.
- **B — Hype rail**: one bar at the bottom with the four emoji and a live counter each. Every Reaction bumps its counter and sends a small hop. A counter drains to 0 after 4 s without that emoji, and the bar fades out when everything's quiet.
- **C — Badge burst**: Reactions pop out of the top of the Contestant's name badge, which bumps. On a shared screen they read as "for Ada".
- **D — Fountain**: Reactions are launched from the bottom edge and arc back down with gravity and spin, like Power Mode's particles but emoji-sized.

## Controls (`controls` in the top bar)

- **Crowd**: the rate (1/s up to a 1000/s flood), the emoji mix, single sends, and a burst of 30.
- **Contestant**: Combo → 500 for Power Mode, a robo-typist, a **Reveal** mock, and what Reactions do **during the Reveal**: keep them over the result, quiet them (faded), or hide them (dropped).
- **Overlay**: the **drawing cap**, the emoji size, and a **chaos test**: 1000/s for 10 s, in Power Mode, with the robo-typist at ~33 chars/s. It passes at a keystroke delay p95 ≤ 8 ms with no long tasks or frames over 50 ms.
- **Share preview** (top bar): the page frames itself at a 1440×900 laptop size, scaled to 50 / 33 / 25 %, or as a **2×2 grid** of four Contestants, with optional "video blur". Use it to judge how the overlay reads on a projector or a call tile.

## Choices the prototype had to make

- The overlay is "Enhancement" code. It has its own canvas and its own rAF loop that stops when idle, and it never touches ACE or the Power Mode canvas. It hears about the Reveal only from a one-way `citd:reveal` CustomEvent that the "Core" publishes.
- Each "WebSocket" message is its own task carrying a JSON string (a `MessageChannel`), as `onmessage` would deliver it. An arrival is O(1): parse, count, then push a sprite or drop it at the cap.
- Each emoji is rasterised once per (emoji, size, DPR) and blitted with `drawImage`, so there's no text shaping per frame.
- Layout (the badge, the free band between the badge and the buttons) is read on resize, on the Reveal and every 500 ms, **never per Reaction**. Otherwise a flood would force a synchronous layout per message.

## Headless chaos results (`file://`, 1440×900, cap 40 unless noted)

| | A | B | C | D | A, no cap | D, no cap |
|---|---|---|---|---|---|---|
| Chromium keystroke p95 | 2.0 ms | 1.9 | 3.2 | 2.1 | **59.9** (17 frames > 50 ms) | **51.4** |
| Firefox keystroke p95 | 3 | 3 | 4 | 4 | **17** | **27** (3 long frames) |
| WebKit keystroke p95 | 3 | 3 | 3 | 3 | 3 | 3 |
| Drawn of ~10,000 | 160 | 600 hops (+ all counted) | 263 | 343 | all | all |

With the final A (full-width, 200 px rise, 40 px) at **cap 200**, the keystroke p95 was 3.5–3.7 ms in Chromium, 4–5 ms in Firefox (max 14) and 3 ms in WebKit, with no frames over 50 ms. Firefox's overlay frame max of 12 ms is the thinnest margin. Of ~10,000 Reactions, ~1,010 were drawn. With no cap, the final A hit a p95 of 23 ms in Chromium and a max of 92 ms in Firefox.

The overlay's frame cost at cap 40 was ≤ 4 ms everywhere. Without a cap, A's frame grows to ~45 ms in Chromium and Firefox. Headless WebKit throttles rendering, so its no-cap row is optimistic. These are headless numbers; the real-device tier still applies.
