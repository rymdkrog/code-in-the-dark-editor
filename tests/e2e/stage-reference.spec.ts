// The Round's Reference on the Stage while voting. The Organizer drops the Competition file or
// Round packages on the Stage or the Host console; the References stay in that browser, and
// neither the Worker nor any phone ever gets one.

import { readFileSync } from "node:fs";
import { expect, test, type Page, type WebSocket } from "@playwright/test";
import { hostConsoleLink, stageLink } from "../../src/pages/links.ts";
import { addRound, competitionFile, newCompetition, updateRound } from "../../src/pages/prep/competition.ts";
import { V, type PublicSnapshot } from "../../src/protocol/protocol.ts";
import { claimConsole, desk, HEAT, newClaim } from "./host.ts";
import { PRACTICE } from "./package.ts";
import { WORKER_ORGANIZER_KEY, WORKER_URL } from "./worker.ts";

test.use({ viewport: { width: 1920, height: 1080 } });

const PNG = readFileSync(new URL("../../fixtures/practice/reference.png", import.meta.url)).toString("base64");

/** A Competition file of Heat 1, with the practice Reference unless `withReference` is false, and
 * a Final with none yet. */
function competitionFileText(withReference = true) {
  let competition = addRound(addRound(newCompetition(), "heat", HEAT), "final", "final00000");
  competition = updateRound(competition, HEAT, (round) => ({
    ...round,
    reference: withReference ? { name: "page.png", dataUri: `data:image/png;base64,${PNG}`, width: 1280, height: 800 } : null,
  }));
  return competitionFile({ ...competition, name: "Gothenburg 2026" });
}

/** Drops files on the page, as the Organizer does from their file manager. */
async function dropFiles(page: Page, files: { name: string; text: string }[]) {
  const dataTransfer = await page.evaluateHandle((files) => {
    const transfer = new DataTransfer();
    for (const { name, text } of files) transfer.items.add(new File([text], name));
    return transfer;
  }, files);
  for (const type of ["dragenter", "dragover", "drop"]) await page.dispatchEvent("body", type, { dataTransfer });
}

const VOTING: PublicSnapshot = {
  competition: {
    name: "Gothenburg 2026",
    joinCode: "K7XQ2N",
    rounds: [
      { id: HEAT, name: "Heat 1" },
      { id: "final00000", name: "Final" },
    ],
  },
  lifecycle: { current: HEAT, phase: "voting", durationMs: 900_000, endsAt: null },
  roster: [{ id: "seat-ada", name: "Ada", online: true }],
  turnout: 4,
};

/** A Stage on a Worker the test plays, and every message the Stage sends it. */
async function scriptedStage(page: Page, first: PublicSnapshot) {
  let latest = first;
  const sent: string[] = [];
  let server: { send(text: string): void } | undefined;
  await page.routeWebSocket(/\/socket\//, (socket) => {
    server = socket;
    socket.onMessage((text) => {
      sent.push(String(text));
      if ((JSON.parse(String(text)) as { t: string }).t === "follow") socket.send(JSON.stringify({ v: V, t: "public", ...latest }));
    });
  });
  await page.goto(`${WORKER_URL}/stage/?c=K7XQ2N`);
  return {
    sent,
    say(next: PublicSnapshot) {
      latest = next;
      server?.send(JSON.stringify({ v: V, t: "public", ...next }));
    },
  };
}

const reference = (page: Page, round = "Heat 1") => page.getByRole("img", { name: `Reference for ${round}` });

/** Whether the image has loaded and decoded. */
const decoded = (image: ReturnType<typeof reference>) =>
  image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0);

test("a Competition file dropped on the Stage puts the Reference beside the turnout, QR and Join code while voting", async ({
  page,
}) => {
  const stage = await scriptedStage(page, { ...VOTING, lifecycle: { ...VOTING.lifecycle, phase: "timesup" } });
  await expect(page.getByText("Time's up · Reveals next")).toBeVisible();

  await dropFiles(page, [{ name: "gbg26.citd-competition.json", text: competitionFileText() }]);
  await expect(page.getByRole("status")).toHaveText("Loaded the Reference for Heat 1.");
  await expect(reference(page)).toHaveCount(0);

  stage.say(VOTING);
  await expect(reference(page)).toBeVisible();
  await expect.poll(() => decoded(reference(page))).toBe(true);
  await expect(page.getByLabel("Turnout")).toHaveText("4");
  await expect(page.getByText("votes so far")).toBeVisible();
  await expect(page.getByRole("img", { name: `QR code for ${WORKER_URL}/join?c=K7XQ2N` })).toBeVisible();
  await expect(page.getByText("K7XQ2N", { exact: true })).toBeVisible();
  // It fills most of the screen.
  const box = (await reference(page).boundingBox())!;
  expect(box.width * box.height).toBeGreaterThan((1920 * 1080) / 3);

  // It's kept in this browser: a reload still has it.
  await page.reload();
  await expect.poll(() => decoded(reference(page))).toBe(true);
  expect(stage.sent.join("\n")).not.toContain("data:");
});

