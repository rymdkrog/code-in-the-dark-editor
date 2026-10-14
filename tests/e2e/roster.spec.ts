// The live Roster: Round packages with the local Worker's URL, opened from file://, appear on
// the Host console run by the real Worker under `wrangler dev`.

import { expect, test, type Browser, type Page, type TestInfo } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { hostConsoleLink } from "../../src/pages/links.ts";
import { mintCredentials } from "../../src/pages/prep/competition.ts";
import type { Claim } from "../../src/protocol/protocol.ts";
import { gateNetwork } from "./no-network-gate.ts";
import { enterName, makePackage, PRACTICE, roundIn } from "./package.ts";
import { WORKER_ORGANIZER_KEY, WORKER_URL } from "./worker.ts";

const HEAT = roundIn(PRACTICE).roundId;

/** A Competition of the practice Round and a Final, with fresh credentials. */
const newClaim = (): Claim => ({
  competitionName: "Gothenburg 2026",
  ...mintCredentials(),
  rounds: [
    { id: HEAT, name: "Heat 1" },
    { id: "final00000", name: "Final" },
  ],
});

/** The practice Round as the Competition's Heat 1, exported as Revision `n`. */
const heatPackage = (testInfo: TestInfo, claim: Claim, n: number) =>
  makePackage(testInfo.outputPath(`heat-rev-${n}.html`), {
    revision: `${n}-20261012140${n}`,
    audience: { workerUrl: WORKER_URL, joinCode: claim.joinCode, contestantToken: claim.contestantToken },
  });

/** Opens a Round package on a laptop of its own, online to the local Worker only. */
async function laptop(browser: Browser, file: string, name: string) {
  const context = await browser.newContext();
  const check = await gateNetwork(context, { workerUrl: WORKER_URL, online: true });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await enterName(page, name);
  return { page, close: async () => (check(), await context.close()) };
}

async function claimConsole(host: Page, claim: Claim) {
  await host.goto(hostConsoleLink(WORKER_URL, claim));
  await host.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await host.getByRole("button", { name: "Claim" }).click();
  await expect(host.getByRole("banner")).toContainText("live");
}

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
  await expect(row(host, "Anna")).toHaveClass(/off/);
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
