# Code in the Dark Editor

An alternative take on the [Code in the Dark editor](https://github.com/codeinthedark/editor): the same blind, power-mode, single-HTML-file experience, plus optional companions that make a competition easier to prepare and let the audience join in.

> [!IMPORTANT]
> **You should use the original editor.** Nothing here is ready. The [original editor](https://github.com/codeinthedark/editor) is tried and tested: keep using it until v2 is proven at a real Competition.

## Status

Early days: the first tracer builds a practice Round package you can type in. The way forward is charted as a wayfinder map on this repo's issues (label `wayfinder:map`). Domain vocabulary lives in [`CONTEXT.md`](./CONTEXT.md).

## Handing out Round packages

The prep page exports one Round package per Round. Send each file however suits your venue: USB stick, AirDrop or a chat link. Tell Contestants: **open it where it lands, and don't move it.** Give the Final only to finalists.

### Organizer pre-event checklist

The prep page's Hand out & checklist pane shows the same list.

- **Ahead of the day**
  - Don't deploy the Worker from the day before.
  - Optional: send `citd-practice.html` with the invitation, so Contestants can try their own laptops.
- **Per laptop, before each Heat**
  - Open the Round package where it landed (don't move it), in a normal window, not a private one.
  - Enter the name and check the badge shows the right Round.
  - Type a little. Check there's no autosave icon, and that Esc shows the Reference.
  - Run Reset Round.
  - Go fullscreen, turn on Do Not Disturb, disable sleep and plug in power.
- **If Enhancements are on**
  - Every seat is on the Host console's Roster, with no stale-Revision flags.
  - The Competition file is loaded on the Stage machine.
- **The room**
  - Contestants can see the Stage clock from their seats, or a second display faces them.
- **Spare laptop**
  - Every Round package opened and tested on it.

## Releases

Pushing a `v*` tag (`v2.x.y`, matching `version` in `package.json`) runs every CI check, then publishes a GitHub Release whose only download is `citd-practice.html` and publishes the prep page to GitHub Pages. Every built file carries `version+shortsha`.

The Pages deploy needs two repository settings, once: **Settings → Pages → Source: GitHub Actions**, and a `v*` tag rule under **Settings → Environments → github-pages → Deployment branches and tags** (by default it accepts only `main`).

## Development

Needs Node 24.

```sh
npm install
npm run build      # dist/core-editor.html (the template), dist/prep/, dist/citd-practice.html and dist/worker/
npm run dev:prep   # the prep page, locally; it needs the template, so build first
npm run typecheck
npm run lint       # includes the module-boundary rules
npm test           # unit tests, and the Worker's protocol tests in workerd
npx playwright install chromium firefox webkit
npm run test:e2e   # the no-network gate, the prep page and the Host console, against dist/; build first
npm run worker:dev # the Worker and its pages (Host console, Stage, Audience phone) under wrangler dev
```

The Worker needs an Organizer key, the secret a Host types to claim a Competition. For `wrangler dev`, put `ORGANIZER_KEY=…` in `.dev.vars`; for a deployed Worker, run `npx wrangler secret put ORGANIZER_KEY`. In the prep page, turn on the Audience layer, set the Worker URL (`http://localhost:8787` locally) and open the Host console link.

Double-click `dist/citd-practice.html` to try the editor. `scripts/make-practice-fixture.ts` regenerates the practice Reference and asset from their sources in `fixtures/practice/`.

## Credits

Built on the ideas and original work of the [Code in the Dark](https://codeinthedark.com) editor by Tictail and its contributors. This project is a for-fun community effort and is not affiliated with or endorsed by Tictail or Code in the Dark.

Every Round package includes:

- [ACE](https://github.com/ajaxorg/ace), the editor engine. Copyright (c) 2010, Ajax.org B.V. BSD-3-Clause.
- [Press Start 2P](https://github.com/codeman38/PressStart2P), the font, by Cody "CodeMan38" Boisclair. SIL Open Font License 1.1.

Both licences are copied into a comment at the top of every built `.html`.

## Licence

BSD-3-Clause — see [`LICENSE`](./LICENSE).
