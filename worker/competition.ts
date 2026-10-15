// One Durable Object per Competition, addressed by its Join code. Plain WebSocket Hibernation
// API, no framework. Its storage, not its memory, holds the claim, the lifecycle, the Rosters
// and the votes, so a restart loses nothing. Who is connected is the open sockets, not storage.

import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_TOKEN,
  CLOSE_UNCLAIMED,
  CLOSE_VERSION,
  EMPTY_ROSTER,
  isClaim,
  isReaction,
  isRoundList,
  isEpochMs,
  isVoterId,
  parseSocketPath,
  PING,
  PONG,
  REACTION_PHASES,
  V,
  isByHand,
  type Claim,
  type ClientMessage,
  type CommandRefusal,
  type CompetitionSummary,
  type ContestantMessage,
  type Lifecycle,
  type LifecycleCommand,
  type Presence,
  type PublicEntry,
  type ReactionMessage,
  type Role,
  type Roster,
  type RosterCommand,
  type RosterEntry,
  type ServerMessage,
  type Tally,
} from "../src/protocol/protocol.ts";
import { isNewerRevision, isRevision } from "../src/round-package/revision.ts";
import type { Env } from "./index.ts";
import { isLifecycleCommand, timesUp, transition, WELCOME } from "./lifecycle.ts";

/** What a socket carries through hibernation. */
interface Attachment {
  joinCode: string;
  role: Role;
  /** Set once the socket has shown the Host secret. */
  host?: true;
  /** Set once a Stage or phone socket has asked to follow the Current Round. */
  follows?: true;
  /** A phone's voter id, from its `follow`. */
  voter?: string;
  /** Set once a Contestant socket's presence is on a Roster. */
  place?: RosterPlace;
}

/** The roles that may follow the Current Round. A Contestant receives Reactions only. */
const FOLLOWERS: Role[] = ["stage", "phone"];

/** The Round list a Host console link presents, unchecked. */
type LinkRounds = { rounds?: unknown; roundsChangedAt?: unknown };

/** Which Round's Roster a Contestant socket is on, and as which seat. */
type RosterPlace = Pick<Presence, "roundId" | "seat">;

/** A Roster entry as stored: everything but whether its laptop is connected. */
type StoredEntry = Omit<RosterEntry, "online">;

/** A Round's votes as stored: one seat per voter id. */
type Votes = Map<string, string>;

/** A Round's Roster as stored: everything but who is connected. */
interface StoredRoster {
  entries: StoredEntry[];
  newest: string | null;
  /** Seats the Host removed while their laptop was connected: hidden for the rest of the Round, or until a reset. */
  hidden?: string[];
}

const MAX_NAME_LENGTH = 100;
const MAX_SEAT_LENGTH = 64;

