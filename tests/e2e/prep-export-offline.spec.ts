import { expect, test, type Page } from "@playwright/test";
import { downloadFrom, exportRound, newRound, openPackage, REFERENCE, turnOnAudience } from "./prep.ts";

const OFFLINE_LINE = /Packages export offline\. Turning on the Audience layer later means re-exporting and handing out every Round package again\./;

/** A Heat 1 with a Reference, ready to export. */
async function readyRound(page: Page) {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
}

/** Counts the downloads the page starts from now on. */
function countDownloads(page: Page) {
  let count = 0;
  page.on("download", () => count++);
  return () => count;
}

const heat1 = (page: Page) => page.getByRole("button", { name: /^Heat 1/ });
const roundExport = (page: Page) => page.getByRole("button", { name: /^(Re-)?[Ee]xport$/ });
const offlineDialog = (page: Page) => page.getByRole("dialog", { name: /offline/ });

test("with an invalid Worker URL, a Round's Export asks first: Cancel and Esc export nothing, Export anyway exports offline", async ({
  page,
  browser,
}, testInfo) => {
  await readyRound(page);
  await turnOnAudience(page, "citd.example.workers.dev");
  await heat1(page).click();
  const downloads = countDownloads(page);

  await roundExport(page).click();
  const dialog = offlineDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("no Reactions, voting or Stage timer");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await roundExport(page).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  expect(downloads()).toBe(0);
  await expect(heat1(page)).toContainText("not exported");
  await expect(page.getByRole("button", { name: "Export 1 changed" })).toBeEnabled();

  await roundExport(page).click();
  const exported = await downloadFrom(dialog.getByRole("button", { name: "Export anyway" }), testInfo);
  expect(exported.fileName).toBe("citd-gothenburg-2026-heat-1.html");
  await expect(dialog).toBeHidden();
  await expect(heat1(page)).toContainText("Rev 1 exported");
  const opened = await openPackage(browser, exported.path);
  expect(opened.round.audience).toBeUndefined();
  await opened.close();
});

test("with no Worker URL, Export N changed asks first: Fix the Worker URL exports nothing and focuses it, Export anyway exports every changed Round", async ({
  page,
}, testInfo) => {
  await readyRound(page);
  await turnOnAudience(page, "");
  const downloads = countDownloads(page);

  await page.getByRole("button", { name: "Export 1 changed" }).click();
  const dialog = offlineDialog(page);
  await dialog.getByRole("button", { name: "Fix the Worker URL" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Worker URL")).toBeFocused();
  expect(downloads()).toBe(0);
  await expect(heat1(page)).toContainText("not exported");

  // From a Round, it opens the Audience pane.
  await heat1(page).click();
  await roundExport(page).click();
  await dialog.getByRole("button", { name: "Fix the Worker URL" }).click();
  await expect(page.getByRole("heading", { name: "Audience" })).toBeVisible();
  await expect(page.getByLabel("Worker URL")).toBeFocused();
  expect(downloads()).toBe(0);

  await page.getByRole("button", { name: "Export 1 changed" }).click();
  const exported = await downloadFrom(dialog.getByRole("button", { name: "Export anyway" }), testInfo);
  expect(exported.fileName).toBe("citd-gothenburg-2026-heat-1.html");
  await expect(heat1(page)).toContainText("Rev 1 exported");
});

test("with the Audience layer off, both Exports download at once, beside a line saying the packages are offline", async ({
  page,
}, testInfo) => {
  await readyRound(page);
  await page.getByRole("button", { name: "+ Heat" }).click();
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);

  await expect(page.locator("main").getByText(OFFLINE_LINE)).toBeVisible();
  await expect(page.locator("aside").getByText(OFFLINE_LINE)).toBeVisible();

  await exportRound(page, testInfo);
  await expect(offlineDialog(page)).toHaveCount(0);
  const changedExport = await downloadFrom(page.getByRole("button", { name: "Export 1 changed" }), testInfo);
  expect(changedExport.fileName).toBe("citd-gothenburg-2026-heat-1.html");
  await expect(offlineDialog(page)).toHaveCount(0);
});

test("with the Audience layer on and a valid Worker URL, Export neither asks nor warns", async ({ page }, testInfo) => {
  await readyRound(page);
  await turnOnAudience(page, "https://citd.example.workers.dev");
  await heat1(page).click();

  await expect(page.getByText(OFFLINE_LINE)).toHaveCount(0);
  await exportRound(page, testInfo);
  await expect(offlineDialog(page)).toHaveCount(0);
  await expect(heat1(page)).toContainText("Rev 1 exported");
});
