# Cloudflare real-time options for the Audience layer

Answers [#4](https://github.com/rymdkrog/code-in-the-dark-editor/issues/4). Researched 2026-10-12 against developers.cloudflare.com (pricing and limits pages show "Last updated Sep 30, 2026"; Workers limits "Oct 8, 2026"), the `cloudflare/partykit` and `cloudflare/agents` repos, and the published npm tarballs. Nothing was deployed. **[V]** means verified in a primary source. **[I]** means inferred or calculated.

## Recommendation

Use **one plain Durable Object per Competition, built on the WebSocket Hibernation API**, with no framework. Put a ~30-line Worker in front of it. On the client, use a **hand-written reconnecting socket of about 40 lines**, inlined into each Enhancement script. Don't use `partysocket`.

- The whole Audience layer fits in one object. 312 sockets is about 1% of the per-object cap. A typical event stays inside the **Workers Free** plan, and a heavy one stays inside the **$5/month Workers Paid** minimum.
- PartyServer works, but at this size it only saves the `broadcast` and tag helpers. In exchange it adds a dependency and a URL convention. The Agents SDK and Realtime (WebRTC) products are heavier and aimed at other jobs.
- `partysocket` can log through `console.warn`/`console.error` and can throw. That breaks the "never throws, blocks or logs" rule (see [Client](#client-reconnect-pattern)).

## Options compared

| Option | What it is | Fit |
|---|---|---|
| **Durable Objects + WebSocket Hibernation API** | Cloudflare's primitive. `ctx.acceptWebSocket()`, `webSocketMessage/Close/Error` handlers, tags, attachments, auto-response. **[V]** [WebSockets best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) calls it the recommended option. | **Chosen.** No dependencies, and the server is about 150 lines **[I]**. |
| **PartyServer** (`partyserver` 0.5.10, published 2026-08-03) | A `Server` class that "extends `DurableObject`", adding `onConnect/onMessage/onClose/onError/onRequest/onStart`, `broadcast(msg, exclude)`, `getConnections(tag)`, `connection.setState()` (≤ 2 KB), and `routePartykitRequest()` for `/parties/:server/:name`, with `onBeforeConnect` hooks. Hibernation needs `static options = { hibernate: true }`. **[V]** [README](https://github.com/cloudflare/partykit/blob/main/packages/partyserver/README.md) | Viable. Still a Durable Object, so the limits and pricing below are the same. It saves about 20 lines and adds a `nanoid` dependency and the `/parties/…` naming. The repo README says "Work in Progress". **[V]** |
| **PartyKit hosted platform** (partykit.io) | The original product. The partykit repo is now `cloudflare/partykit` and describes PartyServer as "Inspired by PartyKit". **[V]** | Not considered. The maintained path is PartyServer on your own Worker. |
| **Agents SDK** (`agents` 0.28.0) | AI-agent runtime on Durable Objects: `setState` syncs to all clients, `AgentClient`, `useAgent`. Depends on `partysocket` 1.3.0 and has about 20 optional AI peer dependencies. **[V]** [docs](https://developers.cloudflare.com/agents/api-reference/agents-api/), [package.json](https://github.com/cloudflare/agents/blob/main/packages/agents/package.json) | The newest option, but oversized. State sync is nice, but the timer and tallies are a few fields. |
| **Realtime SFU DataChannels / RealtimeKit** | WebRTC media products. DataChannels "exchange chat, sensor updates, and control events between WebRTC endpoints". RealtimeKit advertises reactions and polls inside meetings. **[V]** [Realtime](https://developers.cloudflare.com/realtime/) | No. It needs WebRTC negotiation on every phone, and you'd build the fan-out yourself anyway. |
| **Cloudflare Pub/Sub** (MQTT) | Private beta since 2022, and accounts must be granted access. **[V]** ([blog](https://blog.cloudflare.com/announcing-pubsub-programmable-mqtt-messaging), [docs](https://developers.cloudflare.com/pub-sub)) | No. A different Organizer can't self-serve it. |

Nothing newer than Hibernation and PartyServer fits better. Recent Durable Objects changes are incremental **[V]** ([release notes](https://developers.cloudflare.com/durable-objects/release-notes/), [WebSocket API](https://developers.cloudflare.com/durable-objects/api/websockets/)):

- SQLite Durable Objects on the Free plan (2025-04-07).
- Message size raised to 32 MiB (2025-10-25).
- Runtime auto-replies to Close frames with compatibility date ≥ 2026-04-07.
- Declarative `exports` replaces `migrations` in the Wrangler config (2026-06-30).

## Session / connection topology

```
 Audience phones (50–300)     Contestant laptops (10)      Stage (1)        Host (1)
 audience page (hosted)       Core Editor + Enhancement    stage page       host console
        │ wss                        │ wss (receive-only)     │ wss            │ wss + host secret
        └──────────────┬─────────────┴───────────┬────────────┴────────────────┘
                       ▼                         ▼
        Worker  GET /c/<code>/ws?role=…&seat=…     (checks Upgrade, routes, never checks Origin)
                       │  env.COMPETITION.getByName(code).fetch(req)
                       ▼
        Durable Object "Competition <code>"  (SQLite-backed, hibernating)
          sockets tagged: role:audience | role:contestant + seat:3 | role:stage | role:host
          state (SQLite + memory): phase, current Round, timer {endsAt|pausedRemaining}, vote tallies
```

- **One object per Competition**, addressed by a short session code with `getByName(code)` **[V]** ([example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)). Use one object rather than one per Round: the Host, Stage and phones stay connected across all 4 Heats and the Final, and the Round becomes a field in the object's state. How the code is created and shared is for #6.
- **Tags route messages.** Each socket gets up to 10 tags of ≤ 256 chars, and `ctx.getWebSockets(tag)` filters by them **[V]** ([State API](https://developers.cloudflare.com/durable-objects/api/state/)). A reaction `{t:"react", seat:3, e:"🔥"}` from a phone goes to `getWebSockets("seat:3")` plus `getWebSockets("role:stage")`. Votes update a tally that is pushed to the Stage and Host. Host commands (start/pause timer, open voting, next Round) are accepted only from a socket that showed the Host secret.
- **Per-socket identity** goes in `serializeAttachment()`, at most 16,384 bytes, and it survives hibernation **[V]** ([WebSocket API](https://developers.cloudflare.com/durable-objects/api/websockets/)).
- **The timer is data, not ticks.** Store `endsAt` (an absolute ms timestamp) and broadcast it with the server's `now` so clients can correct for clock offset. Each client counts down locally. No `setInterval` in the object, because timers and alarms prevent hibernation **[V]**.
- **The Contestant socket only receives**: reactions for its seat, plus the timer if #6 or #13 wants it. The Contestant laptop never sends code, so "the Audience never sees code before the Reveal" holds by construction.
- **Deploys drop every socket**: "Code updates disconnect all WebSockets." **[V]** Don't deploy during an event. Clients reconnect anyway.

## Limits at event size (~10 Contestants + 1 Stage + 1 Host + 50–300 phones ≈ 62–312 sockets)

| Limit | Value | Headroom |
|---|---|---|
| Hibernatable WebSockets per object | **32,768**, "CPU and memory usage … may further limit" **[V]** ([State API](https://developers.cloudflare.com/durable-objects/api/state/)) | about 100× |
| Requests per object | **soft 1,000 req/s**, then queued, then "overloaded" error. The docs don't say whether WebSocket messages count toward it. **[V]** ([limits](https://developers.cloudflare.com/durable-objects/platform/limits/)) | fine at a typical ~150 msg/s; tight if 300 phones mash at 5 taps/s (1,500 msg/s) **[I]** |
| Memory | 128 MB per isolate **[V]** ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) | ample |
| CPU per message | 30 s, reset by every incoming message **[V]** | forwarding a reaction is well under 1 ms **[I]** |
| Message size | 32 MiB received **[V]** | reactions are about 50 B |
| Attachment / auto-response | 16,384 B attachment; auto-response strings ≤ 2,048 chars **[V]** | — |
| Worker on Free | 100,000 requests/day, 10 ms CPU per request **[V]** | only the ~1,000 upgrades pass through it **[I]** |
| Free-plan storage | 5 GB per account (one FAQ says 1 GB); 100,000 rows written/day **[V]** | write votes, never reactions |

## Pricing at event size

Billing rules **[V]** ([DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)):

- Opening a WebSocket counts as 1 request.
- Incoming WebSocket messages are billed at **20:1**.
- Outgoing messages and protocol pings are free.
- Duration is billed on a 128 MB allocation per wall-clock second while the object is active and "not eligible for hibernation".

| | Free | Workers Paid ($5/month minimum) |
|---|---|---|
| DO requests | 100,000/day (then they **fail**; resets 00:00 UTC) | 1 M/month included, then $0.15/M |
| DO duration | 13,000 GB-s/day | 400,000 GB-s/month included, then $12.50/M GB-s |
| SQLite rows written | 100,000/day | 50 M/month included |

Worked numbers **[I]**. The event has 5 Rounds × 15 min = 4,500 s of active Rounds inside about 3 h on the day.

- **Connections:** about 312 sockets × ~3 reconnects each ≈ **1,000 requests**.
- **Heartbeats:** 312 sockets × one `ping` per 25 s × 10,800 s ≈ 135,000 messages ≈ **6,700 requests**. This is conservative: whether auto-responded pings are billed isn't documented.
- **Typical reactions:** 300 phones × 1 tap per 2 s × 4,500 s = 675,000 messages ≈ **33,750 requests**. **Total ≈ 41,000 requests: Free.**
- **Heavy reactions:** 300 phones × 5 taps/s × 4,500 s = 6.75 M messages ≈ **337,500 requests: over Free, so the Audience layer stops for the rest of the UTC day.** On Paid this is still inside the included 1 M, so it costs **$5.00**.
- **Free break-even:** about 1.9 M incoming messages per day, meaning 300 phones averaging ~1.4 taps/s across every Round.
- **Duration never matters.** One object awake the whole 3 h is 10,800 s × 0.125 GB = 1,350 GB-s. Awake 24/7 it would be 10,800 GB-s/day, still under the Free 13,000.
- **Votes** are about 300–1,500 row writes, which is negligible.

The heavy case runs into both the Free daily quota and the 1,000 req/s soft limit. Coalescing taps on the phone fixes both: send `{e:"🔥", n:7}` at most every 250 ms, capping messages at 4/s per phone. The map's Out of scope list postpones batching, so this is a new question, not a decision (see the report on #4).

## Client reconnect pattern

Why not `partysocket` (1.3.0, a fork of `reconnecting-websocket`)? Its defaults are sensible: delay 1–5 s growing ×1.3 up to 10 s, `maxRetries: Infinity`, `debug: false` **[V]** ([README](https://github.com/cloudflare/partykit/blob/main/packages/partysocket/README.md)). But reading the published `dist/ws.js` shows **[V]**:

- `console.error` at import time when `EventTarget` is missing.
- `console.warn` on `send()` after `close()`.
- `throw` on an invalid URL or invalid protocols.
- `throw` in `index.js` on a bad path or host.

It is also 5.9 KB + 15.5 KB unminified (≈ 6.4 KB gzip) with no size budget. A hand-written client is smaller and can't break the rules:

```js
// Enhancement-side only. The Core Editor never references this.
function link(url, onMsg) {
  var ws, hb, last = 0, delay = 1000;
  function open() {
    if (navigator.onLine === false) return addEventListener('online', open, { once: true });
    try { ws = new WebSocket(url); } catch (_) { return retry(); }
    ws.onopen = function () { delay = 1000; last = Date.now();
      hb = setInterval(function () {
        if (Date.now() - last > 60000) return ws.close();      // half-open socket: force a reconnect
        try { ws.send('ping'); } catch (_) {}
      }, 25000); };
    ws.onmessage = function (e) { last = Date.now(); if (e.data === 'pong') return;
      try { onMsg(JSON.parse(e.data)); } catch (_) {} };
    ws.onerror = function () {};                                // close always follows
    ws.onclose = function () { clearInterval(hb); retry(); };
  }
  function retry() { setTimeout(open, delay * (0.5 + Math.random())); delay = Math.min(delay * 2, 30000); }
  try { open(); } catch (_) {}
  return function send(m) { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(m)); } catch (_) {} };
}
```

- **Heartbeat without waking the object.** Browsers can't send protocol pings, so the app sends the text `ping`. On the server, `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping","pong"))` answers "without waking hibernated WebSockets" **[V]** ([example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/)). The client watches for silence to catch half-open sockets after Wi-Fi changes.
- **Backoff** is exponential from 1 s up to 30 s, with ±50% jitter so that 300 phones don't reconnect at once after a deploy.
- **Offline** means wait for the `online` event, with no retry loop.
- **Never throws, never blocks:** every entry point is wrapped, the work is event-driven only, and messages are dropped while disconnected. A reaction from 30 s ago is worthless, so there's no queue.
- **Logging.** Script never calls `console`. The browser itself still prints "WebSocket connection … failed" in DevTools on each failed handshake. Script can't suppress this **[I]**; only someone with DevTools open sees it, and the 30 s cap keeps it to about 2 lines/min.
- **Phones** should also call `open()` again on `visibilitychange` → visible, because mobile browsers kill background sockets **[I]**.
- **Inlining:** 1,059 B unminified and 527 B gzipped (measured), so it inlines easily into the Contestant Enhancement and the Stage, Host and Audience pages.

## Accepting connections from `file://` (`Origin: null`)

- Browsers send an `Origin` header on the WebSocket handshake ([RFC 6455 §4.1](https://www.rfc-editor.org/rfc/rfc6455#section-4.1)). A `file://` document has an opaque origin, which serializes as `"null"` ([HTML: origin serialization](https://html.spec.whatwg.org/multipage/browsers.html#ascii-serialisation-of-an-origin)) **[V]**.
- WebSockets aren't subject to CORS, and neither Workers nor Durable Objects reject any Origin unless your code does **[I]**. So the Worker accepts the connection, **as long as we don't add an Origin allowlist**.
- So Origin can't be used for authorization. Every `file://` page and sandboxed iframe sends `null`. Authorization comes from the session code plus the Host secret instead, and a Contestant socket only receives, so there is little to protect.
- Whether each browser lets a `file://` page open `wss://` at all is #3's question.

## Ops

- **Deploy:** a `worker/` folder with `wrangler.jsonc` (a `durable_objects.bindings` entry plus a `new_sqlite_classes` migration, or the newer `exports` field) **[V]**. Run `npx wrangler login && npx wrangler deploy` and it's live at `https://<name>.<account>.workers.dev`.
- **Self-hosting by another Organizer:**
  - They need a free Cloudflare account, and the Free plan covers a typical event.
  - The other path is a **Deploy to Cloudflare button**. It clones the repo into their GitHub/GitLab, provisions the Durable Objects and deploys **[V]** ([deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/)).
  - The button requires a public github.com/gitlab.com repo, and "does not fully support monorepos", so `worker/` must be self-contained with its own `package.json` **[V]**.
  - The Organizer pastes the resulting Worker URL into the prep flow, which bakes it into the Round packages.
- **Local dev:** `npx wrangler dev` runs the Worker and Durable Objects locally in `workerd` via Miniflare. Durable Objects "currently will always run locally" **[V]** ([dev & testing](https://developers.cloudflare.com/workers/development-testing/)). Whether a Cloudflare account is needed for purely local dev isn't stated; believed not **[I]**. For phones on the LAN, bind to `0.0.0.0` **[I]**. Hibernation has worked locally since wrangler 3.13.2 **[V]**. Current wrangler is 4.149.0 (npm, 2026-10-12).
- **Plan choice:** Free is enough unless taps aren't coalesced or several Competitions run on the same day. Exceeding Free *fails* requests rather than billing them, which is acceptable for an Enhancement but would kill the Audience layer for the rest of the UTC day.

## Sources

- Durable Objects: [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [WebSocket best practices](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [WebSocket API](https://developers.cloudflare.com/durable-objects/api/websockets/), [State API](https://developers.cloudflare.com/durable-objects/api/state/), [hibernation server example](https://developers.cloudflare.com/durable-objects/examples/websocket-hibernation-server/), [release notes](https://developers.cloudflare.com/durable-objects/release-notes/)
- Workers: [pricing](https://developers.cloudflare.com/workers/platform/pricing/), [limits](https://developers.cloudflare.com/workers/platform/limits/), [deploy buttons](https://developers.cloudflare.com/workers/platform/deploy-buttons/), [development & testing](https://developers.cloudflare.com/workers/development-testing/)
- Other Cloudflare: [Realtime](https://developers.cloudflare.com/realtime/), [Pub/Sub](https://developers.cloudflare.com/pub-sub), [Agents API](https://developers.cloudflare.com/agents/api-reference/agents-api/)
- [cloudflare/partykit](https://github.com/cloudflare/partykit): PartyServer and PartySocket READMEs; `partysocket@1.3.0` and `partyserver@0.5.10` from npm
- [cloudflare/agents](https://github.com/cloudflare/agents) `packages/agents/package.json` (0.28.0)
- [RFC 6455](https://www.rfc-editor.org/rfc/rfc6455) and the [WHATWG HTML origin](https://html.spec.whatwg.org/multipage/browsers.html#origin) spec