test("with no Reference loaded for the Round, the voting screen falls back to turnout and QR", async ({ page }) => {
  const stage = await scriptedStage(page, VOTING);
  await expect(page.getByLabel("Turnout")).toHaveText("4");
  await expect(page.getByText("Vote now · Heat 1")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Reference/ })).toHaveCount(0);

  // The Competition file has no Reference for the Final yet.
  await dropFiles(page, [{ name: "gbg26.citd-competition.json", text: competitionFileText() }]);
  await expect(reference(page)).toBeVisible();
  stage.say({ ...VOTING, lifecycle: { ...VOTING.lifecycle, current: "final00000" } });
  await expect(page.getByText("Vote now · Final")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Reference/ })).toHaveCount(0);

  // A later Competition file whose Heat 1 has no Reference any more clears the one loaded before.
  stage.say(VOTING);
  await expect(reference(page)).toBeVisible();
  await dropFiles(page, [{ name: "gbg26.citd-competition.json", text: competitionFileText(false) }]);
  await expect(page.getByRole("status")).toHaveText("No References in gbg26.citd-competition.json.");
  await expect(page.getByText("Vote now · Heat 1")).toBeVisible();
  await expect(page.getByRole("img", { name: /^Reference/ })).toHaveCount(0);
});

test("a Round package dropped on the Stage loads its Reference, and anything else is refused", async ({ page }) => {
  await scriptedStage(page, VOTING);
  await expect(page.getByLabel("Turnout")).toHaveText("4");

  await dropFiles(page, [{ name: "notes.txt", text: "not a Round" }]);
  await expect(page.getByRole("status")).toHaveText("No References in notes.txt.");
  await expect(page.getByRole("img", { name: /^Reference/ })).toHaveCount(0);

  await dropFiles(page, [{ name: "citd-practice.html", text: readFileSync(PRACTICE, "utf8") }]);
  await expect(page.getByRole("status")).toHaveText("Loaded the Reference for Heat 1.");
  await expect.poll(() => decoded(reference(page))).toBe(true);
});

/** Every frame a page's sockets send or receive. */
function frames(page: Page) {
  const seen: string[] = [];
  page.on("websocket", (socket: WebSocket) => {
    socket.on("framesent", ({ payload }) => void seen.push(String(payload)));
    socket.on("framereceived", ({ payload }) => void seen.push(String(payload)));
  });
  return seen;
}

test("a Competition file dropped on the Host console before the claim is kept", async ({ page: host }) => {
  await host.goto(hostConsoleLink(WORKER_URL, newClaim()));
  await expect(host.getByRole("heading", { name: "Claim this Competition" })).toBeVisible();

  await dropFiles(host, [{ name: "gbg26.citd-competition.json", text: competitionFileText() }]);
  await expect(host.getByRole("status")).toHaveText("Loaded the Reference for Heat 1.");

  await host.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await host.getByRole("button", { name: "Claim" }).click();
  await expect(host.getByRole("region", { name: "References" })).toContainText("Heat 1");
});

test("the Competition file dropped on the Host console covers a Stage in the same browser, and nothing reaches the Worker or phones", async ({
  browser,
  page: host,
}) => {
  const hostFrames = frames(host);
  const claim = newClaim();
  await claimConsole(host, claim);
  const references = host.getByRole("region", { name: "References" });
  await expect(references).toContainText("none");

  const stage = await host.context().newPage();
  const stageFrames = frames(stage);
  await stage.goto(stageLink(WORKER_URL, claim.joinCode, claim.competitionName));
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const phoneFrames = frames(phone);
  await phone.goto(`${WORKER_URL}/join?c=${claim.joinCode}`);

  const { rail, button, dialog } = desk(host);
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  await button("Start Round").click();
  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await button("Open voting").click();
  await expect(stage.getByText("Vote now · Heat 1")).toBeVisible();
  await expect(phone.getByRole("heading", { name: "Whose Reveal came closest?" })).toBeVisible();

  await dropFiles(host, [{ name: "gbg26.citd-competition.json", text: competitionFileText() }]);
  await expect(host.getByRole("status")).toHaveText("Loaded the Reference for Heat 1.");
  await expect(references).toContainText("Heat 1");
  await expect(references).not.toContainText("Final");

  // The Stage, open already, picks it up without a reload.
  await expect.poll(() => decoded(reference(stage))).toBe(true);
  await expect(stage.getByLabel("Turnout")).toHaveText("0");

  for (const seen of [hostFrames, stageFrames, phoneFrames]) {
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join("\n")).not.toContain("data:");
    expect(seen.join("\n")).not.toContain(PNG.slice(100, 200));
  }
  await phone.context().close();
});
