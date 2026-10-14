import { expect, type Page } from "@playwright/test";
import { enterPowerMode, mostSquaresInAFrame, recordEffects, recording } from "./effects.ts";
import { editorText, openPackage, test } from "./package.ts";

// The input-lag budget (spec: Testing Decisions). A regression guard run on release tags; the
// real proof is the manual run on a low-end laptop.
test.skip(!process.env.LAG_BUDGET, "Runs on release tags, or locally with LAG_BUDGET=1");

const BUDGET = { p95KeystrokeProcessing: 8, longestTask: 50 };
const TRIALS = 3;
const TEXT = "the quick brown fox jumps over the lazy dog ".repeat(7);

/** One keystroke: from its keydown to the end of the input it made. */
interface Keystroke {
  /** The keydown's time stamp, which Event Timing reports as its start time. */
  start: number;
  began: number;
  /** Handling time, measured around the page's own listeners. */
  handling: number;
  /** The processing time Event Timing reported for the keystroke's events, if it reported any. */
  eventTiming: number;
}

interface Measurements {
  /** Nothing that starts before this time is measured. */
  from: number;
  keystrokes: Keystroke[];
  longTasks: number[];
}

/**
 * Collects how long each keystroke took to handle, and every task over 50 ms, once started. A
 * keystroke's handling spans keydown, keypress, beforeinput and input: ACE inserts the text, and
 * the Combo and Power Mode react to it, on input.
 */
async function measureInputLag(page: Page) {
  await page.addInitScript(() => {
    const measurements: Measurements = { from: Infinity, keystrokes: [], longTasks: [] };
    (window as unknown as { __lag: Measurements }).__lag = measurements;

    // Before any of the page's listeners, and after them all: the editor listens on its textarea.
    let current: Keystroke | undefined;
    window.addEventListener(
      "keydown",
      (event) => {
        if (event.timeStamp < measurements.from) return;
        current = { start: event.timeStamp, began: performance.now(), handling: 0, eventTiming: 0 };
        measurements.keystrokes.push(current);
      },
      { capture: true },
    );
    window.addEventListener("input", () => {
      if (current) current.handling = performance.now() - current.began;
      current = undefined;
    });

    // Event Timing reports only events that took 16 ms or more from input to the next paint; the
    // handling time above covers the rest.
    const KEYSTROKE_EVENTS = ["keydown", "keypress", "beforeinput", "input"];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as PerformanceEventTiming[]) {
        if (!KEYSTROKE_EVENTS.includes(entry.name)) continue;
        const keystroke = measurements.keystrokes.findLast((keystroke) => keystroke.start <= entry.startTime);
        if (keystroke) keystroke.eventTiming += entry.processingEnd - entry.processingStart;
      }
    }).observe({ type: "event", durationThreshold: 16 } as PerformanceObserverInit);

    if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime >= measurements.from) measurements.longTasks.push(entry.duration);
        }
      }).observe({ type: "longtask" });
    } else {
      // Firefox has no Long Tasks API: a frame that comes more than 50 ms after the one before
      // was held up by a long task. Frames, not timers, as Firefox holds timers back while
      // input is waiting.
      const FRAME = 1000 / 60;
      let last = performance.now();
      const beat = () => {
        const now = performance.now();
        const late = now - last - FRAME;
        if (last >= measurements.from && late > 50) measurements.longTasks.push(late);
        last = now;
        requestAnimationFrame(beat);
      };
      requestAnimationFrame(beat);
    }
  });
}

const startMeasuring = (page: Page) =>
  page.evaluate(() => void ((window as unknown as { __lag: Measurements }).__lag.from = performance.now()));

const measurements = (page: Page) => page.evaluate(() => (window as unknown as { __lag: Measurements }).__lag);

/** The 95th percentile of the keystrokes' processing times, each the larger of its two measures. */
function p95(keystrokes: Keystroke[]) {
  const times = keystrokes.map(({ handling, eventTiming }) => Math.max(handling, eventTiming)).sort((a, b) => a - b);
  return times[Math.ceil(times.length * 0.95) - 1]!;
}

test("Power Mode at the particle cap, shaking, adds no input lag", async ({ browser, browserName }, testInfo) => {
  test.setTimeout(TRIALS * 60_000);
  const timed = browserName !== "webkit";
  const trials = [];

  for (let trial = 1; trial <= TRIALS; trial++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    // Particles slowed down 4×, so they stay at the 500 cap while the Contestant types.
    await recordEffects(page, { slowMotion: 4 });
    await measureInputLag(page);
    await openPackage(page);
    await enterPowerMode(page);
    // Measured from here: Power Mode on, with the particles piling up.
    await startMeasuring(page);

    await page.keyboard.type(TEXT, { delay: 20 });
    await page.waitForTimeout(500);

    // First, as reading the rest is itself a long task.
    const { keystrokes, longTasks } = await measurements(page);
    // The worst case was reached: particles at the cap and the editor shaking.
    expect(await mostSquaresInAFrame(page)).toBe(500);
    expect((await recording(page)).styleChanges.length).toBeGreaterThan(0);
    // No dropped keystrokes, and each one measured.
    expect(await editorText(page)).toBe("a".repeat(200) + TEXT);
    expect(keystrokes).toHaveLength(TEXT.length);

    const result = { trial, p95KeystrokeProcessing: p95(keystrokes), longestTask: Math.max(0, ...longTasks) };
    trials.push(result);
    await context.close();
    if (result.p95KeystrokeProcessing <= BUDGET.p95KeystrokeProcessing && result.longestTask <= BUDGET.longestTask) {
      break;
    }
  }

  await testInfo.attach("input lag", {
    body: JSON.stringify({ budget: BUDGET, trials }, null, 2),
    contentType: "application/json",
  });
  if (!timed) return;
  // Best of 3: the last trial is the first within budget, if any was.
  const best = trials.at(-1)!;
  expect(best.p95KeystrokeProcessing).toBeLessThanOrEqual(BUDGET.p95KeystrokeProcessing);
  expect(best.longestTask).toBeLessThanOrEqual(BUDGET.longestTask);
});