export class Competition extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Answers the heartbeat without waking the object from hibernation.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  async fetch(request: Request): Promise<Response> {
    // The Worker only routes valid socket paths here.
    const { joinCode, role } = parseSocketPath(new URL(request.url).pathname)!;
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    // Tagged by role, so later messages can go to every socket of one role.
    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ joinCode, role } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    let message: ClientMessage;
    try {
      message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data)) as ClientMessage;
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null) return;
    if (message.v !== V && message.v !== V - 1) return socket.close(CLOSE_VERSION, "Unsupported protocol version");
    switch (message.t) {
      case "ping":
        // A previous-version ping, which the auto-response doesn't match.
        return send(socket, { v: V, t: "pong" });
      case "host":
        return this.greetHost(socket, message);
      case "claim":
        return this.claim(socket, message.organizerKey, message.claim);
      case "follow":
        return this.follow(socket, message.voter);
      case "vote":
        return this.vote(socket, message.seat);
      case "presence":
        return this.presence(socket, message);
      case "add-by-hand":
      case "remove-entry":
        return this.rosterCommand(socket, message);
      case "react":
        return this.react(socket, message);
      case "reset":
        return this.reset(socket);
    }
    if (isLifecycleCommand(message)) return this.command(socket, message);
  }

  async webSocketClose(socket: WebSocket, code: number): Promise<void> {
    try {
      // Completes the closing handshake where the runtime doesn't do it by itself.
      socket.close(code === 1005 ? 1000 : code);
    } catch {
      // Already closed.
    }
    await this.left(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.left(socket);
  }

  /** Reaching `endsAt` puts the running Round at time's up. */
  async alarm(): Promise<void> {
    const lifecycle = await this.lifecycle();
    if (lifecycle.phase !== "running") return;
    if (Date.now() < lifecycle.endsAt!) return this.ctx.storage.setAlarm(lifecycle.endsAt!);
    await this.change(timesUp(lifecycle));
  }

  private async greetHost(socket: WebSocket, link: LinkRounds & { hostSecret: unknown }) {
    const claim = await this.ctx.storage.get<Claim>("claim");
    if (!claim) return send(socket, { v: V, t: "unclaimed" });
    if (!sameSecret(link.hostSecret, claim.hostSecret)) return send(socket, { v: V, t: "host-refused" });
    await this.admitHost(socket, claim, link);
  }

  private async claim(socket: WebSocket, organizerKey: unknown, claim: unknown) {
    const { joinCode } = socket.deserializeAttachment() as Attachment;
    if (!isClaim(claim) || claim.joinCode !== joinCode) {
      return send(socket, { v: V, t: "claim-refused", reason: "invalid" });
    }
    if (!this.env.ORGANIZER_KEY) return send(socket, { v: V, t: "claim-refused", reason: "no-organizer-key" });
    if (!sameSecret(organizerKey, this.env.ORGANIZER_KEY)) {
      return send(socket, { v: V, t: "claim-refused", reason: "organizer-key" });
    }
    const existing = await this.ctx.storage.get<Claim>("claim");
    // Once claimed, the Join code is bound to its Host secret for good.
    if (existing && !sameSecret(claim.hostSecret, existing.hostSecret)) {
      return send(socket, { v: V, t: "claim-refused", reason: "claimed" });
    }
    if (existing) return this.admitHost(socket, existing, claim);
    await this.ctx.storage.put("claim", claim);
    await this.admitHost(socket, claim);
    await this.tellFollowers(claim);
  }

  /** Lets a socket in as a Host, with the Round list its link presents. */
  private async admitHost(socket: WebSocket, claim: Claim, link: LinkRounds = {}) {
    socket.serializeAttachment({ ...(socket.deserializeAttachment() as Attachment), host: true } satisfies Attachment);
    if (!(await this.takeRoundList(socket, claim, link))) send(socket, await this.hostSnapshot(claim));
  }

  /** A link's newer Round list replaces the stored one, and every Host, the Stage and the phones get
   * it. One that leaves out the Current Round is refused. False if the stored list stays. */
  private async takeRoundList(socket: WebSocket, claim: Claim, { rounds, roundsChangedAt }: LinkRounds) {
    if (!isRoundList(rounds) || !isEpochMs(roundsChangedAt) || roundsChangedAt <= (claim.roundsChangedAt ?? 0)) {
      return false;
    }
    const { current } = await this.lifecycle();
    if (current && !rounds.some((round) => round.id === current)) {
      send(socket, await this.hostSnapshot(claim));
      send(socket, { v: V, t: "rounds-refused", reason: "current-round", roundId: current });
      return true;
    }
    const updated: Claim = { ...claim, rounds, roundsChangedAt };
    await this.ctx.storage.put("claim", updated);
    this.tellHosts(await this.hostSnapshot(updated));
    await this.tellFollowers(updated);
    return true;
  }

  /** Everything a Host console shows of the Competition. */
  private async hostSnapshot(claim: Claim): Promise<ServerMessage> {
    const lifecycle = await this.lifecycle();
    const stored = await this.ctx.storage.get<StoredRoster>(claim.rounds.map((round) => rosterKey(round.id)));
    const rosters = Object.fromEntries(
      claim.rounds.map((round) => [round.id, this.withOnline(round.id, stored.get(rosterKey(round.id)))]),
    );
    const votes = await this.ctx.storage.get<Votes>(claim.rounds.map((round) => votesKey(round.id)));
    const tallies = Object.fromEntries(claim.rounds.map((round) => [round.id, tally(votes.get(votesKey(round.id)))]));
    return { v: V, t: "competition", competition: summary(claim), lifecycle, rosters, tallies };
  }

  /** A Contestant's laptop says who it is. Before the claim, or without the Contestant token, it
   * is turned away: the socket closes and the Enhancement retries later. */
  private async presence(socket: WebSocket, message: ContestantMessage) {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (attachment.role !== "contestant") return;
    const claim = await this.ctx.storage.get<Claim>("claim");
    if (!claim) return socket.close(CLOSE_UNCLAIMED, "The Competition isn't claimed yet");
    if (!sameSecret(message.token, claim.contestantToken)) {
      return socket.close(CLOSE_TOKEN, "Not this Competition's Contestant token");
    }
    const presence = validPresence(message);
    if (!presence || !claim.rounds.some((round) => round.id === presence.roundId)) return;

    const { roundId, seat, name, revision } = presence;
    const roster = await this.storedRoster(roundId);
    // A laptop the Host removed stays off, and a seat added by hand has no laptop.
    if (roster.hidden?.includes(seat)) return;
    const at = roster.entries.findIndex((entry) => entry.seat === seat);
    if (at !== -1 && isByHand(roster.entries[at]!)) return;
    roster.entries.splice(at === -1 ? roster.entries.length : at, 1, { seat, name, revision });
    if (roster.newest === null || isNewerRevision(revision, roster.newest)) roster.newest = revision;
    await this.ctx.storage.put(rosterKey(roundId), roster);

    const was = attachment.place;
    socket.serializeAttachment({ ...attachment, place: { roundId, seat } } satisfies Attachment);
    if (was && (was.roundId !== roundId || was.seat !== seat)) await this.rosterChanged(was.roundId);
    await this.tellRoster(claim, roundId, roster);
  }

  /** The Host adds a Contestant by hand, or removes an entry. */
  private async rosterCommand(socket: WebSocket, command: RosterCommand) {
    const refuse = (reason: CommandRefusal) => send(socket, { v: V, t: "refused", command: command.t, reason });
    if (!isHost(socket)) return refuse("host-secret");
    // A socket is a Host's only once the Competition is claimed.
    const claim = (await this.ctx.storage.get<Claim>("claim"))!;
    // A command's fields arrive unchecked.
    const { roundId } = command as { roundId: unknown };
    if (!claim.rounds.some((round) => round.id === roundId)) return refuse("invalid");
    const roster = await this.storedRoster(command.roundId);
    const changed =
      command.t === "add-by-hand" ? addByHand(roster, command.name) : this.removeEntry(roster, command.roundId, command.seat);
    if (!changed) return refuse("invalid");
    await this.ctx.storage.put(rosterKey(command.roundId), roster);
    if (command.t === "remove-entry") await this.discardVotes(command.roundId, command.seat);
    await this.tellRoster(claim, command.roundId, roster);
  }

  /** A removed entry's votes go with it, and those phones are back to not voted. */
  private async discardVotes(roundId: string, seat: string) {
    const votes = await this.votes(roundId);
    const before = votes.size;
    for (const [voter, pick] of votes) if (pick === seat) votes.delete(voter);
    if (votes.size !== before) await this.saveVotes(roundId, votes);
  }

  /** A phone's Vote counts only while voting, for an entry on the Current Round's Roster, and
   * replaces its earlier one. */
  private async vote(socket: WebSocket, seat: unknown) {
    const { role, voter } = socket.deserializeAttachment() as Attachment;
    if (role !== "phone" || !voter || typeof seat !== "string") return;
    const { current, phase } = await this.lifecycle();
    if (!current || phase !== "voting") return;
    const roster = await this.ctx.storage.get<StoredRoster>(rosterKey(current));
    if (!roster?.entries.some((entry) => entry.seat === seat)) return;
    const votes = await this.votes(current);
    if (votes.get(voter) === seat) return;
    votes.set(voter, seat);
    await this.saveVotes(current, votes);
    // A claim is all a Round needs to be current.
    await this.tellFollowers((await this.ctx.storage.get<Claim>("claim"))!);
  }

  /** Stores a Round's changed votes and tells every Host its tally. */
  private async saveVotes(roundId: string, votes: Votes) {
    await this.ctx.storage.put(votesKey(roundId), votes);
    this.tellHosts({ v: V, t: "tally", roundId, tally: tally(votes) });
  }

  private async votes(roundId: string): Promise<Votes> {
    return (await this.ctx.storage.get<Votes>(votesKey(roundId))) ?? new Map();
  }

  /** Takes an entry off a Round's Roster. A laptop still connected is hidden for the rest of the
   * Round, and its sockets closing no longer change the Roster. False if there's no such entry. */
  private removeEntry(roster: StoredRoster, roundId: string, seat: unknown): boolean {
    const at = roster.entries.findIndex((entry) => entry.seat === seat);
    if (at === -1) return false;
    const [removed] = roster.entries.splice(at, 1) as [StoredEntry];
    const laptops = this.laptopsOn(roundId, removed.seat);
    if (laptops.length) roster.hidden = [...(roster.hidden ?? []), removed.seat];
    for (const laptop of laptops) {
      const attachment = laptop.deserializeAttachment() as Attachment;
      delete attachment.place;
      laptop.serializeAttachment(attachment);
    }
    return true;
  }

  private async storedRoster(roundId: string): Promise<StoredRoster> {
    return (await this.ctx.storage.get<StoredRoster>(rosterKey(roundId))) ?? structuredClone(EMPTY_ROSTER);
  }

  /** Tells every Host a Round's changed Roster, and the followers too if the Round is current. */
  private async tellRoster(claim: Claim, roundId: string, roster: StoredRoster) {
    this.tellHosts({ v: V, t: "roster", roundId, roster: this.withOnline(roundId, roster) });
    if (roundId === (await this.lifecycle()).current) await this.tellFollowers(claim);
  }

  /** The open sockets of the laptop on a Round's seat. */
  private laptopsOn(roundId: string, seat: string): WebSocket[] {
    return this.ctx.getWebSockets("contestant").filter((socket) => {
      const { place } = socket.deserializeAttachment() as Attachment;
      return place?.roundId === roundId && place.seat === seat;
    });
  }

  /** A socket closed: if it was a laptop on a Roster, its entry may now be offline. */
  private async left(socket: WebSocket) {
    const { place } = socket.deserializeAttachment() as Attachment;
    if (place) await this.rosterChanged(place.roundId, socket);
  }

  /** A phone's Reaction goes to its seat's laptop, and only while the Current Round allows
   * Reactions and the seat is on its Roster and connected. Otherwise it is lost: never stored,
   * never queued. */
  private async react(socket: WebSocket, message: ReactionMessage) {
    const { seat, e } = message;
    if (!this.ctx.getTags(socket).includes("phone") || typeof seat !== "string" || !isReaction(e)) return;
    const { current, phase } = await this.lifecycle();
    if (!current || !REACTION_PHASES.includes(phase!)) return;
    const roster = await this.ctx.storage.get<StoredRoster>(rosterKey(current));
    if (!roster?.entries.some((entry) => entry.seat === seat)) return;
    const reaction = JSON.stringify({ v: V, t: "react", seat, e } satisfies ServerMessage);
    for (const laptop of this.ctx.getWebSockets("contestant")) {
      const { place } = laptop.deserializeAttachment() as Attachment;
      if (place?.roundId === current && place.seat === seat) laptop.send(reaction);
    }
  }

  /** Tells every Host a Round's Roster as it is now, leaving out a socket that is closing. */
  private async rosterChanged(roundId: string, closing?: WebSocket) {
    const stored = await this.storedRoster(roundId);
    this.tellHosts({ v: V, t: "roster", roundId, roster: this.withOnline(roundId, stored, closing) });
    // Phones dim an entry whose laptop has gone: it can't be reacted to while offline.
    const claim = await this.ctx.storage.get<Claim>("claim");
    if (claim && roundId === (await this.lifecycle()).current) await this.tellFollowers(claim, closing);
  }

  /** A stored Roster with each entry's connection: online while one of its laptop's sockets is open. */
  private withOnline(roundId: string, stored: StoredRoster | undefined, closing?: WebSocket): Roster {
    const online = new Set<string>();
    for (const socket of this.ctx.getWebSockets("contestant")) {
      const { place } = socket.deserializeAttachment() as Attachment;
      if (socket !== closing && place?.roundId === roundId) online.add(place.seat);
    }
    const { entries, newest } = stored ?? EMPTY_ROSTER;
    return { entries: entries.map((entry) => ({ ...entry, online: online.has(entry.seat) })), newest };
  }

  /** A Stage or phone follows the Current Round from now on. Before the claim it waits, and the
   * claim brings it the snapshot. */
  private async follow(socket: WebSocket, voter: unknown) {
    const attachment = socket.deserializeAttachment() as Attachment;
    if (!FOLLOWERS.includes(attachment.role)) return;
    const phone = attachment.role === "phone" && isVoterId(voter);
    socket.serializeAttachment({ ...attachment, follows: true, ...(phone && { voter }) } satisfies Attachment);
    const claim = await this.ctx.storage.get<Claim>("claim");
    if (!claim) return send(socket, { v: V, t: "unclaimed" });
    send(socket, (await this.publicSnapshots(claim))(socket));
  }

  private async command(socket: WebSocket, command: LifecycleCommand) {
    if (!isHost(socket)) {
      return send(socket, { v: V, t: "refused", command: command.t, reason: "host-secret" });
    }
    // A socket is a Host's only once the Competition is claimed.
    const { rounds } = (await this.ctx.storage.get<Claim>("claim"))!;
    const next = transition(await this.lifecycle(), command, rounds, Date.now());
    if (!next) return send(socket, { v: V, t: "refused", command: command.t, reason: "transition" });
    // Votes belong to one run of a Round.
    if (command.t === "start") await this.clearVotes(next.current!);
    await this.change(next);
  }

  /** After a rehearsal: every Round's Roster, hidden seats and votes go, and the Stage goes back
   * to the welcome screen with the same duration. The claim stays as it is. Storage is cleared
   * before anyone hears the new lifecycle, so no snapshot shows the old Roster on the welcome
   * screen. Laptops still connected are closed, and their Enhancement reconnects and sends its
   * presence again, so they are back on their Roster, a hidden one too. */
  private async reset(socket: WebSocket) {
    if (!isHost(socket)) return send(socket, { v: V, t: "refused", command: "reset", reason: "host-secret" });
    const lifecycle = await this.lifecycle();
    if (lifecycle.phase === "running") return send(socket, { v: V, t: "refused", command: "reset", reason: "transition" });
    // A socket is a Host's only once the Competition is claimed.
    const claim = (await this.ctx.storage.get<Claim>("claim"))!;
    await this.ctx.storage.transaction(async (txn) => {
      await txn.delete(claim.rounds.flatMap((round) => [rosterKey(round.id), votesKey(round.id)]));
      await txn.put("lifecycle", { ...WELCOME, durationMs: lifecycle.durationMs } satisfies Lifecycle);
      await txn.deleteAlarm();
    });
    this.tellHosts(await this.hostSnapshot(claim));
    await this.tellFollowers(claim);
    for (const laptop of this.ctx.getWebSockets("contestant")) {
      // Off the Roster already, so its closing tells nobody anything.
      const attachment = laptop.deserializeAttachment() as Attachment;
      delete attachment.place;
      laptop.serializeAttachment(attachment);
      // An ordinary close: the Enhancement reconnects after anything but a protocol mismatch.
      laptop.close(1012, "The Competition was reset");
    }
  }

  private async clearVotes(roundId: string) {
    if (!(await this.ctx.storage.delete(votesKey(roundId)))) return;
    this.tellHosts({ v: V, t: "tally", roundId, tally: {} });
  }

  private async lifecycle(): Promise<Lifecycle> {
    return (await this.ctx.storage.get<Lifecycle>("lifecycle")) ?? WELCOME;
  }

  /** Stores a new lifecycle, keeps the alarm on its `endsAt`, and tells every Host and follower. */
  private async change(lifecycle: Lifecycle) {
    await this.ctx.storage.put("lifecycle", lifecycle);
    if (lifecycle.endsAt === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(lifecycle.endsAt);
    this.tellHosts({ v: V, t: "lifecycle", lifecycle });
    // Only a claimed Competition has a lifecycle to change.
    await this.tellFollowers((await this.ctx.storage.get<Claim>("claim"))!);
  }

  private tellHosts(message: ServerMessage) {
    for (const socket of this.ctx.getWebSockets("host")) {
      if (isHost(socket)) send(socket, message);
    }
  }

  /** Tells every Stage and phone the public snapshot, leaving out a laptop socket that is closing. */
  private async tellFollowers(claim: Claim, closing?: WebSocket) {
    const followers = this.ctx.getWebSockets().filter(follows);
    if (!followers.length) return;
    const snapshotFor = await this.publicSnapshots(claim, closing);
    for (const socket of followers) send(socket, snapshotFor(socket));
  }

  /** Each follower's public snapshot. The Current Round's Roster is names, and whether each
   * laptop is connected so phones know whom they can react to; Revisions are the Host's. Votes
   * show as the turnout, plus a phone's own Vote, and every entry's votes on the Stage at results. */
  private async publicSnapshots(claim: Claim, closing?: WebSocket): Promise<(socket: WebSocket) => ServerMessage> {
    const lifecycle = await this.lifecycle();
    const { current } = lifecycle;
    const stored = current ? await this.ctx.storage.get<StoredRoster>(rosterKey(current)) : undefined;
    const votes = current ? await this.votes(current) : new Map<string, string>();
    const roster = current
      ? this.withOnline(current, stored, closing).entries.map(
          (entry): PublicEntry => ({
            id: entry.seat,
            name: entry.name,
            online: entry.online,
            ...(isByHand(entry) && { handAdded: true }),
          }),
        )
      : [];
    const snapshot: ServerMessage = { v: V, t: "public", competition: summary(claim), lifecycle, roster, turnout: votes.size };
    const finalTally = lifecycle.phase === "results" ? tally(votes) : null;
    return (socket) => {
      const { role, voter } = socket.deserializeAttachment() as Attachment;
      if (role === "phone") return { ...snapshot, vote: (voter && votes.get(voter)) || null };
      return finalTally ? { ...snapshot, tally: finalTally } : snapshot;
    };
  }
}

const rosterKey = (roundId: string) => `roster:${roundId}`;
const votesKey = (roundId: string) => `votes:${roundId}`;

/** Each seat's votes. */
function tally(votes: Votes = new Map()): Tally {
  const counts: Tally = {};
  for (const seat of votes.values()) counts[seat] = (counts[seat] ?? 0) + 1;
  return counts;
}

/** The presence in a Contestant's message, or null if a field is missing or malformed. */
function validPresence(message: Partial<Record<keyof Presence, unknown>>): Presence | null {
  const { roundId, seat, name, revision } = message;
  if (typeof roundId !== "string" || typeof seat !== "string") return null;
  if (typeof revision !== "string" || !isRevision(revision)) return null;
  if (!seat || seat.length > MAX_SEAT_LENGTH) return null;
  const valid = validName(name);
  return valid ? { roundId, seat, name: valid, revision } : null;
}

/** Adds a Contestant whose laptop never connects. False if the name is blank. */
function addByHand(roster: StoredRoster, name: unknown): boolean {
  const valid = validName(name);
  if (!valid) return false;
  roster.entries.push({ seat: `hand-${crypto.randomUUID()}`, name: valid, revision: null });
  return true;
}

/** A name trimmed and cut to length, or null if it isn't a string or is blank. */
function validName(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return null;
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

/** Whether the socket has shown the Host secret. */
const isHost = (socket: WebSocket) => (socket.deserializeAttachment() as Attachment).host === true;

/** Whether the socket is a Stage or phone that follows the Current Round. */
const follows = (socket: WebSocket) => (socket.deserializeAttachment() as Attachment).follows === true;

const summary = (claim: Claim): CompetitionSummary => ({
  name: claim.competitionName,
  joinCode: claim.joinCode,
  rounds: claim.rounds,
});

function send(socket: WebSocket, message: ServerMessage) {
  socket.send(JSON.stringify(message));
}

/** Compares two secrets in constant time (only their lengths can leak). Synchronous, so no other
 * message can slip in between reading the claim and storing it. */
function sameSecret(given: unknown, expected: string | undefined): boolean {
  if (typeof given !== "string" || !expected) return false;
  const [a, b] = [given, expected].map((text) => new TextEncoder().encode(text)) as [Uint8Array, Uint8Array];
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}
