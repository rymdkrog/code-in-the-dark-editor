import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { expect, type Page } from "@playwright/test";
import { fillTemplate } from "../../src/round-package/fill-template.ts";
import type { RoundData } from "../../src/round-package/round-data.ts";
import { editorText, editorTextWithCaret, enterName, nextFrame, openPackage, PRACTICE, TEMPLATE, test } from "./package.ts";

const readRoundData = (html: string): RoundData =>
  JSON.parse(html.match(/<script type="application\/json" id="round">([\s\S]*?)<\/script>/)![1]!);

test("the practice package opens from file:// offline, takes typing and shows the Reference", async ({ page }) => {
  await openPackage(page);

  await page.keyboard.type("Hello, dark");
  await page.keyboard.press("Escape");
  await expect
    .poll(() => reference(page).evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await nextFrame(page);
  await page.keyboard.type("!");

  expect(await editorText(page)).toBe("Hello, dark!");
});

// What the original editor (brace 0.5.1, ACE behaviours on) produces for the same keys,
// quirks included. "\n" presses Enter and "←" presses the left arrow.
const ORIGINAL_TYPING: [keys: string, result: string][] = [
  ["<p>", "<p>|</p>"],
  ["<p>\n", "<p>\n    |\n</p>"],
  ['<a href="x">', '<a href="x">|</a>'],
  ["<p>hello</p>", "<p>hello</p>|</p>"],
  ["<html←←>", "<ht>|</ht>ml"],
  ["(a [b] {c} 'd' \"e\")", "(a [b] {c} 'd' \"e\")|"],
  ["<style>\na {\ncolor: red;\n}", "<style>\n    a {\n        color: red;\n    }|\n    }\n</style>"],
  ["<style>\na{color:red}", "<style>\n    a{color:red}|;\n</style>"],
];

for (const [keys, result] of ORIGINAL_TYPING) {
  test(`typing ${JSON.stringify(keys)} gives what the original gives`, async ({ page }) => {
    await openPackage(page);

    for (const part of keys.split(/(←)/)) {
      if (part === "←") await page.keyboard.press("ArrowLeft");
      // At a fast typist's pace: ACE (like the original) only treats a line as CSS once its
      // background tokenizer, which runs on a short timer, has caught up with `<style>`.
      else await page.keyboard.type(part, { delay: 40 });
    }

    expect(await editorTextWithCaret(page)).toBe(result);
  });
}

test("Enter keeps the previous line's indentation", async ({ page }) => {
  await openPackage(page);

  await page.keyboard.type("  hello\nworld");

  expect(await editorText(page)).toBe("  hello\n  world");
});

test("there is no autocomplete or linting", async ({ page }) => {
  await openPackage(page);

  await page.keyboard.type("<div><p class=\"x\"></div>\n<sty");

  await expect(page.locator(".ace_autocomplete")).toBeHidden();
  await expect(page.locator(".ace_gutter-cell.ace_error, .ace_gutter-cell.ace_warning")).toHaveCount(0);
});

test("Ctrl/Cmd-F searches your code", async ({ page }) => {
  await openPackage(page);
  await page.keyboard.type("hello world hello");

  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByPlaceholder("Search for")).toBeFocused();
  await page.keyboard.type("world");
  await expect(page.locator(".ace_search_counter")).toHaveText("1 of 1");
  await page.keyboard.press("Escape");
  await expect(page.locator(".ace_search")).toBeHidden();
  await expect(page.locator("#editor textarea")).toBeFocused();
  // WebKit settles the refocused editor's selection a frame later; no person is faster.
  await nextFrame(page);
  await page.keyboard.type("dark");

  expect(await editorText(page)).toBe("hello dark hello");
});

test("it looks like the original: vibrant_ink, 20px monospace code, no active line, print margin or fold widgets", async ({
  page,
}) => {
  await openPackage(page);

  await expect(page.locator("#editor")).toHaveClass(/ace-vibrant-ink/);
  await expect(page.locator("#editor")).toHaveCSS("font-size", "20px");
  await expect(page.locator("#editor")).not.toHaveCSS("font-family", /Press Start 2P/);
  await expect(page.locator("body")).toHaveCSS("font-family", /Press Start 2P/);
  await expect(page.locator(".ace_active-line")).toBeHidden();
  await expect(page.locator(".ace_print-margin")).toBeHidden();

  await page.keyboard.type("<div>\n");
  await expect(page.locator(".ace_fold-widget")).toHaveCount(0);

  // The cursor steps one glyph per character only if ACE measured the font it draws with.
  // A wrong measurement is off by pixels per character; the cursor itself sits on whole pixels.
  const glyphWidth = await page.evaluate(() => {
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = getComputedStyle(document.querySelector("#editor")!).font;
    return context.measureText("abcdefghij").width / 10;
  });
  const cursorX = async () => (await page.locator(".ace_cursor").boundingBox())!.x;
  // ACE draws the cursor on its next frame; under load, reading it sooner gets a stale spot.
  await nextFrame(page);
  const before = await cursorX();
  await page.keyboard.type("abcdefghij");
  await expect.poll(async () => Math.abs((await cursorX()) - (before + 10 * glyphWidth))).toBeLessThan(1.5);
});

