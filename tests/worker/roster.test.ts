// The Roster: Contestants' laptops register presence with the Contestant token, and every Host
// sees each Round's Roster.

import { afterAll, beforeAll, expect, test } from "vitest";
import {
  CLOSE_TOKEN,
  CLOSE_UNCLAIMED,
  isStale,
  V,
  type Claim,
  type Presence,
  type Roster,
  type ServerMessage,
} from "../../src/protocol/protocol.ts";
import { connect, newClaim, ORGANIZER_KEY, startWorker, type TestSocket } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

const HEAT_1 = "heat1aaaaa";
const FINAL = "finalaaaaa";
const EMPTY: Roster = { entries: [], newest: null };

/** A claimed Competition and a Host socket on it, past the snapshot. */
async function claimed(): Promise<{ claim: Claim; host: TestSocket }> {
  const claim = newClaim("RS");
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  await host.next();
  return { claim, host };
}

/** A fresh Host's snapshot of every Round's Roster. */
async function rosters(claim: Claim): Promise<Record<string, Roster>> {
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "host", hostSecret: claim.hostSecret });
  const snapshot = await host.next();
  host.close();
  if (snapshot.t !== "competition") throw new Error(`Expected the snapshot, got ${JSON.stringify(snapshot)}`);
  return snapshot.rosters;
}

let seats = 0;

/** A laptop's presence on Heat 1: a fresh seat unless one is given. */
const presence = (changes: Partial<Presence> = {}): Presence => ({
  roundId: HEAT_1,
  seat: `seat-${++seats}`,
  name: "Anna",
  revision: "1-202610121403",
  ...changes,
});

/** Opens a Contestant socket and registers presence, as the Enhancement does. */
async function laptop(claim: Claim, who: Presence, token = claim.contestantToken) {
  const socket = await connect(worker, claim.joinCode, "contestant");
  socket.send({ t: "presence", token, ...who });
  return socket;
}

/** The next Roster update a Host hears. */
async function update(host: TestSocket): Promise<Extract<ServerMessage, { t: "roster" }>> {
  const message = await host.next();
  if (message.t !== "roster") throw new Error(`Expected a Roster update, got ${JSON.stringify(message)}`);
  return message;
}

test("a laptop that registers presence appears on its Round's Roster, for every Host", async () => {
  const { claim, host } = await claimed();
  const anna = presence();

  await laptop(claim, anna);

  const { seat, name, revision } = anna;
  const roster = { entries: [{ seat, name, revision, online: true }], newest: revision };
  expect(await update(host)).toEqual({ v: V, t: "roster", roundId: HEAT_1, roster });
  expect(await rosters(claim)).toEqual({ [HEAT_1]: roster, heat2aaaaa: EMPTY, [FINAL]: EMPTY });
});

test("presence before the claim is rejected; the laptop's retry after the claim gets in", async () => {
  const claim = newClaim("RS");
  const anna = presence();

  const early = await laptop(claim, anna);

  expect(await early.closed).toBe(CLOSE_UNCLAIMED);
  const host = await connect(worker, claim.joinCode, "host");
  host.send({ t: "claim", organizerKey: ORGANIZER_KEY, claim });
  expect(await host.next()).toMatchObject({ t: "competition", rosters: { [HEAT_1]: EMPTY } });
  await laptop(claim, anna);
  expect(await update(host)).toMatchObject({ roundId: HEAT_1, roster: { entries: [{ seat: anna.seat }] } });
});

test("presence without the Contestant token is rejected and never reaches the Roster", async () => {
  const { claim, host } = await claimed();

  const wrong = await laptop(claim, presence(), "not-the-token");
  const none = await connect(worker, claim.joinCode, "contestant");
  none.send({ t: "presence", ...presence() });
  const hostSecret = await laptop(claim, presence(), claim.hostSecret);

  for (const socket of [wrong, none, hostSecret]) expect(await socket.closed).toBe(CLOSE_TOKEN);
  await expect(host.next(500)).rejects.toThrow(/No message/);
  expect((await rosters(claim))[HEAT_1]).toEqual(EMPTY);
});

