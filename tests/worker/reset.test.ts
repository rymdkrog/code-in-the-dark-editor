// The reset after a rehearsal: the Host clears every Round's Roster and votes and goes back to the
// welcome screen. The claim stays as it is, and laptops still connected get back on their Roster.

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  CLOSE_TOKEN,
  CLOSE_UNCLAIMED,
  CLOSE_VERSION,
  V,
  type Claim,
  type LifecycleCommand,
  type Presence,
  type Roster,
  type ServerMessage,
} from "../../src/protocol/protocol.ts";
import { WELCOME } from "../../worker/lifecycle.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const HEAT_1 = "heat1aaaaa";
const HEAT_2 = "heat2aaaaa";
const FINAL = "finalaaaaa";
const EMPTY: Roster = { entries: [], newest: null };
const EMPTY_ROSTERS = { [HEAT_1]: EMPTY, [HEAT_2]: EMPTY, [FINAL]: EMPTY };
const EMPTY_TALLIES = { [HEAT_1]: {}, [HEAT_2]: {}, [FINAL]: {} };
/** The welcome screen after the rehearsal, which set a 5 min duration. */
const AFTER = { ...WELCOME, durationMs: 5 * 60_000 };

type Competition = Extract<ServerMessage, { t: "competition" }>;

/** Reads a socket's messages until one of type `t` arrives, skipping the others. */
async function until<T extends ServerMessage["t"]>(socket: TestSocket, t: T): Promise<Extract<ServerMessage, { t: T }>> {
  for (;;) {
    const message = await socket.next();
    if (message.t === t) return message as Extract<ServerMessage, { t: T }>;
  }
}

/** Sends a lifecycle command that must be a transition, and skips the other news in between. */
async function step(host: TestSocket, command: LifecycleCommand) {
  host.send(command);
  await until(host, "lifecycle");
}

let seats = 0;

/** A laptop on a Round's Roster, connected, past the Host hearing of it. */
async function laptop(claim: Claim, host: TestSocket, name: string, roundId = HEAT_1) {
  const presence: Presence = { roundId, seat: `seat-${++seats}`, name, revision: "1-202610121403" };
  const socket = await connect(worker, claim.joinCode, "contestant");
  socket.send({ t: "presence", token: claim.contestantToken, ...presence });
  await until(host, "roster");
  return { socket, presence };
}

/** A fresh Host's snapshot. */
async function snapshot(claim: Claim): Promise<Competition> {
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "host", hostSecret: claim.hostSecret });
  const message = await until(host, "competition");
  host.close();
  return message;
}

/** A rehearsal: Heat 1 at results with Ada's Vote and a hand-added Cleo, Bo on Heat 2, and a
 * phone that voted, all past the Host hearing of it. */
async function rehearsed() {
  const claim = newClaim("RR");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await until(host, "competition");
  await step(host, { t: "make-current", roundId: HEAT_1 });
  await step(host, { t: "set-duration", durationMs: 5 * 60_000 });
  const ada = await laptop(claim, host, "Ada");
  const bo = await laptop(claim, host, "Bo", HEAT_2);
  host.send({ t: "add-by-hand", roundId: HEAT_1, name: "Cleo" });
  await until(host, "roster");
  for (const command of [{ t: "start" }, { t: "end-early" }, { t: "open-voting" }] as const) await step(host, command);
  const phone = await connect(worker, claim.joinCode, "phone");
  phone.send({ t: "follow", voter: "voter-1" });
  await until(phone, "public");
  phone.send({ t: "vote", seat: ada.presence.seat });
  await until(host, "tally");
  await until(phone, "public");
  await step(host, { t: "close-voting" });
  await until(phone, "public");
  return { claim, host, ada, bo, phone };
}

test("a reset clears every Round's Roster and votes and goes to the welcome screen, keeping the duration", async () => {
  const { claim, host } = await rehearsed();

  host.send({ t: "reset" });

  expect(await until(host, "competition")).toMatchObject({ lifecycle: AFTER, rosters: EMPTY_ROSTERS, tallies: EMPTY_TALLIES });
  const after = await snapshot(claim);
  expect(after).toMatchObject({ lifecycle: AFTER, rosters: EMPTY_ROSTERS, tallies: EMPTY_TALLIES });
  expect(after.competition).toEqual({ name: claim.competitionName, joinCode: claim.joinCode, rounds: claim.rounds });
});

