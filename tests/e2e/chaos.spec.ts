// The chaos suite. The Round package's Worker URL points at a fake Worker the test controls, and
// it misbehaves while a Contestant types a script. Whatever it does, the Contestant notices
// nothing: the editor text is byte-identical to the same script typed into a package with no
// Worker URL, no error is thrown, nothing reaches the console, nothing visible changes, and the
// page goes back to idle.

import { randomBytes } from "node:crypto";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { CLOSE_VERSION, V } from "../../src/protocol/protocol.ts";
import { SEAT } from "../../src/round-package/events.ts";
import { socketOrigin } from "../../src/round-package/fill-template.ts";
import { closedPort, presences, startFakeWorker, type Behaviour, type FakeWorker } from "./fake-worker.ts";
import { gateNetwork } from "./no-network-gate.ts";
import { flood, laptopPeer, mostInAFrame, recordReactions } from "./reactions.ts";
import { editorText, makePackage, openPackage } from "./package.ts";

// About 6 s of typing at the delay below, with ACE's auto-closing and indent in play.
const SCRIPT = `<h1 class="moon">Moon</h1>
<p>Hello, dark.
<style>
body { background: #000; }
h1 { color: #fff; }
`;
const KEY_DELAY_MS = 50;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** What the Contestant can see: the page title, and which of the page's parts show. Reactions
 * are left out: they are the one change the Audience may make. */
const surface = (page: Page) =>
  page.evaluate(() => ({
    title: document.title,
    parts: [...document.body.children]
      .filter((element) => !(element instanceof HTMLScriptElement) && !element.matches("canvas.reactions"))
      .map((element) => `${element.tagName.toLowerCase()}.${element.className}: ${element.checkVisibility()}`),
    dialogs: document.querySelectorAll("dialog[open]").length,
  }));

/**
 * How busy the page is once typing has stopped and Power Mode has settled: the worst lateness of
 * a 50 ms timer over 2 s in every browser, and in Chromium the share of that time spent on tasks.
 */
async function busyness(page: Page, browserName: string) {
  await page.waitForTimeout(1500);
  const cdp = browserName === "chromium" ? await page.context().newCDPSession(page) : null;
  const taskSeconds = async () => {
    if (!cdp) return 0;
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((metric) => metric.name === "TaskDuration")!.value;
  };
  await cdp?.send("Performance.enable");
  const before = await taskSeconds();
  const lateness = await page.evaluate(async () => {
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      const start = performance.now();
      await new Promise((resolve) => setTimeout(resolve, 50));
      worst = Math.max(worst, performance.now() - start - 50);
    }
    return worst;
  });
  const taskShare = (await taskSeconds()) - before;
  return { lateness, taskShare: taskShare / 2 };
}

interface Session {
  text: string;
  surface: Awaited<ReturnType<typeof surface>>;
  /** Everything the page wrote to the console, other than the browser reporting the Worker's socket failing. */
  console: string[];
  busy: Awaited<ReturnType<typeof busyness>>;
  /** The most Reactions drawn in one frame. */
  mostReactions: number;
}

/**
 * Opens the practice Round with `workerUrl` as its Worker URL (none for the control) in a fresh
 * online context behind the gate, types the script while `during` runs, and reports what the
 * Contestant got.
 */
async function session(
  browser: Browser,
  browserName: string,
  testInfo: TestInfo,
  {
    workerUrl,
    initScript,
    during,
  }: { workerUrl?: string; initScript?: [(arg: string) => void, string]; during?: () => Promise<void> },
): Promise<Session> {
  const context = await browser.newContext();
  const check = await gateNetwork(context, { workerUrl, online: true });
  if (initScript) await context.addInitScript(...initScript);
  const page = await context.newPage();
  await recordReactions(page);
  const output: string[] = [];
  const workerSocket = workerUrl && socketOrigin(workerUrl);
  page.on("console", (message) => {
    if (!workerSocket || !message.text().includes(`${workerSocket}/`)) output.push(`${message.type()}: ${message.text()}`);
  });
  const file = makePackage(testInfo.outputPath(`package-${workerUrl ? "chaos" : "control"}.html`), {
    audience: workerUrl ? { workerUrl, joinCode: "K7XQ2N", contestantToken: "chaos-token" } : undefined,
  });

  await openPackage(page, file);
  await Promise.all([page.keyboard.type(SCRIPT, { delay: KEY_DELAY_MS }), during?.()]);

  const result = {
    text: await editorText(page),
    surface: await surface(page),
    console: output,
    busy: await busyness(page, browserName),
    mostReactions: await mostInAFrame(page),
  };
  check();
  await context.close();
  return result;
}