test("presence from a socket that isn't a Contestant's, or with a field missing, is ignored", async () => {
  const { claim, host } = await claimed();
  const phone = await connect(worker, claim.joinCode, "phone");
  phone.send({ t: "presence", token: claim.contestantToken, ...presence() });
  const stranger = await laptop(claim, presence({ roundId: "not-a-round" }));
  const nameless = await laptop(claim, presence({ name: undefined }));
  await laptop(claim, presence({ revision: "three" }));
  await laptop(claim, presence({ seat: "" }));

  await expect(host.next(500)).rejects.toThrow(/No message/);
  expect(await rosters(claim)).toEqual({ [HEAT_1]: EMPTY, heat2aaaaa: EMPTY, [FINAL]: EMPTY });
  for (const socket of [phone, stranger, nameless]) {
    socket.send({ t: "ping" });
    expect(await socket.next()).toEqual({ v: V, t: "pong" });
  }
});

test("a new name re-sent by the same laptop renames its entry; a reload keeps the same entry", async () => {
  const { claim, host } = await claimed();
  const anna = presence();
  const first = await laptop(claim, anna);
  await update(host);

  first.send({ t: "presence", token: claim.contestantToken, ...anna, name: "Anna K" });
  expect((await update(host)).roster.entries).toEqual([
    { seat: anna.seat, name: "Anna K", revision: anna.revision, online: true },
  ]);

  first.close();
  expect((await update(host)).roster.entries).toMatchObject([{ seat: anna.seat, online: false }]);
  await laptop(claim, { ...anna, name: "Anna K" });
  expect((await update(host)).roster.entries).toEqual([
    { seat: anna.seat, name: "Anna K", revision: anna.revision, online: true },
  ]);
});

test("an entry stays listed once it appears, offline after its laptop goes; same names get separate entries", async () => {
  const { claim, host } = await claimed();
  const [anna, otherAnna] = [presence(), presence()];
  const annasLaptop = await laptop(claim, anna);
  await update(host);
  await laptop(claim, otherAnna);
  await update(host);

  annasLaptop.close();

  expect((await update(host)).roster.entries).toEqual([
    { seat: anna.seat, name: "Anna", revision: anna.revision, online: false },
    { seat: otherAnna.seat, name: "Anna", revision: otherAnna.revision, online: true },
  ]);
});

test("an entry older than the newest Revision seen for its Round is stale, even once the newer laptop goes", async () => {
  const { claim, host } = await claimed();
  await laptop(claim, presence({ name: "Old", revision: "2-202610121403" }));
  await update(host);
  const newer = await laptop(claim, presence({ name: "New", revision: "3-202610121500" }));
  const { roster } = await update(host);
  await laptop(claim, presence({ roundId: FINAL, revision: "1-202610121600" }));
  await update(host);

  newer.close();
  await update(host);

  const heat = (await rosters(claim))[HEAT_1]!;
  expect(heat.newest).toBe("3-202610121500");
  expect(heat.entries.map((entry) => [entry.name, isStale(entry, heat)])).toEqual([
    ["Old", true],
    ["New", false],
  ]);
  expect(roster).toEqual({ ...heat, entries: heat.entries.map((entry) => ({ ...entry, online: true })) });
  // Revisions are per Round: Heat 1's newest doesn't make the Final's Rev 1 stale.
  const final = (await rosters(claim))[FINAL]!;
  expect(final.entries.map((entry) => isStale(entry, final))).toEqual([false]);
});

test("a laptop reopening with a re-exported Revision moves its entry to it", async () => {
  const { claim, host } = await claimed();
  const anna = presence({ revision: "1-202610121403" });
  (await laptop(claim, anna)).close();
  await update(host);
  await update(host);

  await laptop(claim, { ...anna, revision: "2-202610121410" });

  expect((await update(host)).roster).toEqual({
    entries: [{ seat: anna.seat, name: "Anna", revision: "2-202610121410", online: true }],
    newest: "2-202610121410",
  });
});

test("the Roster survives a Durable Object restart; its laptops are offline until they reconnect", async () => {
  const { claim, host } = await claimed();
  const anna = presence();
  const annasLaptop = await laptop(claim, anna);
  await update(host);

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });
  await annasLaptop.closed;

  expect((await rosters(claim))[HEAT_1]).toEqual({
    entries: [{ seat: anna.seat, name: "Anna", revision: anna.revision, online: false }],
    newest: anna.revision,
  });
  const back = await connect(worker, claim.joinCode, "host");
  back.send({ t: "host", hostSecret: claim.hostSecret });
  await back.next();
  await laptop(claim, anna);
  expect((await update(back)).roster.entries).toEqual([
    { seat: anna.seat, name: "Anna", revision: anna.revision, online: true },
  ]);
});