test("the bare template asks for a Round package from the prep page", async ({ page }) => {
  await page.goto(pathToFileURL(TEMPLATE).href);

  await expect(page.getByText("make a Round package with the prep page")).toBeVisible();
  await expect(page.locator("#editor.ace_editor")).toHaveCount(0);
  await expect(page.getByText("Combo")).toBeHidden();
  await expect(page.getByText("Reference")).toBeHidden();
  await expect(instructionsButton(page)).toBeHidden();
});

for (const file of [PRACTICE, TEMPLATE]) {
  const name = file.split("/").pop();

  test(`${name} starts with the licences and the editor version`, async () => {
    const html = readFileSync(file, "utf8");
    const banner = html.slice(0, html.indexOf("-->"));

    expect(html.startsWith("﻿<!--")).toBe(true);
    expect(banner).toMatch(/Code in the Dark Editor \d+\.\d+\.\d+\+[0-9a-f]{7,}/);
    expect(banner).toContain("Copyright (c) 2010, Ajax.org B.V.");
    expect(banner).toContain("SIL OPEN FONT LICENSE Version 1.1");
  });
}

test("the practice package is a pure offline Round", async () => {
  const html = readFileSync(PRACTICE, "utf8");
  const round = readRoundData(html);

  expect(round.roundName).toBe("Practice");
  expect(round.audience).toBeUndefined();
  expect(html).not.toContain("connect-src");
  expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
});

test("on first open a dialog asks for your name, shows the Round and puts it on the badge", async ({ page }) => {
  await page.goto(pathToFileURL(PRACTICE).href);

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("Practice");
  await enterName(page, "Anna");

  await expect(page.getByRole("button", { name: "Anna · Practice" })).toBeVisible();
  await expect(page.locator("#editor textarea")).toBeFocused();
});

test('the name dialog refuses an empty name, and "null"', async ({ page }) => {
  await page.goto(pathToFileURL(PRACTICE).href);
  const dialog = page.getByRole("dialog");

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  for (const refused of ["   ", "null", " null "]) {
    await dialog.getByRole("textbox").fill(refused);
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /· Practice$/ })).toBeHidden();
});

test("the first name dialog can't be dismissed", async ({ page }) => {
  await page.goto(pathToFileURL(PRACTICE).href);

  // Twice: Chromium lets a second Esc close a dialog that refused the first.
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await expect(page.getByRole("dialog")).toBeVisible();
});

