# What a `file://` page can rely on across browsers

Research for [#3](https://github.com/rymdkrog/code-in-the-dark-editor/issues/3) (part of map #1), 2026-10-12.

Every claim carries one of these tags:
- **[E]**: verified empirically on this Mac (Apple M5, macOS 26) with Playwright 1.64 in headless Chromium 156, Google Chrome 154, Firefox 157 and WebKit 27.2.
  - Firefox runs with `security.fileuri.strict_origin_policy=true`, the shipping default. Playwright turns it off, so this setting had to be restored. With it off, Firefox shares storage like Chromium.
  - WebKit is Playwright's WebKit build, not Safari.app. Its storage results agree with the WebKit source cited below.
- **[S]**: sourced from a spec, MDN/BCD, a browser blog, a bug tracker, or browser source read on `main` today.
- **[I]**: inferred or unconfirmed.

Edge, Brave and Arc run the Chromium engine, so they inherit Chromium behaviour unless a row says otherwise. Test harness: the `pw/` and `t/` scratch files in the session scratchpad (not committed). Each test is described inline so it can be rebuilt.

## Compatibility table

| | Chromium (Chrome, Edge, Brave, Arc) | Firefox | Safari / WebKit |
|---|---|---|---|
| `location.origin` / `self.origin` | `"file://"` / `"null"` **[E]** | `"null"` / `"null"` **[E]** | `"file://"` / `"null"` **[E]** |
| `isSecureContext` | true **[E][S]** | true **[E][S]** | true **[E][S]** |
| localStorage available | yes **[E]** | yes **[E]** | yes **[E][S]** |
| IndexedDB available | yes **[E]** | yes **[E]** (fails on paths ≥ 112 chars, bug 1143003 **[S]**) | yes **[E]** |
| **Storage scope** | **one store shared by every local file** **[E][S]** | **one store per file path** (query/hash ignored) **[E][S]** | **one store shared by every local file** **[E][S]** |
| Survives browser restart | yes **[E]** | yes, same path only **[E]** | yes **[E]** (ITP 7-day cap on file:// unknown **[I]**) |
| `storage` event / BroadcastChannel to other tabs | yes, all local files **[E]** | yes, same file only **[E]** | **none delivered** **[E]** (values still shared) |
| OPFS `navigator.storage.getDirectory()` | **throws SecurityError** **[E]** | works **[E]** | works **[E]** |
| `Origin` header on fetch and WebSocket | `null` **[E][S]** | `null` **[E][S]** | `null` **[E][S]** |
| CORS that works | `ACAO: *` or `null`. Credentials only with `null` + `ACAC: true` **[E][S]** | same **[E][S]** | same **[E][S]** |
| Mixed content (http/ws from file) | not enforced **[E][S]** | not enforced **[E][S]** | not enforced **[E][S]** |
| Local Network Access / PNA prompt | never (file counts as loopback) **[S]**, none seen **[E]** | n/a | n/a |
| 30 MB of inlined data-URI images | loads in ~0.15–0.6 s **[E]** | ~0.15–0.4 s **[E]** | ~0.3–0.7 s **[E]** |
| data: URL cap | 512 MB. Inline `img` works past 2 MB **[E]**. Navigations/IPC capped at 2 MB **[S]** | 512 MB since Fx 136, 32 MB before **[S]** | 2 GB **[S]** |
| Reveal: `sandbox="allow-scripts"` srcdoc + **data:** URIs | images, CSS `url()` and scripts all work **[E]** | same **[E]** | same **[E]** |
| Reveal: sandboxed srcdoc + **blob:** URLs from parent | **images blocked** **[E]** | **blocked** **[E]** | **blocked** **[E]** |
| Reveal: sandboxed srcdoc + `<base href="file:///…/">` | images blocked **[E]** | blocked **[E]** | works **[E]** |
| Reveal: unsandboxed srcdoc (blob or `<base>`) | works, but Contestant JS gets the editor's storage **[E]** | same **[E]** | same **[E]** |
| `<dialog>.showModal()` (works in fullscreen) | yes **[E][S]** | yes (Fx 98+) **[E][S]** | yes (15.4+) **[E][S]** |
| `prompt()`/`confirm()`/`alert()` in fullscreen | **exits fullscreen** **[S]** | unconfirmed on desktop **[I]** | unconfirmed **[I]** |
| Fullscreen API | yes, needs a user gesture **[E]** | yes **[E]** | yes, unprefixed since 16.4 **[S]** |
| `beforeunload` prompt | generic text only, needs sticky activation **[E][S]** | same **[E][S]** | same **[E][S]** |
| `<a download>` with blob: URL | works **[E]** | works **[E]** | works **[E]** |
| `showSaveFilePicker` | Chrome/Edge yes, works on file:// **[S]**. **Brave: off by default** **[S]** | absent **[E][S]** | absent **[E][S]** |

## Storage

### Scoping

The URL spec leaves the origin of a `file:` URL implementation-defined (see [MDN, "File origins"](https://developer.mozilla.org/en-US/docs/Web/Security/Same-origin_policy)). The engines chose differently.

Test **[E]**: `dirA/a.html` writes localStorage and IndexedDB. Then `dirA/a.html`, `dirA/b.html` and `dirB/c.html` read, and the reads repeat after closing and reopening the persistent profile.

**Chromium: one global store.**
- **[E]** a.html, b.html and c.html (other directory) all read a's value from both localStorage and IndexedDB, before and after restart.
- **[S]** Chromium's `url/origin.h` says "'file' URLs all parse as ("file", "", 0)". Blink's `SecurityOrigin::CanAccessLocalStorage()` is `!IsOpaque()`. When `--allow-file-access-from-files` is not set, the origin only *serializes* as `null` (`SerializesAsNull()` / `BlockLocalAccessFromLocalOrigin()` in `document_loader.cc`); it is not opaque.
- **[S]** Chromium engineers on [whatwg/html#3099](https://github.com/whatwg/html/issues/3099): Mike West, 2017, Chrome "shares localStorage across all file: URLs"; Matt Menke, 2020, "localStorage for [file] URLs is global".

**Firefox: one store per file path.**
- **[E]** a.html reads its own value (with or without `?query`), including after restart. b.html in the same directory and c.html read `null`.
- **[S]** File URLs became unique origins in Firefox 68 ([bug 1558299](https://bugzilla.mozilla.org/show_bug.cgi?id=1558299), CVE-2019-11730).
- **[S]** localStorage stopped being shared per directory in Firefox 92. [Bug 1730419](https://bugzilla.mozilla.org/show_bug.cgi?id=1730419) was closed INVALID, meaning intended: Firefox "treats each distinct file URL (distinct except for anchors or parameters) as a new origin."
- **[S]** `caps/ContentPrincipal.cpp` keys local-file storage by "the file path".
- **[S]** The `security.fileuri.strict_origin_policy` pref still exists. Turning it off makes all files share one store, but it corrupted a profile's QuotaManager origins ([bug 1536596](https://bugzilla.mozilla.org/show_bug.cgi?id=1536596)). **Never tell Contestants to flip it.**
- **[S]** IndexedDB fails with `UnknownError` on file paths of 112 characters or more ([bug 1143003](https://bugzilla.mozilla.org/show_bug.cgi?id=1143003), still open).

**Safari/WebKit: one global store.**
- **[E]** Same result as Chromium.
- **[S]** `SecurityOrigin::shouldIgnoreHost` is true for `file:`, so every file maps to ("file", "", none).
- **[S]** Storage access from file URLs is permitted because `NeedsStorageAccessFromFileURLsQuirk` defaults to true (`UnifiedWebPreferences.yaml`, `ScriptExecutionContext::canAccessResource`). An older note saying Safari blocks file:// localStorage is out of date.
- **[S]** Menke (2020, #3099): "Safari looks to have a global file localStorage."

**MDN is wrong for two engines.** Its [localStorage page](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage) says "in all current browsers, localStorage seems to return a different object for each file: URL". That holds only for Firefox.

**This explains the original's bug.** Its global `localStorage.content` key was shared by every Round's `editor.html` in Chromium and Safari, so code leaked between Rounds. In Firefox the same key was lost whenever the file was opened from a new path, for example a fresh copy off the USB stick.

### Persistence and clearing

- **[E]** localStorage and IndexedDB both survive a browser restart in all engines. In Firefox this holds only at the same path.
- **[E]** `navigator.storage.persisted()` is `false` everywhere. Whether `persist()` is ever granted on file:// is **[I]** unconfirmed.
- **[E]** `sessionStorage` is per tab, as usual. A new tab starts empty.
- **[S]** Private and incognito windows clear storage when the last private tab closes ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)).
- **[I]** No primary source covers how Firefox's "delete cookies and site data when closed", Chrome's "clear on exit" or Brave Shields treat file:// storage. The same is true of Safari's [ITP 7-day script-writable-storage cap](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/).
- **[I]** Rounds last 15 minutes and happen on the day, so none of these matter unless the Contestant uses a private window or quits the browser with clear-on-exit turned on.

### Multiple tabs

- **[E]** Chromium delivers `storage` events and BroadcastChannel messages to tabs of *any* local file.
- **[E]** Firefox delivers them only to tabs of the same file.
- **[E]** WebKit delivered **neither**, even though the second tab reads the new value immediately.

## Network from `file://`

Test **[E]**: a local Node HTTP + WebSocket server logs the `Origin` header. Requests go to localhost, to the LAN IP `192.168.1.x`, to `https://httpbin.org/headers` (http and https), and to `wss://echo.websocket.org`.

- **`Origin: null` everywhere**, for fetch (simple and preflighted) and for the WebSocket handshake. **[E]** all four engines.
  - Spec **[S]**: HTML serializes an opaque origin as `"null"`, and [Fetch](https://fetch.spec.whatwg.org/) sends `Origin` for CORS and WebSocket requests.
  - Chromium source **[S]**: `request_conversion.cc` derives an opaque initiator for file: unless `--allow-file-access-from-files` is set. For WebSockets, `websocket_connector_impl.cc` `MaybeTreatLocalOriginAsOpaque` does the same (crbug 1206736).
  - Firefox **[S]**: `nsContentUtils::GetWebExposedOriginSerialization` returns "null" for file.
  - WebKit **[S]**: `SecurityOrigin::toString()` returns "null" for file when file-path separation is enforced, which is the default.
  - `Sec-Fetch-Site: cross-site` on https **[E]**.
- **CORS** **[E][S]**:
  - Responses need `Access-Control-Allow-Origin: *` or `null`. Without it the read fails, and a `no-cors` request returns an opaque response.
  - `credentials: 'include'` fails with `*` and works only with `null` plus `Access-Control-Allow-Credentials: true`.
  - JSON POST preflights work.
  - **[S]** Every file:// page, every sandboxed iframe and every data: document also sends `null`, so **Origin cannot authenticate the Core Editor**. An Origin allow-list adds no security.
  - `navigator.sendBeacon` works **[E]**.
- **Cloudflare** **[S]**: the [Workers WebSocket](https://developers.cloudflare.com/workers/runtime-apis/websockets/) and [Durable Objects WebSocket](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) docs say nothing about Origin. The header reaches Worker code, and validating it is the app's job. **[I]** Whether Cloudflare's edge ever rejects `Origin: null` is undocumented, so check it once against a real Worker.
- **Mixed content is not enforced** from file:// **[E][S]**. `http://` fetches to public and LAN hosts and `ws://` to a LAN IP all succeeded. In source, each engine restricts mixed content only when the document is `https`. Use wss/https anyway.
- **Local Network Access** (Chrome 142+, [blog](https://developer.chrome.com/blog/local-network-access)) **[S]**: `ip_address_space_util.cc` maps `file:` URLs to the loopback address space. A file:// page is therefore never "less private" than its target, so no prompt appears for localhost, the LAN or the public internet. **[E]** No prompt or preflight header was seen in headless Chrome.
- **[S]** `isSecureContext` is true in every engine ([Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/): "file" is potentially trustworthy), so secure-context-only APIs are exposed.

## Inlining limits

Test **[E]**: single HTML files of 4.8, 14.4 and 28.8 MB (one, three and six incompressible 1200×1000 PNGs as base64 data URIs) and a 40 MB file holding a single 30 MB PNG. The assets sit as JSON in a `<script type="application/json">` block, the way a Round package could carry them. Measured on an M5; **expect several times slower on a 2018-era laptop [I]**.

| File | `goto` (load) | `JSON.parse` | decode all images | data: → Blob |
|---|---|---|---|---|
| 4.8 MB | 0.1 s, all engines | 3–6 ms | 13–27 ms | 5–30 ms |
| 28.8 MB | 0.13–0.27 s | 12–39 ms | 80–133 ms | 32–128 ms |
| 40 MB (one 30 MB image) | 0.29–0.68 s | 15–47 ms | 99–172 ms | 59–204 ms |

- No engine hit a hard cap. Chromium decoded a 40 MB `img src="data:…"` fine **[E]**. Chromium JS heap stayed at 16–57 MB **[E]**.
- Data: URL caps **[S]** ([MDN](https://developer.mozilla.org/en-US/docs/Web/URI/Reference/Schemes/data)):
  - Chromium and Firefox: 512 MB.
  - Safari: 2 GB.
  - **Firefox before 136: 32 MB per data: URL, and 256 KB before 97.**
- Chromium's [2 MB URL limit](https://chromium.googlesource.com/chromium/src/+/main/docs/security/url_display_guidelines/url_display_guidelines.md) (`kMaxURLChars`) silently empties URLs that cross a process boundary **[S]**. That covers navigating a frame to a data: URL, `window.open`, and probably an `<a download href="data:…">`. It does **not** affect inline `img`/CSS data URIs **[E]**.
- Top-level navigation to data: is blocked everywhere **[S]**.

## Reveal rendering

Test **[E]**: the Contestant's code is used exactly as typed: `<img src="red.png">`, a `<style>` with `background:url(green.png)`, and a `<script>` that `postMessage`s back its origin and whether localStorage works. A screenshot pixel check confirms the images rendered. Seven strategies were tried.

| Strategy | Chromium | Firefox | WebKit |
|---|---|---|---|
| A. `sandbox="allow-scripts"` srcdoc, filenames → parent's blob: URLs | scripts ✓, images ✗ | scripts ✓, images ✗ | scripts ✓, images ✗ |
| **B. `sandbox="allow-scripts"` srcdoc, filenames → data: URIs** | **all ✓, storage blocked** | **all ✓, storage blocked** | **all ✓, storage blocked** |
| C. unsandboxed srcdoc, blob: URLs | all ✓, **storage readable** | same | same |
| D. sandboxed srcdoc + `<base href="file:///…/assets/">` | images ✗ | images ✗ | all ✓ |
| E. sandboxed iframe whose src is a blob: HTML document | images ✗ | images ✗ | images ✗ |
| F. `sandbox=""` (no scripts) | scripts ✗ (as designed), blob images ✗ | same | same |
| G. unsandboxed srcdoc + `<base href>` to the asset folder | all ✓, storage readable | same | same |

- A sandboxed frame has a fresh opaque origin, so it cannot fetch blob: URLs minted by the `file://` parent (`blob:null/<uuid>`). Chromium logs "Not allowed to load local resource" **[E]**.
- **[S]** Chromium has a related bug where blob URLs created in a Worker fail on file:// ([crbug 366055344](https://issues.chromium.org/issues/366055344)), so mint blob URLs on the main thread if they are ever used.
- **[S]** By spec, srcdoc inherits the parent's origin and base URL, and an explicit `<base>` overrides the base URL ([HTML](https://html.spec.whatwg.org/multipage/document-sequences.html)).
- An unsandboxed srcdoc (C, G) runs Contestant JS with the editor's origin. In Chromium and Safari that means the *shared* file:// storage, plus the parent's DOM **[E]**.
- **Strategy B works identically in all engines, at scale:**
  - With 28.8 MB of data URIs substituted, the rewrite took 11–33 ms and the frame loaded with all images in 0.1–0.46 s **[E]**.
  - Scripts run under `allow-scripts` and are blocked without it **[E]**, so whether Contestant JS runs at the Reveal is a single attribute.
  - Storage throws `SecurityError` inside the frame **[E]**.
- The original's approach, `document.documentElement.innerHTML = code`, never ran scripts **[I]**, as noted in [original-editor.md](original-editor.md).

## Dialogs, fullscreen, unload

- **`<dialog>.showModal()`** works in every engine and opens in the top layer, so it shows over a fullscreen element **[E]**. Support: Chrome 37, Firefox 98, Safari 15.4 **[S]**. Popover is also available **[E]**.
- **`prompt()`, `confirm()` and `alert()` exit fullscreen in Chromium.** `web_contents_impl.cc` calls `ForSecurityDropFullscreen` before any JS dialog, before the beforeunload dialog and before the file chooser: "Running a dialog causes an exit to webpage-initiated fullscreen" (crbug 728276) **[S]**.
  - Firefox has a similar fix on Android (bug 1798798, CVE-2023-25748). Desktop Firefox and Safari are **[I]** unconfirmed.
  - Headless Playwright auto-answers dialogs, so it cannot show this. The headless tests stayed fullscreen, which proves nothing.
- **Fullscreen API** works on file:// after a click in all engines **[E]**.
  - Safari has had unprefixed `requestFullscreen` since 16.4, and keyboard input has worked in HTML fullscreen since Safari 10.1 ([WebKit blog](https://webkit.org/blog/7477/)) **[S]**.
  - Browser-level presentation and kiosk modes (F11, Chrome `--kiosk`, macOS green button) sit outside the page's control and were not tested **[I]**.
- **`beforeunload`** **[E][S]**:
  - Without any prior user interaction, no prompt appears in any engine. After a click, every engine shows the prompt.
  - Only a generic browser string is shown; the custom text ("Hold your horses!") is ignored ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event)).
  - Use `preventDefault()` plus `returnValue`.
  - It is a nicety, not a safety net.

## Saving a backup to disk

- **`<a download="…">` with a blob: URL works from file:// in all engines** **[E]**. A small data: URL also works **[E]**, but in Chromium a data: download over 2 MB is at risk (see Inlining).
  - Support: Chrome 14, Firefox 20, Safari 10.1 **[S]**.
  - **[I]** Where the file lands (Downloads, or an "ask where to save" dialog) depends on the Contestant's browser settings.
- **`showSaveFilePicker`** **[S]**:
  - Exposed only in Chrome and Edge 86+. In Blink it needs a non-opaque storage origin and a user gesture, and the browser side needs a potentially trustworthy origin; file:// passes both, so **it works from file://**.
  - **Brave ships it disabled** ([brave-browser#11407](https://github.com/brave/brave-browser/issues/11407)).
  - Firefox and Safari don't expose it **[E]**.
  - Only usable as progressive enhancement, for example writing a rolling backup file after one picker click.
- **OPFS** throws `SecurityError` on file:// in Chromium **[E]** and works in Firefox and WebKit **[E]**. Don't use it.

## Constraints on the Core Editor

1. **Namespace every storage key by a Round ID baked into the file**, for example `citd2:<roundId>:code`.
   - Chromium and Safari share one store across *all* local files, including other Rounds' editors and any other HTML the Contestant opens. Global keys like the original's `content` and `name` leak code between Rounds.
   - Never `localStorage.clear()`, and never read keys that belong to another Round.
2. **Assume Firefox storage is tied to the exact file path.**
   - Moving, renaming or re-copying the file mid-Round "loses" the autosave: it is still there, but only under the old path.
   - The file should be opened from its final location before the Round starts.
   - Keep the absolute path under ~100 characters, because of IndexedDB bug 1143003. localStorage has no such limit.
3. **Autosave to `localStorage`.** It is synchronous, available everywhere, and the code is only kilobytes.
   - IndexedDB works too, and OPFS is out because Chromium blocks it.
   - Never put Round assets in storage. They live in the HTML file.
   - Treat storage as best effort, because of private windows and clear-on-exit settings. **Offer a "save backup" download** via `<a download>` + blob.
4. **Don't use `prompt()`, `confirm()` or `alert()`** for the name, the Finish confirmation or anything else. Chromium drops fullscreen when they open.
   - Use `<dialog>.showModal()`, which works everywhere and over fullscreen.
   - Treat `beforeunload` as a generic, activation-gated extra. Autosave is the real guarantee.
5. **Reveal = `<iframe sandbox="allow-scripts" srcdoc>`**, with the Contestant's relative asset references rewritten to data: URIs before rendering.
   - This is the only strategy that rendered images and CSS `url()` identically in all engines while keeping Contestant JS away from the editor's (shared) storage and DOM.
   - Blob: URLs and `<base href>` fail in a sandboxed frame in Chromium and Firefox.
   - The rewrite must cover `src`, `href`, `srcset`, CSS `url()` and `@import`, with and without quotes and with `./` or an `assets/` prefix.
   - Whether to drop `allow-scripts` is a rule decision.
6. **Don't use multi-tab detection based on `storage` events or BroadcastChannel.** WebKit delivered neither. If "opened twice" matters, poll a heartbeat key instead.
7. **No `file://` feature-detection surprises.** `isSecureContext` is true everywhere. `location.origin` differs: `"file://"` in Chromium and WebKit, `"null"` in Firefox. Don't branch on it.

## Constraints on Round packages, the prep flow and the backend

1. **Fully inlined is viable.** A 30 MB single file with data-URI assets loads in under a second on all engines on modern hardware. Prefer it over the `editor.html` + `assets/` folder: the sandboxed Reveal needs the asset bytes in the page, and a folder-based Reveal only works unsandboxed.
2. **Keep each inlined asset under 32 MB**, for Firefox before 136, and the whole file in the tens of MB, not hundreds.
   - Store assets as data in a non-executed block, such as `<script type="application/json">`, keyed by the original filename the Contestant will type.
   - The Reference screenshot goes in the same way.
3. **Give every Round a unique ID**, one per Heat and the Final, embedded at prep time. Storage namespacing (Core Editor item 1) depends on it, and so does any rehearsal check.
4. **The Worker must accept `Origin: null`.**
   - Reply with `Access-Control-Allow-Origin: *`, or `null` if credentials are needed, and accept WebSocket upgrades whose Origin is `null` or missing.
   - Cookies are impractical, so authenticate with a token carried in the Round package or the URL, not by Origin. Every local file and sandboxed frame looks the same.
   - A `ws://` LAN host would also work if a venue-local backend is ever wanted, since nothing blocks mixed content or local-network access from file://.
5. **Don't depend on `showSaveFilePicker`.** Brave, Firefox and Safari lack it. `<a download>` is the universal path.

## Not confirmed / open

- Real Safari.app behaviour: everything above used Playwright WebKit plus WebKit source. That includes the ITP 7-day cap, private windows and "Disable Local File Restrictions" in the Develop menu.
- Whether `prompt()` exits fullscreen in desktop Firefox and Safari. This is moot if v2 never calls it.
- Brave Shields and the clear-on-exit settings in each browser, as they affect file:// storage.
- Whether Cloudflare's edge, as opposed to Worker code, ever rejects `Origin: null`.
- Load times on low-end Contestant laptops.
