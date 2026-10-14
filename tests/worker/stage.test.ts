// The Stage follows the Current Round: read-only, joined with the public Join code alone.

import { afterAll, beforeAll, expect, test } from "vitest";
import { DEFAULT_DURATION_MS, V, type Claim, type LifecycleCommand, type ServerMessage } from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const welcome = { current: null, phase: null, durationMs: DEFAULT_DURATION_MS, endsAt: null };

async function stage(claim: Claim): Promise<TestSocket> {
  const socket = await connect(worker, claim.joinCode, "stage");
  socket.send({ t: "follow" });
  return socket;
}

async function host(claim: Claim): Promise<TestSocket> {
  const socket = await connect(worker, claim.joinCode, "host");
  socket.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  expect(await socket.next()).toMatchObject({ t: "competition" });
  return socket;
}

/** Sends a lifecycle command that must be a transition. */
async function step(socket: TestSocket, command: LifecycleCommand) {
  socket.send(command);
  expect(await socket.next()).toMatchObject({ t: "lifecycle" });
}

const competition = (claim: Claim) => ({ name: "Gothenburg 2026", joinCode: claim.joinCode, rounds: claim.rounds });

test("before the claim the Stage waits, and the claim brings it the welcome screen", async () => {
  const claim = newClaim("ST");
  const screen = await stage(claim);
  expect(await screen.next()).toEqual({ v: V, t: "unclaimed" });

  await host(claim);

  expect(await screen.next()).toEqual({
    v: V,
    t: "public",
    competition: competition(claim),
    lifecycle: welcome,
    roster: [],
  });
});

test("the Stage's snapshot carries no secrets", async () => {
  const claim = newClaim("ST");
  await host(claim);

  const snapshot = JSON.stringify(await (await stage(claim)).next());

  expect(snapshot).toContain(claim.joinCode);
  expect(snapshot).not.toContain(claim.hostSecret);
  expect(snapshot).not.toContain(claim.contestantToken);
});

test("the Stage follows every lifecycle change, and a Stage that connects later gets the same snapshot", async () => {
  const claim = newClaim("ST");
  const desk = await host(claim);
  const screen = await stage(claim);
  await screen.next();

  await step(desk, { t: "make-current", roundId: "heat1aaaaa" });
  expect(await screen.next()).toEqual({
    v: V,
    t: "public",
    competition: competition(claim),
    lifecycle: { current: "heat1aaaaa", phase: "upcoming", durationMs: DEFAULT_DURATION_MS, endsAt: null },
    roster: [],
  });
  await step(desk, { t: "set-duration", durationMs: 2 * 60_000 });
  expect(await screen.next()).toMatchObject({ lifecycle: { phase: "upcoming", durationMs: 2 * 60_000 } });
  await step(desk, { t: "start" });
  const running = await screen.next();
  expect(running).toMatchObject({ lifecycle: { phase: "running", endsAt: expect.any(Number) } });

  expect(await (await stage(claim)).next()).toEqual(running);
  await step(desk, { t: "end-early" });
  expect(await screen.next()).toMatchObject({ lifecycle: { phase: "timesup", endsAt: null } });
});

test("reaching endsAt brings the Stage to time's up", async () => {
  const claim = newClaim("ST");
  const desk = await host(claim);
  await step(desk, { t: "make-current", roundId: "heat1aaaaa" });
  await step(desk, { t: "set-duration", durationMs: 1000 });
  const screen = await stage(claim);
  await screen.next();

  await step(desk, { t: "start" });
  await screen.next();

  expect(await screen.next(5000)).toMatchObject({ t: "public", lifecycle: { phase: "timesup" } });
});

test("the Stage is read-only: its lifecycle commands are refused", async () => {
  const claim = newClaim("ST");
  const desk = await host(claim);
  await step(desk, { t: "make-current", roundId: "heat1aaaaa" });
  const screen = await stage(claim);
  await screen.next();

  screen.send({ t: "start" });

  expect(await screen.next()).toEqual({ v: V, t: "refused", command: "start", reason: "host-secret" });
  desk.send({ t: "host", hostSecret: claim.hostSecret });
  expect(await desk.next()).toMatchObject({ lifecycle: { phase: "upcoming" } });
});

test("a Contestant socket can't follow the lifecycle", async () => {
  const claim = newClaim("ST");
  const desk = await host(claim);
  const contestant = await connect(worker, claim.joinCode, "contestant");

  contestant.send({ t: "follow" });
  await step(desk, { t: "make-current", roundId: "heat1aaaaa" });

  await expect(contestant.next(500)).rejects.toThrow(/No message/);
});

test("a Stage keeps following after a Durable Object restart, once it reconnects", async () => {
  const claim = newClaim("ST");
  const desk = await host(claim);
  await step(desk, { t: "make-current", roundId: "heat2aaaaa" });
  await step(desk, { t: "start" });
  const before: ServerMessage = await (await stage(claim)).next();

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  expect(await (await stage(claim)).next()).toEqual(before);
});