test("the name is remembered, so reopening doesn't ask again", async ({ page }) => {
  await openPackage(page);

  await page.reload();

  await expect(page.getByRole("button", { name: "Anna · Practice" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator("#editor textarea")).toBeFocused();
});

test("the name carries to the next Round where the browser shares storage", async ({ page, browserName }, testInfo) => {
  test.skip(browserName === "firefox", "Firefox keeps one store per file, so each file asks again");
  const practice = readRoundData(readFileSync(PRACTICE, "utf8"));
  const heat2 = testInfo.outputPath("citd-heat-2.html");
  writeFileSync(
    heat2,
    fillTemplate(readFileSync(TEMPLATE, "utf8"), { ...practice, roundName: "Heat 2", roundId: "r_heat2" }),
  );
  await openPackage(page);

  await page.goto(pathToFileURL(heat2).href);

  await expect(page.getByRole("button", { name: "Anna · Heat 2" })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("clicking the badge edits the name, and Esc keeps the old one", async ({ page }) => {
  await openPackage(page);
  const dialog = page.getByRole("dialog");

  await page.getByRole("button", { name: "Anna · Practice" }).click();
  await expect(dialog).toContainText("Practice");
  await expect(dialog.getByRole("textbox")).toHaveValue("Anna");
  await enterName(page, "Anna B");
  await expect(page.getByRole("button", { name: "Anna B · Practice" })).toBeVisible();
  await expect(page.locator("#editor textarea")).toBeFocused();

  await page.getByRole("button", { name: "Anna B · Practice" }).click();
  await dialog.getByRole("textbox").fill("Bob");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Anna B · Practice" })).toBeVisible();
  await expect(page.locator("#editor textarea")).toBeFocused();

  await page.reload();
  await expect(page.getByRole("button", { name: "Anna B · Practice" })).toBeVisible();
});

const reference = (page: Page) => page.getByRole("img", { name: "Reference" });

test("a 200×160 Reference thumbnail sits at the bottom right", async ({ page }) => {
  await openPackage(page);

  const box = (await reference(page).boundingBox())!;
  const viewport = page.viewportSize()!;
  expect([box.width, box.height]).toEqual([200, 160]);
  expect(viewport.width - (box.x + box.width)).toBeLessThan(40);
  expect(viewport.height - (box.y + box.height)).toBeLessThan(120);
  // It shows the Round's Reference, which the practice fixture draws at 1280×800.
  expect(await reference(page).evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1280);
});

/** Whether the Reference fills the window, give or take the padding around it. */
const referenceIsFullScreen = async (page: Page) => {
  const box = (await reference(page).boundingBox())!;
  return box.width >= page.viewportSize()!.width - 60 && box.height >= page.viewportSize()!.height - 60;
};

/** Checks the editor has the keyboard back by typing into it. */
async function expectEditorTakesTyping(page: Page) {
  await expect(page.locator("#editor textarea")).toBeFocused();
  await nextFrame(page);
  await page.keyboard.type("x");
  await expect.poll(() => editorText(page)).toBe("x");
}

test("clicking the Reference opens it full screen, and clicking again goes back to the editor", async ({ page }) => {
  await openPackage(page);

  await reference(page).click();
  await expect.poll(() => referenceIsFullScreen(page)).toBe(true);

  await reference(page).click();
  await expect.poll(() => referenceIsFullScreen(page)).toBe(false);
  await expectEditorTakesTyping(page);
});

test("Esc opens the Reference full screen, and Esc again goes back to the editor", async ({ page }) => {
  await openPackage(page);

  await page.keyboard.press("Escape");
  await expect.poll(() => referenceIsFullScreen(page)).toBe(true);

  await page.keyboard.press("Escape");
  await expect.poll(() => referenceIsFullScreen(page)).toBe(false);
  await expectEditorTakesTyping(page);
});

test("Esc after clicking the Reference open closes it", async ({ page }) => {
  await openPackage(page);

  await reference(page).click();
  await expect.poll(() => referenceIsFullScreen(page)).toBe(true);
  await page.keyboard.press("Escape");

  await expect.poll(() => referenceIsFullScreen(page)).toBe(false);
  await expectEditorTakesTyping(page);
});

test("with the search box open, Esc closes the search box first", async ({ page }) => {
  await openPackage(page);
  // The editor settles its focus a frame after the name dialog closes; no person is faster.
  await nextFrame(page);
  await page.keyboard.press("ControlOrMeta+f");
  await expect(page.getByPlaceholder("Search for")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator(".ace_search")).toBeHidden();
  expect(await referenceIsFullScreen(page)).toBe(false);

  // Also when the Contestant has gone back to typing with the search box still open.
  await page.keyboard.press("ControlOrMeta+f");
  await page.locator("#editor .ace_content").click();
  await expect(page.locator("#editor textarea")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ace_search")).toBeHidden();
  expect(await referenceIsFullScreen(page)).toBe(false);

  await page.keyboard.press("Escape");
  await expect.poll(() => referenceIsFullScreen(page)).toBe(true);
});

const instructions = (page: Page) => page.getByRole("region", { name: "Instructions" });
const instructionsButton = (page: Page) => page.getByRole("button", { name: "Instructions" });

test("the Instructions button opens the overlay, and a click beside it goes back to the editor", async ({ page }) => {
  await openPackage(page);
  await expect(instructions(page)).toBeHidden();

  await instructionsButton(page).click();
  await expect(instructions(page)).toBeVisible();

  await page.mouse.click(5, 5);
  await expect(instructions(page)).toBeHidden();
  await expectEditorTakesTyping(page);
});

test("Esc closes the Instructions overlay, and only that", async ({ page }) => {
  await openPackage(page);
  await instructionsButton(page).click();
  await expect(instructions(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(instructions(page)).toBeHidden();
  expect(await referenceIsFullScreen(page)).toBe(false);
  await expectEditorTakesTyping(page);
});

test("the Instructions show the Round's rules, note, colours and assets, in that order, as plain text", async ({
  page,
}) => {
  await openPackage(page);
  await instructionsButton(page).click();

  const text = await instructions(page).innerText();
  const inOrder = [
    "Recreate the Reference using only HTML and CSS.",
    // The rules mention a tag; it is shown as text, never rendered.
    'Use the assets by file name, for example <img src="moon.png">.',
    "This is a practice Round. Your code stays on this laptop.",
    "#1B1F3B",
    "Night",
    "#F4F1EA",
    "Text",
    "moon.png",
    "240 × 240",
  ];
  let position = 0;
  for (const part of inOrder) {
    position = text.indexOf(part, position);
    expect(position, `${JSON.stringify(part)} in order in ${JSON.stringify(text)}`).toBeGreaterThanOrEqual(0);
  }
  await expect(instructions(page).locator("img")).toHaveCount(0);

  // Each colour has a swatch in that colour.
  await expect(instructions(page).getByText("#FF6B6B").locator("xpath=..").locator(".swatch")).toHaveCSS(
    "background-color",
    "rgb(255, 107, 107)",
  );
});

test("the Instructions text can be selected without closing the overlay", async ({ page }) => {
  await openPackage(page);
  await instructionsButton(page).click();

  await instructions(page).getByText("#4ECDC4").click({ clickCount: 3 });

  await expect(instructions(page)).toBeVisible();
  expect(await page.evaluate(() => getSelection()!.toString())).toContain("#4ECDC4");
});