test("the Stage and phones see the Current Round's Roster: names only, and nobody from another Round", async () => {
  const { claim, host } = await claimed();
  host.send({ t: "make-current", roundId: HEAT_1 });
  await host.next();
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow" });
  expect(await stage.next()).toMatchObject({ t: "public", roster: [] });

  const anna = presence();
  await laptop(claim, presence({ roundId: FINAL, name: "Finn" }));
  await expect(stage.next(500)).rejects.toThrow(/No message/);
  const annaLaptop = await laptop(claim, anna);
  expect(await stage.next()).toMatchObject({ t: "public", roster: [{ id: anna.seat, name: "Anna" }] });

  annaLaptop.send({ t: "presence", token: claim.contestantToken, ...anna, name: "Anna K" });
  const renamed = await stage.next();
  expect(renamed).toMatchObject({ t: "public", roster: [{ id: anna.seat, name: "Anna K" }] });
  expect(JSON.stringify(renamed)).not.toContain(anna.revision);

  const phone = await connect(worker, claim.joinCode, "phone");
  phone.send({ t: "follow" });
  expect(await phone.next()).toEqual(renamed);
});

/** The names on a Roster, in order. */
const names = (roster: Roster) => roster.entries.map((entry) => entry.name);

/** Sends a Roster command and returns the Roster update every Host hears. */
async function rosterCommand(host: TestSocket, command: object) {
  host.send(command);
  return update(host);
}

test("the Host adds a Contestant by hand: listed, without a laptop or Revision, and on the Stage", async () => {
  const { claim, host } = await claimed();
  host.send({ t: "make-current", roundId: HEAT_1 });
  await host.next();
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow" });
  await stage.next();
  await laptop(claim, presence({ revision: "2-202610121403" }));
  await update(host);
  await stage.next();

  const { roundId, roster } = await rosterCommand(host, { t: "add-by-hand", roundId: HEAT_1, name: "  Cleo  " });

  expect(roundId).toBe(HEAT_1);
  const cleo = roster.entries[1]!;
  expect(cleo).toEqual({ seat: expect.any(String), name: "Cleo", revision: null, online: false });
  expect(isStale(cleo, roster)).toBe(false);
  expect(roster.newest).toBe("2-202610121403");
  expect(await stage.next()).toMatchObject({ t: "public", roster: [{ name: "Anna" }, { id: cleo.seat, name: "Cleo" }] });
  // Same names get separate entries.
  const again = await rosterCommand(host, { t: "add-by-hand", roundId: HEAT_1, name: "Cleo" });
  expect(names(again.roster)).toEqual(["Anna", "Cleo", "Cleo"]);
  expect(new Set(again.roster.entries.map((entry) => entry.seat)).size).toBe(3);
});

test("a hand-added entry's seat can't be taken over by a laptop's presence", async () => {
  const { claim, host } = await claimed();
  const { roster } = await rosterCommand(host, { t: "add-by-hand", roundId: HEAT_1, name: "Cleo" });

  await laptop(claim, presence({ seat: roster.entries[0]!.seat, name: "Mallory" }));

  await expect(host.next(500)).rejects.toThrow(/No message/);
  expect((await rosters(claim))[HEAT_1]).toEqual(roster);
});

test("the Host removes an offline entry; its laptop coming back later appears again", async () => {
  const { claim, host } = await claimed();
  const [anna, bo] = [presence(), presence({ name: "Bo" })];
  (await laptop(claim, anna)).close();
  await update(host);
  await update(host);
  await laptop(claim, bo);
  await update(host);

  const { roster } = await rosterCommand(host, { t: "remove-entry", roundId: HEAT_1, seat: anna.seat });

  expect(names(roster)).toEqual(["Bo"]);
  expect(names((await rosters(claim))[HEAT_1]!)).toEqual(["Bo"]);
  await laptop(claim, anna);
  expect(names((await update(host)).roster)).toEqual(["Bo", "Anna"]);
});

test("the Host removes a hand-added entry, and the Stage stops listing it", async () => {
  const { claim, host } = await claimed();
  host.send({ t: "make-current", roundId: HEAT_1 });
  await host.next();
  const { roster } = await rosterCommand(host, { t: "add-by-hand", roundId: HEAT_1, name: "Cleo" });
  const stage = await connect(worker, claim.joinCode, "stage");
  stage.send({ t: "follow" });
  expect(await stage.next()).toMatchObject({ roster: [{ name: "Cleo" }] });

  const removed = await rosterCommand(host, { t: "remove-entry", roundId: HEAT_1, seat: roster.entries[0]!.seat });

  expect(removed.roster.entries).toEqual([]);
  expect(await stage.next()).toMatchObject({ t: "public", roster: [] });
});

