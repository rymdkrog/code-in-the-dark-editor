# Code in the Dark Editor

An alternative take on the [Code in the Dark editor](https://github.com/codeinthedark/editor): the same blind, power-mode, single-HTML-file experience, plus optional companions that make a competition easier to prepare and let the audience join in.

> [!IMPORTANT]
> **You should use the original editor.** Nothing here is ready. The [original editor](https://github.com/codeinthedark/editor) is tried and tested: keep using it until v2 is proven at a real Competition.

## Status

Early days: the first tracer builds a practice Round package you can type in. The way forward is charted as a wayfinder map on this repo's issues (label `wayfinder:map`). Domain vocabulary lives in [`CONTEXT.md`](./CONTEXT.md).

## Development

Needs Node 24.

```sh
npm install
npm run build      # dist/core-editor.html (the template), dist/prep/ and dist/citd-practice.html
npm run dev:prep   # the prep page, locally; it needs the template, so build first
npm run typecheck
npm run lint       # includes the module-boundary rules
npm test           # unit tests
npx playwright install chromium firefox webkit
npm run test:e2e   # the no-network gate and the prep page, against dist/; build first
npm run worker:dev # the Worker under wrangler dev
```

Double-click `dist/citd-practice.html` to try the editor. `scripts/make-practice-fixture.ts` regenerates the practice Reference and asset from their sources in `fixtures/practice/`.

## Credits

Built on the ideas and original work of the [Code in the Dark](https://codeinthedark.com) editor by Tictail and its contributors. This project is a for-fun community effort and is not affiliated with or endorsed by Tictail or Code in the Dark.

Every Round package includes:

- [ACE](https://github.com/ajaxorg/ace), the editor engine. Copyright (c) 2010, Ajax.org B.V. BSD-3-Clause.
- [Press Start 2P](https://github.com/codeman38/PressStart2P), the font, by Cody "CodeMan38" Boisclair. SIL Open Font License 1.1.

Both licences are copied into a comment at the top of every built `.html`.

## Licence

BSD-3-Clause — see [`LICENSE`](./LICENSE).
