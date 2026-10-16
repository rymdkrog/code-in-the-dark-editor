// The live Roster: Round packages with the local Worker's URL, opened from file://, appear on
// the Host console run by the real Worker under `wrangler dev`.

import { expect, test, type Page } from "@playwright/test";
import { claimConsole, heatPackage, laptop, newClaim } from "./host.ts";
import { enterName } from "./package.ts";
import { closeOwnContexts } from "./contexts.ts";

test.afterEach(closeOwnContexts);

const rosterOf = (host: Page) => host.getByRole("table", { name: /^Roster/ });
const row = (host: Page, name: string) => rosterOf(host).getByRole("row").filter({ hasText: name });

test("Contestants appear on the Roster with their name and Revision; offline and stale entries are flagged", async ({
  browser,
  page: host,
}, testInfo) => {
  const claim = newClaim();
  // Opened before the claim: turned away, it retries without a word and appears once claimed.
  const anna = await laptop(browser, heatPackage(testInfo, claim, 1), "Anna");
  await claimConsole(host, claim);
  const rail = host.getByRole("navigation", { name: "Rounds" });
  await rail.getByRole("button", { name: /^Final/ }).click();
  await expect(rail.getByRole("button", { name: /^Final/ })).toContainText("nobody yet");
  await expect(rosterOf(host)).toContainText("Nobody has opened Final yet.");
  await rail.getByRole("button", { name: /^Heat 1/ }).click();

  await expect(row(host, "Anna")).toContainText("Rev 1", { timeout: 20_000 });
  await expect(row(host, "Anna").getByRole("img", { name: "Connected" })).toBeVisible();
  await expect(rail.getByRole("button", { name: /^Heat 1/ })).toContainText("1 ready");

  const bo = await laptop(browser, heatPackage(testInfo, claim, 2), "Bo");
  await expect(row(host, "Bo")).toContainText("Rev 2");
  await expect(row(host, "Anna")).toContainText("⚠ Rev 1 · newest is Rev 2");
  await expect(row(host, "Bo")).not.toContainText("⚠");
  await expect(rail.getByRole("button", { name: /^Heat 1/ })).toContainText("2 ready · 1 stale");

  await anna.close();
  await expect(row(host, "Anna").getByRole("img", { name: "Offline" })).toBeVisible();
  // Dimmed, as the Host sees it.
  await expect(row(host, "Anna").getByRole("cell", { name: "Anna", exact: true })).not.toHaveCSS(
    "color",
    await row(host, "Bo").getByRole("cell", { name: "Bo", exact: true }).evaluate((cell) => getComputedStyle(cell).color),
  );
  await expect(rail.getByRole("button", { name: /^Heat 1/ })).toContainText("1 ready · 1 offline · 1 stale");
  await expect(host.getByRole("heading", { name: /^Roster/ })).toContainText("1 ready · 1 offline · 1 stale");

  // A reload is the same laptop: the same entry, not a new one.
  await bo.page.reload();
  await expect(bo.page.locator("#editor textarea")).toBeFocused();
  await expect(rosterOf(host).getByRole("row")).toHaveCount(3);
  await expect(row(host, "Bo").getByRole("img", { name: "Connected" })).toBeVisible();
  await bo.close();
});

test("a new name shows on the Roster in place of the old one", async ({ browser, page: host }, testInfo) => {
  const claim = newClaim();
  await claimConsole(host, claim);
  await host.getByRole("navigation", { name: "Rounds" }).getByRole("button", { name: /^Heat 1/ }).click();
  const anna = await laptop(browser, heatPackage(testInfo, claim, 1), "Anna");
  await expect(row(host, "Anna")).toBeVisible();

  await anna.page.getByRole("button", { name: /^Anna/ }).click();
  await enterName(anna.page, "Anna K");

  await expect(row(host, "Anna K")).toBeVisible();
  await expect(rosterOf(host).getByRole("row")).toHaveCount(2);
  await anna.close();
});

test("the Host adds a Contestant by hand and removes entries after a confirm; a connected one stays off", async ({
  browser,
  page: host,
}, testInfo) => {
  const claim = newClaim();
  await claimConsole(host, claim);
  const rail = host.getByRole("navigation", { name: "Rounds" });
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  const anna = await laptop(browser, heatPackage(testInfo, claim, 1), "Anna");
  await expect(row(host, "Anna")).toBeVisible({ timeout: 20_000 });
  const dialog = host.getByRole("dialog");

  const add = host.getByRole("textbox", { name: "Add a Contestant by hand" });
  await add.fill("Cleo");
  await add.press("Enter");
  await expect(row(host, "Cleo")).toContainText("added by hand");
  await expect(row(host, "Cleo").getByRole("img", { name: /^Added by hand/ })).toBeVisible();
  await expect(add).toHaveValue("");
  await expect(rail.getByRole("button", { name: /^Heat 1/ })).toContainText("1 ready · 1 by hand");

  await row(host, "Cleo").getByRole("button", { name: "Remove Cleo" }).click();
  await expect(dialog).toContainText("Remove Cleo from Heat 1?");
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(row(host, "Cleo")).toHaveCount(0);

  await row(host, "Anna").getByRole("button", { name: "Remove Anna" }).click();
  await expect(dialog).toContainText("Their laptop is still connected. It stays hidden for the rest of this Round.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(row(host, "Anna")).toBeVisible();
  await row(host, "Anna").getByRole("button", { name: "Remove Anna" }).click();
  await dialog.getByRole("button", { name: "Remove" }).click();
  await expect(rosterOf(host)).toContainText("Nobody has opened Heat 1 yet.");

  // Reloading the removed laptop doesn't bring it back; a new one still appears.
  await anna.page.reload();
  await expect(anna.page.locator("#editor textarea")).toBeFocused();
  const bo = await laptop(browser, heatPackage(testInfo, claim, 1), "Bo");
  await expect(row(host, "Bo")).toBeVisible();
  await expect(row(host, "Anna")).toHaveCount(0);
  await Promise.all([anna.close(), bo.close()]);
});
