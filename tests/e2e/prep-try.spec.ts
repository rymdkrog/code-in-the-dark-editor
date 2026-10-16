// Trying a Round from the prep page: it opens in a new tab as a Contestant would see it, with no
// download, no Revision recorded and no Audience connection.

import { expect, test } from "@playwright/test";
import type { RoundData } from "../../src/round-package/round-data.ts";
import { gateNetwork } from "./no-network-gate.ts";
import { enterName, reveal, setEditorText } from "./package.ts";
import { fixture, newRound, REFERENCE, turnOnAudience } from "./prep.ts";
import { WORKER_URL } from "./worker.ts";

test("Try opens the Round in a new tab, offline even with the Audience layer on, and records nothing", async ({
  page,
  context,
}) => {
  await newRound(page);
  const tryButton = page.getByRole("button", { name: "Try", exact: true });
  await expect(tryButton).toBeDisabled();
  await expect(tryButton).toHaveAccessibleDescription(/not the check on a Contestant's laptop/);

  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByLabel("Add assets").setInputFiles(fixture("assets/moon.png"));
  await expect(tryButton).toBeEnabled();

  // The real Worker, so the prep page's own Host socket connects without errors.
  await turnOnAudience(page, WORKER_URL);
  await page.getByRole("button", { name: /^Heat 1/ }).click();
  const status = page.locator(".topbar .status");
  await expect(status).toHaveText("not exported");

  // Every page opened from now on is gated, and no Worker socket is allowed.
  const check = await gateNetwork(context, { online: true });
  const downloads: string[] = [];
  page.on("download", (download) => downloads.push(download.suggestedFilename()));
  const [tried] = await Promise.all([context.waitForEvent("page"), tryButton.click()]);

  expect(new URL(tried.url()).protocol).toBe("blob:");
  await enterName(tried, "Anna");
  await expect(tried.locator("#editor textarea")).toBeFocused();
  const round = await tried.evaluate(() => JSON.parse(document.getElementById("round")!.textContent!) as RoundData);
  expect(round.audience).toBeUndefined();
  expect(round.revision).toMatch(/^1-\d{12}$/);

  await setEditorText(tried, '<img id="moon" src="moon.png">');
  await reveal(tried);
  await expect
    .poll(() =>
      tried
        .frameLocator("iframe.result")
        .locator("#moon")
        .evaluate((image: HTMLImageElement) => image.naturalWidth > 0 && image.currentSrc.startsWith("data:image/png")),
    )
    .toBe(true);
  check();

  expect(downloads).toEqual([]);
  await expect(status).toHaveText("not exported");
  await expect(page.getByText("Not exported yet.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export 1 changed" })).toBeVisible();
});