test("a removed entry whose laptop is still connected stays hidden for the rest of the Round", async () => {
  const { claim, host } = await claimed();
  const anna = presence();
  const annasLaptop = await laptop(claim, anna);
  await update(host);

  const { roster } = await rosterCommand(host, { t: "remove-entry", roundId: HEAT_1, seat: anna.seat });
  expect(roster.entries).toEqual([]);

  // A new name, a reload and a laptop that goes all bring nothing back.
  annasLaptop.send({ t: "presence", token: claim.contestantToken, ...anna, name: "Anna K" });
  annasLaptop.close();
  await laptop(claim, anna);
  await laptop(claim, presence({ name: "Bo" }));
  expect(names((await update(host)).roster)).toEqual(["Bo"]);
  expect(names((await rosters(claim))[HEAT_1]!)).toEqual(["Bo"]);
  // Only on this Round: the same seat id on another Round is another Roster entry.
  await laptop(claim, { ...anna, roundId: FINAL });
  expect(await update(host)).toMatchObject({ roundId: FINAL, roster: { entries: [{ seat: anna.seat }] } });
});

test("adding and removing survive a Durable Object restart, the hidden laptop included", async () => {
  const { claim, host } = await claimed();
  const [anna, bo] = [presence(), presence({ name: "Bo" })];
  const annasLaptop = await laptop(claim, anna);
  await update(host);
  await laptop(claim, bo);
  await update(host);
  await rosterCommand(host, { t: "add-by-hand", roundId: HEAT_1, name: "Cleo" });
  await rosterCommand(host, { t: "remove-entry", roundId: HEAT_1, seat: anna.seat });

  await worker.getWorker().evictDurableObject("Competition", { name: claim.joinCode, webSockets: "close" });
  await annasLaptop.closed;

  expect((await rosters(claim))[HEAT_1]!.entries).toEqual([
    { seat: bo.seat, name: "Bo", revision: bo.revision, online: false },
    { seat: expect.any(String), name: "Cleo", revision: null, online: false },
  ]);
  const back = await connect(worker, claim.joinCode, "host");
  back.send({ t: "host", hostSecret: claim.hostSecret });
  await back.next();
  await laptop(claim, anna);
  await laptop(claim, bo);
  expect((await update(back)).roster.entries.map((entry) => [entry.name, entry.online])).toEqual([
    ["Bo", true],
    ["Cleo", false],
  ]);
});

test("adding and removing need the Host secret", async () => {
  const { claim, host } = await claimed();
  const anna = presence();
  await laptop(claim, anna);
  await update(host);
  const stranger = await connect(worker, claim.joinCode, "host");
  stranger.send({ t: "host", hostSecret: "not-the-secret" });
  expect(await stranger.next()).toMatchObject({ t: "host-refused" });
  const phone = await connect(worker, claim.joinCode, "phone");

  for (const socket of [stranger, phone]) {
    socket.send({ t: "add-by-hand", roundId: HEAT_1, name: "Mallory" });
    expect(await socket.next()).toEqual({ v: V, t: "refused", command: "add-by-hand", reason: "host-secret" });
    socket.send({ t: "remove-entry", roundId: HEAT_1, seat: anna.seat });
    expect(await socket.next()).toEqual({ v: V, t: "refused", command: "remove-entry", reason: "host-secret" });
  }
  await expect(host.next(500)).rejects.toThrow(/No message/);
  expect(names((await rosters(claim))[HEAT_1]!)).toEqual(["Anna"]);
});

test("adding without a name, or to a Round or removing an entry that isn't there, is refused", async () => {
  const { claim, host } = await claimed();

  for (const command of [
    { t: "add-by-hand", roundId: HEAT_1, name: "   " },
    { t: "add-by-hand", roundId: HEAT_1 },
    { t: "add-by-hand", roundId: "not-a-round", name: "Cleo" },
    { t: "remove-entry", roundId: HEAT_1, seat: "no-such-seat" },
    { t: "remove-entry", roundId: "not-a-round", seat: "no-such-seat" },
  ]) {
    host.send(command);
    expect(await host.next()).toEqual({ v: V, t: "refused", command: command.t, reason: "invalid" });
  }
  expect((await rosters(claim))[HEAT_1]).toEqual(EMPTY);
});
