import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test, type Browser, type Download, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { RoundData } from "../../src/round-package/round-data.ts";
import { gateNetwork } from "./no-network-gate.ts";

const fixture = (file: string) => fileURLToPath(new URL(`../../fixtures/practice/${file}`, import.meta.url));
const REFERENCE = fixture("reference.png");

const pngDataUri = (path: string) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;

let downloads = 0;

/** Clicks a button and keeps the file it downloads, in a folder of its own. */
async function downloadFrom(button: Locator, testInfo: TestInfo) {
  const [download] = await Promise.all([button.page().waitForEvent("download"), button.click()]);
  const path = testInfo.outputPath(`download-${++downloads}`, download.suggestedFilename());
  await download.saveAs(path);
  return { fileName: download.suggestedFilename(), path };
}

/** Clicks Export and keeps the Round package it downloads. */
const exportRound = (page: Page, testInfo: TestInfo) =>
  downloadFrom(page.getByRole("button", { name: /^(Re-)?[Ee]xport$/ }), testInfo);

/** Opens a Round package from file://, offline and behind the no-network gate. */
async function openPackage(browser: Browser, path: string) {
  const context = await browser.newContext();
  const check = await gateNetwork(context);
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
  await page.getByRole("button", { name: /^⚙ Competition/ }).click();
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

test("a reload picks up the Competition where the Organizer left off", async ({ page }) => {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByLabel("Add assets").setInputFiles(fixture("assets/moon.png"));
  await page.getByLabel("Round name").fill("Opening Heat");
  await page.getByRole("button", { name: /^⚙ Competition/ }).click();
  await page.getByLabel("Rules").fill("Only HTML and CSS.");
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  await page.reload();

  await expect(page.getByLabel("Competition name")).toHaveValue("Gothenburg 2026");
  await expect(page.getByLabel("Rules")).toHaveValue("Only HTML and CSS.");
  await page.getByRole("button", { name: /^Opening Heat/ }).click();
  await expect(page.getByRole("img", { name: "Reference" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Assets" }).getByRole("row", { name: /moon\.png/ })).toContainText(
    "240 × 240",
  );
});

test("each sidebar Round shows its Reference, asset count and whether it needs exporting", async ({
  page,
}, testInfo) => {
  await newRound(page);
  await page.getByRole("button", { name: "+ Heat" }).click();
  const heat1 = page.getByRole("button", { name: /^Heat 1/ });
  const heat2 = page.getByRole("button", { name: /^Heat 2/ });
  await expect(heat1).toContainText("✗ Reference · 0 assets");
  await expect(heat1).toContainText("problem");

  await heat1.click();
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await expect(heat1).toContainText("✓ Reference · 0 assets");
  await expect(heat1).toContainText("not exported");
  await exportRound(page, testInfo);
  await expect(heat1).toContainText("Rev 1 exported");
  await page.getByLabel("Add assets").setInputFiles(fixture("assets/moon.png"));
  await expect(heat1).toContainText("✓ Reference · 1 assets");
  await expect(heat1).toContainText("changed since Rev 1");
  await exportRound(page, testInfo);
  await expect(heat1).toContainText("Rev 2 exported");

  await heat2.click();
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await exportRound(page, testInfo);
  await expect(heat2).toContainText("Rev 1 exported");

  // A Competition-level change reaches every package, so every Round needs exporting again.
  await page.getByRole("button", { name: /^⚙ Competition/ }).click();
  await page.getByLabel("Rules").fill("Only HTML and CSS.");
  await expect(heat1).toContainText("changed since Rev 2");
  await expect(heat2).toContainText("changed since Rev 1");
});

test("Export N changed downloads every ready Round that's new or changed, unless two share a file name", async ({
  page,
}) => {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByRole("button", { name: "+ Heat" }).click();
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  // Heat 3 has no Reference, so it isn't ready.
  await page.getByRole("button", { name: "+ Heat" }).click();

  expect(await exportChanged(page, 2)).toEqual(["citd-gothenburg-2026-heat-1.html", "citd-gothenburg-2026-heat-2.html"]);
  await expect(page.getByRole("button", { name: "Export 0 changed" })).toBeDisabled();

  await page.getByRole("button", { name: /^Heat 1/ }).click();
  await page.getByLabel("Add assets").setInputFiles(fixture("assets/moon.png"));
  expect(await exportChanged(page, 1)).toEqual(["citd-gothenburg-2026-heat-1.html"]);
  await expect(page.getByRole("button", { name: /^Heat 1/ })).toContainText("Rev 2 exported");

  await page.getByRole("button", { name: /^Heat 3/ }).click();
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByLabel("Round name").fill("Heat 2!");
  await expect(page.getByText(/the same file as Heat 2\. Rename one/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Heat 2/ }).first()).toContainText("problem");
  // Heat 1 is ready and changed, but nothing exports while two Rounds clash.
  await page.getByRole("button", { name: /^⚙ Competition/ }).click();
  await page.getByLabel("Rules").fill("Only HTML and CSS.");
  await expect(page.getByRole("button", { name: "Export 1 changed" })).toBeDisabled();
  await expect(page.getByText(/Two Rounds would export to the same file name/)).toBeVisible();
});

/** Clicks Export N changed and returns the names of the Round packages it downloads. */
async function exportChanged(page: Page, count: number) {
  const names: string[] = [];
  const record = (download: Download) => names.push(download.suggestedFilename());
  page.on("download", record);
  await page.getByRole("button", { name: `Export ${count} changed` }).click();
  await expect.poll(() => names.length).toBe(count);
  page.off("download", record);
  return names.sort();
}

test("a Competition file saves the whole Competition, and replacing it offers to save it first", async ({
  page,
}, testInfo) => {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByLabel("Add assets").setInputFiles(fixture("assets/moon.png"));
  await exportRound(page, testInfo);
  const saved = await downloadFrom(page.getByRole("button", { name: "Save Competition file" }), testInfo);
  expect(saved.fileName).toBe("gothenburg-2026.citd-competition.json");

  await page.getByRole("button", { name: "New Competition" }).click();
  const offer = page.getByRole("dialog", { name: "Replace “Gothenburg 2026”?" });
  await offer.getByRole("button", { name: "Cancel" }).click();
  await expect(offer).toBeHidden();
  await expect(page.getByLabel("Competition name")).toHaveValue("Gothenburg 2026");
  await page.getByRole("button", { name: "New Competition" }).click();
  await offer.getByRole("button", { name: "Replace without saving" }).click();
  await expect(page.getByLabel("Competition name")).toHaveValue("");
  await expect(page.getByRole("button", { name: /^Heat/ })).toHaveCount(0);

  // Nothing to lose in an empty Competition, so it's replaced straight away.
  await page.getByLabel("Open a Competition file").setInputFiles(saved.path);
  await expect(page.getByLabel("Competition name")).toHaveValue("Gothenburg 2026");
  const heat1 = page.getByRole("button", { name: /^Heat 1/ });
  await expect(heat1).toContainText("✓ Reference · 1 assets");
  await expect(heat1).toContainText("Rev 1 exported");

  await page.getByRole("button", { name: "+ Heat" }).click();
  await page.getByLabel("Open a Competition file").setInputFiles(saved.path);
  const again = await downloadFrom(offer.getByRole("button", { name: "Save Competition file first" }), testInfo);
  expect(again.fileName).toBe("gothenburg-2026.citd-competition.json");
  await expect(page.getByRole("button", { name: /^Heat 2/ })).toHaveCount(0);
  await expect(heat1).toContainText("Rev 1 exported");

  await page.getByLabel("Open a Competition file").setInputFiles(REFERENCE);
  await expect(page.getByText("reference.png isn't a Competition file.")).toBeVisible();
  await expect(heat1).toBeVisible();

  // Edited rules are worth keeping too, even with no name and no Rounds.
  await page.getByRole("button", { name: "New Competition" }).click();
  await offer.getByRole("button", { name: "Replace without saving" }).click();
  await page.getByLabel("Rules").fill("Only HTML and CSS.");
  await page.getByRole("button", { name: "New Competition" }).click();
  await expect(page.getByRole("dialog", { name: "Replace “this Competition”?" })).toBeVisible();
});

test("a re-export after a reload keeps the Round id, and the Round view shows its Revision history", async ({
  page,
  browser,
}, testInfo) => {
  await page.clock.setFixedTime(new Date("2026-10-12T14:03:30Z"));
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  const first = await openPackage(browser, (await exportRound(page, testInfo)).path);
  await first.close();
  await expect(page.getByText("Saved in this browser")).toBeVisible();

  await page.reload();
  await page.clock.setFixedTime(new Date("2026-10-12T15:30:00Z"));
  await page.getByRole("button", { name: /^Heat 1/ }).click();
  const history = page.getByRole("region", { name: "Revisions" });
  await expect(history).toContainText(first.round.roundId);
  await expect(history.getByRole("listitem")).toHaveText(["Rev 1 · 12 Oct 14:03"]);
  const second = await openPackage(browser, (await exportRound(page, testInfo)).path);
  await second.close();

  expect(second.round.roundId).toBe(first.round.roundId);
  expect(second.round.revision).toBe("2-202610121530");
  await expect(history.getByRole("listitem")).toHaveText(["Rev 2 · 12 Oct 15:30", "Rev 1 · 12 Oct 14:03"]);
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
  await expect(opened.page.getByRole("button", { name: "Anna · Heat 2" })).toBeVisible();
  expect(opened.round.competitionName).toBe("Gothenburg 2026");
  // What the package carries is what its Reference thumbnail shows.
  expect(opened.round.reference).toBe(pngDataUri(REFERENCE));
  await opened.close();
});