/** What a package with no Worker URL gives for the same script, per browser. */
const controls = new Map<string, Promise<Session>>();
const control = (browser: Browser, browserName: string, testInfo: TestInfo) => {
  if (!controls.has(browserName)) controls.set(browserName, session(browser, browserName, testInfo, {}));
  return controls.get(browserName)!;
};

/** The pass criteria every scenario shares. */
async function expectUnnoticed(chaos: Session, browser: Browser, browserName: string, testInfo: TestInfo) {
  const { text, surface, busy } = await control(browser, browserName, testInfo);
  expect(chaos.text, "editor text").toBe(text);
  expect(chaos.console, "console output").toEqual([]);
  expect(chaos.surface, "what the Contestant sees").toEqual(surface);
  expect(chaos.busy.lateness, "worst timer lateness once idle, ms").toBeLessThan(Math.max(30, busy.lateness * 3));
  expect(chaos.busy.taskShare, "share of time on tasks once idle").toBeLessThan(Math.max(0.1, busy.taskShare * 3));
}

/** A fake Worker for one scenario, stopped once the test ends. */
let worker: FakeWorker | null = null;
const fake = async (behaviour?: Behaviour) => (worker = await startFakeWorker(behaviour));
test.afterEach(async () => {
  await worker?.stop();
  worker = null;
});

// Long sessions, and the control's on top for each browser's first scenario.
test.describe.configure({ timeout: 90_000 });

test("control: a package with no Worker URL", async ({ browser, browserName }, testInfo) => {
  const { text, console, busy } = await control(browser, browserName, testInfo);

  expect(text).toContain("Moon");
  expect(console).toEqual([]);
  testInfo.annotations.push({ type: "idle", description: JSON.stringify(busy) });
});

test("connection refused", async ({ browser, browserName }, testInfo) => {
  const workerUrl = `http://127.0.0.1:${await closedPort()}`;

  await expectUnnoticed(await session(browser, browserName, testInfo, { workerUrl }), browser, browserName, testInfo);
});

test("DNS failure", async ({ browser, browserName }, testInfo) => {
  const workerUrl = "https://citd-chaos.invalid";

  await expectUnnoticed(await session(browser, browserName, testInfo, { workerUrl }), browser, browserName, testInfo);
});

test("a handshake that hangs", async ({ browser, browserName }, testInfo) => {
  const { url } = await fake({ hang: true });

  const chaos = await session(browser, browserName, testInfo, { workerUrl: url });

  await expectUnnoticed(chaos, browser, browserName, testInfo);
  expect(worker!.connections).toBe(1);
  expect(worker!.handshakes).toBe(0);
});

test("accepts, then goes silent", async ({ browser, browserName }, testInfo) => {
  const { url } = await fake();

  const chaos = await session(browser, browserName, testInfo, { workerUrl: url });

  await expectUnnoticed(chaos, browser, browserName, testInfo);
  expect(worker!.handshakes).toBe(1);
  expect(presences(worker!)).toHaveLength(1);
});

