// Rounds added or renamed in prep after the claim reach the Host console and the Stage, through
// a fresh Host console link, on the real Worker under `wrangler dev`.

import { expect, test } from "@playwright/test";
import { hostConsoleLink } from "../../src/pages/links.ts";
import { claimConsole, claimedConsole, desk, HEAT, hostLinkIn, newClaim, prepareCompetition } from "./host.ts";
import { openAudiencePane } from "./prep.ts";
import { WORKER_URL } from "./worker.ts";

test("a Heat added and a Round renamed in prep after the claim reach the Host console and the Stage", async ({
  page,
  context,
}) => {
  const links = await prepareCompetition(page);
  const host = await context.newPage();
  await claimedConsole(host, links.hostLink);
  await desk(host).rail.getByRole("button", { name: /^Heat 1/ }).click();
  const stage = await context.newPage();
  await stage.goto(links.stageLink);
  await expect(stage.getByText("Heat 1")).toBeVisible();

  await page.getByRole("button", { name: "+ Heat" }).click();
  await page.getByRole("button", { name: /^Heat 1/ }).click();
  await page.getByLabel("Round name").fill("Opening Heat");
  const fresh = await context.newPage();
  await openAudiencePane(page);
  await fresh.goto(await hostLinkIn(page));

  const { rail, heading } = desk(fresh);
  await expect(rail).toContainText("Opening Heat");
  await expect(rail).toContainText("Heat 2");
  await expect(desk(host).rail).toContainText("Heat 2");
  await expect(stage.getByText("Opening Heat")).toBeVisible();
  await rail.getByRole("button", { name: /^Heat 2/ }).click();
  await expect(heading).toHaveText("Heat 2");
  await expect(stage.getByText("Heat 2")).toBeVisible();

  // The link from before the change, opened again, doesn't roll the list back.
  const older = await context.newPage();
  await older.goto(links.hostLink);
  await expect(desk(older).heading).toHaveText("Heat 2");
  await expect(desk(older).rail).toContainText("Opening Heat");
});

test("a link whose Round list leaves out the Current Round says why, and the console keeps working", async ({
  page,
  context,
}) => {
  const claim = newClaim();
  await claimConsole(page, claim);
  await desk(page).rail.getByRole("button", { name: /^Final/ }).click();
  await expect(desk(page).heading).toHaveText("Final");

  const without = await context.newPage();
  await without.goto(hostConsoleLink(WORKER_URL, { ...claim, rounds: [{ id: HEAT, name: "Heat 1" }], roundsChangedAt: Date.now() }));

  await expect(without.getByRole("alert")).toContainText("leaves out Final, the Current Round");
  const { rail, heading } = desk(without);
  await expect(heading).toHaveText("Final");
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await expect(heading).toHaveText("Heat 1");
});
