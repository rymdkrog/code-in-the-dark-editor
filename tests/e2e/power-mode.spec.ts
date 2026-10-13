import { expect, type Locator, type Page } from "@playwright/test";
import { nextFrame, openPackage, test } from "./package.ts";

const combo = (page: Page) => page.locator(".streak-container .counter");

/** The CSS animations running on an element, by name and duration in ms. */
const cssAnimations = (element: Locator) =>
  element.evaluate((el) =>
    el.getAnimations().map((animation) => ({
      name: (animation as CSSAnimation).animationName,
      duration: animation.effect!.getTiming().duration,
    })),
  );

/** Pastes `text` into the editor as the browser does for Ctrl/Cmd-V, without the system clipboard. */
const paste = (page: Page, text: string) =>
  page.locator("#editor textarea").evaluate((textarea, text) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
    // Firefox drops the data of a `clipboardData` passed to the constructor.
    Object.defineProperty(event, "clipboardData", { value: clipboardData });
    textarea.dispatchEvent(event);
  }, text);

test("each insertion adds one to the Combo, and deletes don't count", async ({ page }) => {
  await openPackage(page);
  await expect(page.locator(".streak-container")).toContainText("Combo");
  await expect(combo(page)).toHaveText("0");

  await page.keyboard.type("abc");
  await expect(combo(page)).toHaveText("3");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await expect(combo(page)).toHaveText("3");
  await page.keyboard.type("d");
  await expect(combo(page)).toHaveText("4");
});

test("the Combo resets after 10 s without an insertion", async ({ page }) => {
  await page.clock.install();
  await openPackage(page);

  await page.keyboard.type("abc");
  await page.clock.fastForward(9_000);
  await page.keyboard.press("Backspace");
  await expect(combo(page)).toHaveText("3");
  await page.clock.fastForward(1_000);
  await expect(combo(page)).toHaveText("0");

  await page.keyboard.type("de");
  await page.clock.fastForward(9_000);
  await page.keyboard.type("f");
  await page.clock.fastForward(9_000);
  await expect(combo(page)).toHaveText("3");
  await page.clock.fastForward(1_000);
  await expect(combo(page)).toHaveText("0");
});

test("a bar under the Combo shrinks over the 10 s, and the counter bumps for 0.25 s per insertion", async ({
  page,
}) => {
  await openPackage(page);
  const bar = page.locator(".streak-container .bar");
  await expect(bar).toHaveCSS("transform", "matrix(0, 0, 0, 1, 0, 0)");

  await page.keyboard.type("a");

  // Full width, then shrinking to nothing over exactly the time left.
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).transform)).not.toBe("matrix(0, 0, 0, 1, 0, 0)");
  await expect
    .poll(() =>
      bar.evaluate((el) =>
        el.getAnimations().map((animation) => ({
          property: (animation as CSSTransition).transitionProperty,
          duration: animation.effect!.getTiming().duration,
          easing: animation.effect!.getTiming().easing,
        })),
      ),
    )
    .toEqual([{ property: "transform", duration: 10_000, easing: "linear" }]);
  await expect.poll(() => cssAnimations(combo(page))).toEqual([{ name: "grow", duration: 250 }]);
});

// The original's 15 exclamations.
const EXCLAMATIONS = [
  "Super!", "Radical!", "Fantastic!", "Great!", "OMG", "Whoah!", ":O", "Nice!",
  "Splendid!", "Wild!", "Grand!", "Impressive!", "Stupendous!", "Extreme!", "Awesome!",
];

test("every 10 Combo shows one of the original's exclamations, gone after 3 s", async ({ page }) => {
  await page.clock.install();
  await openPackage(page);
  const exclamations = page.locator(".streak-container .exclamation");

  await page.keyboard.type("123456789");
  await expect(exclamations).toHaveCount(0);
  await page.keyboard.type("0");
  await expect(exclamations).toHaveCount(1);
  expect(EXCLAMATIONS).toContain(await exclamations.textContent());
  expect(await cssAnimations(exclamations)).toEqual([{ name: "exclamation", duration: 1_500 }]);

  await page.clock.fastForward(2_000);
  await page.keyboard.type("1234567890");
  await expect(exclamations).toHaveCount(2);
  await page.clock.fastForward(1_000);
  await expect(exclamations).toHaveCount(1);
  await page.clock.fastForward(2_000);
  await expect(exclamations).toHaveCount(0);
});

