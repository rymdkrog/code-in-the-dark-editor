// Driving the Host console on the real Worker under `wrangler dev` (see playwright.config.ts).

import { expect, type Page } from "@playwright/test";
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
