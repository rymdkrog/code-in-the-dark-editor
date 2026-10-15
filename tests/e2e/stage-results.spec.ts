// The Stage while voting and at results, on a Worker the test plays: the turnout but no counts
// while voting, then every entry's tile, arriving last to first, the leaders crowned.

import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import { V, type PublicSnapshot } from "../../src/protocol/protocol.ts";
import { WORKER_URL } from "./worker.ts";

test.use({ viewport: { width: 1920, height: 1080 } });

const VOTING: PublicSnapshot = {
  competition: { name: "Gothenburg 2026", joinCode: "K7XQ2N", rounds: [{ id: "heat1aaaaa", name: "Heat 1" }] },
  lifecycle: { current: "heat1aaaaa", phase: "voting", durationMs: 900_000, endsAt: null },
  roster: [
    { id: "seat-ada", name: "Ada", online: true },
    { id: "seat-bo", name: "Bo", online: false },
    { id: "hand-cleo", name: "Cleo", online: false, handAdded: true },
  ],
  turnout: 4,
};

const results = (tally: Record<string, number>): PublicSnapshot => ({
  ...VOTING,
  lifecycle: { ...VOTING.lifecycle, phase: "results" },
  tally,
});

/** A Stage on a Worker the test plays: it answers every `follow` with the latest snapshot. */
async function scriptedStage(page: Page, first: PublicSnapshot) {
  let latest = first;
  let server: WebSocketRoute | undefined;
  let follows = 0;
  await page.routeWebSocket(/\/socket\//, (socket) => {
    server = socket;
    socket.onMessage((text) => {
      if ((JSON.parse(String(text)) as { t: string }).t !== "follow") return;
      follows++;
      socket.send(JSON.stringify({ v: V, t: "public", ...latest }));
    });
  });
  await page.goto(`${WORKER_URL}/stage/?c=K7XQ2N`);
  return {
    say(next: PublicSnapshot) {
      latest = next;
      server?.send(JSON.stringify({ v: V, t: "public", ...next }));
    },
    /** Drops the Stage's socket; it reconnects to the latest snapshot. */
    drop: () => server?.close(),
    follows: () => follows,
  };
}

const tiles = (stage: Page) => stage.getByRole("list", { name: "Results" }).getByRole("listitem");
const tile = (stage: Page, name: string) => tiles(stage).filter({ hasText: name });
const opacity = (stage: Page, name: string) =>
  tile(stage, name).evaluate((element) => Number(getComputedStyle(element).opacity));
/** How full a tile's bar is, from 0 to 1. */
const fill = (stage: Page, name: string) =>
  tile(stage, name)
    .locator(".fill")
    .evaluate((bar: HTMLElement) => bar.offsetHeight / bar.parentElement!.clientHeight);

test("while voting the Stage shows the turnout, QR and Join code, and no counts for anyone", async ({ page }) => {
  const stage = await scriptedStage(page, VOTING);

  await expect(page.getByText("Vote now · Heat 1")).toBeVisible();
  await expect(page.getByLabel("Turnout")).toHaveText("4");
  await expect(page.getByText("votes so far")).toBeVisible();
  await expect(page.getByRole("img", { name: `QR code for ${WORKER_URL}/join?c=K7XQ2N` })).toBeVisible();
  await expect(page.getByText("K7XQ2N", { exact: true })).toBeVisible();
  for (const name of ["Ada", "Bo", "Cleo"]) await expect(page.getByText(name)).toHaveCount(0);

  stage.say({ ...VOTING, turnout: 5 });
  await expect(page.getByLabel("Turnout")).toHaveText("5");
});

test("closing voting brings every entry's tile last to first, 0 included, each grown to its count", async ({ page }) => {
  const stage = await scriptedStage(page, VOTING);
  await expect(page.getByLabel("Turnout")).toBeVisible();

  stage.say(results({ "seat-bo": 3, "seat-ada": 1 }));

  await expect(tiles(page)).toHaveCount(3);
  for (const [at, name, count] of [[0, "Bo", "3"], [1, "Ada", "1"], [2, "Cleo", "0"]] as const) {
    await expect(tiles(page).nth(at)).toContainText(name);
    await expect(tiles(page).nth(at)).toContainText(count);
  }
  // Last place arrives first, while the leader is still to come.
  await expect(tile(page, "Cleo")).toHaveCSS("opacity", "1");
  expect(await opacity(page, "Bo")).toBeLessThan(0.5);
  await expect(tile(page, "Ada")).toHaveCSS("opacity", "1");
  expect(await opacity(page, "Bo")).toBeLessThan(0.5);
  await expect(tile(page, "Bo")).toHaveCSS("opacity", "1", { timeout: 6000 });

  await expect.poll(() => fill(page, "Bo"), { timeout: 6000 }).toBeCloseTo(1, 2);
  expect(await fill(page, "Ada")).toBeCloseTo(1 / 3, 2);
  expect(await fill(page, "Cleo")).toBe(0);
  await expect(tile(page, "Bo").getByRole("img", { name: "Leader" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Leader" })).toHaveCount(1);
  await expect(page.getByText("TIE")).toHaveCount(0);
});

test("joint leaders arrive last, together, crowned, with a TIE badge", async ({ page }) => {
  const stage = await scriptedStage(page, VOTING);
  await expect(page.getByLabel("Turnout")).toBeVisible();

  stage.say(results({ "seat-ada": 2, "seat-bo": 2, "hand-cleo": 1 }));

  await expect(tiles(page).nth(2)).toContainText("Cleo");
  await expect(tile(page, "Cleo")).toHaveCSS("opacity", "1");
  expect(await opacity(page, "Ada")).toBeLessThan(0.5);
  expect(await opacity(page, "Bo")).toBeLessThan(0.5);
  await expect(page.getByText("TIE", { exact: true })).toBeVisible();
  await expect(tile(page, "Ada")).toHaveCSS("opacity", "1", { timeout: 6000 });
  await expect(tile(page, "Bo")).toHaveCSS("opacity", "1");
  for (const name of ["Ada", "Bo"]) await expect(tile(page, name).getByRole("img", { name: "Leader" })).toBeVisible();
  await expect(tile(page, "Cleo").getByRole("img", { name: "Leader" })).toHaveCount(0);
});

test("a Stage that reconnects while the results arrive, or opens at results, shows them all at once", async ({ page }) => {
  const stage = await scriptedStage(page, VOTING);
  await expect(page.getByLabel("Turnout")).toBeVisible();
  stage.say(results({ "seat-bo": 3, "seat-ada": 1 }));
  await expect(tile(page, "Cleo")).toHaveCSS("opacity", "1");
  expect(await opacity(page, "Bo")).toBeLessThan(0.5);

  await stage.drop();

  await expect.poll(stage.follows, { timeout: 35_000 }).toBe(2);
  await expect(tile(page, "Bo")).toHaveCSS("opacity", "1", { timeout: 300 });
  expect(await fill(page, "Bo")).toBeCloseTo(1, 2);

  await page.reload();
  await expect(tile(page, "Bo")).toHaveCSS("opacity", "1", { timeout: 300 });
  await expect(tile(page, "Cleo")).toHaveCSS("opacity", "1", { timeout: 300 });
});

test("with nobody voting, every tile shows 0 and nobody is crowned", async ({ page }) => {
  await scriptedStage(page, results({}));

  await expect(tiles(page)).toHaveText([/0.*Ada/, /0.*Bo/, /0.*Cleo/]);
  await expect(page.getByRole("img", { name: "Leader" })).toHaveCount(0);
  await expect(page.getByText("TIE")).toHaveCount(0);
});
