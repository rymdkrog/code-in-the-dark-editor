// Reactions on the Contestant's screen: an emoji from the Audience floats up from the bottom
// edge, behind the name badge and Reference, over the Reveal too, and a flood is capped.

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { REACTIONS } from "../../src/protocol/protocol.ts";
import { startFakeWorker, type FakeWorker, type Peer } from "./fake-worker.ts";
import { gateNetwork } from "./no-network-gate.ts";
import { editorText, makePackage, openPackage, reveal } from "./package.ts";
import { laptopPeer, mostInAFrame, reaction, reactionRecording, recordReactions, type Blit } from "./reactions.ts";
import { closeOwnContexts, ownContext } from "./contexts.ts";

const WIDTH = 1440;
const HEIGHT = 900;

let worker: FakeWorker | null = null;
test.afterEach(async () => {
  await closeOwnContexts();
  await worker?.stop();
  worker = null;
});

/** A Round package connected to a fake Worker, open at 1440×900 and recording the overlay. */
async function contestant(browser: Browser, testInfo: TestInfo): Promise<{ page: Page; peer: Peer }> {
  const { behaviour, peer } = laptopPeer();
  worker = await startFakeWorker(behaviour);
  const context = await ownContext(browser, { viewport: { width: WIDTH, height: HEIGHT } });
  await gateNetwork(context, { workerUrl: worker.url, online: true });
  const page = await context.newPage();
  await recordReactions(page);
  const file = makePackage(testInfo.outputPath("package.html"), {
    audience: { workerUrl: worker.url, joinCode: "K7XQ2N", contestantToken: "token" },
  });
  await openPackage(page, file);
  return { page, peer: await peer };
}

/** Each emoji's blits, in order, told apart by when they start: one Reaction at a time here. */
const lifeOf = (blits: Blit[]) => blits.toSorted((a, b) => a.frame - b.frame);

const overlay = (page: Page) => page.locator("canvas.reactions");

test("a Reaction floats up from the bottom edge, pops in, wobbles, and fades out in about 2 s", async ({
  browser,
}, testInfo) => {
  const { page, peer } = await contestant(browser, testInfo);
  await expect(overlay(page)).toHaveCount(0);

  peer.send(reaction("🔥"));

  await expect(overlay(page)).toBeVisible();
  await expect.poll(async () => (await reactionRecording(page)).blits.length).toBeGreaterThan(0);
  // Gone in at most 2.4 s, and the overlay stops asking for frames.
  await page.waitForTimeout(2600);
  const { blits, rasterised, requestedFrames } = await reactionRecording(page);
  const dpr = await page.evaluate(() => devicePixelRatio);
  await page.waitForTimeout(300);
  expect((await reactionRecording(page)).requestedFrames).toBe(requestedFrames);

  const life = lifeOf(blits);
  const [first, last] = [life[0]!, life.at(-1)!];
  const lifetime = last.time - first.time;
  expect(lifetime).toBeGreaterThan(1600);
  expect(lifetime).toBeLessThan(2500);
  // From the bottom edge, anywhere along it.
  expect(first.y).toBeGreaterThan(HEIGHT - 10);
  expect(first.x).toBeGreaterThan(0);
  expect(first.x).toBeLessThan(WIDTH);
  // Rises 60–100 % of 200 px.
  const rise = first.y - Math.min(...life.map((blit) => blit.y));
  expect(rise).toBeGreaterThan(110);
  expect(rise).toBeLessThanOrEqual(205);
  // A slight wobble.
  const sway = Math.max(...life.map((blit) => blit.x)) - Math.min(...life.map((blit) => blit.x));
  expect(sway).toBeGreaterThan(2);
  expect(sway).toBeLessThan(30);
  // Pops in over the first ~0.2 s, then holds its size.
  const full = life.at(-1)!.size;
  expect(first.size).toBeLessThan(full);
  const settled = life.filter((blit) => blit.time - first.time > 300);
  for (const blit of settled) expect(blit.size).toBeCloseTo(full, 1);
  // Full strength until ~55 % of its life, then fading to nothing.
  for (const blit of life.filter((blit) => blit.time - first.time < lifetime * 0.5)) expect(blit.alpha).toBe(1);
  expect(last.alpha).toBeLessThan(0.15);
  // One 40 px emoji, rasterised at device pixels.
  expect(rasterised).toEqual([{ text: "🔥", font: expect.stringMatching(new RegExp(`^${40 * dpr}px `)) }]);
  // Nothing is left drawn on the overlay.
  const blank = await overlay(page).evaluate((canvas: HTMLCanvasElement) =>
    canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.every((byte) => byte === 0),
  );
  expect(blank).toBe(true);
});

