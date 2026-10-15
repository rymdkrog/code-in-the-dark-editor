// Voting: after the Reveals, every phone picks one entry on the Current Round's Roster. The
// Durable Object keeps one Vote per voter id per Round, the last one wins, and only while voting.
// Hosts see the live tally, phones and the Stage only the turnout, and the Stage the counts at
// results.

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  CLOSE_VERSION,
  V,
  type Claim,
  type LifecycleCommand,
  type Phase,
  type Presence,
  type ServerMessage,
} from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const HEAT_1 = "heat1aaaaa";
const HEAT_2 = "heat2aaaaa";

type Public = Extract<ServerMessage, { t: "public" }>;

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

const TO_VOTING: LifecycleCommand[] = [{ t: "start" }, { t: "end-early" }, { t: "open-voting" }];

/** A claimed Competition with Heat 1 up next, Ada and Bo on its Roster, and a Host past it all. */
async function heat(): Promise<{ claim: Claim; host: TestSocket; ada: string; bo: string }> {
  const claim = newClaim("VT");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await until(host, "competition");
  await step(host, { t: "make-current", roundId: HEAT_1 });
  const ada = await laptop(claim, host, "Ada");
  const bo = await laptop(claim, host, "Bo");
  return { claim, host, ada, bo };
}

/** Heat 1 at voting, with Ada and Bo on its Roster. */
async function voting() {
  const competition = await heat();
  for (const command of TO_VOTING) await step(competition.host, command);
  return competition;
}

let seats = 0;

/** A laptop on Heat 1's Roster, connected, past the Host hearing of it. Returns its seat. */
async function laptop(claim: Claim, host: TestSocket, name: string): Promise<string> {
  const presence: Presence = { roundId: HEAT_1, seat: `seat-${++seats}`, name, revision: "1-202610121403" };
  const socket = await connect(worker, claim.joinCode, "contestant");
  socket.send({ t: "presence", token: claim.contestantToken, ...presence });
  await until(host, "roster");
  return presence.seat;
}

let voters = 0;

/** A phone following the Current Round as a voter, and its first snapshot. */
async function phone(claim: Claim, voter = `voter-${++voters}`) {
  const socket = await connect(worker, claim.joinCode, "phone");
  socket.send({ t: "follow", voter });
  return { socket, voter, snapshot: await until(socket, "public") };
}

/** A phone votes, and the Host hears the new tally. */
async function vote(host: TestSocket, socket: TestSocket, seat: string) {
  socket.send({ t: "vote", seat });
  return (await until(host, "tally")).tally;
}

/** A fresh Host's snapshot of every Round's tally. */
async function tallies(claim: Claim) {
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "host", hostSecret: claim.hostSecret });
  const { tallies } = await until(host, "competition");
  host.close();
  return tallies;
}

const NOTHING = /No message/;

test("a phone votes while voting: the Host sees the tally, and the phone its own Vote and the turnout", async () => {
  const { claim, host, ada } = await voting();
  const { socket } = await phone(claim);

  expect(await vote(host, socket, ada)).toEqual({ [ada]: 1 });

  expect(await until(socket, "public")).toMatchObject({ turnout: 1, vote: ada });
  expect(await tallies(claim)).toEqual({ [HEAT_1]: { [ada]: 1 }, [HEAT_2]: {}, finalaaaaa: {} });
});

test("the last Vote wins: a phone that changes its pick counts once", async () => {
  const { claim, host, ada, bo } = await voting();
  const first = await phone(claim);
  const second = await phone(claim);

  await vote(host, first.socket, ada);
  await vote(host, second.socket, ada);
  expect(await vote(host, first.socket, bo)).toEqual({ [ada]: 1, [bo]: 1 });

  const snapshot = (await phone(claim, first.voter)).snapshot;
  expect(snapshot).toMatchObject({ turnout: 2, vote: bo });
});

test("each phone sees only its own Vote, and never the tally while voting", async () => {
  const { claim, host, ada } = await voting();
  const voter = await phone(claim);
  const other = await phone(claim);
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow" });
  await until(stage, "public");

  await vote(host, voter.socket, ada);

  const seen = await until(other.socket, "public");
  expect(seen).toMatchObject({ turnout: 1, vote: null });
  expect(seen).not.toHaveProperty("tally");
  const onStage = await until(stage, "public");
  expect(onStage.turnout).toBe(1);
  expect(onStage).not.toHaveProperty("tally");
  expect(onStage).not.toHaveProperty("vote");
});

