import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";

const dist = (file: string) => fileURLToPath(new URL(`../../dist/${file}`, import.meta.url));
const PRACTICE = dist("citd-practice.html");
const TEMPLATE = dist("core-editor.html");

const ALLOWED_SCHEMES = ["file:", "data:", "blob:"];

// The no-network gate. Every test runs with the network off, records every request the page
// makes, every CSP violation and every error it reports, and fails on anything that leaves
// file:, data: or blob:.
const test = base.extend<{ gate: void }>({
  gate: [
    async ({ context }, use) => {
      const offending: string[] = [];
      const errors: string[] = [];
      await context.setOffline(true);
      context.on("request", (request) => {
        if (!ALLOWED_SCHEMES.includes(new URL(request.url()).protocol)) offending.push(request.url());
      });
      context.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      context.on("weberror", (error) => errors.push(String(error.error())));
      // A request the package's CSP blocks never reaches the network, so it never shows up
      // as a request. Count the violation itself.
      await context.exposeBinding("reportCspViolation", (_source, uri: string) => offending.push(`CSP: ${uri}`));
      await context.addInitScript(() =>
        document.addEventListener("securitypolicyviolation", (event) =>
          (window as unknown as { reportCspViolation(uri: string): void }).reportCspViolation(event.blockedURI),
        ),
      );

      await use();

      expect(offending, "requests other than file:, data: or blob:").toEqual([]);
      expect(errors, "errors reported by the page").toEqual([]);
    },
    { auto: true },
  ],
});

async function openPackage(page: Page, file = PRACTICE) {
  await page.goto(pathToFileURL(file).href);
  // The editor takes focus by itself, so the Contestant can type straight away.
  await expect(page.locator("#editor textarea")).toBeFocused();
}

const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

const editorText = (page: Page) =>
  page.evaluate(() => (document.querySelector("#editor") as unknown as EditorElement).env.editor.getValue());

/** The editor's text with `|` at the caret. */
const editorTextWithCaret = (page: Page) =>
  page.evaluate(() => {
    const { editor } = (document.querySelector("#editor") as unknown as EditorElement).env;
    const { row, column } = editor.getCursorPosition();
    const lines = editor.getValue().split("\n");
    lines[row] = `${lines[row]!.slice(0, column)}|${lines[row]!.slice(column)}`;
    return lines.join("\n");
  });

interface EditorElement {
  env: { editor: { getValue(): string; getCursorPosition(): { row: number; column: number } } };
}

test("the practice package opens from file:// offline and takes typing", async ({ page }) => {
  await openPackage(page);

  await page.keyboard.type("Hello, dark");

  expect(await editorText(page)).toBe("Hello, dark");
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
  const before = await cursorX();
  await page.keyboard.type("abcdefghij");
  await expect.poll(async () => Math.abs((await cursorX()) - (before + 10 * glyphWidth))).toBeLessThan(1.5);
});

test("the bare template asks for a Round package from the prep page", async ({ page }) => {
  await page.goto(pathToFileURL(TEMPLATE).href);

  await expect(page.getByText("make a Round package with the prep page")).toBeVisible();
  await expect(page.locator("#editor.ace_editor")).toHaveCount(0);
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
  const round = JSON.parse(html.match(/<script type="application\/json" id="round">([\s\S]*?)<\/script>/)![1]!);

  expect(round.roundName).toBe("Practice");
  expect(round.audience).toBeUndefined();
  expect(html).not.toContain("connect-src");
  expect(html).not.toMatch(/(src|href)="(https?:)?\/\//);
});
