// The Audience phone page on the real Worker under `wrangler dev`: joining with the Join code,
// and following the Competition from Round to Round.

import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { JOIN_CODE_ALPHABET, REACTIONS, V, type PublicSnapshot } from "../../src/protocol/protocol.ts";
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

/** A phone on a Worker the test plays: it answers `follow` with `snapshot`, and records what the
 * phone sends. */
async function scriptedPhone(page: Page, snapshot: PublicSnapshot) {
  const sent: unknown[] = [];
  let server: WebSocketRoute | undefined;
  let reachable = true;
  const say = (next: PublicSnapshot) => server?.send(JSON.stringify({ v: V, t: "public", ...next }));
  await page.routeWebSocket(/\/socket\//, (socket) => {
    if (!reachable) return void socket.close();
    server = socket;
    socket.onMessage((text) => {
      const message = JSON.parse(String(text)) as { t: string };
      if (message.t === "follow") say(snapshot);
      else sent.push(message);
    });
  });
  // Every buzz the phone asks for.
  await page.addInitScript(() => {
    const buzzes: unknown[] = [];
    (window as unknown as { buzzes: unknown[] }).buzzes = buzzes;
    Object.defineProperty(navigator, "vibrate", { value: (pattern: unknown) => (buzzes.push(pattern), true) });
  });
  await page.goto(`${WORKER_URL}/join/?c=K7XQ2N`);
  /** Drops the phone, and turns its reconnects away from then on. */
  const drop = async () => {
    reachable = false;
    await server?.close();
  };
  return { sent, say, drop, buzzes: () => page.evaluate(() => (window as unknown as { buzzes: unknown[] }).buzzes) };
}

const SNAPSHOT: PublicSnapshot = {
  competition: { name: "Gothenburg 2026", joinCode: "K7XQ2N", rounds: [{ id: "heat1aaaaa", name: "Heat 1" }] },
  lifecycle: { current: "heat1aaaaa", phase: "running", durationMs: 900_000, endsAt: Date.now() + 600_000 },
  roster: [
    { id: "seat-ada", name: "Ada", online: true },
    { id: "seat-bo", name: "Bo", online: false },
    { id: "hand-cleo", name: "Cleo", online: false, handAdded: true },
  ],
  turnout: 0,
};

const rosterRow = (phone: Page, name: string) => phone.getByRole("listitem").filter({ hasText: name });
const emojiButtons = (phone: Page, name: string) => rosterRow(phone, name).getByRole("button");

test("every Roster entry is a row of its own four emoji; offline entries are dimmed, hand-added ones vote only", async ({
  page,
}) => {
  await scriptedPhone(page, SNAPSHOT);

  await expect(emojiButtons(page, "Ada")).toHaveText([...REACTIONS]);
  for (const button of await emojiButtons(page, "Ada").all()) await expect(button).toBeEnabled();
  await expect(emojiButtons(page, "Ada").first()).toHaveAccessibleName("React 🔥 to Ada");

  await expect(emojiButtons(page, "Bo")).toHaveCount(4);
  for (const button of await emojiButtons(page, "Bo").all()) await expect(button).toBeDisabled();
  const opacity = (name: string) => rosterRow(page, name).evaluate((row) => Number(getComputedStyle(row).opacity));
  expect(await opacity("Bo")).toBeLessThan(await opacity("Ada"));

  await expect(rosterRow(page, "Cleo")).toContainText("no laptop — vote only");
  await expect(emojiButtons(page, "Cleo")).toHaveCount(0);
});

test("a tap sends one Reaction, bursts at the tap point at once, and buzzes", async ({ page }) => {
  const { sent, buzzes } = await scriptedPhone(page, SNAPSHOT);
  const fire = emojiButtons(page, "Ada").first();
  const box = (await fire.boundingBox())!;

  await fire.click();
  await fire.click();

  const burst = page.locator(".burst").first();
  await expect(burst).toBeAttached();
  await expect(burst).toHaveText("🔥");
  const at = (await burst.boundingBox())!;
  expect(Math.abs(at.x + at.width / 2 - (box.x + box.width / 2))).toBeLessThan(box.width);
  await expect.poll(() => sent).toEqual([
    { v: V, t: "react", seat: "seat-ada", e: "🔥" },
    { v: V, t: "react", seat: "seat-ada", e: "🔥" },
  ]);
  expect(await buzzes()).toHaveLength(2);
  // Bursts clear themselves.
  await expect(page.locator(".burst")).toHaveCount(0);
});

