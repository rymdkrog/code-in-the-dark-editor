import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { editorText, nextFrame, openPackage, resultFrame, reveal, revealButton, setEditorText, test } from "./package.ts";

// References the practice Round's one asset every way a Contestant might, plus a script and
// an external font and stylesheets, which must neither run nor load.
const CONTESTANT_CODE = readFileSync(new URL("../../fixtures/reveal/contestant.html", import.meta.url), "utf8");

/** Counts the Reveal events the Core publishes from now on. */
const recordRevealEvents = (page: Page) =>
  page.evaluate(() => {
    const events: string[] = [];
    for (const type of ["citd:reveal-started", "citd:reveal-ended"]) {
      window.addEventListener(type, (event) => events.push(`${event.type}:${event instanceof CustomEvent}`));
    }
    (window as unknown as { revealEvents: string[] }).revealEvents = events;
  });
const revealEvents = (page: Page) =>
  page.evaluate(() => (window as unknown as { revealEvents: string[] }).revealEvents);

const result = (page: Page) => page.frameLocator("iframe.result");

test("the Reveal renders the code with the Round's assets, and no JavaScript or external resources", async ({
  page,
}) => {
  await openPackage(page);
  await setEditorText(page, CONTESTANT_CODE);

  await reveal(page);

  // The script didn't run.
  await expect(result(page).locator("#title")).toHaveText("Good night");
  for (const id of ["plain", "dotted", "srcset"]) {
    await expect
      .poll(() =>
        result(page)
          .locator(`#${id}`)
          .evaluate((image: HTMLImageElement) => image.naturalWidth > 0 && image.currentSrc.startsWith("data:image/png")),
      )
      .toBe(true);
  }
  await expect(result(page).locator("#missing")).toHaveJSProperty("naturalWidth", 0);
  for (const id of ["sky", "styled"]) {
    await expect(result(page).locator(`#${id}`)).toHaveCSS("background-image", /^url\("data:image\/png;base64,/);
  }
  // No font loaded: the CSP refused the remote one and the stylesheets that bring the others.
  const fontStatuses = () =>
    result(page)
      .locator("body")
      .evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts].map((font) => `${font.family}: ${font.status}`);
      });
  expect(await fontStatuses()).not.toContainEqual(expect.stringMatching(/: loaded$/));
  await expect(result(page).locator("body")).toHaveCSS("font-family", /Remote/);
});

test("the result renders in standards mode with or without a doctype, as in the original", async ({ page }) => {
  await openPackage(page);
  await setEditorText(page, "<p>No doctype</p>");

  await reveal(page);

  await expect(result(page).locator("p")).toHaveText("No doctype");
  expect(await result(page).locator("p").evaluate(() => document.compatMode)).toBe("CSS1Compat");
});

test('the Reveal asks for "yes" first, and Cancel or Esc go back to the editor', async ({ page }) => {
  await openPackage(page);
  await page.keyboard.type("<h1>");
  await recordRevealEvents(page);
  const dialog = page.getByRole("dialog");

  await revealButton(page).click();
  await expect(dialog).toContainText("WILL DISQUALIFY YOU");
  await expect(dialog.getByRole("alert")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText('Type "yes" to reveal');
  await dialog.getByRole("textbox").fill("no");
  await expect(dialog.getByRole("alert")).toBeHidden();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("alert")).toHaveText('Type "yes" to reveal');
  // One click, even right after a wrong word.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#editor textarea")).toBeFocused();

  await revealButton(page).click();
  await expect(dialog.getByRole("textbox")).toHaveValue("");
  await expect(dialog.getByRole("alert")).toBeHidden();
  await dialog.getByRole("textbox").fill("yes");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.locator("#editor textarea")).toBeFocused();
  await nextFrame(page);
  await page.keyboard.type("Hi");
  expect(await editorText(page)).toBe("<h1>Hi</h1>");
  await expect(resultFrame(page)).toBeHidden();
  expect(await revealEvents(page)).toEqual([]);

  // As in the original, "yes" in any case.
  await reveal(page, "Yes");
  await expect(result(page).locator("h1")).toHaveText("Hi");
  expect(await revealEvents(page)).toEqual(["citd:reveal-started:true"]);
});

test("during the Reveal only the result and the name badge show, without Power Mode", async ({ page }) => {
  await page.clock.install();
  await openPackage(page);
  await page.keyboard.type(`<p>${"a".repeat(197)}`);
  await expect(page.locator("body")).toHaveClass(/power-mode/);
  await expect(page.locator(".exclamations .exclamation").first()).toBeVisible();

  await reveal(page);

  await expect(result(page).locator("p")).toHaveText("a".repeat(197));
  const badge = page.getByRole("button", { name: "Anna · Practice" });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveCSS("background-color", "rgba(58, 147, 100, 0.75)");
  for (const hidden of [
    "#editor",
    ".reference",
    ".streak-container",
    ".exclamations",
    ".power-mode-indicator",
    ".canvas-overlay",
    ".background",
    ".button-bar",
  ]) {
    await expect(page.locator(hidden), hidden).toBeHidden();
  }
  // The result covers the window, under the badge.
  const box = (await resultFrame(page).boundingBox())!;
  expect([box.x, box.y, box.width, box.height]).toEqual([0, 0, page.viewportSize()!.width, page.viewportSize()!.height]);

  // Esc doesn't bring the Reference back.
  await page.keyboard.press("Escape");
  await expect(page.locator(".reference")).toBeHidden();
});

test("the name badge still edits the name during the Reveal", async ({ page }) => {
  await openPackage(page);
  await reveal(page);

  await page.getByRole("button", { name: "Anna · Practice" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill("Anna B");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Anna B · Practice" })).toBeVisible();
  await expect(resultFrame(page)).toBeVisible();
});

test("the storage icon is hidden during the Reveal", async ({ page }) => {
  // Every localStorage write throws, as on a full disk.
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
  });
  await openPackage(page);
  const storageFailing = page.getByTitle("Autosave isn't working — download a backup");
  await expect(storageFailing).toBeVisible();

  await reveal(page);

  await expect(storageFailing).toBeHidden();
});

test("nothing is kept: a reload ends the Reveal, back to the editor with the code, and revealing again needs yes", async ({
  page,
}) => {
  await openPackage(page);
  await page.keyboard.type("<h1>");
  await reveal(page);
  // Leaving publishes the Reveal's end.
  await page.evaluate(() =>
    window.addEventListener("citd:reveal-ended", () => localStorage.setItem("test:reveal-ended", "yes")),
  );

  await page.reload();

  expect(await page.evaluate(() => localStorage.getItem("test:reveal-ended"))).toBe("yes");
  await expect(resultFrame(page)).toBeHidden();
  await expect(page.locator(".reference")).toBeVisible();
  expect(await editorText(page)).toBe("<h1></h1>");
  await expect(page.locator("#editor textarea")).toBeFocused();
  await nextFrame(page);
  await page.keyboard.type("x");
  await expect.poll(() => editorText(page)).toBe("x<h1></h1>");

  await revealButton(page).click();
  await expect(page.getByRole("dialog").getByRole("textbox")).toHaveValue("");
});
