import { expect, type Page } from "@playwright/test";
import {
  clearRecording,
  type DrawnSquare,
  enterPowerMode,
  mostSquaresInAFrame,
  recordEffects,
  recording,
  waitForParticlesGone,
} from "./effects.ts";
import { makePackage, openPackage, test } from "./package.ts";

/** Where the caret is on screen, in CSS pixels. */
const caret = (page: Page) =>
  page.locator("#editor .ace_cursor").evaluate((cursor) => {
    const { left, top } = cursor.getBoundingClientRect();
    return { left, top };
  });

test("below Combo 200 there are no particles; in Power Mode each insertion throws 5-12 8 px squares from the caret", async ({
  page,
}) => {
  // No shake, so the editor stays put.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordEffects(page);
  await openPackage(page);

  await page.keyboard.type("a".repeat(150));
  await page.waitForTimeout(100);
  expect((await recording(page)).frames).toEqual([]);

  await enterPowerMode(page);
  await page.keyboard.press("Enter");
  await waitForParticlesGone(page);
  await clearRecording(page);
  await page.keyboard.type("b");
  await expect.poll(async () => (await recording(page)).frames.length).toBeGreaterThan(0);
  const at = await caret(page);

  const [first] = (await recording(page)).frames;
  expect(first!.squares.length).toBeGreaterThanOrEqual(5);
  expect(first!.squares.length).toBeLessThanOrEqual(12);
  expectThrownFrom(first!.squares, at);
});

/**
 * Squares in the first frame of a burst are 8 px, thrown from 4 px right of and 10 px below the
 * caret, and have taken their first step: up to 2.5 px sideways and 3.5-7 px up.
 */
function expectThrownFrom(squares: DrawnSquare[], at: { left: number; top: number }) {
  for (const square of squares) {
    expect(square).toMatchObject({ width: 8, height: 8 });
    const step = { x: square.x + 4 - (at.left + 4), y: square.y + 4 - (at.top + 10) };
    expect(Math.abs(step.x)).toBeLessThanOrEqual(3);
    expect(step.y).toBeGreaterThanOrEqual(-7.5);
    expect(step.y).toBeLessThanOrEqual(-3);
  }
}

test("particles come from the caret on a line scrolled sideways", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordEffects(page);
  await openPackage(page);
  await enterPowerMode(page);
  // Far past the right edge of the window, so the editor has scrolled.
  await page.keyboard.type("a".repeat(150));
  await waitForParticlesGone(page);
  await clearRecording(page);

  await page.keyboard.type("b");

  await expect.poll(async () => (await recording(page)).frames.length).toBeGreaterThan(0);
  const at = await caret(page);
  expect(at.left).toBeLessThan(page.viewportSize()!.width);
  expectThrownFrom((await recording(page)).frames[0]!.squares, at);
});

/** How long, in ms, the particles one keystroke throws stay on screen. */
async function burstLifetime(page: Page) {
  await page.keyboard.press("Enter");
  await waitForParticlesGone(page);
  await clearRecording(page);
  await page.keyboard.type("b");
  await waitForParticlesGone(page);
  const { frames } = await recording(page);
  return frames.at(-1)!.time - frames[0]!.time;
}

// Alpha ×0.96 per 1/60 s falls to 0.1 after 56 steps: 0.93 s, as the original on a 60 Hz screen.
for (const frameRate of [30, 60, 120]) {
  test(`particles fade over the same 0.93 s on a ${frameRate} Hz screen`, async ({ page }) => {
    await recordEffects(page, { frameRate });
    await openPackage(page);
    await enterPowerMode(page);

    const lifetime = await burstLifetime(page);

    expect(lifetime).toBeGreaterThan(850);
    expect(lifetime).toBeLessThan(1050);
  });
}

test("a frame never moves particles more than 0.1 s on, however late it comes", async ({ page }) => {
  // 5 frames a second, so each frame takes 0.2 s and particles move half as fast.
  await recordEffects(page, { frameRate: 5 });
  await openPackage(page);
  await enterPowerMode(page);

  const lifetime = await burstLifetime(page);

  expect(lifetime).toBeGreaterThan(1700);
  expect(lifetime).toBeLessThan(2100);
});

test("once the particles are gone, nothing asks for animation frames", async ({ page }) => {
  await recordEffects(page);
  await openPackage(page);
  await enterPowerMode(page);
  await waitForParticlesGone(page);
  await clearRecording(page);

  await page.waitForTimeout(1000);

  expect((await recording(page)).requestedFrames).toBe(0);
});

test("at most 500 particles are on screen at once", async ({ page }) => {
  // Slowed down 4×, the particles live long enough to pile up past 500.
  await recordEffects(page, { slowMotion: 4 });
  await openPackage(page);
  await enterPowerMode(page);

  await page.keyboard.type("b".repeat(150), { delay: 15 });

  expect(await mostSquaresInAFrame(page)).toBe(500);
});

test.describe("on a retina screen", () => {
  test.use({ deviceScaleFactor: 2 });

  test("the particle canvas covers the window at full resolution, and follows it when resized", async ({ page }) => {
    await openPackage(page);
    const canvas = page.locator(".canvas-overlay");
    const size = () =>
      canvas.evaluate((canvas: HTMLCanvasElement) => {
        const { width, height } = canvas.getBoundingClientRect();
        return { width, height, pixels: [canvas.width, canvas.height] };
      });

    expect(await size()).toEqual({ width: 1280, height: 720, pixels: [2560, 1440] });

    await page.setViewportSize({ width: 900, height: 600 });

    await expect.poll(size).toEqual({ width: 900, height: 600, pixels: [1800, 1200] });
  });
});

