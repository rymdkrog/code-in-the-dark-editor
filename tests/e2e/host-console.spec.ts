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

/** Opens the Host console link and claims the Competition. */
async function claimedConsole(host: Page, link: string) {
  await host.goto(link);
  await host.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await host.getByRole("button", { name: "Claim" }).click();
  await expect(host.getByRole("banner")).toContainText("live");
}

/** What the console shows of the Current Round. */
const desk = (host: Page) => ({
  rail: host.getByRole("navigation", { name: "Rounds" }),
  heading: host.getByRole("heading", { level: 1 }),
  step: host.getByRole("list", { name: "Lifecycle" }).locator('[aria-current="step"]'),
  clock: host.getByRole("timer", { name: "Clock" }),
  button: (name: string) => host.getByRole("main").getByRole("button", { name, exact: true }),
  dialog: host.getByRole("dialog"),
});

test("the Host drives a Round from up next to results, and a reload gets the Worker's snapshot", async ({
  page,
  context,
}) => {
  const host = await context.newPage();
  await claimedConsole(host, await hostConsoleLink(page));
  const { rail, heading, step, clock, button, dialog } = desk(host);
  await expect(heading).toHaveText("Welcome screen");

  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await expect(heading).toHaveText("Heat 1");
  await expect(step).toHaveText("Up next");
  await expect(rail.getByRole("button", { name: /^Heat 1/ })).toContainText("Up next");
  await expect(clock).toHaveText("15:00");
  await host.getByLabel("Duration in minutes").fill("2");
  await host.getByLabel("Duration in minutes").press("Enter");
  await expect(clock).toHaveText("02:00");

  await button("Start Round").click();
  await expect(step).toHaveText("Running");
  await expect(rail.getByRole("button", { name: /^Heat 1/ })).toContainText("Running");
  await expect(clock).toHaveText(/^01:5\d$/);
  await expect(button("Start Round")).toHaveCount(0);
  await button("+1 min").click();
  await expect(clock).toHaveText(/^02:5\d$/);
  await button("+30 s").click();
  await expect(clock).toHaveText(/^03:2\d$/);

  await button("End early").click();
  await expect(dialog).toContainText("End Heat 1 now?");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(step).toHaveText("Running");
  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await expect(step).toHaveText("Time's up");
  await expect(clock).toHaveText("00:00");

  await button("Open voting").click();
  await expect(step).toHaveText("Voting");
  await expect(clock).toHaveCount(0);
  await button("Close voting & show results").click();
  await expect(step).toHaveText("Results");
  await button("Reopen voting").click();
  await expect(step).toHaveText("Voting");
  await button("Close voting & show results").click();
  await button("Back to up next").click();
  await expect(step).toHaveText("Up next");
  await expect(clock).toHaveText("02:00");

  await button("Start Round").click();
  await expect(step).toHaveText("Running");
  await host.reload();
  await expect(heading).toHaveText("Heat 1");
  await expect(step).toHaveText("Running");
  await expect(clock).toHaveText(/^01:5\d$/);
});

test("switching away from a busy Round asks first; an idle one switches at once", async ({ page, context }) => {
  const host = await context.newPage();
  await claimedConsole(host, await hostConsoleLink(page));
  const { rail, heading, step, button, dialog } = desk(host);
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await button("Start Round").click();
  await expect(step).toHaveText("Running");

  await rail.getByRole("button", { name: /^Final/ }).click();
  await expect(dialog).toContainText("Put Final on the Stage?");
  await expect(dialog).toContainText("Heat 1 is running. Switching abandons its timer.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(heading).toHaveText("Heat 1");
  await expect(step).toHaveText("Running");

  await rail.getByRole("button", { name: /^Final/ }).click();
  await dialog.getByRole("button", { name: "Switch" }).click();
  await expect(heading).toHaveText("Final");
  await expect(step).toHaveText("Up next");
  await expect(rail.getByRole("button", { name: /^Heat 1/ })).not.toContainText("Running");

  await rail.getByRole("button", { name: /^Welcome screen/ }).click();
  await expect(dialog).toBeHidden();
  await expect(heading).toHaveText("Welcome screen");
});

test("while offline the console pauses its controls; reconnecting gets the snapshot", async ({ page, context }) => {
  const link = await hostConsoleLink(page);
  const host = await context.newPage();
  let reachable = true;
  const pageSides: { close(): Promise<void> }[] = [];
  await host.routeWebSocket(/\/socket\//, (socket) => {
    if (!reachable) return void socket.close();
    socket.connectToServer();
    pageSides.push(socket);
  });
  await claimedConsole(host, link);
  const { rail, heading, step, button } = desk(host);
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await expect(step).toHaveText("Up next");

  reachable = false;
  await Promise.all(pageSides.map((socket) => socket.close()));
  await expect(host.getByRole("status")).toHaveText("Connection lost — reconnecting… Controls are paused.");
  await expect(button("Start Round")).toBeDisabled();
  await expect(host.getByLabel("Duration in minutes")).toBeDisabled();
  await expect(rail.getByRole("button", { name: /^Final/ })).toBeDisabled();

  // Another Host moves on while this one is offline.
  const other = await context.newPage();
  await other.goto(link);
  await desk(other).button("Start Round").click();
  await expect(desk(other).step).toHaveText("Running");

  reachable = true;
  await expect(host.getByRole("status")).toBeHidden({ timeout: 35_000 });
  await expect(heading).toHaveText("Heat 1");
  await expect(step).toHaveText("Running");
  await expect(button("End early")).toBeEnabled();
});

test("a Host console link whose claim is missing says so", async ({ page }) => {
  await page.goto(`${WORKER_URL}/host/`);

  await expect(page.getByRole("heading", { name: "This Host console link is incomplete" })).toBeVisible();
});

test("the Worker serves the Audience phone page", async ({ page }) => {
  await page.goto(`${WORKER_URL}/join/?c=K7XQ2N`);
  await expect(page.getByRole("heading", { name: "Join the Audience" })).toBeVisible();
});
