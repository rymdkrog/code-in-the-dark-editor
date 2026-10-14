// The live flow on the Stage: the venue screen follows the Host, read-only, on the real Worker
// under `wrangler dev`.

import { expect, test, type Page } from "@playwright/test";
import { claimedConsole, desk, prepareCompetition } from "./host.ts";
import { WORKER_URL } from "./worker.ts";

test.use({ viewport: { width: 1920, height: 1080 } });

/** A claimed Competition with Heat 1 up next, and its Stage open. */
async function upNext(page: Page, minutes: number) {
  const links = await prepareCompetition(page);
  const host = await page.context().newPage();
  await claimedConsole(host, links.hostLink);
  await desk(host).rail.getByRole("button", { name: /^Heat 1/ }).click();
  await host.getByLabel("Duration in minutes").fill(String(minutes));
  await host.getByLabel("Duration in minutes").press("Enter");
  const stage = await page.context().newPage();
  await stage.goto(links.stageLink);
  await expect(stage.getByRole("timer", { name: "Clock" })).toHaveText(`${String(minutes).padStart(2, "0")}:00`);
  return { ...links, host, stage, start: () => desk(host).button("Start Round").click() };
}

test("the Stage waits for the claim, then follows the Host from welcome to time's up", async ({ page, context }) => {
  const { hostLink, stageLink, joinCode } = await prepareCompetition(page);
  const stage = await context.newPage();
  const joinUrl = `${WORKER_URL}/join?c=${joinCode}`;
  const qr = stage.getByRole("img", { name: `QR code for ${joinUrl}` });

  await stage.goto(stageLink);
  await expect(stage.getByText("Gothenburg 2026")).toBeVisible();
  await expect(stage.getByText("Waiting for the Host to open the Competition…")).toBeVisible();
  await expect(stage.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  await expect(stage.getByText(/^Code in the Dark editor \d+\.\d+\.\d+\+\w+$/)).toBeVisible();

  const host = await context.newPage();
  await claimedConsole(host, hostLink);
  const { rail, button, dialog } = desk(host);

  // Welcome: no Current Round.
  await expect(stage.getByText("Waiting for the Host")).toHaveCount(0);
  await expect(stage.getByText("Gothenburg 2026")).toBeVisible();
  await expect(stage.getByText(`localhost:${new URL(WORKER_URL).port}/join`)).toBeVisible();
  await expect(stage.getByText(joinCode, { exact: true })).toBeVisible();
  await expect(qr).toBeVisible();

  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await expect(stage.getByText("Up next")).toBeVisible();
  await expect(stage.getByText("Heat 1")).toBeVisible();
  const clock = stage.getByRole("timer", { name: "Clock" });
  await expect(clock).toHaveText("15:00");
  await expect(stage.getByRole("list", { name: "Roster" })).toBeVisible();
  await host.getByLabel("Duration in minutes").fill("2");
  await host.getByLabel("Duration in minutes").press("Enter");
  await expect(clock).toHaveText("02:00");

  await button("Start Round").click();
  await expect(clock).toHaveText(/^01:5\d$/);
  await expect(stage.getByText("Up next")).toHaveCount(0);
  await expect(stage.getByText("Heat 1")).toBeVisible();
  // The small join corner.
  await expect(stage.getByText(joinCode, { exact: true })).toBeVisible();
  await expect(qr).toBeVisible();

  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await expect(stage.getByText("Time's up · Reveals next")).toBeVisible();
  await expect(stage.getByRole("list", { name: "Roster" })).toBeVisible();

  // The Stage is read-only: its only control is popping out.
  await expect(stage.getByRole("button")).toHaveCount(1);
  await expect(stage.getByRole("button")).toHaveAccessibleName("Pop out");
});

test("the QR on the Stage opens the Audience phone page with the Join code", async ({ page, context }) => {
  const { hostLink, stageLink, joinCode } = await prepareCompetition(page);
  await claimedConsole(await context.newPage(), hostLink);
  const stage = await context.newPage();
  await stage.goto(stageLink);

  const label = await stage.getByRole("img", { name: /^QR code for / }).getAttribute("aria-label");
  const phone = await context.newPage();
  await phone.goto(label!.replace(/^QR code for /, ""));

  await expect(phone.getByText("✓ You're in")).toBeVisible();
  expect(new URL(phone.url()).searchParams.get("c")).toBe(joinCode);
});

test("the Stage's clock turns amber in the last minute and throbs pink in the last 10 s", async ({ page }) => {
  const { stage, start } = await upNext(page, 1);
  await stage.clock.install();
  const clock = stage.getByRole("timer", { name: "Clock" });
  const white = await clock.evaluate((element) => getComputedStyle(element).color);

  await start();
  await expect(clock).toHaveText(/^0(1:00|0:5\d)$/);
  await expect(clock).not.toHaveCSS("color", white);
  const amber = await clock.evaluate((element) => getComputedStyle(element).color);
  await expect(clock).not.toHaveCSS("animation-name", "throb");

  await stage.clock.fastForward("00:30");
  await stage.clock.fastForward("00:25");
  await expect(clock).toHaveText(/^00:0\d$/);
  await expect(clock).not.toHaveCSS("color", amber);
  await expect(clock).not.toHaveCSS("color", white);
  await expect(clock).toHaveCSS("animation-name", "throb");
});

test("offline, the Stage shows a reconnecting marker and keeps counting from the last endsAt", async ({ page }) => {
  const links = await prepareCompetition(page);
  const host = await page.context().newPage();
  await claimedConsole(host, links.hostLink);
  await desk(host).rail.getByRole("button", { name: /^Heat 1/ }).click();

  const stage = await page.context().newPage();
  let reachable = true;
  const pageSides: { close(): Promise<void> }[] = [];
  await stage.routeWebSocket(/\/socket\//, (socket) => {
    if (!reachable) return void socket.close();
    socket.connectToServer();
    pageSides.push(socket);
  });
  await stage.goto(links.stageLink);
  const clock = stage.getByRole("timer", { name: "Clock" });
  await expect(clock).toHaveText("15:00");
  await desk(host).button("Start Round").click();
  await expect(clock).toHaveText(/^14:5\d$/);
  await expect(stage.getByRole("status")).toHaveCount(0);

  reachable = false;
  await Promise.all(pageSides.map((socket) => socket.close()));
  await expect(stage.getByRole("status")).toHaveText("reconnecting");
  const offline = await clock.textContent();
  await expect(clock).not.toHaveText(offline!);
  await expect(clock).toHaveText(/^14:[45]\d$/);

  reachable = true;
  await expect(stage.getByRole("status")).toHaveCount(0, { timeout: 35_000 });
  await expect(clock).toHaveText(/^14:[0-5]\d$/);
});

test("a Stage that can't reach the Worker at all shows the reconnecting marker", async ({ page }) => {
  await page.routeWebSocket(/\/socket\//, (socket) => void socket.close());

  await page.goto(`${WORKER_URL}/stage/?c=K7XQ2N`);

  await expect(page.getByText("Connecting to the Worker…")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("reconnecting");
});

test("the Stage pops out to its own window", async ({ page }) => {
  const { stageLink } = await prepareCompetition(page);
  const stage = await page.context().newPage();
  await stage.goto(stageLink);

  const [popup] = await Promise.all([
    stage.waitForEvent("popup"),
    stage.getByRole("button", { name: "Pop out" }).click(),
  ]);

  await expect(popup).toHaveURL(stageLink);
  await expect(popup.getByText("Waiting for the Host to open the Competition…")).toBeVisible();
  // A popped-out Stage is the venue screen: nothing to pop out again.
  await expect(popup.getByRole("button", { name: "Pop out" })).toHaveCount(0);
});

test("a Stage link without a Join code says so", async ({ page }) => {
  await page.goto(`${WORKER_URL}/stage/`);

  await expect(page.getByRole("heading", { name: "This Stage link has no Join code" })).toBeVisible();
});
