// Reactions: a phone taps an emoji on a Roster entry, and the Durable Object relays it to that
// seat's laptop only, while the Current Round allows it. Never stored, never queued.

import { afterAll, beforeAll, expect, test } from "vitest";
import { V, type Claim, type LifecycleCommand, type Presence } from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const HEAT_1 = "heat1aaaaa";
const FINAL = "finalaaaaa";

/** A claimed Competition with Heat 1 current and up next, and a Host socket past its answers. */
async function heatUpNext(): Promise<{ claim: Claim; host: TestSocket }> {
  const claim = newClaim("RE");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await host.next();
  await step(host, { t: "make-current", roundId: HEAT_1 });
  return { claim, host };
}

/** Sends a lifecycle command that must be a transition, and skips the Roster news in between. */
async function step(host: TestSocket, command: LifecycleCommand) {
  host.send(command);
  for (;;) if ((await host.next()).t === "lifecycle") return;
}

let seats = 0;

/** A laptop on a Round's Roster, connected, past the Host hearing of it. */
async function laptop(claim: Claim, host: TestSocket, roundId = HEAT_1): Promise<{ seat: string; socket: TestSocket }> {
  const presence: Presence = { roundId, seat: `seat-${++seats}`, name: "Anna", revision: "1-202610121403" };
  const socket = await connect(worker, claim.joinCode, "contestant");
  socket.send({ t: "presence", token: claim.contestantToken, ...presence });
  for (;;) if ((await host.next()).t === "roster") break;
  return { seat: presence.seat, socket };
}

async function phone(claim: Claim): Promise<TestSocket> {
  const socket = await connect(worker, claim.joinCode, "phone");
  socket.send({ t: "follow" });
  await socket.next();
  return socket;
}

const NOTHING = /No message/;

test("a Reaction reaches that seat's laptop, and no other", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const bo = await laptop(claim, host);
  const tapper = await phone(claim);

  tapper.send({ t: "react", seat: anna.seat, e: "🔥" });

  expect(await anna.socket.next()).toEqual({ v: V, t: "react", seat: anna.seat, e: "🔥" });
  await expect(bo.socket.next(500)).rejects.toThrow(NOTHING);
});

test("every Reaction is relayed, one per tap, while up next, running and at time's up", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const tapper = await phone(claim);

  tapper.send({ t: "react", seat: anna.seat, e: "👏" });
  tapper.send({ t: "react", seat: anna.seat, e: "👏" });
  await step(host, { t: "start" });
  tapper.send({ t: "react", seat: anna.seat, e: "😂" });
  await step(host, { t: "end-early" });
  tapper.send({ t: "react", seat: anna.seat, e: "😱" });

  const relayed = [];
  for (let i = 0; i < 4; i++) relayed.push(await anna.socket.next());
  expect(relayed.map((message) => message.t === "react" && message.e)).toEqual(["👏", "👏", "😂", "😱"]);
});

test("no Reaction is relayed in voting or results, or with no Current Round", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const tapper = await phone(claim);
  await step(host, { t: "start" });
  await step(host, { t: "end-early" });

  await step(host, { t: "open-voting" });
  tapper.send({ t: "react", seat: anna.seat, e: "🔥" });
  await step(host, { t: "close-voting" });
  tapper.send({ t: "react", seat: anna.seat, e: "🔥" });
  await step(host, { t: "make-current", roundId: null });
  tapper.send({ t: "react", seat: anna.seat, e: "🔥" });

  await expect(anna.socket.next(500)).rejects.toThrow(NOTHING);
});

test("no Reaction reaches an unknown seat or a laptop on another Round's Roster", async () => {
  const { claim, host } = await heatUpNext();
  const finn = await laptop(claim, host, FINAL);
  const tapper = await phone(claim);

  tapper.send({ t: "react", seat: finn.seat, e: "🔥" });
  tapper.send({ t: "react", seat: "nobody", e: "🔥" });
  tapper.send({ t: "react", e: "🔥" });

  await expect(finn.socket.next(500)).rejects.toThrow(NOTHING);
});

test("a Reaction for a laptop that is offline is lost, not queued for when it comes back", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const tapper = await phone(claim);
  anna.socket.close();
  for (;;) if ((await host.next()).t === "roster") break;

  tapper.send({ t: "react", seat: anna.seat, e: "🔥" });
  const back = await connect(worker, claim.joinCode, "contestant");
  back.send({ t: "presence", token: claim.contestantToken, roundId: HEAT_1, seat: anna.seat, name: "Anna", revision: "1-202610121403" });

  await expect(back.next(500)).rejects.toThrow(NOTHING);
});

test("only the four emoji are relayed", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const tapper = await phone(claim);

  for (const e of ["💩", "🔥🔥", "", "fire", 1, null, "<script>"]) tapper.send({ t: "react", seat: anna.seat, e });
  tapper.send({ t: "react", seat: anna.seat, e: "😱" });

  expect(await anna.socket.next()).toEqual({ v: V, t: "react", seat: anna.seat, e: "😱" });
  await expect(anna.socket.next(500)).rejects.toThrow(NOTHING);
});

test("only phones send Reactions", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const stage = await connect(worker, claim.joinCode, "stage");
  const bo = await laptop(claim, host);

  for (const socket of [stage, bo.socket, host]) socket.send({ t: "react", seat: anna.seat, e: "🔥" });

  await expect(anna.socket.next(500)).rejects.toThrow(NOTHING);
});

test("phones see which Roster entries are connected, as laptops come and go", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const tapper = await connect(worker, claim.joinCode, "phone");
  tapper.send({ t: "follow" });
  expect(await tapper.next()).toMatchObject({ roster: [{ id: anna.seat, name: "Anna", online: true }] });

  anna.socket.close();

  expect(await tapper.next()).toMatchObject({ roster: [{ id: anna.seat, name: "Anna", online: false }] });
});

test("an entry added by hand shows as such on phones, and gets no Reactions", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  host.send({ t: "add-by-hand", roundId: HEAT_1, name: "Cleo" });
  let cleo: string | undefined;
  while (!cleo) {
    const message = await host.next();
    if (message.t === "roster") cleo = message.roster.entries.find((entry) => entry.name === "Cleo")?.seat;
  }
  const tapper = await connect(worker, claim.joinCode, "phone");
  tapper.send({ t: "follow" });
  expect(await tapper.next()).toMatchObject({
    roster: [
      { id: anna.seat, online: true },
      { id: cleo, name: "Cleo", online: false, handAdded: true },
    ],
  });

  tapper.send({ t: "react", seat: cleo, e: "🔥" });

  await expect(anna.socket.next(500)).rejects.toThrow(NOTHING);
});

test("a laptop whose entry the Host removed gets no more Reactions", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const tapper = await phone(claim);
  host.send({ t: "remove-entry", roundId: HEAT_1, seat: anna.seat });
  for (;;) if ((await host.next()).t === "roster") break;

  tapper.send({ t: "react", seat: anna.seat, e: "🔥" });

  await expect(anna.socket.next(500)).rejects.toThrow(NOTHING);
});

test("phones see a laptop go offline when it moves to another Round", async () => {
  const { claim, host } = await heatUpNext();
  const anna = await laptop(claim, host);
  const tapper = await connect(worker, claim.joinCode, "phone");
  tapper.send({ t: "follow" });
  await tapper.next();

  anna.socket.send({ t: "presence", token: claim.contestantToken, roundId: FINAL, seat: anna.seat, name: "Anna", revision: "1-202610121403" });

  expect(await tapper.next()).toMatchObject({ roster: [{ id: anna.seat, online: false }] });
});