test("votes are refused outside voting", async () => {
  const { claim, host, ada } = await heat();
  const { socket } = await phone(claim);
  const tries: (Phase | LifecycleCommand)[] = [
    "upcoming",
    { t: "start" },
    "running",
    { t: "end-early" },
    "timesup",
    { t: "open-voting" },
    { t: "close-voting" },
    "results",
  ];

  for (const attempt of tries) {
    if (typeof attempt === "string") socket.send({ t: "vote", seat: ada });
    else await step(host, attempt);
  }
  await expect(until(host, "tally")).rejects.toThrow(NOTHING);

  await step(host, { t: "reopen-voting" });
  expect((await phone(claim)).snapshot.turnout).toBe(0);
});

test("only a phone that said its voter id votes, and only for an entry on the Current Round's Roster", async () => {
  const { claim, host, ada } = await voting();
  const anonymous = await connect(worker, claim.joinCode, "phone");
  anonymous.send({ t: "follow" });
  await until(anonymous, "public");
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow", voter: "stage-voter" });
  await until(stage, "public");
  const { socket } = await phone(claim);

  anonymous.send({ t: "vote", seat: ada });
  stage.send({ t: "vote", seat: ada });
  for (const seat of ["seat-nobody", 42, null]) socket.send({ t: "vote", seat });

  await expect(until(host, "tally")).rejects.toThrow(NOTHING);
  expect(await vote(host, socket, ada)).toEqual({ [ada]: 1 });
});

test("hand-added and offline entries are votable", async () => {
  const { claim, host } = await voting();
  host.send({ t: "add-by-hand", roundId: HEAT_1, name: "Cleo" });
  const cleo = (await until(host, "roster")).roster.entries.find((entry) => entry.name === "Cleo")!.seat;
  const { socket } = await phone(claim);

  expect(await vote(host, socket, cleo)).toEqual({ [cleo]: 1 });
});

test("removing an entry discards its votes, and those phones are back to not voted", async () => {
  const { claim, host, ada, bo } = await voting();
  const forAda = await phone(claim);
  const forBo = await phone(claim);
  await vote(host, forAda.socket, ada);
  await vote(host, forBo.socket, bo);

  host.send({ t: "remove-entry", roundId: HEAT_1, seat: ada });

  expect((await until(host, "tally")).tally).toEqual({ [bo]: 1 });
  let snapshot: Public;
  do snapshot = await until(forAda.socket, "public");
  while (snapshot.roster.some((entry) => entry.id === ada));
  expect(snapshot).toMatchObject({ turnout: 1, vote: null });
});

test("Start clears the Round's votes; back to up next and switching Rounds keep them", async () => {
  const { claim, host, ada } = await voting();
  const { socket, voter } = await phone(claim);
  await vote(host, socket, ada);
  await step(host, { t: "close-voting" });

  await step(host, { t: "back-to-up-next" });
  await step(host, { t: "make-current", roundId: HEAT_2 });
  await step(host, { t: "make-current", roundId: HEAT_1 });
  expect((await phone(claim, voter)).snapshot).toMatchObject({ turnout: 1, vote: ada });
  expect((await tallies(claim))[HEAT_1]).toEqual({ [ada]: 1 });

  host.send({ t: "start" });
  expect(await until(host, "tally")).toEqual({ v: V, t: "tally", roundId: HEAT_1, tally: {} });
  expect((await phone(claim, voter)).snapshot).toMatchObject({ lifecycle: { phase: "running" }, turnout: 0, vote: null });
});

test("Reopen voting keeps the votes cast", async () => {
  const { claim, host, ada } = await voting();
  const { socket, voter } = await phone(claim);
  await vote(host, socket, ada);
  await step(host, { t: "close-voting" });

  await step(host, { t: "reopen-voting" });

  expect((await phone(claim, voter)).snapshot).toMatchObject({ lifecycle: { phase: "voting" }, turnout: 1, vote: ada });
});

test("at results the Stage gets every entry's votes; phones still get only their own", async () => {
  const { claim, host, ada, bo } = await voting();
  const { socket, voter } = await phone(claim);
  await vote(host, socket, bo);
  await vote(host, (await phone(claim)).socket, bo);
  await vote(host, (await phone(claim)).socket, ada);
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow" });
  await until(stage, "public");

  await step(host, { t: "close-voting" });

  expect(await until(stage, "public")).toMatchObject({ lifecycle: { phase: "results" }, turnout: 3, tally: { [ada]: 1, [bo]: 2 } });
  const mine = (await phone(claim, voter)).snapshot;
  expect(mine).toMatchObject({ turnout: 3, vote: bo });
  expect(mine).not.toHaveProperty("tally");
});

test("votes survive a Durable Object restart", async () => {
  const { claim, host, ada } = await voting();
  const { socket, voter } = await phone(claim);
  await vote(host, socket, ada);

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });

  expect(await host.closed).not.toBe(CLOSE_VERSION);
  expect((await tallies(claim))[HEAT_1]).toEqual({ [ada]: 1 });
  expect((await phone(claim, voter)).snapshot).toMatchObject({ turnout: 1, vote: ada });
});
