// The Round lifecycle: every transition in the spec's table, and every other one refused.

import { afterAll, beforeAll, expect, test } from "vitest";
import { connectSocket } from "../../src/enhancement/socket.ts";
import {
  CLOSE_VERSION,
  DEFAULT_DURATION_MS,
  socketPath,
  V,
  type Claim,
  type Lifecycle,
  type LifecycleCommand,
  type Phase,
  type ServerMessage,
} from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const HEAT_1 = "heat1aaaaa";
const HEAT_2 = "heat2aaaaa";

/** A claimed Competition and a Host socket on it, past the snapshot. */
async function claimed(): Promise<{ claim: Claim; host: TestSocket; snapshot: ServerMessage }> {
  const claim = newClaim("RD");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  return { claim, host, snapshot: await host.next() };
}

/** Another Host socket on a claimed Competition, past the snapshot. */
async function anotherHost(claim: Claim) {
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "host", hostSecret: claim.hostSecret });
  const snapshot = await host.next();
  return { host, snapshot };
}

/** Sends a lifecycle command and returns what the Worker answers. */
async function command(host: TestSocket, message: LifecycleCommand) {
  host.send(message);
  return host.next();
}

/** Sends a command that must be a transition, and returns the new lifecycle. */
async function step(host: TestSocket, message: LifecycleCommand): Promise<Lifecycle> {
  const answer = await command(host, message);
  if (answer.t !== "lifecycle") throw new Error(`${message.t} was answered with ${JSON.stringify(answer)}`);
  return answer.lifecycle;
}

/** The commands that bring Heat 1 from the welcome screen to each phase. */
const PATH: Record<Phase, LifecycleCommand[]> = {
  upcoming: [{ t: "make-current", roundId: HEAT_1 }],
  running: [{ t: "make-current", roundId: HEAT_1 }, { t: "start" }],
  timesup: [{ t: "make-current", roundId: HEAT_1 }, { t: "start" }, { t: "end-early" }],
  voting: [{ t: "make-current", roundId: HEAT_1 }, { t: "start" }, { t: "end-early" }, { t: "open-voting" }],
  results: [
    { t: "make-current", roundId: HEAT_1 },
    { t: "start" },
    { t: "end-early" },
    { t: "open-voting" },
    { t: "close-voting" },
  ],
};

async function at(phase: Phase | "welcome") {
  const competition = await claimed();
  let lifecycle = (competition.snapshot as Extract<ServerMessage, { t: "competition" }>).lifecycle;
  for (const message of phase === "welcome" ? [] : PATH[phase]) lifecycle = await step(competition.host, message);
  return { ...competition, lifecycle };
}

test("a claimed Competition starts on the welcome screen, with a 15 min duration", async () => {
  const { snapshot } = await claimed();

  expect(snapshot).toMatchObject({
    t: "competition",
    lifecycle: { current: null, phase: null, durationMs: 15 * 60_000, endsAt: null },
  });
  expect(DEFAULT_DURATION_MS).toBe(15 * 60_000);
});

test("any Round can be made current in any order, and cleared to the welcome screen; every Host sees it", async () => {
  const { claim, host } = await claimed();
  const { host: other } = await anotherHost(claim);

  const final = await step(host, { t: "make-current", roundId: "finalaaaaa" });
  expect(final).toEqual({ current: "finalaaaaa", phase: "upcoming", durationMs: DEFAULT_DURATION_MS, endsAt: null });
  expect(await other.next()).toEqual({ v: V, t: "lifecycle", lifecycle: final });

  expect(await step(host, { t: "make-current", roundId: HEAT_2 })).toMatchObject({ current: HEAT_2, phase: "upcoming" });
  expect(await step(host, { t: "make-current", roundId: HEAT_1 })).toMatchObject({ current: HEAT_1, phase: "upcoming" });
  expect(await step(host, { t: "make-current", roundId: null })).toEqual({
    current: null,
    phase: null,
    durationMs: DEFAULT_DURATION_MS,
    endsAt: null,
  });
});

test("the duration is set while up next, and kept from Round to Round", async () => {
  const { host } = await at("upcoming");

  expect(await step(host, { t: "set-duration", durationMs: 20 * 60_000 })).toMatchObject({ durationMs: 20 * 60_000 });
  await step(host, { t: "make-current", roundId: HEAT_2 });
  const { durationMs } = await step(host, { t: "make-current", roundId: null });
  expect(durationMs).toBe(20 * 60_000);
});

