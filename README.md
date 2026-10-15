# Code in the Dark Editor

An alternative take on the [Code in the Dark editor](https://github.com/codeinthedark/editor): the same blind, power-mode, single-HTML-file experience, plus optional companions that make a competition easier to prepare and let the audience join in.

> [!IMPORTANT]
> **You should use the original editor.** Nothing here is ready. The [original editor](https://github.com/codeinthedark/editor) is tried and tested: keep using it until v2 is proven at a real Competition.

## Status

Early days: the first tracer builds a practice Round package you can type in. The way forward is charted as a wayfinder map on this repo's issues (label `wayfinder:map`). Domain vocabulary lives in [`CONTEXT.md`](./CONTEXT.md).

## Handing out Round packages

The prep page exports one Round package per Round. Send each file however suits your venue: USB stick, AirDrop or a chat link. Tell Contestants: **open it where it lands, and don't move it.** Give the Final only to finalists.

Exporting two or more Rounds at once downloads one zip, for you alone. **Unzip it first and hand out the `.html` files inside, never the zip:** a package opened from inside a zip runs from a temporary folder, and can lose its autosave.

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
  - Prep was open with the Audience layer on after the last Reference changed, so the Stage gets each Round's Reference from the Worker. If it wasn't, drop the Competition file on the Stage.
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
npm run dev:demo   # claims a demo Competition on worker:dev and prints its links and packages; needs build, worker:dev and .dev.vars
```

The Worker needs an Organizer key, the secret a Host types to claim a Competition. For `wrangler dev`, copy `.dev.vars.example` to `.dev.vars` and set `ORGANIZER_KEY`. In the prep page, turn on the Audience layer, set the Worker URL (`http://localhost:8787` locally), then claim the Competition on the Audience pane or in the Host console, and open the Host console link.

Double-click `dist/citd-practice.html` to try the editor. `scripts/make-practice-fixture.ts` regenerates the practice Reference and asset from their sources in `fixtures/practice/`.

## Run your own Audience layer

The Audience layer (the Host console, the Stage and the Audience phone page) runs on a Cloudflare Worker. There's no sign-up: anyone who wants the Audience layer deploys their own Worker.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/rymdkrog/code-in-the-dark-editor)

The button copies this repo to your account and deploys the Worker, its Durable Object and its pages. It asks for the Organizer key and sets it as a Worker secret. To deploy by hand instead:

```sh
npx wrangler deploy
npx wrangler secret put ORGANIZER_KEY
```

After every deploy, run the smoke test. It connects with `Origin: null` as a Round package does, claims a throwaway Competition and checks the round trip:

```sh
WORKER_URL=https://code-in-the-dark.<you>.workers.dev ORGANIZER_KEY=… npm run smoke
```

> [!WARNING]
> **No deploys from the day before a Competition until it ends.** A deploy drops every socket: Contestants keep typing, but the Host console, the Stage and the phones all reconnect.

### The closed instance

This repo's own Worker is deployed only by hand: the [Deploy the Worker](./.github/workflows/deploy.yml) workflow (Actions → Run workflow) or a local `npx wrangler deploy`. Nothing deploys it on merge or tag. The workflow asks you to confirm that no Competition is on today or tomorrow, then deploys and runs the smoke test. It needs the repository secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `ORGANIZER_KEY`, and the repository variable `WORKER_URL`.

## Credits

Built on the ideas and original work of the [Code in the Dark](https://codeinthedark.com) editor by Tictail and its contributors. This project is a for-fun community effort and is not affiliated with or endorsed by Tictail or Code in the Dark.

Every Round package includes:

- [ACE](https://github.com/ajaxorg/ace), the editor engine. Copyright (c) 2010, Ajax.org B.V. BSD-3-Clause.
- [Press Start 2P](https://github.com/codeman38/PressStart2P), the font, by Cody "CodeMan38" Boisclair. SIL Open Font License 1.1.

Both licences are copied into a comment at the top of every built `.html`.

The Stage draws its QR codes with [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator). Copyright (c) 2009 Kazuhiko Arase. MIT. "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

## Licence

BSD-3-Clause — see [`LICENSE`](./LICENSE).
