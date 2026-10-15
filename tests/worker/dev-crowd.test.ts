// `npm run dev:crowd` against the Worker in workerd.

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  addRound,
  claimOf,
  newCompetition,
  updateAudience,
  updateRound,
  type Competition,
  type Round,
} from "../../src/pages/prep/competition.ts";
import { isStale, type LifecycleCommand, type Roster, type ServerMessage } from "../../src/protocol/protocol.ts";
import { runCrowd, type CrowdOptions } from "../../scripts/dev-crowd.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const FAST = { reactEvery: [10, 30], voteAfter: [10, 80] } satisfies CrowdOptions["timing"];

/** A Competition with two Heats and a Final, Heat 1 exported twice, and its own Join code. */
function competition(): Competition {
  const { joinCode, hostSecret, contestantToken } = newClaim("CR");
  let competition = newCompetition();
  for (const [kind, id] of [["heat", "heat1aaaaa"], ["heat", "heat2aaaaa"], ["final", "finalaaaaa"]] as const) {
    competition = addRound(competition, kind, id);
  }
  competition = updateRound(competition, "heat1aaaaa", (round) => ({
    ...round,
    revisions: [
      { n: 1, stamp: "1-202610121403", fingerprint: "a" },
      { n: 2, stamp: "2-202610131000", fingerprint: "b" },
    ],
  }));
  return updateAudience(competition, { enabled: true, joinCode, hostSecret, contestantToken });
}

const roundOf = (competition: Competition, id: string): Round => competition.rounds.find((round) => round.id === id)!;

/** Reads a socket's messages until one of type `t` that passes `test` arrives, skipping the others. */
async function until<T extends ServerMessage["t"]>(
  socket: TestSocket,
  t: T,
  test: (message: Extract<ServerMessage, { t: T }>) => boolean = () => true,
): Promise<Extract<ServerMessage, { t: T }>> {
  for (;;) {
    const message = await socket.next(5000);
    if (message.t === t && test(message as Extract<ServerMessage, { t: T }>)) return message as Extract<ServerMessage, { t: T }>;
  }
}

/** Claims the Competition and returns a Host socket past the snapshot. */
async function claimed(competition: Competition): Promise<TestSocket> {
  const host = await connect(worker, competition.audience.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim: claimOf(competition) });
  await until(host, "competition");
  return host;
}

async function crowd(competition: Competition, options: Partial<CrowdOptions> = {}) {
  const { url } = await worker.listen();
  return runCrowd({
    competition,
    round: roundOf(competition, "heat1aaaaa"),
    contestants: 0,
    phones: 0,
    stale: 0,
    workerUrl: url.origin,
    timing: FAST,
    ...options,
  });
}

const onlineIn = (roster: Roster) => roster.entries.filter((entry) => entry.online).length;