test("an insertion worth more than 1 that passes a multiple of 10 still shows an exclamation", async ({ page }) => {
  await openPackage(page);

  await page.keyboard.type("123456789");
  await paste(page, "one\ntwo");

  await expect(combo(page)).toHaveText("12");
  await expect(page.locator(".streak-container .exclamation")).toHaveCount(1);
});

// The heading fades in and out as a whole with its container.
const powerModeHeading = (page: Page) => page.locator(".power-mode-indicator", { hasText: "POWER MODE!" });

test("at Combo 200 Power Mode turns on, and 10 s idle turns it off", async ({ page }) => {
  await page.clock.install();
  await openPackage(page);
  const logo = page.locator(".background");
  const GREEN = "rgb(78, 255, 161)";
  const CYAN = "rgb(0, 221, 255)";

  const tagName = page.locator("#editor .ace_tag-name").first();
  await page.keyboard.type(`<p>${"a".repeat(196)}`);
  await expect(combo(page)).toHaveText("199");
  await expect(tagName).toHaveCSS("color", "rgb(0, 255, 121)");
  await expect(powerModeHeading(page)).toHaveCSS("opacity", "0");
  await expect(combo(page)).toHaveCSS("color", GREEN);
  await expect(logo).toHaveCSS("animation-name", "none");

  await page.keyboard.type("a");
  await expect(powerModeHeading(page)).toHaveCSS("opacity", "1");
  await expect(combo(page)).toHaveCSS("color", CYAN);
  await expect(logo).toHaveCSS("animation-name", "background-power");
  await expect(logo).toHaveCSS("animation-duration", "2s");
  await expect(tagName).toHaveCSS("color", CYAN);
  await expect(page.locator(".name-badge")).toHaveCSS("background-color", "rgba(0, 221, 255, 0.75)");

  await page.clock.fastForward(10_000);
  await expect(combo(page)).toHaveText("0");
  await expect(powerModeHeading(page)).toHaveCSS("opacity", "0");
  await expect(combo(page)).toHaveCSS("color", GREEN);
  await expect(logo).toHaveCSS("animation-name", "none");
});

// The Combo the original editor (brace 0.5.1) reaches for the same input. Its ACE split one
// insertion over several lines into separate changes, so Enter between nested tags and
// multi-line pastes count more than 1. "\n" presses Enter.
const ORIGINAL_COMBO: [input: { keys: string } | { paste: string }, combo: number][] = [
  [{ keys: "<p>" }, 3],
  [{ keys: "<p>\n" }, 4],
  [{ keys: "  hello\nworld" }, 14],
  [{ keys: "<div>\n<p>\n" }, 11],
  [{ keys: "<style>\na{\n" }, 12],
  [{ paste: "hello world" }, 1],
  [{ paste: "one\ntwo" }, 3],
  [{ paste: "one\ntwo\nthree\nfour" }, 3],
  [{ paste: "one\ntwo\n" }, 2],
];

for (const [input, expected] of ORIGINAL_COMBO) {
  test(`${JSON.stringify(input)} gives the Combo the original gives`, async ({ page }) => {
    await openPackage(page);

    if ("keys" in input) await page.keyboard.type(input.keys, { delay: 40 });
    else await paste(page, input.paste);

    await expect(combo(page)).toHaveText(String(expected));
  });
}

test("an HTML comment pulses as one span, as in the original", async ({ page }) => {
  await openPackage(page);

  await page.keyboard.type("<!-- hi -->");

  await expect(page.locator("#editor .ace_comment")).toHaveText(["<!-- hi -->"]);
});

test("pulsing comments and strings share one beat, including on the line being typed", async ({ page }) => {
  await openPackage(page);
  /** The start time of every pulse on screen. */
  const pulseStarts = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("#editor .ace_comment, #editor .ace_string, #editor .ace_constant")].flatMap(
        (span) => span.getAnimations().map((animation) => animation.startTime),
      ),
    );

  await page.keyboard.type('<!-- a --><a href="x">');
  await nextFrame(page);
  await page.waitForTimeout(100);
  // Retyped lines are drawn afresh, so their pulses would restart without the shared beat.
  await page.keyboard.type('<b title="y"><!-- c -->');
  await nextFrame(page);

  const starts = await pulseStarts();
  expect(starts.length).toBeGreaterThanOrEqual(4);
  expect(new Set(starts)).toEqual(new Set([0]));
});
