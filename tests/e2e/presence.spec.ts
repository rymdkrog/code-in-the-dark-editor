// The Enhancement in a Round package with a Worker URL: what it sends, and when it stays quiet.
// The Worker is the chaos suite's fake, so the test sees every message the package sends.

import { expect, test, type Browser, type TestInfo } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { startFakeWorker, type FakeWorker } from "./fake-worker.ts";
import { gateNetwork } from "./no-network-gate.ts";
import { enterName, makePackage, openPackage, PRACTICE, roundIn } from "./package.ts";

const JOIN_CODE = "K7XQ2N";
const TOKEN = "contestant-token-for-the-presence-tests";

/** The practice Round with the Audience layer on, pointing at `workerUrl`. */
const audiencePackage = (testInfo: TestInfo, workerUrl: string) =>
  makePackage(testInfo.outputPath("package.html"), {
    audience: { workerUrl, joinCode: JOIN_CODE, contestantToken: TOKEN },
  });

/** An online context behind the gate, which lets only `workerUrl`'s sockets through. */
async function online(browser: Browser, workerUrl?: string) {
  const context = await browser.newContext();
  const check = await gateNetwork(context, { workerUrl, online: true });
  return { context, page: await context.newPage(), check };
}

const presences = (worker: FakeWorker) =>
  worker.messages.filter((message) => (message as { t?: string }).t === "presence") as Record<string, unknown>[];

test("a package with a Worker URL sends presence only: name, Round id, seat and Revision, with the token", async ({
  browser,
}, testInfo) => {
  const worker = await startFakeWorker();
  const file = audiencePackage(testInfo, worker.url);
  const { roundId, revision } = roundIn(file);
  const { page, check } = await online(browser, worker.url);

  await openPackage(page, file);
  await page.keyboard.type("<h1>Moon</h1>");

  await expect.poll(() => presences(worker)).toHaveLength(1);
  expect(worker.messages).toEqual([
    { v: 1, t: "presence", token: TOKEN, roundId, seat: expect.stringMatching(/^[0-9a-f]{24}$/), name: "Anna", revision },
  ]);
  check();
  await worker.stop();
});

test("presence waits for the name, is sent again when it changes, and a reload keeps the seat", async ({
  browser,
}, testInfo) => {
  const worker = await startFakeWorker();
  const file = audiencePackage(testInfo, worker.url);
  const { page, check } = await online(browser, worker.url);

  await page.goto(pathToFileURL(file).href);
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(3000);
  expect(worker.connections).toBe(0);
  await enterName(page, "Anna");
  await expect.poll(() => presences(worker).map((presence) => presence.name)).toEqual(["Anna"]);
  const [{ seat }] = presences(worker) as [{ seat: string }];

  await page.getByRole("button", { name: /^Anna/ }).click();
  await enterName(page, "Anna K");
  await expect.poll(() => presences(worker).map((presence) => presence.name)).toEqual(["Anna", "Anna K"]);

  await page.reload();
  await expect.poll(() => presences(worker)).toHaveLength(3);
  expect(presences(worker).map((presence) => [presence.seat, presence.name])).toEqual([
    [seat, "Anna"],
    [seat, "Anna K"],
    [seat, "Anna K"],
  ]);
  expect(worker.connections).toBe(2);
  check();
  await worker.stop();
});

test("a second tab of the Round is blocked and doesn't connect", async ({ browser }, testInfo) => {
  const worker = await startFakeWorker();
  const file = audiencePackage(testInfo, worker.url);
  const { context, page, check } = await online(browser, worker.url);
  await openPackage(page, file);
  await expect.poll(() => presences(worker)).toHaveLength(1);

  const second = await context.newPage();
  await second.goto(pathToFileURL(file).href);

  await expect(second.getByText("This Round is open in another tab.")).toBeVisible();
  await second.waitForTimeout(3000);
  expect(worker.connections).toBe(1);
  check();
  await worker.stop();
});

test("a package without a Worker URL never opens a socket, even online", async ({ browser }) => {
  const { page, check } = await online(browser);
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));

  await openPackage(page, PRACTICE);
  await page.keyboard.type("<h1>Moon</h1>");
  await page.waitForTimeout(3000);

  expect(sockets).toEqual([]);
  check();
});

