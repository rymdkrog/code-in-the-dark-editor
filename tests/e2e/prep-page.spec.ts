import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import type { RoundData } from "../../src/round-package/round-data.ts";
import { gateNetwork } from "./no-network-gate.ts";

const fixture = (file: string) => fileURLToPath(new URL(`../../fixtures/practice/${file}`, import.meta.url));
const REFERENCE = fixture("reference.png");

const pngDataUri = (path: string) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;

let downloads = 0;

/** Clicks Export and saves the Round package it downloads, in a folder of its own. */
async function exportRound(page: Page, testInfo: TestInfo) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /^(Re-)?[Ee]xport/ }).click(),
  ]);
  const path = testInfo.outputPath(`download-${++downloads}`, download.suggestedFilename());
  await download.saveAs(path);
  return { fileName: download.suggestedFilename(), path };
}

/** Opens a Round package from file://, offline and behind the no-network gate. */
async function openPackage(browser: Browser, path: string) {
  const context = await browser.newContext();
  const check = await gateNetwork(context);
  const page = await context.newPage();
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator("#editor textarea")).toBeFocused();
  const round = await page.evaluate(
    () => JSON.parse(document.getElementById("round")!.textContent!) as RoundData,
  );
  return { page, round, close: async () => (check(), await context.close()) };
}

/** Drops a file onto an element, the way dragging it from the desktop does. */
async function dropFile(page: Page, selector: string, path: string, type: string) {
  const dataTransfer = await page.evaluateHandle(
    ([base64, name, type]) => {
      const bytes = Uint8Array.from(atob(base64!), (char) => char.charCodeAt(0));
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name!, { type }));
      return transfer;
    },
    [readFileSync(path).toString("base64"), path.split("/").pop(), type],
  );
  await page.dispatchEvent(selector, "dragover", { dataTransfer });
  await page.dispatchEvent(selector, "drop", { dataTransfer });
}

async function newRound(page: Page) {
  await page.goto("/");
  await page.getByLabel("Competition name").fill("Gothenburg 2026");
  await page.getByRole("button", { name: "+ Heat" }).click();
}

test("dropping a Reference onto the Round shows it full size", async ({ page }) => {
  await newRound(page);

  await dropFile(page, "text=Drop the Reference", REFERENCE, "image/png");

  const reference = page.getByRole("img", { name: "Reference" });
  await expect(reference).toBeVisible();
  expect(await reference.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.width])).toEqual([
    1280, 1280,
  ]);
});

test("uploaded assets get their pixel dimensions, and awkward or clashing names are refused", async ({ page }) => {
  await newRound(page);
  const moon = readFileSync(fixture("assets/moon.png"));
  const assets = page.getByRole("table", { name: "Assets" });

  await page.getByLabel("Add assets").setInputFiles({ name: "moon.png", mimeType: "image/png", buffer: moon });
  await expect(assets.getByRole("row", { name: /moon\.png/ })).toContainText("240 × 240");

  await page.getByLabel("Add assets").setInputFiles([
    { name: "MOON.PNG", mimeType: "image/png", buffer: moon },
    { name: "my moon.png", mimeType: "image/png", buffer: moon },
    { name: "-moon.png", mimeType: "image/png", buffer: moon },
    { name: "moon_2.png", mimeType: "image/png", buffer: moon },
  ]);

  await expect(page.getByText(/Refused “MOON\.PNG”: it clashes with “moon\.png”/)).toBeVisible();
  await expect(page.getByText(/Refused “my moon\.png”/)).toBeVisible();
  await expect(page.getByText(/Refused “-moon\.png”/)).toBeVisible();
  await expect(assets.getByRole("row")).toHaveCount(2);
  await expect(assets.getByRole("row", { name: /moon_2\.png/ })).toContainText("240 × 240");
});

test("an asset over 32 MB gets a warning", async ({ page }) => {
  await newRound(page);

  await page.getByLabel("Add assets").setInputFiles({
    name: "Huge.woff2",
    mimeType: "font/woff2",
    buffer: Buffer.alloc(25 * 1024 * 1024),
  });

  // 25 MB of file is over 32 MB as a data: URI, which is what Firefox ESR can't load.
  await expect(page.getByRole("row", { name: /Huge\.woff2/ })).toContainText("over 32 MB");
  await expect(page.getByText(/Huge\.woff2 is over 32 MB/)).toBeVisible();
});

test("the Competition-wide rules are pre-filled, editable, and reach the package", async ({
  page,
  browser,
}, testInfo) => {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByRole("button", { name: /Competition/ }).click();
  const rules = page.getByLabel("Rules");
  await expect(rules).toHaveValue(/^Recreate the Reference using only HTML and CSS\./);

  await rules.fill("Only HTML and CSS.\nNo preview.");
  await page.getByRole("button", { name: /^Heat 1/ }).click();
  const exported = await exportRound(page, testInfo);

  const opened = await openPackage(browser, exported.path);
  expect(opened.round.instructions.rules).toBe("Only HTML and CSS.\nNo preview.");
  await opened.close();
});

test("each export keeps the Round id and stamps a new Revision", async ({ page, browser }, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-12T14:03:30Z"));
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByLabel("Add assets").setInputFiles(fixture("assets/moon.png"));

  const first = await exportRound(page, testInfo);
  await expect(page.getByText("Rev 1 · 12 Oct 14:03")).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-10-12T14:09:05Z"));
  const second = await exportRound(page, testInfo);
  await expect(page.getByText("Rev 2 · 12 Oct 14:09")).toBeVisible();

  const one = await openPackage(browser, first.path);
  const two = await openPackage(browser, second.path);
  expect(one.round.revision).toBe("1-202610121403");
  expect(two.round.revision).toBe("2-202610121409");
  expect(one.round.roundId).toMatch(/\w{8,}/);
  expect(two.round.roundId).toBe(one.round.roundId);
  expect(two.round.editorVersion).toMatch(/^\d+\.\d+\.\d+\+\w+$/);
  expect(two.round.audience).toBeUndefined();
  expect(two.round.assets).toEqual([
    { name: "moon.png", width: 240, height: 240, dataUri: pngDataUri(fixture("assets/moon.png")) },
  ]);
  await one.close();
  await two.close();

  await page.getByRole("button", { name: "+ Heat" }).click();
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  const other = await openPackage(browser, (await exportRound(page, testInfo)).path);
  expect(other.round.roundId).not.toBe(one.round.roundId);
  expect(other.round.revision).toBe("1-202610121409");
  await other.close();
});

test("an Organizer builds a Competition and exports a Round package that opens from file://", async ({
  page,
  browser,
}, testInfo) => {
  await page.goto("/");
  await page.getByLabel("Competition name").fill("Gothenburg 2026");
  await page.getByRole("button", { name: "+ Heat" }).click();
  await page.getByRole("button", { name: "+ Heat" }).click();
  await page.getByRole("button", { name: "+ Final" }).click();
  await page.getByRole("button", { name: /^Heat 2/ }).click();
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);

  const exported = await exportRound(page, testInfo);

  expect(exported.fileName).toBe("citd-gothenburg-2026-heat-2.html");
  const opened = await openPackage(browser, exported.path);
  // What the package carries is what its badge and Reference thumbnail show.
  expect(opened.round.competitionName).toBe("Gothenburg 2026");
  expect(opened.round.roundName).toBe("Heat 2");
  expect(opened.round.reference).toBe(pngDataUri(REFERENCE));
  await opened.close();
});
