// The Audience phone page on the real Worker under `wrangler dev`: joining with the Join code,
// and following the Competition from Round to Round.

import { expect, test, type Page } from "@playwright/test";
import { JOIN_CODE_ALPHABET } from "../../src/protocol/protocol.ts";
import { claimedConsole, desk, prepareCompetition } from "./host.ts";
import { WORKER_URL } from "./worker.ts";

test.use({ viewport: { width: 390, height: 844 } });

/** A code nobody has claimed: the local Worker keeps its Durable Objects between runs. */
const unclaimedCode = () =>
  Array.from({ length: 6 }, () => JOIN_CODE_ALPHABET[Math.floor(Math.random() * JOIN_CODE_ALPHABET.length)]).join("");

const phoneScreen = (phone: Page) => ({
  header: phone.getByRole("banner"),
  clock: phone.getByRole("timer", { name: "Clock" }),
  reconnecting: phone.getByRole("status"),
});

test("the QR link joins at once, with a voter id and no name; the phone follows the Round", async ({
  page,
  context,
}) => {
  const { hostLink: link, joinCode } = await prepareCompetition(page);
  const host = await context.newPage();
  await claimedConsole(host, link);
  const phone = await context.newPage();

  // Exactly what the Stage's QR carries.
  await phone.goto(`${WORKER_URL}/join?c=${joinCode}`);

  await expect(phone.getByRole("heading", { name: "Gothenburg 2026" })).toBeVisible();
  await expect(phone.getByText("✓ You're in")).toBeVisible();
  await expect(phone.getByText("The next Round shows up here by itself.")).toBeVisible();
  await expect(phone.getByText(/send Reactions .* vote/)).toBeVisible();
  await expect(phone.getByText(/^Code in the Dark editor \d+\.\d+\.\d+\+\w+$/)).toBeVisible();
  const voterId = await phone.evaluate(() => localStorage.getItem("citd-voter-id"));
  expect(voterId).toMatch(/^[\w-]{16,}$/);
  await expect(phone.getByRole("textbox")).toHaveCount(0);

  const { rail, button, dialog } = desk(host);
  const { header, clock } = phoneScreen(phone);
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await expect(header).toContainText("Heat 1");
  await expect(header).toContainText("Up next");
  await expect(clock).toHaveText("15:00");

  await button("Start Round").click();
  await expect(header).toContainText("Running");
  await expect(clock).toHaveText(/^14:5\d$/);

  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await expect(header).toContainText("Time's up");
  await expect(clock).toHaveCount(0);

  await rail.getByRole("button", { name: /^Final/ }).click();
  await dialog.getByRole("button", { name: "Switch" }).click();
  await expect(header).toContainText("Final");
  await expect(header).not.toContainText("Heat 1");
  await expect(header).toContainText("Up next");

  await rail.getByRole("button", { name: /^Welcome screen/ }).click();
  await expect(phone.getByText("✓ You're in")).toBeVisible();
  await expect(header).toHaveCount(0);

  // The same phone keeps its voter id.
  await phone.reload();
  await expect(phone.getByText("✓ You're in")).toBeVisible();
  expect(await phone.evaluate(() => localStorage.getItem("citd-voter-id"))).toBe(voterId);
});

test("a phone on a code that isn't open yet waits, and is in as soon as the Host claims", async ({ page, context }) => {
  const { hostLink: link, joinCode } = await prepareCompetition(page);
  const phone = await context.newPage();

  await phone.goto(`${WORKER_URL}/join/?c=${joinCode}`);

  await expect(phone.getByRole("heading", { name: `Waiting for ${joinCode} to open…` })).toBeVisible();
  await expect(phone.getByText("Not starting? Check the code on the Stage")).toBeVisible();
  await expect(phone.getByRole("button", { name: "Change code" })).toBeVisible();

  await claimedConsole(await context.newPage(), link);

  await expect(phone.getByText("✓ You're in")).toBeVisible();
  await expect(phone.getByRole("heading", { name: "Gothenburg 2026" })).toBeVisible();
});

