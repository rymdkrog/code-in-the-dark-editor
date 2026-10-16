// The live flow for voting, through the real Worker under `wrangler dev`: phones vote, the Host
// watches the live tally and closes voting, and the Stage shows the ranking.

import { expect, test, type Browser, type Page } from "@playwright/test";
import { stageLink } from "../../src/pages/links.ts";
import type { Claim } from "../../src/protocol/protocol.ts";
import { claimConsole, desk, newClaim } from "./host.ts";
import { WORKER_URL } from "./worker.ts";
import { closeOwnContexts, ownContext } from "./contexts.ts";

test.afterEach(closeOwnContexts);

/** Heat 1 at voting, with Ada, Bo and Cleo added by hand. */
async function votingOpen(host: Page): Promise<Claim> {
  const claim = newClaim();
  await claimConsole(host, claim);
  const { rail, button, dialog } = desk(host);
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  for (const name of ["Ada", "Bo", "Cleo"]) {
    await host.getByLabel("Add a Contestant by hand").fill(name);
    await host.getByRole("button", { name: "Add", exact: true }).click();
    await expect(row(host, name)).toBeVisible();
  }
  await button("Start Round").click();
  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await button("Open voting").click();
  return claim;
}

/** A phone of its own, so its own voter id, on the Competition. */
async function phone(browser: Browser, claim: Claim) {
  const page = await (await ownContext(browser, { viewport: { width: 390, height: 844 } })).newPage();
  await page.goto(`${WORKER_URL}/join?c=${claim.joinCode}`);
  return page;
}

async function vote(phone: Page, name: string) {
  await phone.getByRole("list", { name: "Roster" }).getByRole("button", { name }).click();
  await expect(phone.getByText(`✓ You voted for ${name}`)).toBeVisible();
}

const row = (host: Page, name: string) => host.getByRole("table").getByRole("row").filter({ hasText: name });
/** The Host-only live tally's count in an entry's row. */
const count = (host: Page, name: string) => row(host, name).getByRole("cell").nth(4);
const turnout = (page: Page) => page.getByLabel("Turnout");

test("phones vote, the Host watches the live tally and closes voting, and the Stage shows the ranking", async ({
  browser,
  page: host,
}) => {
  const claim = await votingOpen(host);
  const stage = await host.context().newPage();
  await stage.setViewportSize({ width: 1920, height: 1080 });
  await stage.goto(stageLink(WORKER_URL, claim.joinCode, claim.competitionName));
  await expect(turnout(stage)).toHaveText("0");
  // Turnout replaces the clock.
  await expect(desk(host).clock).toHaveCount(0);
  await expect(turnout(host)).toHaveText("0 votes");
  await expect(host.getByRole("columnheader", { name: "Live tally (Host only)" })).toBeVisible();

  const [first, second, third, idle] = await Promise.all([1, 2, 3, 4].map(() => phone(browser, claim)));
  await expect(idle!.getByRole("heading", { name: "Whose Reveal came closest?" })).toBeVisible();
  await vote(first!, "Ada");
  await vote(second!, "Bo");
  await vote(third!, "Bo");
  await second!.getByRole("button", { name: "Change my vote" }).click();
  await vote(second!, "Ada");

  await expect(turnout(host)).toHaveText("3 votes");
  await expect(count(host, "Ada")).toHaveText("2");
  await expect(count(host, "Bo")).toHaveText("1");
  await expect(count(host, "Cleo")).toHaveText("0");
  await expect(row(host, "Ada")).toHaveClass(/\blead\b/);
  await expect(row(host, "Bo")).not.toHaveClass(/\blead\b/);
  await expect(turnout(stage)).toHaveText("3");
  await expect(idle!.getByText("3 votes so far")).toBeVisible();
  await expect(stage.getByText("Ada")).toHaveCount(0);

  await desk(host).button("Close voting & show results").click();

  const tiles = stage.getByRole("list", { name: "Results" }).getByRole("listitem");
  await expect(tiles).toHaveText([/2.*Ada/, /1.*Bo/, /0.*Cleo/]);
  await expect(tiles.first().getByRole("img", { name: "Leader" })).toBeVisible({ timeout: 6000 });
  await expect(turnout(host)).toHaveText("3 votes");
  await expect(count(host, "Ada")).toHaveText("2");
  for (const page of [first!, second!, third!, idle!]) {
    await expect(page.getByRole("heading", { name: "Voting closed · Eyes on the Stage" })).toBeVisible();
  }
  await expect(first!.getByText("You picked Ada")).toBeVisible();
  await expect(third!.getByText("You picked Bo")).toBeVisible();
  await expect(idle!.getByText("You didn't vote this Round")).toBeVisible();
});

test("removing an entry says how many votes it discards; a re-run asks before clearing the votes, reopening keeps them", async ({
  browser,
  page: host,
}) => {
  const claim = await votingOpen(host);
  const { button, dialog } = desk(host);
  const [first, second, third] = await Promise.all([1, 2, 3].map(() => phone(browser, claim)));
  await vote(first!, "Ada");
  await vote(second!, "Ada");
  await vote(third!, "Bo");
  await expect(turnout(host)).toHaveText("3 votes");

  await host.getByRole("button", { name: "Remove Cleo" }).click();
  await expect(dialog).toContainText("No votes are discarded.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await host.getByRole("button", { name: "Remove Bo" }).click();
  await expect(dialog).toContainText("1 vote for them is discarded");
  await dialog.getByRole("button", { name: "Remove" }).click();

  await expect(turnout(host)).toHaveText("2 votes");
  await expect(third!.getByRole("heading", { name: "Whose Reveal came closest?" })).toBeVisible();
  await expect(third!.getByText("2 votes so far")).toBeVisible();

  await button("Close voting & show results").click();
  await button("Reopen voting").click();
  await expect(turnout(host)).toHaveText("2 votes");
  await expect(first!.getByText("✓ You voted for Ada")).toBeVisible();

  await button("Close voting & show results").click();
  await button("Back to up next").click();
  await button("Start Round").click();
  await expect(dialog).toContainText("Starting a re-run clears the 2 votes from its last run.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(desk(host).step).toHaveText("Up next");

  await button("Start Round").click();
  await dialog.getByRole("button", { name: "Start and clear votes" }).click();
  await expect(desk(host).step).toHaveText("Running");
  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await button("Open voting").click();
  await expect(turnout(host)).toHaveText("0 votes");
  await expect(first!.getByRole("heading", { name: "Whose Reveal came closest?" })).toBeVisible();
  await expect(first!.getByText("0 votes so far")).toBeVisible();
});
