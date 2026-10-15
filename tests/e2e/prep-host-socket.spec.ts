// The prep page's own Host socket: claiming from prep, and Round changes reaching an open Host
// console, the Stage and phones with no new link. On the real Worker under `wrangler dev`.

import { expect, test, type Page, type WebSocket } from "@playwright/test";
import { claimConsole, desk, hostLinkIn, newClaim, prepareCompetition } from "./host.ts";
import { downloadFrom, newRound, openAudiencePane, turnOnAudience } from "./prep.ts";
import { WORKER_ORGANIZER_KEY, WORKER_URL } from "./worker.ts";

/** Claims the Competition from the prep page's open Audience pane. */
async function claimFromPrep(page: Page, organizerKey = WORKER_ORGANIZER_KEY) {
  await page.getByLabel("Organizer key").fill(organizerKey);
  await page.getByRole("button", { name: "Claim", exact: true }).click();
}

const claimed = (page: Page) => page.getByText("Claimed.");

/** Every socket the page opens, in order. */
function socketsOf(page: Page) {
  const sockets: WebSocket[] = [];
  page.on("websocket", (socket) => sockets.push(socket));
  return sockets;
}

test("claimed from prep, a Heat added in prep reaches the open Host console and the Stage", async ({
  page,
  context,
}) => {
  const links = await prepareCompetition(page);
  await expect(page.getByText("Not claimed yet.")).toBeVisible();
  await expect(page.getByText(/Open it again after adding or renaming a Round/)).toBeVisible();

  await claimFromPrep(page, "not-the-key");
  await expect(page.getByRole("alert")).toHaveText("That Organizer key is wrong.");
  await claimFromPrep(page);
  await expect(claimed(page)).toBeVisible();
  await expect(page.getByText(/Open it again after adding or renaming a Round/)).toHaveCount(0);

  const host = await context.newPage();
  await host.goto(links.hostLink);
  const { rail, heading } = desk(host);
  await expect(host.getByRole("banner")).toContainText("live");
  const stage = await context.newPage();
  await stage.goto(links.stageLink);

  await page.getByRole("button", { name: "+ Heat" }).click();
  await expect(rail).toContainText("Heat 2");
  await rail.getByRole("button", { name: /^Heat 2/ }).click();
  await expect(heading).toHaveText("Heat 2");
  await expect(stage.getByText("Heat 2")).toBeVisible();

  await page.getByLabel("Round name").fill("Last Chance Heat");
  await expect(heading).toHaveText("Last Chance Heat");
  await expect(stage.getByText("Last Chance Heat")).toBeVisible();

  // The link from before the Heat was added, opened again, doesn't roll the list back.
  const older = await context.newPage();
  await older.goto(links.hostLink);
  await expect(desk(older).heading).toHaveText("Last Chance Heat");
  await expect(desk(older).rail).toContainText("Final");
});

test("a Round list that leaves out the Current Round is refused, and prep names it", async ({
  page,
  context,
}, testInfo) => {
  await newRound(page);
  await turnOnAudience(page, WORKER_URL);
  const withoutFinal = await downloadFrom(page.getByRole("button", { name: "Save Competition file" }), testInfo);
  await page.getByRole("button", { name: "+ Final" }).click();
  await openAudiencePane(page);
  await claimFromPrep(page);
  await expect(claimed(page)).toBeVisible();
  const host = await context.newPage();
  await host.goto(await hostLinkIn(page));
  const { rail, heading } = desk(host);
  await rail.getByRole("button", { name: /^Final/ }).click();
  await expect(heading).toHaveText("Final");

  // The file from before the Final, with a Heat added: a newer list without the Current Round.
  await page.getByLabel("Open a Competition file").setInputFiles(withoutFinal.path);
  await page.getByRole("button", { name: "Replace without saving" }).click();
  await page.getByRole("button", { name: "+ Heat" }).click();
  await openAudiencePane(page);

  await expect(page.getByRole("alert")).toContainText("leaves out Final, the Current Round");
  await expect(rail).not.toContainText("Heat 2");

  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await expect(heading).toHaveText("Heat 1");
  await page.getByRole("button", { name: "Send the Round list again" }).click();
  await expect(rail).toContainText("Heat 2");
  await expect(rail).not.toContainText("Final");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a Worker prep can't reach shows on the Audience pane", async ({ page }) => {
  await page.routeWebSocket(/\/socket\//, (socket) => void socket.close());
  await newRound(page);
  await turnOnAudience(page, WORKER_URL);
  await expect(page.getByText("Can't reach the Worker.")).toBeVisible();
});

test("a Join code claimed with another Host secret shows on the Audience pane", async ({ page, context }) => {
  await newRound(page);
  await turnOnAudience(page, WORKER_URL);
  await expect(page.getByText("Not claimed yet.")).toBeVisible();

  const joinCode = (await page.getByLabel("Join code").textContent())!;
  await claimConsole(await context.newPage(), { ...newClaim(), joinCode });
  // Coming back to prep asks the Worker again.
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await expect(page.getByText(`Join code ${joinCode} is claimed with another Host secret`)).toBeVisible();
});

test("prep opens no socket while the Audience layer is off or the Worker URL is invalid, and reconnects on changes", async ({
  page,
}) => {
  const sockets = socketsOf(page);
  await newRound(page);
  await turnOnAudience(page, "localhost:8788");
  await expect(page.getByText("Not a valid Worker URL")).toBeVisible();
  // Long enough for the Worker URL to settle.
  await page.waitForTimeout(1000);
  expect(sockets).toHaveLength(0);

  await page.getByLabel("Worker URL").fill(WORKER_URL);
  await expect(page.getByText("Not claimed yet.")).toBeVisible();
  const joinCode = (await page.getByLabel("Join code").textContent())!;
  expect(sockets.map((socket) => socket.url())).toEqual([`ws://localhost:8788/socket/${joinCode}/host`]);

  await page.getByRole("button", { name: "Mint new credentials…" }).click();
  await page.getByRole("button", { name: "Mint new credentials", exact: true }).click();
  const minted = (await page.getByLabel("Join code").textContent())!;
  expect(minted).not.toBe(joinCode);
  await expect.poll(() => sockets.map((socket) => socket.url())).toEqual([
    `ws://localhost:8788/socket/${joinCode}/host`,
    `ws://localhost:8788/socket/${minted}/host`,
  ]);
  await expect.poll(() => sockets[0]!.isClosed()).toBe(true);

  await page.getByLabel(/Audience layer/).uncheck();
  await expect.poll(() => sockets[1]!.isClosed()).toBe(true);
  expect(sockets).toHaveLength(2);
});
