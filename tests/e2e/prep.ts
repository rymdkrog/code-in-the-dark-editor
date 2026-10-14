// Driving the prep page: exporting Round packages and opening them from file://.

import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, type Browser, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { RoundData } from "../../src/round-package/round-data.ts";
import { gateNetwork } from "./no-network-gate.ts";
import { roundIn } from "./package.ts";

export const fixture = (file: string) => fileURLToPath(new URL(`../../fixtures/practice/${file}`, import.meta.url));
export const REFERENCE = fixture("reference.png");

let downloads = 0;

/** Clicks a button and keeps the file it downloads, in a folder of its own. */
export async function downloadFrom(button: Locator, testInfo: TestInfo) {
  const [download] = await Promise.all([button.page().waitForEvent("download"), button.click()]);
  const path = testInfo.outputPath(`download-${++downloads}`, download.suggestedFilename());
  await download.saveAs(path);
  return { fileName: download.suggestedFilename(), path };
}

/** Clicks Export and keeps the Round package it downloads. */
export const exportRound = (page: Page, testInfo: TestInfo) =>
  downloadFrom(page.getByRole("button", { name: /^(Re-)?[Ee]xport$/ }), testInfo);

/** Opens a Round package from file://, offline and behind the no-network gate. */
export async function openPackage(browser: Browser, path: string) {
  const context = await browser.newContext();
  const check = await gateNetwork(context, { workerUrl: roundIn(path).audience?.workerUrl });
  const page = await context.newPage();
  await page.goto(pathToFileURL(path).href);
  const nameDialog = page.getByRole("dialog");
  await nameDialog.getByRole("textbox").fill("Anna");
  await page.keyboard.press("Enter");
  await expect(nameDialog).toBeHidden();
  await expect(page.locator("#editor textarea")).toBeFocused();
  const round = await page.evaluate(
    () => JSON.parse(document.getElementById("round")!.textContent!) as RoundData,
  );
  return { page, round, close: async () => (check(), await context.close()) };
}

export async function newRound(page: Page) {
  await page.goto("/");
  await page.getByLabel("Competition name").fill("Gothenburg 2026");
  await page.getByRole("button", { name: "+ Heat" }).click();
}

export async function openAudiencePane(page: Page) {
  await page.getByRole("button", { name: /Audience/ }).click();
}

export async function turnOnAudience(page: Page, workerUrl: string) {
  await openAudiencePane(page);
  await page.getByLabel(/Audience layer/).check();
  await page.getByLabel("Worker URL").fill(workerUrl);
}
