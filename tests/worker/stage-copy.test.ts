// A Round's Stage copy: a small copy of its Reference that prep keeps on the Worker, given out
// only while that Round is current and voting.

import { afterAll, beforeAll, expect, test } from "vitest";
import { STAGE_COPY_LIMIT, V, type Claim, type LifecycleCommand } from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const IMAGE = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";

async function host(claim: Claim): Promise<TestSocket> {
  const socket = await connect(worker, claim.joinCode, "host");
  socket.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  expect(await socket.next()).toMatchObject({ t: "competition" });
  return socket;
}

async function stage(claim: Claim): Promise<TestSocket> {
  const socket = await connect(worker, claim.joinCode, "stage");
  socket.send({ t: "follow" });
  expect(await socket.next()).toMatchObject({ t: "public" });
  return socket;
}

/** Sends a lifecycle command that must be a transition. */
async function step(socket: TestSocket, command: LifecycleCommand) {
  socket.send(command);
  expect(await socket.next()).toMatchObject({ t: "lifecycle" });
}

/** Sets a Round's copy, which every Host hears as the copies the Worker now holds. */
async function setCopy(desk: TestSocket, roundId: string, fingerprint = "fp-1", image = IMAGE) {
  desk.send({ t: "set-stage-copy", roundId, fingerprint, image });
  return desk.next();
}

/** Puts a Round at voting. */
async function toVoting(desk: TestSocket, roundId: string) {
  await step(desk, { t: "make-current", roundId });
  await step(desk, { t: "start" });
  await step(desk, { t: "end-early" });
  await step(desk, { t: "open-voting" });
}

test("a Host sets and clears a Round's copy, and every Host hears the fingerprints the Worker holds", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  const other = await host(claim);

  expect(await setCopy(desk, "heat1aaaaa")).toEqual({ v: V, t: "stage-copies", stageCopies: { heat1aaaaa: "fp-1" } });
  expect(await other.next()).toEqual({ v: V, t: "stage-copies", stageCopies: { heat1aaaaa: "fp-1" } });

  desk.send({ t: "clear-stage-copy", roundId: "heat1aaaaa" });
  expect(await desk.next()).toEqual({ v: V, t: "stage-copies", stageCopies: {} });
});

test("a Host's snapshot says which copies the Worker holds, by Round id", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  await setCopy(desk, "heat2aaaaa", "fp-2");

  const later = await connect(worker, claim.joinCode, "host");
  later.send({ t: "host", hostSecret: claim.hostSecret });

  expect(await later.next()).toMatchObject({ t: "competition", stageCopies: { heat2aaaaa: "fp-2" } });
});

test("only a Host sets or clears a copy", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  const intruder = await connect(worker, claim.joinCode, "host");
  const screen = await stage(claim);

  intruder.send({ t: "set-stage-copy", roundId: "heat1aaaaa", fingerprint: "x", image: IMAGE });
  expect(await intruder.next()).toEqual({
    v: V,
    t: "refused",
    command: "set-stage-copy",
    reason: "host-secret",
    roundId: "heat1aaaaa",
  });
  screen.send({ t: "clear-stage-copy", roundId: "heat1aaaaa" });
  expect(await screen.next()).toEqual({
    v: V,
    t: "refused",
    command: "clear-stage-copy",
    reason: "host-secret",
    roundId: "heat1aaaaa",
  });
  await expect(desk.next(300)).rejects.toThrow(/No message/);
});

test("a copy that isn't an image data: URI, or is over the limit, is refused", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);

  for (const image of ["data:text/html;base64,PGgxPg==", "https://example.com/reference.png", 42]) {
    desk.send({ t: "set-stage-copy", roundId: "heat1aaaaa", fingerprint: "fp", image });
    expect(await desk.next()).toEqual({
      v: V,
      t: "refused",
      command: "set-stage-copy",
      reason: "not-image",
      roundId: "heat1aaaaa",
    });
  }
  const huge = `data:image/jpeg;base64,${"A".repeat(STAGE_COPY_LIMIT)}`;
  desk.send({ t: "set-stage-copy", roundId: "heat1aaaaa", fingerprint: "fp", image: huge });
  expect(await desk.next()).toEqual({
    v: V,
    t: "refused",
    command: "set-stage-copy",
    reason: "too-large",
    roundId: "heat1aaaaa",
  });
});