test("closes every connection at once, and the package backs off instead of storming", async ({
  browser,
  browserName,
}, testInfo) => {
  const { url } = await fake({ open: (peer) => peer.close(1011) });

  const chaos = await session(browser, browserName, testInfo, { workerUrl: url, during: async () => void (await sleep(10_000)) });

  await expectUnnoticed(chaos, browser, browserName, testInfo);
  // Jittered backoff from 1 s, doubling: the earliest retries are at 1, 3, 7 and 15 s.
  expect(worker!.handshakes).toBeGreaterThanOrEqual(2);
  expect(worker!.handshakes).toBeLessThanOrEqual(4);
});

test("garbage on the wire", async ({ browser, browserName }, testInfo) => {
  const { url } = await fake({ open: (peer) => peer.write(randomBytes(256)) });

  await expectUnnoticed(await session(browser, browserName, testInfo, { workerUrl: url }), browser, browserName, testInfo);
});

test("messages that aren't JSON", async ({ browser, browserName }, testInfo) => {
  const { url } = await fake({
    open(peer) {
      for (const text of ["not json {", "<html><body>Bad gateway</body></html>", "", "null", "42", '"react"']) {
        peer.send(text);
      }
    },
  });

  await expectUnnoticed(await session(browser, browserName, testInfo, { workerUrl: url }), browser, browserName, testInfo);
});

test("a protocol version the Worker doesn't accept: the package stops reconnecting", async ({
  browser,
  browserName,
}, testInfo) => {
  // What the Worker does when a message's `v` is one it doesn't accept.
  const { url } = await fake({ message: (peer) => peer.close(CLOSE_VERSION) });

  const chaos = await session(browser, browserName, testInfo, { workerUrl: url, during: async () => void (await sleep(8000)) });

  await expectUnnoticed(chaos, browser, browserName, testInfo);
  expect(worker!.connections).toBe(1);
});

test("a 1 MB message", async ({ browser, browserName }, testInfo) => {
  const { url } = await fake({
    open: (peer) => peer.send(JSON.stringify({ v: V, t: "react", seat: "x", e: "x".repeat(1_000_000) })),
  });

  await expectUnnoticed(await session(browser, browserName, testInfo, { workerUrl: url }), browser, browserName, testInfo);
});

test("a flood of 1,000 Reactions a second for 10 s: only Reactions show, at most 200 at once", async ({
  browser,
  browserName,
}, testInfo) => {
  const { behaviour, peer } = laptopPeer();
  const { url } = await fake(behaviour);

  const chaos = await session(browser, browserName, testInfo, {
    workerUrl: url,
    during: async () => {
      await flood(await peer, { perSecond: 1000, seconds: 10 });
      // The last ones float away within 2.4 s; idle is measured after that.
      await sleep(2500);
    },
  });

  await expectUnnoticed(chaos, browser, browserName, testInfo);
  expect(chaos.mostReactions).toBe(200);
});

test("the server restarts mid-Round, and the package comes back with its presence", async ({
  browser,
  browserName,
}, testInfo) => {
  const server = await fake();
  const restart = async () => {
    await expect.poll(() => presences(server)).toHaveLength(1);
    await server.stop();
    await sleep(1500);
    await server.restart();
    await expect.poll(() => presences(server), { timeout: 15_000 }).toHaveLength(2);
  };

  const chaos = await session(browser, browserName, testInfo, { workerUrl: server.url, during: restart });

  await expectUnnoticed(chaos, browser, browserName, testInfo);
  expect(presences(server)[1]).toEqual(presences(server)[0]);
});

test("the Enhancement throws at boot", async ({ browser, browserName }, testInfo) => {
  const { url } = await fake();
  // The Enhancement's first step is to listen for the Core's seat event; nothing else does.
  const fault = (seatEvent: string) => {
    const listen = window.addEventListener;
    window.addEventListener = function (this: Window, ...args: Parameters<Window["addEventListener"]>) {
      if (args[0] === seatEvent) throw new Error("Injected fault");
      return listen.apply(this, args);
    } as Window["addEventListener"];
  };

  const chaos = await session(browser, browserName, testInfo, { workerUrl: url, initScript: [fault, SEAT] });

  await expectUnnoticed(chaos, browser, browserName, testInfo);
  expect(worker!.connections).toBe(0);
});