test("the bare URL asks for the code and takes only the Join code alphabet; Change code goes back", async ({ page }) => {
  await page.goto(`${WORKER_URL}/join/`);
  const code = page.getByLabel("Join code");
  const join = page.getByRole("button", { name: "Join" });
  await expect(page.getByRole("heading", { name: "Enter the code on the Stage" })).toBeVisible();
  await expect(join).toBeDisabled();

  // Lower case is raised, and 0, O, 1, I, L and anything else outside the alphabet is dropped.
  await code.pressSequentially("k7-x0q 2io1lnm");
  await expect(code).toHaveValue("K7XQ2N");
  await code.fill("");
  await code.pressSequentially("K7XQ2");
  await expect(join).toBeDisabled();

  const typo = unclaimedCode();
  await code.fill(typo);
  await join.click();

  await expect(page.getByRole("heading", { name: `Waiting for ${typo} to open…` })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("c")).toBe(typo);

  await page.getByRole("button", { name: "Change code" }).click();
  await expect(code).toHaveValue(typo);
  expect(new URL(page.url()).search).toBe("");
});

test("a link with a code outside the alphabet asks for the code", async ({ page }) => {
  await page.goto(`${WORKER_URL}/join/?c=K0XQ2N`);

  await expect(page.getByRole("heading", { name: "Enter the code on the Stage" })).toBeVisible();
  await expect(page.getByLabel("Join code")).toHaveValue("KXQ2N");
});

test("offline, the phone says it's reconnecting until the snapshot arrives", async ({ page, context }) => {
  const { hostLink: link, joinCode } = await prepareCompetition(page);
  const host = await context.newPage();
  await claimedConsole(host, link);
  const phone = await context.newPage();
  let reachable = true;
  const pageSides: { close(): Promise<void> }[] = [];
  await phone.routeWebSocket(/\/socket\//, (socket) => {
    if (!reachable) return void socket.close();
    socket.connectToServer();
    pageSides.push(socket);
  });
  await phone.goto(`${WORKER_URL}/join/?c=${joinCode}`);
  const { header, reconnecting } = phoneScreen(phone);
  await expect(phone.getByText("✓ You're in")).toBeVisible();
  await expect(reconnecting).toHaveCount(0);

  reachable = false;
  await Promise.all(pageSides.map((socket) => socket.close()));
  await expect(reconnecting).toHaveText("Reconnecting…");
  await expect(phone.getByText("✓ You're in")).toBeVisible();

  // The Round moves on while the phone is offline.
  await desk(host).rail.getByRole("button", { name: /^Heat 1/ }).click();
  await desk(host).button("Start Round").click();
  await expect(desk(host).step).toHaveText("Running");

  reachable = true;
  await expect(reconnecting).toHaveCount(0, { timeout: 35_000 });
  await expect(header).toContainText("Heat 1");
  await expect(header).toContainText("Running");
});

test("until the Worker answers, a phone is joining, not waiting on a wrong code", async ({ page }) => {
  await page.routeWebSocket(/\/socket\//, (socket) => void socket.close());
  const code = unclaimedCode();

  await page.goto(`${WORKER_URL}/join/?c=${code}`);

  await expect(page.getByRole("heading", { name: `Joining ${code}…` })).toBeVisible();
  await expect(page.getByText("Not starting?")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("a phone waiting on a code says when it's reconnecting", async ({ page }) => {
  const pageSides: { close(): Promise<void> }[] = [];
  let reachable = true;
  await page.routeWebSocket(/\/socket\//, (socket) => {
    if (!reachable) return void socket.close();
    socket.connectToServer();
    pageSides.push(socket);
  });
  const code = unclaimedCode();
  await page.goto(`${WORKER_URL}/join/?c=${code}`);
  await expect(page.getByRole("heading", { name: `Waiting for ${code} to open…` })).toBeVisible();

  reachable = false;
  await Promise.all(pageSides.map((socket) => socket.close()));

  await expect(page.getByRole("status")).toHaveText("Reconnecting…");
  await expect(page.getByRole("heading", { name: `Waiting for ${code} to open…` })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change code" })).toBeEnabled();
});