/**
 * The shakes finished so far: each one's start, offset and how long it lasted. A shake ends when
 * the editor goes back, or when the next shake starts first because its end was held up.
 */
async function shakes(page: Page) {
  const { styleChanges } = await recording(page);
  expect(styleChanges.every((change) => change.margin === "")).toBe(true);
  const result: { time: number; x: number; y: number; duration: number }[] = [];
  styleChanges.forEach((change, i) => {
    const offset = /^translate3d\((-?[\d.]+)px, (-?[\d.]+)px, 0px\)$/.exec(change.transform);
    const end = styleChanges[i + 1];
    if (!offset || !end) return;
    result.push({ time: change.time, x: Number(offset[1]), y: Number(offset[2]), duration: end.time - change.time });
  });
  return result;
}

/** Waits past the shake's throttle and starts the recording afresh. */
async function settle(page: Page) {
  await page.waitForTimeout(150);
  await clearRecording(page);
}

test("in Power Mode each change shakes the editor 1 px for 75 ms with a transform, never its margin", async ({
  page,
}) => {
  await recordEffects(page);
  await openPackage(page);

  await page.keyboard.type("a".repeat(199));
  await page.waitForTimeout(150);
  expect((await recording(page)).styleChanges).toEqual([]);

  // Combo 200: Power Mode.
  await page.keyboard.type("b");
  await expect.poll(async () => (await shakes(page)).length).toBe(1);
  const [shake] = await shakes(page);
  expect([Math.abs(shake!.x), Math.abs(shake!.y)]).toEqual([1, 1]);
  expect(shake!.duration).toBeGreaterThanOrEqual(70);
  expect(shake!.duration).toBeLessThan(150);

  // Deletes shake too.
  await settle(page);
  await page.keyboard.press("Backspace");
  await expect.poll(async () => (await shakes(page)).length).toBe(1);
});

test("the editor shakes at most every 100 ms", async ({ page }) => {
  await recordEffects(page);
  await openPackage(page);
  await enterPowerMode(page);
  await settle(page);

  await page.keyboard.type("b".repeat(50), { delay: 10 });
  await page.waitForTimeout(150);

  const starts = (await shakes(page)).map((shake) => shake.time);
  expect(starts.length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(99);
});

test("the shake grows with the Combo: 1 to 3 px from Combo 300", async ({ page }) => {
  await recordEffects(page);
  await openPackage(page);
  await enterPowerMode(page);
  await page.keyboard.type("b".repeat(100));
  await settle(page);

  await page.keyboard.type("c".repeat(12), { delay: 110 });
  await page.waitForTimeout(150);

  const offsets = (await shakes(page)).flatMap((shake) => [Math.abs(shake.x), Math.abs(shake.y)]);
  expect(offsets.length).toBeGreaterThanOrEqual(20);
  for (const offset of offsets) {
    expect(offset).toBeGreaterThanOrEqual(1);
    expect(offset).toBeLessThan(3);
  }
  expect(offsets.some((offset) => offset > 1)).toBe(true);
});

test("under reduced motion there's no shake, but particles still fly", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await recordEffects(page);
  await openPackage(page);
  await enterPowerMode(page);

  await page.keyboard.type("b".repeat(20), { delay: 20 });
  await waitForParticlesGone(page);

  expect((await recording(page)).styleChanges).toEqual([]);
  expect((await recording(page)).frames.length).toBeGreaterThan(0);
});

test("a Round with shake off doesn't shake, but particles still fly", async ({ page }, testInfo) => {
  const noShake = makePackage(testInfo.outputPath("citd-no-shake.html"), { shake: false });
  await recordEffects(page);
  await openPackage(page, noShake);
  await enterPowerMode(page);

  await page.keyboard.type("b".repeat(20), { delay: 20 });
  await waitForParticlesGone(page);

  expect((await recording(page)).styleChanges).toEqual([]);
  expect((await recording(page)).frames.length).toBeGreaterThan(0);
});

/** The colours of the particles one more keystroke throws, once the last ones are gone. */
async function burstColours(page: Page, key: string) {
  await waitForParticlesGone(page);
  await clearRecording(page);
  await page.keyboard.type(key);
  await expect.poll(async () => (await recording(page)).frames.length).toBeGreaterThan(0);
  await waitForParticlesGone(page);
  return new Set((await recording(page)).frames.flatMap((frame) => frame.squares.map((square) => square.colour)));
}

test("particles take the colour of the code under the caret, from the original's map", async ({ page }) => {
  await recordEffects(page);
  await openPackage(page);
  await enterPowerMode(page);

  expect(await burstColours(page, "b")).toEqual(new Set(["#ffffff"]));

  await page.keyboard.type("\n<!-- ");
  expect(await burstColours(page, "c")).toEqual(new Set(["#00ff79"]));

  await page.keyboard.type(" -->\n<d");
  expect(await burstColours(page, "i")).toEqual(new Set(["#00ddff"]));

  await page.keyboard.type("v cla");
  expect(await burstColours(page, "s")).toEqual(new Set(["#8194f4"]));

  // The quote is closed for us, and the caret left between the two.
  await page.keyboard.type('s="');
  expect(await burstColours(page, "x")).toEqual(new Set(["#f9ff00"]));
});
