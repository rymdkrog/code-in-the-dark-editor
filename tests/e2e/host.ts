// Driving the Host console, and Round packages connected to it, on the real Worker under
// `wrangler dev` (see playwright.config.ts).

import { pathToFileURL } from "node:url";
import { expect, type Browser, type Page, type TestInfo } from "@playwright/test";
import { hostConsoleLink } from "../../src/pages/links.ts";
import { mintCredentials } from "../../src/pages/prep/competition.ts";
import type { Claim } from "../../src/protocol/protocol.ts";
import { gateNetwork } from "./no-network-gate.ts";
import { enterName, makePackage, PRACTICE, roundIn } from "./package.ts";
import { newRound, turnOnAudience } from "./prep.ts";
import { WORKER_ORGANIZER_KEY, WORKER_URL } from "./worker.ts";

/** Prepares a Competition with Heat 1 and a Final on the local Worker, and returns what the
 * prep page's Audience pane hands out. */
export async function prepareCompetition(page: Page) {
  await newRound(page);
  await page.getByRole("button", { name: "+ Final" }).click();
  await turnOnAudience(page, WORKER_URL);
  return {
    hostLink: (await page.getByRole("link", { name: "Open Host console" }).getAttribute("href"))!,
    stageLink: (await page.getByLabel("Stage link").textContent())!,
    joinCode: (await page.getByLabel("Join code").textContent())!,
  };
}

/** Opens the Host console link and claims the Competition. */
export async function claimedConsole(host: Page, link: string) {
  await host.goto(link);
  await host.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await host.getByRole("button", { name: "Claim" }).click();
  await expect(host.getByRole("banner")).toContainText("live");
}

/** What the console shows of the Current Round. */
export const desk = (host: Page) => ({
  rail: host.getByRole("navigation", { name: "Rounds" }),
  heading: host.getByRole("heading", { level: 1 }),
  step: host.getByRole("list", { name: "Lifecycle" }).locator('[aria-current="step"]'),
  clock: host.getByRole("timer", { name: "Clock" }),
  button: (name: string) => host.getByRole("main").getByRole("button", { name, exact: true }),
  dialog: host.getByRole("dialog"),
});

export const HEAT = roundIn(PRACTICE).roundId;

/** A Competition of the practice Round and a Final, with fresh credentials. */
export const newClaim = (): Claim => ({
  competitionName: "Gothenburg 2026",
  ...mintCredentials(),
  rounds: [
    { id: HEAT, name: "Heat 1" },
    { id: "final00000", name: "Final" },
  ],
});

/** The practice Round as the Competition's Heat 1, exported as Revision `n`. */
export const heatPackage = (testInfo: TestInfo, claim: Claim, n: number) =>
  makePackage(testInfo.outputPath(`heat-rev-${n}.html`), {
    revision: `${n}-20261012140${n}`,
    audience: { workerUrl: WORKER_URL, joinCode: claim.joinCode, contestantToken: claim.contestantToken },
  });

/** Opens a Round package on a laptop of its own, online to the local Worker only. */
export async function laptop(browser: Browser, file: string, name: string) {
  const context = await browser.newContext();
  const check = await gateNetwork(context, { workerUrl: WORKER_URL, online: true });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href);
  await enterName(page, name);
  return { page, close: async () => (check(), await context.close()) };
}

/** Opens the Host console link for `claim` and claims it. */
export async function claimConsole(host: Page, claim: Claim) {
  await host.goto(hostConsoleLink(WORKER_URL, claim));
  await host.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await host.getByRole("button", { name: "Claim" }).click();
  await expect(host.getByRole("banner")).toContainText("live");
}
