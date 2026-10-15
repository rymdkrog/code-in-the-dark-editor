import { afterAll, beforeAll, expect, test } from "vitest";
import { CLOSE_VERSION, DEFAULT_DURATION_MS, PING } from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const welcome = { current: null, phase: null, durationMs: DEFAULT_DURATION_MS, endsAt: null };

test("a claim with a wrong Organizer key fails", async () => {
  const claim = newClaim("CM");
  const host = await connect(worker, claim.joinCode, "host");

  host.send({ t: "claim", organizerKey: "not-the-key", claim });

  expect(await host.next()).toEqual({ v: 1, t: "claim-refused", reason: "organizer-key" });
  host.send({ t: "host", hostSecret: claim.hostSecret });
  expect(await host.next()).toEqual({ v: 1, t: "unclaimed" });
});

test("a claim with the Organizer key binds the Join code to the Host secret", async () => {
  const claim = newClaim("CM");
  const host = await connect(worker, claim.joinCode, "host");

  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });

  const competition = { name: "Gothenburg 2026", joinCode: claim.joinCode, rounds: claim.rounds };
  const empty = { entries: [], newest: null };
  const rosters = { heat1aaaaa: empty, heat2aaaaa: empty, finalaaaaa: empty };
  const tallies = { heat1aaaaa: {}, heat2aaaaa: {}, finalaaaaa: {} };
  expect(await host.next()).toEqual({ v: 1, t: "competition", competition, lifecycle: welcome, rosters, tallies });
  const later = await connect(worker, claim.joinCode, "host");
  later.send({ t: "host", hostSecret: claim.hostSecret });
  expect(await later.next()).toEqual({ v: 1, t: "competition", competition, lifecycle: welcome, rosters, tallies });
});

test("a second claim with a different Host secret fails, even with the Organizer key", async () => {
  const claim = newClaim("CM");
  const first = await connect(worker, claim.joinCode, "host");
  first.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await first.next();

  const rival = await connect(worker, claim.joinCode, "host");
  rival.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim: { ...claim, hostSecret: "another-secret" } });

  expect(await rival.next()).toEqual({ v: 1, t: "claim-refused", reason: "claimed" });
  rival.send({ t: "host", hostSecret: "another-secret" });
  expect(await rival.next()).toEqual({ v: 1, t: "host-refused" });
});

test("the claim survives a Durable Object restart", async () => {
  const claim = newClaim("CM");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await host.next();

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  expect(await host.closed).not.toBe(CLOSE_VERSION);
  const back = await connect(worker, claim.joinCode, "host");
  back.send({ t: "host", hostSecret: claim.hostSecret });
  expect(await back.next()).toMatchObject({ t: "competition", competition: { rounds: claim.rounds } });
  back.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim: { ...claim, hostSecret: "another-secret" } });
  expect(await back.next()).toEqual({ v: 1, t: "claim-refused", reason: "claimed" });
});

test("a message with a protocol version the Worker doesn't accept closes the socket with the version code", async () => {
  const claim = newClaim("CM");
  const host = await connect(worker, claim.joinCode, "host");

  host.send(JSON.stringify({ v: 99, t: "host", hostSecret: claim.hostSecret }));

  expect(await host.closed).toBe(CLOSE_VERSION);
});

test("the Worker still accepts the previous protocol version", async () => {
  const claim = newClaim("CM");
  const host = await connect(worker, claim.joinCode, "host");

  host.send(JSON.stringify({ v: 0, t: "host", hostSecret: claim.hostSecret }));

  expect(await host.next()).toEqual({ v: 1, t: "unclaimed" });
});

test("a ping is answered with a pong", async () => {
  const host = await connect(worker, newClaim("CM").joinCode, "host");

  host.send(PING);

  expect(await host.next()).toEqual({ v: 1, t: "pong" });
});

test("every role connects with Origin: null, as a file:// page does; other paths aren't sockets", async () => {
  const { joinCode } = newClaim("CM");
  for (const role of ["host", "stage", "phone", "contestant"] as const) {
    const socket = await connect(worker, joinCode, role, { Origin: "null" });
    socket.send(PING);
    expect(await socket.next()).toEqual({ v: 1, t: "pong" });
  }

  const upgrade = { headers: { Upgrade: "websocket" } };
  expect((await worker.fetch(`/socket/${joinCode}/judge`, upgrade)).status).toBe(404);
  expect((await worker.fetch("/socket/K0XQ2N/host", upgrade)).status).toBe(404);
  expect((await worker.fetch(`/socket/${joinCode}/host`)).status).toBe(426);
});
