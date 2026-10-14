// The Audience phone follows the Current Round like the Stage: joined with the Join code
// alone, with no name or account.

import { afterAll, beforeAll, expect, test } from "vitest";
import { CLOSE_VERSION, V, type Claim, type LifecycleCommand, type ServerMessage } from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const HEAT_1 = "heat1aaaaa";

/** A phone on the Join code, past the Worker's first answer. */
async function phone(claim: Claim): Promise<{ socket: TestSocket; first: ServerMessage }> {
  const socket = await connect(worker, claim.joinCode, "phone");
  socket.send({ t: "follow" });
  return { socket, first: await socket.next() };
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

test("a phone on a code nobody has claimed waits, and the claim brings it in, with no secrets", async () => {
  const claim = newClaim("PH");
  const { socket, first } = await phone(claim);
  expect(first).toEqual({ v: V, t: "unclaimed" });

  await host(claim);

  const snapshot = await socket.next();
  expect(snapshot).toMatchObject({ t: "public", competition: { name: "Gothenburg 2026" }, lifecycle: { current: null } });
  for (const secret of [claim.hostSecret, claim.contestantToken]) expect(JSON.stringify(snapshot)).not.toContain(secret);
});

test("every phone follows the Round as the Host moves it on, and none can move it", async () => {
  const claim = newClaim("PH");
  const hostSocket = await host(claim);
  const phones = [(await phone(claim)).socket, (await phone(claim)).socket];

  await step(hostSocket, { t: "make-current", roundId: HEAT_1 });
  for (const socket of phones) {
    expect(await socket.next()).toMatchObject({ t: "public", lifecycle: { current: HEAT_1, phase: "upcoming" }, roster: [] });
  }
  await step(hostSocket, { t: "start" });
  for (const socket of phones) expect(await socket.next()).toMatchObject({ lifecycle: { phase: "running" } });

  phones[0]!.send({ t: "end-early" });
  expect(await phones[0]!.next()).toEqual({ v: V, t: "refused", command: "end-early", reason: "host-secret" });
});

test("after a Durable Object restart, a phone reconnects to the same snapshot", async () => {
  const claim = newClaim("PH");
  const hostSocket = await host(claim);
  await step(hostSocket, { t: "make-current", roundId: HEAT_1 });
  await step(hostSocket, { t: "start" });
  const { socket, first } = await phone(claim);

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  expect(await socket.closed).not.toBe(CLOSE_VERSION);
  expect((await phone(claim)).first).toEqual(first);
});