test("a duration that isn't whole seconds between 1 s and 90 min is refused", async () => {
  const { host } = await at("upcoming");

  for (const durationMs of [0, -60_000, 1500, 90 * 60_000 + 1000, Number.NaN, "900000"]) {
    expect(await command(host, { t: "set-duration", durationMs } as LifecycleCommand)).toEqual({
      v: V,
      t: "refused",
      command: "set-duration",
      reason: "transition",
    });
  }
  expect(await step(host, { t: "set-duration", durationMs: 90 * 60_000 })).toMatchObject({ durationMs: 90 * 60_000 });
});

test("Start runs the Round until now + duration; time is added only while running", async () => {
  const { host } = await at("upcoming");
  await step(host, { t: "set-duration", durationMs: 10 * 60_000 });

  const before = Date.now();
  const running = await step(host, { t: "start" });
  expect(running).toMatchObject({ current: HEAT_1, phase: "running", durationMs: 10 * 60_000 });
  expect(running.endsAt).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
  expect(running.endsAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000 + 1000);

  expect((await step(host, { t: "add-time", ms: 30_000 })).endsAt).toBe(running.endsAt! + 30_000);
  expect((await step(host, { t: "add-time", ms: 60_000 })).endsAt).toBe(running.endsAt! + 90_000);
  expect(await command(host, { t: "add-time", ms: 45_000 } as unknown as LifecycleCommand)).toMatchObject({
    t: "refused",
    command: "add-time",
  });
});

test("End early, voting, results, reopening and the re-run path", async () => {
  const { host } = await at("running");

  expect(await step(host, { t: "end-early" })).toMatchObject({ current: HEAT_1, phase: "timesup", endsAt: null });
  expect(await step(host, { t: "back-to-up-next" })).toMatchObject({ phase: "upcoming", endsAt: null });
  await step(host, { t: "start" });
  await step(host, { t: "end-early" });
  expect(await step(host, { t: "open-voting" })).toMatchObject({ phase: "voting" });
  expect(await step(host, { t: "close-voting" })).toMatchObject({ phase: "results" });
  expect(await step(host, { t: "reopen-voting" })).toMatchObject({ phase: "voting" });
  await step(host, { t: "close-voting" });
  expect(await step(host, { t: "back-to-up-next" })).toMatchObject({ current: HEAT_1, phase: "upcoming", endsAt: null });
});

test.each(["upcoming", "running", "timesup", "voting", "results"] as const)(
  "from %s, another Round can be made current, or the Stage cleared, and the timer is dropped",
  async (phase) => {
    const { host } = await at(phase);

    expect(await step(host, { t: "make-current", roundId: HEAT_2 })).toMatchObject({
      current: HEAT_2,
      phase: "upcoming",
      endsAt: null,
    });
    await step(host, { t: "make-current", roundId: HEAT_1 });
    for (const message of PATH[phase].slice(1)) await step(host, message);
    expect(await step(host, { t: "make-current", roundId: null })).toMatchObject({ current: null, endsAt: null });
  },
);

/** Every command, and the phases each one is a transition from. Making another Round current is
 * allowed everywhere, so it's covered above. */
const ALLOWED_FROM: [LifecycleCommand, (Phase | "welcome")[]][] = [
  [{ t: "make-current", roundId: HEAT_1 }, ["welcome"]],
  [{ t: "make-current", roundId: null }, ["upcoming", "running", "timesup", "voting", "results"]],
  [{ t: "set-duration", durationMs: 60_000 }, ["upcoming"]],
  [{ t: "start" }, ["upcoming"]],
  [{ t: "add-time", ms: 30_000 }, ["running"]],
  [{ t: "add-time", ms: 60_000 }, ["running"]],
  [{ t: "end-early" }, ["running"]],
  [{ t: "open-voting" }, ["timesup"]],
  [{ t: "close-voting" }, ["voting"]],
  [{ t: "reopen-voting" }, ["results"]],
  [{ t: "back-to-up-next" }, ["timesup", "results"]],
];