test("a copy for a Round the Worker doesn't list is refused", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);

  desk.send({ t: "set-stage-copy", roundId: "nosuchround", fingerprint: "fp", image: IMAGE });

  expect(await desk.next()).toEqual({
    v: V,
    t: "refused",
    command: "set-stage-copy",
    reason: "invalid",
    roundId: "nosuchround",
  });
});

test("the copy is given out only while its Round is current and voting, whoever asks", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  await setCopy(desk, "heat1aaaaa");
  await setCopy(desk, "heat2aaaaa", "fp-2");
  const screen = await stage(claim);
  const phone = await connect(worker, claim.joinCode, "phone");
  const ask = (socket: TestSocket, roundId: string) => socket.send({ t: "ask-stage-copy", roundId });

  // At the welcome screen, then while the Round is up next and running.
  ask(screen, "heat1aaaaa");
  await step(desk, { t: "make-current", roundId: "heat1aaaaa" });
  await screen.next();
  ask(screen, "heat1aaaaa");
  await step(desk, { t: "start" });
  await screen.next();
  ask(screen, "heat1aaaaa");
  await step(desk, { t: "end-early" });
  await screen.next();
  await step(desk, { t: "open-voting" });
  await screen.next();
  // Another Round than the current one, while voting.
  ask(screen, "heat2aaaaa");
  ask(screen, "heat1aaaaa");

  expect(await screen.next()).toEqual({ v: V, t: "stage-copy", roundId: "heat1aaaaa", image: IMAGE });
  await expect(screen.next(300)).rejects.toThrow(/No message/);
  // The Worker doesn't tell phones apart from the Stage: the voting-only gate is the protection.
  ask(phone, "heat1aaaaa");
  expect(await phone.next()).toMatchObject({ t: "stage-copy", roundId: "heat1aaaaa" });

  await step(desk, { t: "close-voting" });
  await screen.next();
  ask(screen, "heat1aaaaa");
  await expect(screen.next(300)).rejects.toThrow(/No message/);
});

test("the copy never rides on the public snapshot", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  await setCopy(desk, "heat1aaaaa");
  const screen = await stage(claim);

  await toVoting(desk, "heat1aaaaa");
  for (let i = 0; i < 4; i++) expect(JSON.stringify(await screen.next())).not.toContain(IMAGE);
});

test("a Round with no copy gives nothing while voting", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  await setCopy(desk, "heat1aaaaa");
  desk.send({ t: "clear-stage-copy", roundId: "heat1aaaaa" });
  await desk.next();
  await toVoting(desk, "heat1aaaaa");
  const screen = await stage(claim);

  screen.send({ t: "ask-stage-copy", roundId: "heat1aaaaa" });

  await expect(screen.next(300)).rejects.toThrow(/No message/);
});

test("a copy survives a Durable Object restart", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  await setCopy(desk, "finalaaaaa", "fp-final");
  await toVoting(desk, "finalaaaaa");

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  const later = await connect(worker, claim.joinCode, "host");
  later.send({ t: "host", hostSecret: claim.hostSecret });
  expect(await later.next()).toMatchObject({ t: "competition", stageCopies: { finalaaaaa: "fp-final" } });
  const screen = await stage(claim);
  screen.send({ t: "ask-stage-copy", roundId: "finalaaaaa" });
  expect(await screen.next()).toEqual({ v: V, t: "stage-copy", roundId: "finalaaaaa", image: IMAGE });
});

test("a copy set while its Round is voting reaches the Stages following it, and no phone", async () => {
  const claim = newClaim("SC");
  const desk = await host(claim);
  await toVoting(desk, "heat1aaaaa");
  const screen = await stage(claim);
  const phone = await connect(worker, claim.joinCode, "phone");
  phone.send({ t: "follow" });
  await phone.next();

  await setCopy(desk, "heat1aaaaa");
  await setCopy(desk, "heat2aaaaa", "fp-2");

  expect(await screen.next()).toEqual({ v: V, t: "stage-copy", roundId: "heat1aaaaa", image: IMAGE });
  await expect(screen.next(300)).rejects.toThrow(/No message/);
  await expect(phone.next(300)).rejects.toThrow(/No message/);
});
