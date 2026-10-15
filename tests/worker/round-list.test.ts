// Rounds added or renamed in prep after the claim: the Host console link presents its Round list,
// and the Worker keeps the newest one.

import { afterAll, beforeAll, expect, test } from "vitest";
import type { Claim, RoundRef } from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

/** A claimed Competition, from a link without a Round-list time stamp, and its Host socket. */
async function claimed(): Promise<{ claim: Claim; host: TestSocket }> {
  const claim = newClaim("RN");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await host.next();
  return { claim, host };
}

/** The claim's Rounds with a Heat 3 added and the Final renamed. */
const grown = (claim: Claim): RoundRef[] => [
  ...claim.rounds.slice(0, 2),
  { id: "heat3aaaaa", name: "Heat 3" },
  { id: "finalaaaaa", name: "Grand Final" },
];

/** A Host socket opening a link with this Round list and time stamp. */
async function openLink(claim: Claim, rounds: RoundRef[], roundsChangedAt?: number) {
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "host", hostSecret: claim.hostSecret, rounds, roundsChangedAt });
  return host;
}

test("a newer Round list replaces the stored one, reaches every Host and the Stage, and its new Round can be made current", async () => {
  const { claim, host } = await claimed();
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow" });
  await stage.next();
  const phone = await connect(worker, claim.joinCode, "phone");
  phone.send({ t: "follow", voter: "voter-0000000000000001" });
  await phone.next();

  const fresh = await openLink(claim, grown(claim), 1_000);

  const rounds = grown(claim);
  expect(await fresh.next()).toMatchObject({ t: "competition", competition: { rounds } });
  expect(await host.next()).toMatchObject({ t: "competition", competition: { rounds } });
  expect(await stage.next()).toMatchObject({ t: "public", competition: { rounds } });
  expect(await phone.next()).toMatchObject({ t: "public", competition: { rounds } });
  fresh.send({ t: "make-current", roundId: "heat3aaaaa" });
  expect(await fresh.next()).toMatchObject({ t: "lifecycle", lifecycle: { current: "heat3aaaaa", phase: "upcoming" } });
});

test("an older link connecting afterwards doesn't roll the Round list back", async () => {
  const { claim, host } = await claimed();
  await openLink(claim, grown(claim), 2_000);
  await host.next();

  const older = await openLink(claim, claim.rounds, 1_000);
  const unrevised = await openLink(claim, claim.rounds);

  expect(await older.next()).toMatchObject({ t: "competition", competition: { rounds: grown(claim) } });
  expect(await unrevised.next()).toMatchObject({ t: "competition", competition: { rounds: grown(claim) } });
  await expect(host.next(500)).rejects.toThrow("No message");
});

test("a newer list without the Current Round is refused, and the Host is in with the stored list", async () => {
  const { claim, host } = await claimed();
  host.send({ t: "make-current", roundId: "heat2aaaaa" });
  await host.next();

  const without = await openLink(claim, [{ id: "heat1aaaaa", name: "Heat 1" }], 1_000);

  expect(await without.next()).toMatchObject({ t: "competition", competition: { rounds: claim.rounds } });
  expect(await without.next()).toEqual({ v: 1, t: "rounds-refused", reason: "current-round", roundId: "heat2aaaaa" });
  without.send({ t: "make-current", roundId: "finalaaaaa" });
  expect(await without.next()).toMatchObject({ t: "lifecycle", lifecycle: { current: "finalaaaaa" } });
});

test("a link with another Host secret is refused, and its Round list isn't taken", async () => {
  const { claim } = await claimed();

  const rival = await openLink({ ...claim, hostSecret: "another-secret" }, grown(claim), 1_000);

  expect(await rival.next()).toEqual({ v: 1, t: "host-refused" });
  const later = await openLink(claim, claim.rounds);
  expect(await later.next()).toMatchObject({ t: "competition", competition: { rounds: claim.rounds } });
});

test("the updated Round list and its time stamp survive a Durable Object restart", async () => {
  const { claim, host } = await claimed();
  await openLink(claim, grown(claim), 2_000);
  await host.next();

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  const back = await openLink(claim, claim.rounds, 1_000);
  expect(await back.next()).toMatchObject({ t: "competition", competition: { rounds: grown(claim) } });
});