test("the emoji work while up next, running and at time's up, and are gone in voting and results", async ({ page }) => {
  const { say } = await scriptedPhone(page, SNAPSHOT);
  const fire = page.getByRole("button", { name: "React 🔥 to Ada" });

  for (const phase of ["upcoming", "timesup", "voting", "results", "running"] as const) {
    say({ ...SNAPSHOT, lifecycle: { ...SNAPSHOT.lifecycle, phase } });
    if (phase === "voting" || phase === "results") await expect(fire).toHaveCount(0);
    else await expect(fire).toBeEnabled();
  }
});

const VOTING: PublicSnapshot = { ...SNAPSHOT, lifecycle: { ...SNAPSHOT.lifecycle, phase: "voting", endsAt: null }, turnout: 4, vote: null };
const voteButton = (phone: Page, name: string) => phone.getByRole("list", { name: "Roster" }).getByRole("button", { name });

test("the voting screen: a big button for every entry, offline and hand-added too, and the turnout but no tally", async ({
  page,
}) => {
  const { sent } = await scriptedPhone(page, VOTING);

  await expect(page.getByRole("heading", { name: "Whose Reveal came closest?" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Roster" }).getByRole("button")).toHaveText(["Ada", "Bo", "Cleo"]);
  for (const name of ["Ada", "Bo", "Cleo"]) await expect(voteButton(page, name)).toBeEnabled();
  await expect(page.getByText("4 votes so far")).toBeVisible();

  await voteButton(page, "Cleo").click();

  await expect.poll(() => sent).toEqual([{ v: V, t: "vote", seat: "hand-cleo" }]);
  // Only the Worker's answer confirms the Vote.
  await expect(page.getByText("You voted for")).toHaveCount(0);
});

test("the Worker's answer confirms the Vote; Change my vote shows the names again, and the last pick wins", async ({ page }) => {
  const { sent, say } = await scriptedPhone(page, VOTING);
  await expect(voteButton(page, "Ada")).toBeEnabled();

  say({ ...VOTING, turnout: 5, vote: "seat-ada" });

  await expect(page.getByText("✓ You voted for Ada")).toBeVisible();
  await expect(page.getByText("5 votes so far")).toBeVisible();
  await expect(page.getByRole("list", { name: "Roster" })).toHaveCount(0);

  await page.getByRole("button", { name: "Change my vote" }).click();
  await expect(voteButton(page, "Ada")).toHaveAttribute("aria-pressed", "true");
  await voteButton(page, "Bo").click();
  await expect.poll(() => sent).toEqual([{ v: V, t: "vote", seat: "seat-bo" }]);
  say({ ...VOTING, turnout: 5, vote: "seat-bo" });

  await expect(page.getByText("✓ You voted for Bo")).toBeVisible();
});

test("a phone whose entry was removed is back to not voted, on a voting screen that follows the live Roster", async ({ page }) => {
  const { say } = await scriptedPhone(page, { ...VOTING, vote: "seat-ada" });
  await expect(page.getByText("✓ You voted for Ada")).toBeVisible();

  say({ ...VOTING, roster: VOTING.roster.slice(1), turnout: 3, vote: null });

  await expect(page.getByRole("list", { name: "Roster" }).getByRole("button")).toHaveText(["Bo", "Cleo"]);
  await expect(page.getByText("3 votes so far")).toBeVisible();
});

test("while the phone is reconnecting, the voting buttons wait for the snapshot", async ({ page }) => {
  const { drop } = await scriptedPhone(page, VOTING);
  await expect(voteButton(page, "Ada")).toBeEnabled();

  await drop();

  await expect(page.getByRole("status")).toHaveText("Reconnecting…");
  for (const button of await page.getByRole("list", { name: "Roster" }).getByRole("button").all()) {
    await expect(button).toBeDisabled();
  }
});

test("at results the phone shows its own pick, or that it didn't vote, and never a ranking", async ({ page }) => {
  const results: PublicSnapshot = { ...VOTING, lifecycle: { ...VOTING.lifecycle, phase: "results" } };
  const { say } = await scriptedPhone(page, { ...results, vote: "seat-bo" });

  await expect(page.getByRole("heading", { name: "Voting closed · Eyes on the Stage" })).toBeVisible();
  await expect(page.getByText("You picked Bo")).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByText(/\d+ votes?\b/)).toHaveCount(0);

  say({ ...results, vote: null });

  await expect(page.getByText("You didn't vote this Round")).toBeVisible();
});

test("while the phone is reconnecting, the emoji wait for the snapshot", async ({ page }) => {
  const { drop } = await scriptedPhone(page, SNAPSHOT);
  await expect(emojiButtons(page, "Ada").first()).toBeEnabled();

  await drop();

  await expect(page.getByRole("status")).toHaveText("Reconnecting…");
  for (const button of await emojiButtons(page, "Ada").all()) await expect(button).toBeDisabled();
});
