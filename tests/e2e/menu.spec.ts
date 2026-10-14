import { readFileSync, writeFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import {
  editorText,
  makePackage,
  menuButton,
  menuItem,
  nextFrame,
  openPackage,
  restoreFrom,
  setEditorText,
  test,
} from "./package.ts";

// The ⋯ menu: backup, restore, reset, and which Revision this is.

const dialog = (page: Page) => page.getByRole("dialog");

/** A Round package from Heat 2 of a Competition whose file prefix is gbg26. */
const heat2 = () =>
  makePackage(test.info().outputPath("citd-gbg26-heat-2.html"), {
    filePrefix: "gbg26",
    roundId: "heat-2-a1b2c3",
    roundName: "Heat 2",
    editorVersion: "2.1.0+abc1234",
    revision: "12-202610121403",
  });

async function expectEditorTakesTyping(page: Page, before = "") {
  await expect(page.locator("#editor textarea")).toBeFocused();
  await nextFrame(page);
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type("x");
  await expect.poll(() => editorText(page)).toBe(`${before}x`);
}

test("the ⋯ menu has backup, restore and reset, and says which Revision this is", async ({ page }) => {
  await openPackage(page, heat2());
  await expect(menuItem(page, "Download backup")).toBeHidden();

  await menuButton(page).click();

  await expect(page.getByText("Revision 12 Oct 14:03", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem")).toHaveText(["Download backup", "Restore from backup…", "Reset Round"]);
});

test("Esc closes the ⋯ menu, and only that", async ({ page }) => {
  await openPackage(page);
  await menuButton(page).click();
  await expect(page.getByRole("menu")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByRole("menu")).toBeHidden();
  // The Reference stays a thumbnail.
  const box = (await page.getByRole("img", { name: "Reference" }).boundingBox())!;
  expect(box.width).toBeLessThan(page.viewportSize()!.width / 2);
  await expectEditorTakesTyping(page);
});

test("tabbing out of the ⋯ menu closes it", async ({ page }) => {
  await openPackage(page);
  await menuButton(page).click();
  await expect(menuItem(page, "Download backup")).toBeFocused();

  await page.keyboard.press("ArrowUp");
  await expect(menuItem(page, "Reset Round")).toBeFocused();
  await page.keyboard.press("Tab");

  await expect(page.getByRole("menu")).toBeHidden();
  await expectEditorTakesTyping(page);
});

test("a click beside the ⋯ menu closes it", async ({ page }) => {
  await openPackage(page);
  await menuButton(page).click();
  await expect(page.getByRole("menu")).toBeVisible();

  await page.mouse.click(5, 5);

  await expect(page.getByRole("menu")).toBeHidden();
});

test("Download backup saves the code as a .txt named after the Competition, Round and Contestant", async ({ page }) => {
  await openPackage(page, heat2());
  await setEditorText(page, "<h1>My code</h1>\n<p>ÅÄÖ ✓</p>");
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));

  const download = page.waitForEvent("download");
  await menuButton(page).click();
  await menuItem(page, "Download backup").click();

  expect((await download).suggestedFilename()).toBe("gbg26-heat-2-anna-backup.txt");
  expect(readFileSync((await (await download).path())!, "utf8")).toBe("<h1>My code</h1>\n<p>ÅÄÖ ✓</p>");
  await expect(page.getByRole("menu")).toBeHidden();
  // Only when asked: typing and waiting downloads nothing.
  await page.locator("#editor textarea").focus();
  await page.keyboard.type("more");
  await page.waitForTimeout(1000);
  expect(downloads).toEqual(["gbg26-heat-2-anna-backup.txt"]);
});

test("Restore from backup… asks first, showing the file name, then replaces the Round's code", async ({ page }) => {
  const backup = test.info().outputPath("anything.txt");
  writeFileSync(backup, "<h1>From the backup</h1>");
  await openPackage(page);
  await page.keyboard.type("old code");

  await restoreFrom(page, backup);
  await expect(dialog(page)).toContainText("anything.txt");
  expect(await editorText(page)).toBe("old code");
  await dialog(page).getByRole("button", { name: "Restore" }).click();

  await expect(dialog(page)).toBeHidden();
  await expect.poll(() => editorText(page)).toBe("<h1>From the backup</h1>");
  await expectEditorTakesTyping(page, "<h1>From the backup</h1>");
});

test("Restore from backup… can be cancelled, and leaves the code alone", async ({ page }) => {
  const backup = test.info().outputPath("backup.txt");
  writeFileSync(backup, "from the backup");
  await openPackage(page);
  await page.keyboard.type("old code");

  await restoreFrom(page, backup);
  await dialog(page).getByRole("button", { name: "Cancel" }).click();

  await expect(dialog(page)).toBeHidden();
  expect(await editorText(page)).toBe("old code");
  await expectEditorTakesTyping(page, "old code");

  // Esc cancels too, and the same file can be picked again.
  await restoreFrom(page, backup);
  await expect(dialog(page)).toContainText("backup.txt");
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toBeHidden();
  // The "x" is from checking the editor took typing.
  expect(await editorText(page)).toBe("old codex");
});

test("Restore from backup… takes any text file, even another Round's", async ({ page }) => {
  const html = test.info().outputPath("citd-other-round.html");
  writeFileSync(html, "<!doctype html><p>not a backup</p>");
  await openPackage(page);

  await restoreFrom(page, html);
  await dialog(page).getByRole("button", { name: "Restore" }).click();

  await expect.poll(() => editorText(page)).toBe("<!doctype html><p>not a backup</p>");
});

test("undo after a restore doesn't bring the old code back", async ({ page }) => {
  const backup = test.info().outputPath("backup.txt");
  writeFileSync(backup, "restored");
  await openPackage(page);
  await page.keyboard.type("old code");

  await restoreFrom(page, backup);
  await dialog(page).getByRole("button", { name: "Restore" }).click();
  await expect.poll(() => editorText(page)).toBe("restored");
  await page.keyboard.press("ControlOrMeta+z");

  expect(await editorText(page)).toBe("restored");
});

test('Reset Round empties the Round only once "reset" is typed, and the empty Round is saved', async ({ page }) => {
  await openPackage(page);
  await page.keyboard.type("practice code");
  await menuButton(page).click();
  await menuItem(page, "Reset Round").click();

  const input = dialog(page).getByRole("textbox");
  await input.fill("yes");
  await page.keyboard.press("Enter");
  await expect(dialog(page).getByRole("alert")).toHaveText('Type "reset" to empty the Round');
  expect(await editorText(page)).toBe("practice code");

  await input.fill("reset");
  await page.keyboard.press("Enter");

  await expect(dialog(page)).toBeHidden();
  expect(await editorText(page)).toBe("");
  await page.keyboard.press("ControlOrMeta+z");
  expect(await editorText(page)).toBe("");
  await page.reload();
  await expect(page.locator("#editor textarea")).toBeFocused();
  expect(await editorText(page)).toBe("");
});

test("Reset Round can be cancelled with the button or Esc", async ({ page }) => {
  await openPackage(page);
  await page.keyboard.type("my code");

  for (const cancel of ["button", "Esc"]) {
    await menuButton(page).click();
    await menuItem(page, "Reset Round").click();
    await dialog(page).getByRole("textbox").fill("reset");
    if (cancel === "button") await dialog(page).getByRole("button", { name: "Cancel" }).click();
    else await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  }

  expect(await editorText(page)).toBe("my code");
  await expectEditorTakesTyping(page, "my code");
});

test("clicking the storage-failure icon opens the ⋯ menu", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
    };
  });
  await openPackage(page);

  await page.getByTitle("Autosave isn't working — download a backup").click();

  await expect(menuItem(page, "Download backup")).toBeVisible();
});
