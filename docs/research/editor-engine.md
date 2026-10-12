# Editor engine for a single offline HTML file — ACE vs CodeMirror 6 vs Monaco

Research for [#2](https://github.com/rymdkrog/code-in-the-dark-editor/issues/2) (part of map #1), 2026-10-12.
**[M]** = measured here (method at the bottom), **[S]** = read in source/docs (linked), **[I]** = inferred.

## Answer

**Use ACE (`ace-builds`), with `behavioursEnabled: false` and `useWorker: false`.** It's the only engine where parity with the original is a port rather than a rewrite. It uses the same token type strings as the original's `PARTICLE_COLORS` map, ships the same `vibrant_ink` theme, gives each token a semantic CSS class so the pulsing/growing comment and string animation carries over unchanged, and its `getTokenAt` / `textToScreenCoordinates` / `change` delta API is the one `app.coffee` already calls. It inlines to about 545 KB with no worker, and works from `file://` in Chromium, Firefox and WebKit.

**Trade-off:** ACE is older and less modular than CodeMirror 6. It renders its own text layer around a hidden textarea, its accessibility and mobile/IME support are likely weaker, and new editor work across the ecosystem mostly targets CM6 **[I]**. CM6, by contrast, documents native mobile editing. CodeMirror 6 is a close runner-up: about the same size (465–490 KB), no workers, the cleanest change annotations, MIT. But it needs a new theme, a new token-to-colour map built on Lezer node names, and asynchronous (measure-phase) cursor coordinates. **Monaco is ruled out**: it's about 5× larger (2.8 MB before workers), its token classes are colour-indexed (`mtk12`) rather than semantic, so per-token CSS animation needs hacks, and it has no public token-at-position API.

**Constraints on other tickets**

- Auto-closing must be **off**. All three engines' auto-close/auto-pair corrupts linear typing (see §2). That fits "no help" and fixes the original's `<ht></ht>` bug.
- No linting or syntax-check worker. That's consistent with the blind/no-help rules and means no worker files.
- The particle colour map stays keyed on ACE token types, so the original constants carry over verbatim.
- Ctrl/Cmd-F comes from `ext-searchbox` (+14 KB). Whether search stays in is a game-rules call.
- Any future worker must be inlined and started from a **blob URL**. A worker file next to the page (the `editor.html` + `assets/` fallback) fails from `file://` in Chromium and WebKit (§1).
- The build stays trivial: ACE's prebuilt scripts are concatenated into the HTML, so no bundler is needed. CM6 or Monaco would need an esbuild step.

## Comparison at a glance

| | ACE 1.44.0 | CodeMirror 6 (view 6.43) | Monaco 0.57.0 |
|---|---|---|---|
| Inlined JS+CSS, HTML+CSS mode, one theme, minified **[M]** | **543 KB** (146 KB gzip) incl. searchbox | **465 KB** (160 KB gzip); 489 KB with `@codemirror/search` | **2,790 KB** (721 KB gzip), +297 KB editor worker |
| Workers | Optional syntax-check worker; `useWorker:false` → none **[M]** | None **[M]** | Editor and language workers; none created for Monarch-only HTML/CSS **[M]** |
| Works from `file://`, all inlined, Chromium/Firefox/WebKit **[M]** | Yes | Yes | Yes |
| Embedded `<style>` CSS highlighting **[M]** | Yes (CSS + JS modes bundled into `mode-html.js`) | Yes (Lezer CSS/JS nested) | Yes (Monarch `nextEmbedded`) |
| Auto-close off cleanly **[M]** | `behavioursEnabled:false` | omit `closeBrackets()`, `html({autoCloseTags:false})` | `autoClosingBrackets/Quotes:'never'` (Monaco never auto-closes tags) |
| Token under cursor | `session.getTokenAt(row,col).type`, sync, cheap, same strings as original | `syntaxTree(state).resolveInner(pos,-1)` → Lezer node name | **No public API.** Internal `model.tokenization.getLineTokens()` or full re-tokenise via `monaco.editor.tokenize()` |
| Cursor screen coords | `renderer.textToScreenCoordinates()` sync | `view.coordsAtPos()` inside `requestMeasure` (next frame) | `getScrolledVisiblePosition()` + DOM rect |
| Insert vs delete vs paste | delta `action` + `editor.on('paste')` (fires before change) | transaction `isUserEvent('input'/'input.paste'/'delete')` | public `onDidPaste` fires **after** the change event; reliable reason only via internal `detailedReasons` |
| Per-token CSS classes | Semantic: `.ace_comment`, `.ace_string` | Your choice: `HighlightStyle` `class:` per tag | Colour-indexed `mtkN` |
| Licence | BSD-3-Clause | MIT | MIT |

## 1. Size and single-file viability

Measured bundles **[M]**. Because the file is opened from disk, the minified (uncompressed) size is the one that matters. Gzip is shown for reference only.

| Bundle | min | gzip |
|---|---|---|
| ACE `ace.js` (core) | 464 KB | 124 KB |
| ACE `mode-html.js`: defines `html`, `css`, `javascript`, `xml` highlight rules + completions | 62 KB | 19 KB |
| ACE `theme-vibrant_ink.js` | 3 KB | 1 KB |
| ACE `ext-searchbox.js` (Ctrl/Cmd-F, as the original) | 14 KB | 4 KB |
| **ACE total** | **543 KB** | **146 KB** |
| ACE `worker-html.js` (not needed) | 204 KB | 47 KB |
| **CM6 minimal** (view, state, commands/history, language, lang-html, custom HighlightStyle) | **454–465 KB** | **160 KB** |
| CM6 + `@codemirror/search` | 489 KB | 170 KB |
| CM6 `basicSetup` + html (for comparison) | 556 KB | 192 KB |
| **Monaco** `editor.api` + HTML/CSS Monarch grammars, JS + CSS (codicon TTF as data URI) | **2,790 KB** | **721 KB** |
| Monaco `editor.worker` (if ever needed) | 297 KB | 93 KB |

The test pages were fully inlined into one `.html` each: `ace.html` 545 KB, `cm6.html` 462 KB, `monaco.html` 3,091 KB (with the worker source embedded in a `<script type="text/plain">`). For comparison, the original's `dist/editor.html` is ~1.3 MB, mostly font and logos.

- **CM6 composition [M]:** `@codemirror/view` 155 KB, `@lezer/javascript` 76 KB, state 46 KB, `@lezer/common`+`lr` 53 KB. `@codemirror/lang-html` statically imports `lang-javascript` and `lang-css`, so the JS grammar is in the bundle whether or not `<script>` matters to us.
- **Monaco composition [M]:** `editor/common` 775 KB, `editor/browser` 663 KB, `base/browser` 450 KB. This is the core alone: `editor.api.js` leaves out most contributions (suggest, comment line, …), and it's still 5× ACE.
- **Workers:** see the source notes below. Measured **[M]**: ACE with `useWorker:false` and CM6 constructed **zero** `Worker`s. Monaco constructed zero workers in Chromium with only Monarch HTML/CSS grammars loaded, both with our options and with defaults, whether `MonacoEnvironment.getWorker` returned a blob worker, threw, or was unset. No console warnings. A blob-URL worker is the documented escape hatch if one is ever needed.

**Workers from `file://` [M]**, tested with a minimal page in all three browsers:

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| `new Worker(blobURL)` built from an inline string | ✅ works | ✅ works | ✅ works |
| `new Worker('sibling.js')` (a file next to the page) | ❌ throws: "cannot be accessed from origin 'null'" | ✅ works | ❌ `onerror` |

So a worker is only viable when it's fully inlined and started from a blob. A worker file in `assets/` breaks in Chrome. That's how the Angry Creative fork ships its HTML-lint worker, so it presumably only works there when served over http **[I]**.

**ACE [S].**
- Workers exist only for syntax-check annotations: `createWorker` in [src/mode/html.js#L51-L54](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/mode/html.js#L51-L54). `useWorker` is a session option ([src/edit_session.js#L926-L933](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/edit_session.js#L926-L933)).
- Highlighting is a main-thread tokenizer.
- The worker is loaded through a blob wrapper that calls `importScripts('<workerUrl>')` ([lib/ace/worker/worker_client.js#L39-L63](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/worker/worker_client.js#L39-L63), `loadWorkerFromBlob: true` in [src/config.js#L19](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/config.js#L19)). That still has to fetch a `file:` URL, so `useWorker: false` is the right setting. The original already does this ([app.coffee#L94](https://github.com/codeinthedark/editor/blob/master/app/scripts/app.coffee#L94)).
- No bundler is needed. `src-min-noconflict/*.js` are plain scripts you concatenate, so the prep flow can inline them with string concatenation.

**CodeMirror 6 [S].**
- No workers in the core packages.
- The [Guide (Architecture › Modularity)](https://codemirror.net/docs/guide/) says it "is not currently practical to run the library without some kind of bundler". So the Core Editor build needs an esbuild/rollup step that emits one IIFE. That's done once at release time, not by Organizers.

**Monaco [S].**
- It runs an editor worker plus html/css/json/ts language workers, with a label → worker map in `min/vs/editor/editor.main.js`.
- If the editor worker can't be created, it warns and runs it on the main thread: [webWorker.ts#L31](https://github.com/microsoft/vscode/blob/6a598d4a13031703d483d103c1d934a36ad27971/src/vs/base/common/worker/webWorker.ts#L31), [editorWorkerService.ts#L472-L491](https://github.com/microsoft/vscode/blob/6a598d4a13031703d483d103c1d934a36ad27971/src/vs/editor/browser/services/editorWorkerService.ts#L472-L491).
- Its own [FAQ](https://github.com/microsoft/monaco-editor/blob/v0.57.0/README.md#faq) says "HTML5 does not allow pages loaded on `file://` to create web workers. Please load the editor with a web server". Our blob test shows `getWorker` returning a blob worker sidesteps that ([standaloneWebWorkerService.ts#L15](https://github.com/microsoft/vscode/blob/6a598d4a13031703d483d103c1d934a36ad27971/src/vs/editor/standalone/browser/services/standaloneWebWorkerService.ts#L15)). `getWorkerUrl` doesn't help, because it is wrapped in a module blob that `import()`s the URL ([webWorkerServiceImpl.ts#L76-L116](https://github.com/microsoft/vscode/blob/6a598d4a13031703d483d103c1d934a36ad27971/src/vs/platform/webWorker/browser/webWorkerServiceImpl.ts#L76-L116)).
- The AMD (script-tag) build is **deprecated since 0.53.0**: "Please migrate to the ESM build", and the ESM build is meant to be used with a bundler ([CHANGELOG](https://github.com/microsoft/monaco-editor/blob/v0.57.0/CHANGELOG.md)).
- In the ESM build, `codicon.css` references a separate `codicon.ttf` (153 KB) that you must inline.
- The FAQ also says mobile browsers are **not supported**.

## 2. HTML mode quality and auto-closing

All three highlight CSS inside `<style>` **[M]**. With the cursor after `a{color:re` inside `<style>`, CM6 resolved `ValueName` inside a `Declaration`, Monaco's internal line tokens reported `lang=css`, and ACE switched to its CSS rules (`mode-html.js` embeds `css_highlight_rules`).

**Auto-close test [M].** I typed this linearly, the way a Contestant types, in Chromium and WebKit:

```
<style>⏎a{color:red}⏎</style>⏎<!-- hi -->⏎<p class="x">t</p>
```

then pasted two lines and pressed Backspace ×3.

| | auto-close **on** (defaults) | auto-close **off** |
|---|---|---|
| ACE | doc ends `…</sp</p>;⏎</style>`: spurious `</style>`, `;` (CSS behaviour), `</p>` | exactly as typed |
| CM6 | spurious trailing `</p>` (`autoCloseTags` + `closeBrackets`) | exactly as typed |
| Monaco | spurious trailing `"}` (bracket/quote auto-close; Monaco has no tag auto-close) | exactly as typed |

All three can be switched off cleanly, and off is what we want. Auto-close is "help", and it's the source of the original's bogus `<ht></ht>` tags. Switches:

- ACE: `behavioursEnabled: false`. `wrapBehavioursEnabled` only matters for wrapping selections.
- CM6: don't add `closeBrackets()`, and pass `html({autoCloseTags: false})`.
- Monaco: `autoClosingBrackets/Quotes: 'never'`, `autoClosingOvertype/autoSurround: 'never'`. It doesn't auto-close tags at all (see sources below).

Auto-indent on Enter stays in CM6 and Monaco (`insertNewlineAndIndent` / language rules). In ACE it went away together with behaviours in this test (no indentation in the "off" document). That matches the original, which ran ACE 1.1 with behaviours on **[I]**.

Sources **[S]**:

**Embedded highlighting**
- ACE embeds CSS/JS via `embedTagRules(CssHighlightRules, "css-", "style")` ([html_highlight_rules.js#L70-L71](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/mode/html_highlight_rules.js#L70-L71)).
- CM6 `lang-html` nests `cssLanguage` for `<style>` and `javascriptLanguage` for `<script>`. It also parses `style=""` attributes as CSS ([lang-html@6.4.12 dist/index.js L501-L531](https://unpkg.com/@codemirror/lang-html@6.4.12/dist/index.js)).
- Monaco's Monarch HTML grammar uses `nextEmbedded: "text/css"` / `"text/javascript"` ([html.ts](https://github.com/microsoft/monaco-editor/blob/v0.57.0/src/languages/definitions/html/html.ts)).

**Auto-close switches**
- ACE: `behavioursEnabled` and `wrapBehavioursEnabled` both default to true ([editor.js#L2908-L2909](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/editor.js#L2908-L2909)). HTML uses `XmlBehaviour`, which auto-closes tags on `>` and inserts attribute quotes.
- CM6: `closeBrackets()` is an opt-in extension that is part of `basicSetup`. `html({autoCloseTags})` is documented in `lang-html` `index.d.ts` L85-L88.
- Monaco: `autoClosingBrackets/Quotes/Delete/Overtype` (`monaco.d.ts` L3952-L3970). It has **no tag auto-close at all** ([monaco-editor#221](https://github.com/microsoft/monaco-editor/issues/221), still open).

**The original's `<ht></ht>` bug (likely cause)**
- On `>`, ACE's XmlBehaviour takes the tag-name token and **truncates it at the cursor**: `token.value.substring(0, position.column - tokenColumn)` ([behaviour/xml.js#L115-L117](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/mode/behaviour/xml.js#L115-L117)). So `>` typed inside `<ht|ml` yields `<ht></ht>ml`.
- brace 0.5.1 has the same truncation and also lacks today's guard that skips auto-close when a `>` already follows ([brace@0.5.1 mode/html.js L1684-L1723](https://unpkg.com/brace@0.5.1/mode/html.js)).
- I found no issue report confirming this. `behavioursEnabled: false` removes the code path entirely.

## 3. Token type and cursor coordinates on every insertion

The original runs on every change: `pos = insert ? range.end : range.start`, then `session.getTokenAt(pos.row, pos.column)`, then `PARTICLE_COLORS[token.type]`, and spawns particles at the cursor's screen position.

- **ACE [M]**: `getTokenAt` returned `comment.xml` in the comment and `string.attribute-value.xml` in `class="x`. Those are **the same keys as the original's `PARTICLE_COLORS`**. `renderer.textToScreenCoordinates(row, col)` returned page coordinates synchronously inside the change handler, in all three browsers. Tokens are cached per row by ACE's background tokenizer, so the lookup is cheap **[S]**.
- **CM6 [M]**: `syntaxTree(state).resolveInner(pos, -1)` gives the Lezer node (`Comment`, `AttributeValue`, `ValueName`, `TagName`, …), and the particle map is re-keyed on those names. `view.coordsAtPos(pos)` works, but reading layout inside an update listener forces a synchronous layout. The documented pattern is `view.requestMeasure({read, write})`, which lands in the next measure cycle (same frame as the DOM update). My first harness kept a stale `pos` across that boundary and got a `RangeError` after a delete, so clamp to `state.doc.length` or read the selection in `read`.
- **Monaco [M]**: no public "token at position". `monaco.editor.tokenize(text, lang)` is public but tokenises the whole string from scratch on every keystroke, and its embedded-CSS results were inconsistent in my test (empty type at the CSS position). The working route is internal: `model.tokenization.getLineTokens(line)` → `getStandardTokenType(i)` (Comment = 1 / String = 2 / Other = 0) or `getForeground(i)` / `getClassName(i)` (`mtk9`). Attribute values in the HTML grammar come back as **Other**, not String. `getScrolledVisiblePosition(pos)` + `getDomNode().getBoundingClientRect()` gives coordinates synchronously.

Sources **[S]**:

**ACE**
- `getTokenAt` returns the token ending at or after `col`, i.e. the one just before the caret ([edit_session.js#L430-L449](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/edit_session.js#L430-L449)).
- `textToScreenCoordinates` calls `getBoundingClientRect`, which is a layout read ([virtual_renderer.js#L1723-L1745](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/virtual_renderer.js#L1723-L1745)).
- The original instead used the private `renderer.$cursorLayer.getPixelPosition(pos, true)`. That's pure arithmetic from cached font metrics ([layer/cursor.js#L180-L195](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/layer/cursor.js#L180-L195)) plus gutter width and scroll offset. It's cheaper, but it's `$`-private.

**CM6**
- `resolveInner` (`@codemirror/language` d.ts L183). `getStyleTags(node)` in `@lezer/highlight` maps a node to its highlight tags, and `highlightingFor(state, tags)` gives the class your `HighlightStyle` assigns. With those, the particle map can key on *the same tags the theme colours*, not on node names.
- `coordsAtPos` throws if called mid-update, and forces a synchronous measure if one is pending ([view dist L8355, L8060-L8071](https://unpkg.com/@codemirror/view@6.43.14/dist/index.js)). `requestMeasure` is in `d.ts` L866-L874, with background in [Guide › Update Cycle](https://codemirror.net/docs/guide/).

**Monaco**
- `getScrolledVisiblePosition` (`monaco.d.ts` L6718-L6729).
- `tokenize` is the only public tokenizer (L1398). `getLineTokens` is absent from `ITextModel`.

## 4. Insertion vs deletion vs paste hooks

Combo rule: +1 per insertion, paste counts 1, deletes count 0.

| | typed char | paste (2 lines) | Backspace ×3 |
|---|---|---|---|
| ACE `session.on('change')` **[M]** | 1 × `insert` each (60) | **1** delta. `editor.on('paste')` fires **before** it, so a flag labels it | 3 × `remove` |
| CM6 `EditorView.updateListener` **[M]** | 1 transaction, `isUserEvent('input')` (`input.type`) | 1 transaction, `isUserEvent('input.paste')` | 3 × `delete` (`delete.backward`) |
| Monaco `onDidChangeModelContent` **[M]** | 1 change each | 1 change; **`onDidPaste` fires *after* it**, so a "set flag on paste" approach mislabels the *next* edit | 3 changes, `text === ''` |

Monaco's change event carries `detailedReasons` with `kind: 'type' | 'paste'` (seen in my run as `insert[type]`, `insert[paste]`), but it's not in `monaco.d.ts` (only `detailedReasonsChangeLengths` is), so it's internal. CM6's user-event annotations are the cleanest model. ACE is the simplest and matches the original line for line (`delta.action === 'insert'` replaces brace's `insertText`).

Caveat: Firefox ignored my synthetic `ClipboardEvent` for all three engines, so I verified paste in Chromium and WebKit only. Real Cmd/Ctrl-V in Firefox goes through the same handlers **[I]**.

**Gotcha (CM6) [S, consistent with M]:** with `autoCloseTags` on, typing `>` dispatches the typed transaction **plus** a second `input.complete` transaction (lang-html `dist/index.js` L627-L668). A naive "count every `input`" combo would count that keystroke twice. My on-mode run logged 61 inserts against 60 off. So count `input.type` + `input.paste` (+ maybe `input.drop`). The full user-event list is in [`@codemirror/state` d.ts L995-L1021](https://unpkg.com/@codemirror/state@6.7.6/dist/index.d.ts).

**ACE [S]**
- `change` delta actions: [edit_session.js#L310](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/edit_session.js#L310), [document.js](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/document.js).
- `editor.on('paste')` fires before the insert: [editor.js#L864-L877](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/editor.js#L864-L877).
- A behaviour insertion (`>` + `</tag>`) would arrive as one insert delta, which is another reason to keep behaviours off.

**Monaco [S]**
- `IModelContentChangedEvent` (`monaco.d.ts` L3247-L3286) has no typed-vs-paste field.
- `onDidChangeCursorPosition` carries `reason: CursorChangeReason.Paste` (L3363-L3409). That's a public, if indirect, way to label pastes.

## 5. Typing latency and the animated theme

**Measured [M]** (headless Playwright, 1,280×800). The document had ~1,500 lines: 100 CSS rules in `<style>`, plus 400 lines each with a comment, an attribute string and text. The original's `pulse` (opacity) and `grow` (`display:inline-block; transform: scale(1.3)`) animations ran on comments and strings throughout. I typed 183 keys at 25 ms intervals and measured keydown → after the next frame (rAF + MessageChannel):

| keydown → next frame | p50 | p95 | max |
|---|---|---|---|
| ACE — Chromium / Firefox / WebKit | 10.5 / 3 / 11 ms | 17.5 / 8 / 18 ms | 18 / 30 / 43 ms |
| CM6 — Chromium / Firefox / WebKit | 10 / 5 / 10 ms | 17 / 10 / 17 ms | 19 / 14 / 19 ms |
| Monaco — Chromium / Firefox / WebKit | 8 / 4 / 10 ms | 16.5 / 7 / 17 ms | 17 / 16 / 21 ms |

All three deliver each keystroke within the next 60 Hz frame at p95 on every engine. Differences are within frame-alignment noise. Firefox's Event Timing reported no events over 16 ms for CM6 or Monaco, and 7 for ACE (max 32 ms). This doesn't discriminate between engines. Rule 4's real risk is our own Power Mode loop (the original's #10), not the editor.

Structural notes:

- All three render only the visible viewport, so animated tokens off-screen cost nothing **[S]**.
- All three rebuild a changed line's DOM, so the CSS animation on tokens in the line being edited **restarts** on every keystroke. The original has the same behaviour with ACE, so it's parity, not a regression **[I]**.
- `grow` uses `transform` on `inline-block` spans. That avoids reflow but promotes many small layers. Keep animations to `opacity`/`transform` in any engine **[I]**.
- Monaco on Chromium now takes input through the **EditContext API** (`div.native-edit-context`) rather than a textarea; on Firefox and WebKit it uses a textarea **[M]**. That's a newer, Chromium-only input path for Contestant-owned browsers.

Sources **[S]**:
- **CM6** renders the viewport plus a margin and batches DOM reads/writes in a measure phase ([Guide › Viewport, Update Cycle](https://codemirror.net/docs/guide/)).
- **ACE** re-renders only changed rows (`updateLines`, [layer/text.js#L176](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/layer/text.js#L176)). It emits token classes as `"ace_" + type.replace(/\./g, " ace_")` ([#L419](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/layer/text.js#L419)).
- I found no first-party typing-latency benchmarks for any of the three. The numbers above are my own.
- To keep pulses in sync on the line being typed, animate a CSS variable on a parent element (e.g. `--pulse` driving `opacity`) instead of a per-span `animation`. This is a possible improvement over the original, not a parity requirement **[I]**.

## 6. Theming (vibrant_ink, 20 px pixel font)

- **ACE**: `ace-builds` still ships `theme-vibrant_ink.js` (3 KB) **[M]**. The original's SCSS overrides (`#editor .ace_comment { … animation: grow }`, `.ace_string { animation: pulse }`, power-mode colour swaps on `body.power-mode #editor .ace_keyword` etc.) target ACE's semantic token classes and **port verbatim**. Font: `setFontSize(20)` (or `fontSize: 20`) plus a CSS `font-family` on the editor element. ACE measures the character width from the font, so the inlined `@font-face` must have loaded before or during setup, or you call `renderer.updateFontSize()` afterwards **[I]**.
- **CM6**: theme = `EditorView.theme({...}, {dark: true})` for chrome + `HighlightStyle.define([{tag, color, class}])` for tokens. The `class:` option lets comment/string tokens get stable class names for the pulse/grow animations **[M]** (used in the test page). vibrant_ink has to be hand-ported. It's about 15 colours.
- **Monaco**: `defineTheme` rules only take `foreground`/`background`/`fontStyle` per token scope. Rendered spans get colour-indexed classes (`mtk1`…`mtk24`, observed **[M]**), not semantic ones. Animating "all comments" means giving comments a unique colour and finding its `mtkN` at runtime, or using decorations. Both are hacks against the engine.
- All three take an arbitrary `@font-face` (inlined data URI) and `fontSize: 20`. Press Start 2P is monospace, which all three require.

Sources **[S]**:
- **ACE:** vibrant_ink is `cssClass "ace-vibrant-ink"`, `isDark: true` ([src/theme/vibrant_ink.js](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/theme/vibrant_ink.js)). Its `.ace_comment` / `.ace_string` rules are in [vibrant_ink-css.js#L90-L98](https://github.com/ajaxorg/ace/blob/62d5ffd789b4eb29ef7c1acc17554c91c745a307/src/theme/vibrant_ink-css.js#L90-L98).
- **CM6:** `EditorView.theme` is covered in [Styling example](https://codemirror.net/examples/styling/). The `TagStyle` `class` option is in `@codemirror/language` d.ts L916-L931.
- **Monaco:** `ITokenThemeRule` only takes `{token, foreground, background, fontStyle}` (`monaco.d.ts` L1471-L1476). The class is `'mtk' + foregroundColorIndex` ([encodedTokenAttributes.ts#L127](https://github.com/microsoft/vscode/blob/6a598d4a13031703d483d103c1d934a36ad27971/src/vs/editor/common/encodedTokenAttributes.ts#L127)), and there is no public colour-map API.

## 7. Maintenance health and licence

Checked 2026-10-12 against `npm view <pkg> time`, the GitHub API and the CodeMirror forge API **[S]**.

| | Latest | Released | Activity | Licence |
|---|---|---|---|---|
| `ace-builds` | 1.44.0 | npm 2026-05-11 (prev. 1.43.6 2026-01-23) | [ajaxorg/ace](https://github.com/ajaxorg/ace) last push 2026-09-23 (security fix, diff work); 136 open issues | BSD-3-Clause |
| `@codemirror/view` | 6.43.14 | 2026-10-07 (6.43.12 09-15, .13 09-22) | commits 2026-10-06…10-09; 18 open issues on `dev` | MIT |
| `@codemirror/state` / `lang-html` | 6.7.6 / 6.4.12 | 2026-09-22 / 2026-08-04 | | MIT |
| `monaco-editor` | 0.57.0 | 2026-09-24 (0.56.0 2026-07-20) | last push 2026-10-03, mostly dependabot; 875 open issues | MIT |

- **ACE**: steady but slower release cadence; active commits in 2026. The Angry Creative CITD fork already uses `ace-builds` (see the original survey).
- **CodeMirror moved off GitHub**: `github.com/codemirror/*` was archived on 2026-04-15, and the READMEs point to [code.haverbeke.berlin/codemirror](https://code.haverbeke.berlin/codemirror/dev). The npm `repository` fields point there too. The project is very active, but the bus factor is low: it's essentially one maintainer (Marijn Haverbeke) **[I]**.
- **Monaco** follows VS Code (each release pins a `vscodeRef`). It's healthy, but its priorities are VS Code's: AMD deprecated, no mobile support, no `file://` story.
- **Browser support**: CM6 claims everything from IE11 (with polyfills) plus native mobile editing ([codemirror.net](https://codemirror.net/)). ACE publishes no browser matrix. Monaco says mobile is unsupported. All three passed the behaviour test in current Chromium, Firefox and WebKit **[M]**.
- All three licences are permissive and compatible with this repo's BSD-3-Clause. Keep ACE's BSD notice (or CM6/Monaco's MIT notice) in the inlined file's header.

## Method

Everything ran in a scratch dir outside the repo, on 2026-10-12, with Node 24.21 and esbuild 0.28.2 (minify, IIFE, `.ttf` → data URL). Versions: `ace-builds@1.44.0`, `@codemirror/view@6.43.14`, `state@6.7.6`, `language@6.13.1`, `commands@6.11.1`, `lang-html@6.4.12`, `search@6.7.2`, `codemirror@6.0.2`, `monaco-editor@0.57.0`.

- **Sizes:** ACE uses the prebuilt `src-min-noconflict/*.js` files, concatenated. CM6 and Monaco are esbuild bundles of a minimal entry: Monaco is `monaco-editor/editor/editor.api.js` + `languages/definitions/{html,css}/register.js`. In 0.57 the package's export map is `"./*": "./esm/vs/*.js"`, so the old `esm/vs/basic-languages/...` paths no longer resolve. Gzip is level 9.
- **Behaviour:** one fully inlined `.html` per engine, opened over `file://` with Playwright 1.64 in Chromium, Firefox and WebKit. A shared harness wraps `window.Worker` to count constructions, logs every change event with its kind, the token under the cursor and the cursor's screen coordinates, and records keydown → next-frame latency. Text was typed with `keyboard.type`. Paste was a synthetic `ClipboardEvent` with a `DataTransfer` (ignored by Firefox).
- Not tested: real IME input, mobile/touch, very old browsers, real 120 Hz hardware, or an actual Power Mode particle loop running alongside the editor.
