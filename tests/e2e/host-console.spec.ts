// The live flow: the prep page's Host console link, opened on the real Worker under `wrangler dev`.

import { expect, test, type Page } from "@playwright/test";
import { decodeClaim } from "../../src/protocol/protocol.ts";
import { newRound, turnOnAudience } from "./prep.ts";
import { WORKER_ORGANIZER_KEY, WORKER_URL } from "./worker.ts";

/** Prepares a Competition with two Rounds on the local Worker, and returns its Host console link. */
async function hostConsoleLink(page: Page) {
  await newRound(page);
  await page.getByRole("button", { name: "+ Final" }).click();
  await turnOnAudience(page, WORKER_URL);
  return (await page.getByRole("link", { name: "Open Host console" }).getAttribute("href"))!;
}

test("the Host claims the Competition with the Organizer key, which nothing stores", async ({ page, context }) => {
  const link = await hostConsoleLink(page);
  const joinCode = await page.getByLabel("Join code").textContent();
  const host = await context.newPage();

  await host.goto(link);

  await expect(host.getByRole("heading", { name: "Claim this Competition" })).toBeVisible();
  const carried = host.getByLabel("What the link carries");
  await expect(carried).toContainText("Gothenburg 2026");
  await expect(carried).toContainText(joinCode!);
  await expect(carried).toContainText("Heat 1, Final");
  const { hostSecret, contestantToken } = decodeClaim(new URL(link).hash)!;
  expect(await carried.textContent()).not.toContain(hostSecret.slice(4));
  expect(await carried.textContent()).not.toContain(contestantToken.slice(4));

  await host.getByLabel("Organizer key").fill("not-the-key");
  await host.getByRole("button", { name: "Claim" }).click();
  await expect(host.getByRole("alert")).toHaveText("That Organizer key is wrong.");

  await host.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await host.getByRole("button", { name: "Claim" }).click();

  const top = host.getByRole("banner");
  await expect(top).toContainText("Gothenburg 2026");
  await expect(top).toContainText(`Join ${joinCode}`);
  await expect(top).toContainText("live");
  await expect(top.getByRole("button", { name: "Copy Stage link" })).toBeVisible();
  const rail = host.getByRole("navigation", { name: "Rounds" });
  await expect(rail).toContainText("Welcome screen");
  await expect(rail).toContainText("Heat 1");
  await expect(rail).toContainText("Final");
  await expect(host.getByText(/^Code in the Dark editor \d+\.\d+\.\d+\+\w+$/)).toBeVisible();

  // Reopening the link goes straight to the console: the claim is the Worker's, not the browser's.
  expect(await host.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  await host.reload();
  await expect(host.getByRole("banner")).toContainText(`Join ${joinCode}`);
  await expect(host.getByLabel("Organizer key")).toHaveCount(0);
});

test("a Host console link whose claim is missing says so", async ({ page }) => {
  await page.goto(`${WORKER_URL}/host/`);

  await expect(page.getByRole("heading", { name: "This Host console link is incomplete" })).toBeVisible();
});

test("the Worker serves the Stage and the Audience phone page", async ({ page }) => {
  await page.goto(`${WORKER_URL}/stage/?c=K7XQ2N`);
  await expect(page.getByRole("heading", { name: "Stage" })).toBeVisible();

  await page.goto(`${WORKER_URL}/join/?c=K7XQ2N`);
  await expect(page.getByRole("heading", { name: "Join the Audience" })).toBeVisible();
});
