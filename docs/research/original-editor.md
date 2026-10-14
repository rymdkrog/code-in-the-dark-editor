# The original Code in the Dark editor — survey

Source: https://github.com/codeinthedark/editor, last commit `04bf2d7` (2016-09-16), read-only survey on 2026-10-12. **[V]** = verified in source/GitHub, **[I]** = inferred.

## Stack & build

- **[V]** CoffeeScript 1.9, single `App` class in `app/scripts/app.coffee` (~270 lines); SCSS in `app/styles/index.scss`. Deps: jQuery 2, Underscore 1.8, **brace ^0.5** (old ACE wrapper, ≈ ACE 1.1.x **[I]**) — html mode, `vibrant_ink` theme, searchbox ext. ACE worker disabled (`useWorker false`).
- **[V]** Build: gulp 3 + webpack 1 + node-sass 3 + `gulp-inline-source`. `gulp dist` → `dist/editor.html` (~1.3 MB, everything inlined incl. Press Start 2P font and logos) + `dist/assets/` (`instructions.html`, `page.png`, `result.html`, sample `beach.jpg`).
- **[V]** Fully offline; opened over `file://`. No CDN.

## Features

- **Editor**: ACE HTML mode (highlights embedded CSS/JS), font 20, no print margin, no active-line highlight. Custom theme with constantly pulsing/growing comment and string tokens. **[I]** ACE auto-closing tags/brackets left on.
- **Combo**: +1 per ACE `insertText` change; deletes don't count. **[V]** In brace 0.5.1 an insertion over several lines is split into `insertText` changes for the first line's text, the line break and the last line's text (whole lines between are an uncounted `insertLines`), so a multi-line paste counts 2–3 and Enter between nested tags counts 2. `STREAK_TIMEOUT` 10 s, debounced — 10 s idle resets combo and exits power mode. Shrinking bar under the counter (10 s CSS `scaleX` transition) resets per keystroke; counter "bumps" 0.25 s per change.
- **Exclamations**: every 10 combo, one of 15 random strings ("Super!", "Radical!", "OMG", ":O", …), 1.5 s animation, removed after 3 s.
- **Power mode**: combo ≥ 200. Adds `body.power-mode`: "POWER MODE!" heading, pulsing background logo (2 s), green → cyan colour scheme.
- **Particles** (power mode only): throttle 25 ms; 5–12 × 8 px squares at the cursor, colour from ACE token type under the cursor (hard-coded map); vx ∈ [-2.5, 2.5], vy ∈ [-7, -3.5], gravity 0.075, alpha ×0.96 **per frame** (frame-rate dependent), culled at ≤ 0.1; 500-slot ring buffer, full-window canvas sized once at load (never on resize).
- **Screen shake** (power mode only): throttle 100 ms, any change incl. deletes; editor margin offset `1 + 2*rand*floor((combo-200)/100)` px for 75 ms.
- **Reference**: 200×160 thumbnail bottom-right (CSS background `assets/page.png`, cover); click → fullscreen (contain); click again → close and refocus editor.
- **Instructions**: button toggles an overlay iframe of `assets/instructions.html` (900×600); click to close. Default text lists rules plus an organiser-editable asset list with dimensions.
- **Name**: `localStorage.name` or `prompt()` on load; big bottom-left badge, click to re-prompt. **[I]** Cancelling saves the string `"null"`.
- **Finish/Reveal**: `prompt()` warning (finishing early disqualifies) requiring "yes"; code `postMessage`d to `assets/result.html` iframe, which sets `document.documentElement.innerHTML = code`. Iframe covers the editor; name badge stays on top. Relative asset paths resolve from `assets/`. **[I]** Scripts in the result don't run. No way to close the result; **nothing exported**.
- **Autosave**: `localStorage.content`, 300 ms debounce, restored on load. Global keys, no per-round namespace, no reset. **[I]** On `file://`, storage often shared across local files → previous round's code reappears.
- `beforeunload` "Hold your horses!" guard. No custom shortcuts/settings (ACE defaults + Ctrl/Cmd-F). All thresholds hard-coded. No timer.

## How organizers run it

- **[V]** Copy `dist/`, replace `assets/page.png` with the Reference, drop images into `assets/`, edit `assets/instructions.html` with asset paths and sizes.
- **[V]** Distributed on USB sticks; mirrored monitor faces the audience; browser in presentation mode; 15-minute timer on a wall (in-editor timer rejected in issue #5). Results shown on each screen, audience votes via external tools (e.g. Mentimeter). No code collected.
- **[V]** Also hosted at codeinthedark.com/editor.

## Known pain points

- **#15** (open, many +1s): after `gulp dist`, syntax highlighting is gone (all text black); workaround is removing Uglify.
- **#10**: 80–190 % CPU and input lag in power mode. **[V]** rAF loop clears the full canvas and walks all 500 particles every frame, even when idle.
- **#4, #7, #11**: install/build failures — toolchain is dead.
- **[V, per fork README]** brace crashes on keypress in modern browsers; auto-close produces bogus tags like `<ht></ht>`.
- **#12** turn off shake; **#29** keyboard shortcut for the Reference; **#3** Emmet requested, debated as unfair.
- **[I]** `prompt()`/`confirm()` unreliable in fullscreen/presentation mode; data loss risk from global localStorage; canvas not resized; finish depends on `prompt()`.

## Product-direction precedent

Rejected by the original maintainer on principle (#17): live previews (#16, #17) and a websocket audience "live follow-along" (#18) — previews kill the suspense of the Reveal and let the audience help Contestants. In-editor timer rejected (#5). Unmerged: 15-min countdown (#19).

## Angry Creative fork

https://github.com/Angrycreative/code-in-the-dark-editor — active (last push 2026-06), announced in issue #35. Still CoffeeScript, but: Vite + `ace-builds`, HTML linting via worker file in `dist/assets/`, styled `<dialog>` modals instead of prompts, asset-browser panel (click to copy path), "Finish" click counter as anti-cheat, reset button, canvas resize handling, GitHub Pages deploy, multiple challenges per build (`assets/challenges/{id}/page.png` + `assets.html`, `assets/challenges-config.js`). Treat as evidence of organizer demand, not a base.

## Licence & branding

- **[V]** BSD-3-Clause, © 2015 Tictail Inc; no-endorsement clause names "Tictail, Code in the Dark".
- **[V]** Competition site (`codeinthedark.github.io`) terms for using the name/logo: non-commercial, free events, link to codeinthedark.com, announce via PR.
- **[I]** Bundled logos carry CITD branding — v2 shouldn't reuse them.

## Key files in the original

`app/scripts/app.coffee` (all logic), `app/styles/index.scss`, `app/index.html`, `app/assets/{instructions.html,result.html,page.png}`, `app/assets/images/logo*.png`, `app/assets/fonts/PressStart2P-Regular.ttf`, `gulpfile.coffee`, `dist/editor.html`.