test("the Stage and phones get the welcome screen with no Roster, turnout or Vote", async () => {
  const { claim, host, phone } = await rehearsed();
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow" });
  await until(stage, "public");

  host.send({ t: "reset" });

  // The first snapshot after the reset is already the clean one.
  expect(await until(stage, "public")).toEqual({
    v: V,
    t: "public",
    competition: { name: claim.competitionName, joinCode: claim.joinCode, rounds: claim.rounds },
    lifecycle: AFTER,
    roster: [],
    turnout: 0,
  });
  expect(await until(phone, "public")).toMatchObject({ lifecycle: AFTER, roster: [], turnout: 0, vote: null });
});

test("a reset stays cleared after a Durable Object restart, and the claim is unchanged", async () => {
  const { claim, host } = await rehearsed();
  host.send({ t: "reset" });
  await until(host, "competition");

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  expect(await snapshot(claim)).toMatchObject({
    lifecycle: AFTER,
    rosters: EMPTY_ROSTERS,
    tallies: EMPTY_TALLIES,
  });
  // The claim is the same: its Host secret still gets in, and its Contestant token still seats a laptop.
  const back = await connect(worker, claim.joinCode, "host");
  back.send({ t: "host", hostSecret: claim.hostSecret });
  await until(back, "competition");
  const { presence } = await laptop(claim, back, "Dee");
  expect((await snapshot(claim)).rosters[HEAT_1]!.entries).toEqual([
    { seat: presence.seat, name: "Dee", revision: presence.revision, online: true },
  ]);
});

test("a reset needs the Host secret, and changes nothing without it", async () => {
  const { claim } = await rehearsed();
  const before = await snapshot(claim);
  const stranger = await connect(worker, claim.joinCode, "host");
  stranger.send({ t: "host", hostSecret: "not-the-secret" });
  await stranger.next();

  stranger.send({ t: "reset" });

  expect(await stranger.next()).toEqual({ v: V, t: "refused", command: "reset", reason: "host-secret" });
  expect(await snapshot(claim)).toEqual(before);
});

test("a reset is refused while a Round is running, and allowed at every other phase", async () => {
  const claim = newClaim("RR");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await until(host, "competition");
  await step(host, { t: "make-current", roundId: HEAT_1 });
  await step(host, { t: "start" });
  const before = await snapshot(claim);

  host.send({ t: "reset" });

  expect(await host.next()).toEqual({ v: V, t: "refused", command: "reset", reason: "transition" });
  expect(await snapshot(claim)).toEqual(before);
  await step(host, { t: "end-early" });
  host.send({ t: "reset" });
  expect((await until(host, "competition")).lifecycle).toMatchObject({ current: null, phase: null });
  // At the welcome screen too.
  host.send({ t: "reset" });
  expect((await until(host, "competition")).lifecycle).toMatchObject({ current: null, phase: null });
});

test("laptops still connected, a hidden one included, are closed with an ordinary code and get back on their Roster", async () => {
  const { claim, host, ada, bo } = await rehearsed();
  host.send({ t: "remove-entry", roundId: HEAT_2, seat: bo.presence.seat });
  await until(host, "roster");

  host.send({ t: "reset" });
  await until(host, "competition");

  for (const { socket } of [ada, bo]) {
    expect([CLOSE_VERSION, CLOSE_UNCLAIMED, CLOSE_TOKEN]).not.toContain(await socket.closed);
  }
  // The Enhancement reconnects and sends its presence again.
  for (const { presence } of [ada, bo]) {
    const socket = await connect(worker, claim.joinCode, "contestant");
    socket.send({ t: "presence", token: claim.contestantToken, ...presence });
    const { roundId, seat, name, revision } = presence;
    expect(await until(host, "roster")).toEqual({
      v: V,
      t: "roster",
      roundId,
      roster: { entries: [{ seat, name, revision, online: true }], newest: revision },
    });
  }
});