async function step(host: TestSocket, command: LifecycleCommand) {
  host.send(command);
  await until(host, "lifecycle");
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("the fake Contestants join the Round's Roster, one of them stale, and go offline when stopped", async () => {
  const fakes = competition();
  const host = await claimed(fakes);

  const running = await crowd(fakes, { contestants: 3, stale: 1 });
  const { roster } = await until(host, "roster", ({ roundId, roster }) => roundId === "heat1aaaaa" && onlineIn(roster) === 3);
  expect(roster.entries.filter((entry) => isStale(entry, roster))).toHaveLength(1);
  expect(roster.newest).toBe("2-202610131000");
  expect(running.stats).toMatchObject({ online: 3, contestants: 3 });

  await running.stop();
  const after = await until(host, "roster", ({ roster }) => onlineIn(roster) === 0);
  expect(after.roster.entries).toHaveLength(3);
});

test("a restart comes back as the same Roster entries", async () => {
  const fakes = competition();
  const host = await claimed(fakes);

  await (await crowd(fakes, { contestants: 2 })).stop();
  const again = await crowd(fakes, { contestants: 2 });
  const { roster } = await until(host, "roster", ({ roster }) => onlineIn(roster) === 2);
  expect(roster.entries).toHaveLength(2);
  await again.stop();
});

test("--round puts the fakes on the chosen Round", async () => {
  const fakes = competition();
  const host = await claimed(fakes);

  const running = await crowd(fakes, { contestants: 1, round: roundOf(fakes, "finalaaaaa") });
  const { roster } = await until(host, "roster", ({ roundId }) => roundId === "finalaaaaa");
  expect(roster.entries).toHaveLength(1);
  // A Round never exported gets a made-up Revision.
  expect(roster.newest).toMatch(/^1-\d{12}$/);
  await running.stop();
});

test("the phones react to a real laptop while the phase allows it, then each votes once", async () => {
  const fakes = competition();
  const host = await claimed(fakes);
  const laptop = await connect(worker, fakes.audience.joinCode, "contestant");
  const seat = "real-laptop";
  laptop.send({ t: "presence", token: fakes.audience.contestantToken, roundId: "heat1aaaaa", seat, name: "Real", revision: "2-202610131000" });
  await step(host, { t: "make-current", roundId: "heat1aaaaa" });

  const running = await crowd(fakes, { contestants: 2, phones: 4 });
  // Reactions only go to laptops, and a fake Contestant isn't one this test can see.
  expect(await until(laptop, "react")).toMatchObject({ seat });

  for (const command of [{ t: "start" }, { t: "end-early" }, { t: "open-voting" }] as const) await step(host, command);
  await pause(100);
  const reactions = running.stats.reactions;
  const { tally } = await until(host, "tally", ({ tally }) => Object.values(tally).reduce((a, b) => a + b, 0) === 4);
  await pause(300);
  expect(running.stats.reactions).toBe(reactions);
  expect(running.stats.votes).toBe(4);
  expect(running.stats.phase).toBe("voting");
  expect(Object.keys(tally).every((voted) => voted === seat || voted.startsWith("crowd-"))).toBe(true);

  await running.stop();
  laptop.close();
});

test("a phone whose Vote goes with its entry votes again", async () => {
  const fakes = competition();
  const host = await claimed(fakes);
  const running = await crowd(fakes, { contestants: 2, phones: 1, random: () => 0 });
  await until(host, "roster", ({ roster }) => onlineIn(roster) === 2);
  await step(host, { t: "make-current", roundId: "heat1aaaaa" });
  for (const command of [{ t: "start" }, { t: "end-early" }, { t: "open-voting" }] as const) await step(host, command);

  const [first] = Object.keys((await until(host, "tally", ({ tally }) => Object.keys(tally).length === 1)).tally);
  host.send({ t: "remove-entry", roundId: "heat1aaaaa", seat: first! });
  const { tally } = await until(host, "tally", ({ tally }) => Object.keys(tally).length === 1 && !(first! in tally));
  expect(Object.values(tally)).toEqual([1]);
  expect(running.stats.votes).toBe(2);
  await running.stop();
});

test("an unclaimed Competition turns the crowd away in one line", async () => {
  const fakes = competition();

  const running = await crowd(fakes, { contestants: 1, phones: 1 });
  const { url } = await worker.listen();
  expect((await running.failure).message).toBe(
    `${fakes.audience.joinCode} isn't claimed on ${url.origin}: claim it from the Host console link in prep, or make a claimed one with \`npm run dev:demo\`.`,
  );
});

test("a wrong Contestant token turns the crowd away in one line", async () => {
  const fakes = competition();
  await claimed(fakes);

  const running = await crowd(updateAudience(fakes, { contestantToken: "not-the-token" }), { contestants: 1 });
  expect((await running.failure).message).toBe(
    `The Worker refused the Contestant token for ${fakes.audience.joinCode}: is this the Competition file that was claimed?`,
  );
});

test("an unreachable Worker fails, saying to start it", async () => {
  await expect(crowd(competition(), { contestants: 1, workerUrl: "http://127.0.0.1:9" })).rejects.toThrow(
    "Couldn't reach the Worker at http://127.0.0.1:9: is `npm run worker:dev` running?",
  );
});
