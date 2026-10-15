// The reset after a rehearsal, through the real Worker under `wrangler dev`: the Host clears every
// Roster and vote and the Stage goes back to the welcome screen, with the same Join code.

import { expect, test } from "@playwright/test";
import { stageLink } from "../../src/pages/links.ts";
import { claimConsole, desk, heatPackage, laptop, newClaim } from "./host.ts";
import { WORKER_URL } from "./worker.ts";

test("after a rehearsal Round with a laptop and a Vote, a reset empties the Roster and tally, the Stage shows the welcome screen, and an open laptop comes back", async ({
  browser,
  page: host,
}, testInfo) => {
  const claim = newClaim();
  await claimConsole(host, claim);
  const { rail, button, dialog } = desk(host);
  const heat = rail.getByRole("button", { name: /^Heat 1/ });
  await heat.click();
  const ada = await laptop(browser, heatPackage(testInfo, claim, 1), "Ada");
  const bo = await laptop(browser, heatPackage(testInfo, claim, 1), "Bo");
  await expect(heat).toContainText("2 ready", { timeout: 20_000 });
  await button("Start Round").click();
  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await button("Open voting").click();
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`${WORKER_URL}/join?c=${claim.joinCode}`);
  await phone.getByRole("list", { name: "Roster" }).getByRole("button", { name: "Ada" }).click();
  await expect(host.getByLabel("Turnout")).toHaveText("1 vote");
  const stage = await host.context().newPage();
  await stage.goto(stageLink(WORKER_URL, claim.joinCode, claim.competitionName));
  await expect(stage.getByText("Heat 1")).toBeVisible();
  await ada.close();

  await host.getByRole("button", { name: "Reset after rehearsal…" }).click();
  await expect(dialog).toContainText("Heat 1: 2 Roster entries, 1 vote.");
  await expect(dialog).toContainText("The Join code and Round packages stay the same");
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();

  await expect(desk(host).heading).toHaveText("Welcome screen");
  // Bo's laptop, still open, reconnects and is back on the Roster; Ada's is gone.
  await expect(heat).toContainText("1 ready");
  await expect(heat).not.toContainText("offline");
  await expect(stage.getByText(claim.joinCode, { exact: true })).toBeVisible();
  await expect(stage.getByText("Heat 1")).toHaveCount(0);
  await expect(phone.getByText("Nothing's on yet.")).toBeVisible();
  // Only Bo is left to clear, and no vote.
  await host.getByRole("button", { name: "Reset after rehearsal…" }).click();
  await expect(dialog).toContainText("Heat 1: 1 Roster entry, 0 votes.");
  await expect(bo.page.locator("#editor textarea")).toBeFocused();
  await bo.close();
});