test("Reactions draw over the code and buttons, behind the badge and Reference, and take no clicks", async ({
  browser,
}, testInfo) => {
  const { page, peer } = await contestant(browser, testInfo);
  peer.send(reaction("👏"));
  await expect(overlay(page)).toBeVisible();

  const layer = (selector: string) =>
    page.locator(selector).evaluate((element) => Number(getComputedStyle(element).zIndex) || 0);
  const z = await layer("canvas.reactions");
  for (const below of ["#editor", ".button-bar", ".canvas-overlay", ".background"]) expect(z).toBeGreaterThan(await layer(below));
  for (const above of [".name-badge", ".reference"]) expect(z).toBeLessThan(await layer(above));
  await expect(overlay(page)).toHaveCSS("pointer-events", "none");
  // The whole window.
  expect(await overlay(page).boundingBox()).toEqual({ x: 0, y: 0, width: WIDTH, height: HEIGHT });

  // Typing carries on under it.
  // A click on the code goes through the overlay, which covers the whole window, to the editor.
  await page.locator("#editor textarea").blur();
  await page.mouse.click(WIDTH / 2, HEIGHT / 2);
  await page.keyboard.type("hi");
  await expect.poll(() => editorText(page)).toContain("hi");
});

test("Reactions stay at full strength over the Reveal", async ({ browser }, testInfo) => {
  const { page, peer } = await contestant(browser, testInfo);

  await reveal(page);
  peer.send(reaction("😱"));

  await expect(overlay(page)).toBeVisible();
  await expect(overlay(page)).toHaveCSS("opacity", "1");
  const z = await overlay(page).evaluate((element) => Number(getComputedStyle(element).zIndex));
  const result = await page.locator("iframe.result").evaluate((element) => Number(getComputedStyle(element).zIndex));
  expect(z).toBeGreaterThan(result);
  await expect.poll(async () => (await reactionRecording(page)).blits.some((blit) => blit.alpha === 1)).toBe(true);
});

test("a flood draws at most 200 at once, and rasterises each emoji once", async ({ browser }, testInfo) => {
  const { page, peer } = await contestant(browser, testInfo);

  for (let i = 0; i < 1000; i++) peer.send(reaction(REACTIONS[i % REACTIONS.length]!));

  await expect.poll(() => mostInAFrame(page)).toBe(200);
  await page.waitForTimeout(500);
  expect(await mostInAFrame(page)).toBe(200);
  expect((await reactionRecording(page)).rasterised.map(({ text }) => text).sort()).toEqual([...REACTIONS].sort());
});

test("anything but the four emoji draws nothing", async ({ browser }, testInfo) => {
  const { page, peer } = await contestant(browser, testInfo);

  for (const e of ["💩", "🔥🔥", "", "fire"]) peer.send(reaction(e));
  peer.send(JSON.stringify({ v: 1, t: "react", seat: "seat" }));
  peer.send(JSON.stringify({ v: 1, t: "pong", e: "🔥" }));
  await page.waitForTimeout(500);

  await expect(overlay(page)).toHaveCount(0);
  expect((await reactionRecording(page)).blits).toEqual([]);
});
