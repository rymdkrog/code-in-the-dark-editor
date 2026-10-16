// Stage copies: prep, connected as the Host, keeps a small copy of each Round's Reference on the
// Worker, and a Stage on any machine shows it while voting, with no file dropped anywhere. On the
// real Worker under `wrangler dev`.

import { expect, test, type Page, type WebSocket } from "@playwright/test";
import { desk, hostLinkIn } from "./host.ts";
import { newRound, REFERENCE, turnOnAudience } from "./prep.ts";
import { V, type RoundRef } from "../../src/protocol/protocol.ts";
import { WORKER_ORGANIZER_KEY, WORKER_URL } from "./worker.ts";
import { closeOwnContexts, ownContext } from "./contexts.ts";

test.afterEach(closeOwnContexts);

/** Every frame a page's sockets send or receive, the sent ones marked. */
function frames(page: Page) {
  const seen: { sent: boolean; payload: string }[] = [];
  page.on("websocket", (socket: WebSocket) => {
    socket.on("framesent", ({ payload }) => void seen.push({ sent: true, payload: String(payload) }));
    socket.on("framereceived", ({ payload }) => void seen.push({ sent: false, payload: String(payload) }));
  });
  return seen;
}

const sentCopies = (seen: ReturnType<typeof frames>) =>
  seen.filter(({ sent, payload }) => sent && payload.includes('"set-stage-copy"'));

test("prep connected with a Reference set, voting opens, and a Stage in a fresh browser shows it", async ({
  page: prep,
  browser,
}) => {
  const prepFrames = frames(prep);
  await newRound(prep);
  await prep.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await turnOnAudience(prep, WORKER_URL);
  await prep.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await prep.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(prep.getByText("Claimed.")).toBeVisible();
  // The Worker says it holds the copy.
  await expect.poll(() => prepFrames.some(({ sent, payload }) => !sent && payload.includes('"stage-copies"'))).toBe(true);
  expect(sentCopies(prepFrames)).toHaveLength(1);
  const stageLink = (await prep.getByLabel("Stage link").textContent())!;
  const joinCode = (await prep.getByLabel("Join code").textContent())!;

  const host = await prep.context().newPage();
  await host.goto(await hostLinkIn(prep));
  await expect(host.getByRole("banner")).toContainText("live");
  const { rail, button, dialog } = desk(host);
  await rail.getByRole("button", { name: /^Heat 1/ }).click();

  const stageContext = await ownContext(browser, { viewport: { width: 1920, height: 1080 } });
  const stage = await stageContext.newPage();
  await stage.goto(stageLink);
  const phoneContext = await ownContext(browser, { viewport: { width: 390, height: 844 } });
  const phone = await phoneContext.newPage();
  const phoneFrames = frames(phone);
  await phone.goto(`${WORKER_URL}/join?c=${joinCode}`);

  await button("Start Round").click();
  const reference = stage.getByRole("img", { name: "Reference for Heat 1" });
  await expect(stage.getByText("Heat 1")).toBeVisible();
  await expect(reference).toHaveCount(0);
  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await button("Open voting").click();

  await expect(reference).toBeVisible();
  await expect.poll(() => reference.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  // The Stage copy, not the full Reference.
  expect(await reference.getAttribute("src")).toMatch(/^data:image\/(webp|jpeg);/);
  await expect(phone.getByRole("heading", { name: "Whose Reveal came closest?" })).toBeVisible();
  expect(phoneFrames.map(({ payload }) => payload).join("\n")).not.toContain("data:");

  // Connecting again, prep sends nothing the Worker already holds.
  const again = frames(prep);
  await prep.reload();
  await prep.getByRole("button", { name: /Audience/ }).click();
  await expect(prep.getByText("Claimed.")).toBeVisible();
  await expect.poll(() => again.some(({ sent, payload }) => !sent && payload.includes('"competition"'))).toBe(true);
  await prep.waitForTimeout(500);
  expect(sentCopies(again)).toHaveLength(0);

  await stageContext.close();
  await phoneContext.close();
});

test("a copy the Worker refuses shows as a problem on that Round in prep", async ({ page: prep }) => {
  await prep.routeWebSocket(/\/socket\//, (socket) => {
    socket.onMessage((text) => {
      const message = JSON.parse(String(text)) as { t: string; roundId?: string; rounds?: RoundRef[] };
      if (message.t === "host") {
        const competition = { name: "Gothenburg 2026", joinCode: "K7XQ2N", rounds: message.rounds ?? [] };
        const lifecycle = { current: null, phase: null, durationMs: 900_000, endsAt: null };
        socket.send(JSON.stringify({ v: V, t: "competition", competition, lifecycle, rosters: {}, tallies: {} }));
      }
      if (message.t === "set-stage-copy") {
        socket.send(
          JSON.stringify({ v: V, t: "refused", command: "set-stage-copy", reason: "too-large", roundId: message.roundId }),
        );
      }
    });
  });
  await newRound(prep);
  await turnOnAudience(prep, WORKER_URL);
  await expect(prep.getByText("Claimed.")).toBeVisible();
  await prep.getByRole("button", { name: /^Heat 1/ }).click();
  const problems = prep.locator(".topbar-problems");
  await expect(problems).toHaveText("It has no Reference yet.");

  await prep.getByLabel("Choose a Reference").setInputFiles(REFERENCE);

  await expect(problems).toHaveText(
    "The Stage won't show this Reference from the Worker: the Worker refused its Stage copy as too big.",
  );
  // It doesn't stop an export.
  await expect(prep.getByRole("button", { name: "Export", exact: true })).toBeEnabled();
});