test.each(["welcome", "upcoming", "running", "timesup", "voting", "results"] as const)(
  "from %s, every command that isn't a transition is refused and changes nothing",
  async (phase) => {
    const { claim, host, lifecycle } = await at(phase);
    const { host: other } = await anotherHost(claim);

    for (const [message, from] of ALLOWED_FROM) {
      if (from.includes(phase)) continue;
      expect(await command(host, message), `${message.t} from ${phase}`).toEqual({
        v: V,
        t: "refused",
        command: message.t,
        reason: "transition",
      });
    }
    expect(await command(host, { t: "make-current", roundId: "not-a-round" })).toMatchObject({ t: "refused" });

    // The other Host heard nothing, and a fresh snapshot shows the same lifecycle.
    const { snapshot } = await anotherHost(claim);
    expect(snapshot).toMatchObject({ t: "competition", lifecycle });
    other.send({ t: "host", hostSecret: claim.hostSecret });
    expect(await other.next()).toMatchObject({ t: "competition", lifecycle });
  },
);

test("lifecycle commands without the Host secret are refused", async () => {
  const { claim, host, lifecycle } = await at("running");
  const stranger = await connect(worker, claim.joinCode, "host");
  const wrong = await connect(worker, claim.joinCode, "host");
  wrong.send({ t: "host", hostSecret: "not-the-secret" });
  expect(await wrong.next()).toEqual({ v: V, t: "host-refused" });
  const phone = await connect(worker, claim.joinCode, "phone");

  for (const socket of [stranger, wrong, phone]) {
    for (const message of [{ t: "end-early" }, { t: "make-current", roundId: null }] as LifecycleCommand[]) {
      expect(await command(socket, message)).toEqual({ v: V, t: "refused", command: message.t, reason: "host-secret" });
    }
  }
  host.send({ t: "host", hostSecret: claim.hostSecret });
  expect(await host.next()).toMatchObject({ t: "competition", lifecycle });
});

test("reaching endsAt moves the Round to time's up, for every Host", async () => {
  const { claim, host } = await at("upcoming");
  const { host: other } = await anotherHost(claim);
  await step(host, { t: "set-duration", durationMs: 1000 });
  await other.next();

  const { endsAt } = await step(host, { t: "start" });
  await other.next();

  for (const socket of [host, other]) {
    expect(await socket.next(5000)).toEqual({
      v: V,
      t: "lifecycle",
      lifecycle: { current: HEAT_1, phase: "timesup", durationMs: 1000, endsAt: null },
    });
  }
  expect(Date.now()).toBeGreaterThanOrEqual(endsAt!);
});

test("time added after the alarm was set moves time's up later", async () => {
  const { host } = await at("upcoming");
  await step(host, { t: "set-duration", durationMs: 1000 });
  const { endsAt } = await step(host, { t: "start" });

  await step(host, { t: "add-time", ms: 30_000 });

  await expect(host.next(Math.max(0, endsAt! - Date.now()) + 1500)).rejects.toThrow(/No message/);
});

test("a Durable Object restart mid-Round restores the Current Round, phase and endsAt, and the alarm still fires", async () => {
  const { claim, host } = await at("upcoming");
  await step(host, { t: "make-current", roundId: HEAT_2 });
  await step(host, { t: "set-duration", durationMs: 3000 });
  const running = await step(host, { t: "start" });

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  expect(await host.closed).not.toBe(CLOSE_VERSION);
  const { host: back, snapshot } = await anotherHost(claim);
  expect(snapshot).toMatchObject({ t: "competition", lifecycle: running });
  expect(await back.next(5000)).toMatchObject({ t: "lifecycle", lifecycle: { current: HEAT_2, phase: "timesup" } });
});

test("a client reconnects within the backoff ceiling after a Durable Object restart, and gets the snapshot", async () => {
  const { claim, host } = await at("running");
  const { url } = await worker.listen();
  const snapshots: ServerMessage[] = [];
  let opened = 0;
  const client = connectSocket(new URL(socketPath(claim.joinCode, "host"), url.href.replace(/^http/, "ws")).href, {
    open() {
      opened++;
      client.send({ v: V, t: "host", hostSecret: claim.hostSecret });
    },
    message: (message) => snapshots.push(message as ServerMessage),
  });
  await expect.poll(() => snapshots.length).toBe(1);

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });
  await host.closed;

  // The first retry comes within 2 s; the ceiling is 30 s.
  await expect.poll(() => snapshots.length, { timeout: 30_000 }).toBe(2);
  client.close();
  expect(opened).toBe(2);
  expect(snapshots[1]).toEqual(snapshots[0]);
  expect(snapshots[1]).toMatchObject({ lifecycle: { current: HEAT_1, phase: "running" } });
}, 35_000);
