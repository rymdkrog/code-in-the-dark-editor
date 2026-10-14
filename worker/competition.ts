// One Durable Object per Competition, addressed by its Join code. Plain WebSocket Hibernation
// API, no framework. Its storage, not its memory, holds the claim, the lifecycle and the
// Rosters, so a restart loses nothing. Who is connected is the open sockets, not storage.

import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_TOKEN,
  CLOSE_UNCLAIMED,
  CLOSE_VERSION,
  isClaim,
  isNewerRevision,
  parseSocketPath,
  PING,
  PONG,
  V,
  type Claim,
  type ClientMessage,
  type CompetitionSummary,
  type ContestantMessage,
  type Lifecycle,
  type LifecycleCommand,
  type Presence,
  type Role,
  type Roster,
  type RosterEntry,
  type ServerMessage,
} from "../src/protocol/protocol.ts";
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
  /** Set once a Contestant socket's presence is on a Roster. */
  seat?: Seat;
}

/** The roles that may follow the Current Round. A Contestant receives Reactions only. */
const FOLLOWERS: Role[] = ["stage", "phone"];

/** Where on which Roster a Contestant socket is. */
type Seat = Pick<Presence, "roundId" | "seat">;

/** A Round's Roster as stored: everything but who is connected. */
interface StoredRoster {
  entries: Omit<RosterEntry, "online">[];
  newest: string | null;
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
        return this.greetHost(socket, message.hostSecret);
      case "claim":
        return this.claim(socket, message.organizerKey, message.claim);
      case "follow":
        return this.follow(socket);
      case "presence":
        return this.presence(socket, message);
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

  private async greetHost(socket: WebSocket, hostSecret: unknown) {
    const claim = await this.ctx.storage.get<Claim>("claim");
    if (!claim) return send(socket, { v: V, t: "unclaimed" });
    if (!sameSecret(hostSecret, claim.hostSecret)) return send(socket, { v: V, t: "host-refused" });
    await this.admitHost(socket, claim);
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
    if (!existing) await this.ctx.storage.put("claim", claim);
    await this.admitHost(socket, existing ?? claim);
    if (!existing) await this.tellFollowers(claim);
  }

  private async admitHost(socket: WebSocket, claim: Claim) {
    socket.serializeAttachment({ ...(socket.deserializeAttachment() as Attachment), host: true } satisfies Attachment);
    const lifecycle = await this.lifecycle();
    const stored = await this.ctx.storage.get<StoredRoster>(claim.rounds.map((round) => rosterKey(round.id)));
    const rosters = Object.fromEntries(
      claim.rounds.map((round) => [round.id, this.withOnline(round.id, stored.get(rosterKey(round.id)))]),
    );
    send(socket, { v: V, t: "competition", competition: summary(claim), lifecycle, rosters });
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
    const roster = (await this.ctx.storage.get<StoredRoster>(rosterKey(roundId))) ?? { entries: [], newest: null };
    const at = roster.entries.findIndex((entry) => entry.seat === seat);
    roster.entries.splice(at === -1 ? roster.entries.length : at, 1, { seat, name, revision });
    if (roster.newest === null || isNewerRevision(revision, roster.newest)) roster.newest = revision;
    await this.ctx.storage.put(rosterKey(roundId), roster);

    const was = attachment.seat;
    socket.serializeAttachment({ ...attachment, seat: { roundId, seat } } satisfies Attachment);
    if (was && (was.roundId !== roundId || was.seat !== seat)) await this.rosterChanged(was.roundId);
    this.tellHosts({ v: V, t: "roster", roundId, roster: this.withOnline(roundId, roster) });
  }

  /** A socket closed: if it was a laptop on a Roster, its entry may now be offline. */
  private async left(socket: WebSocket) {
    const { seat } = socket.deserializeAttachment() as Attachment;
    if (seat) await this.rosterChanged(seat.roundId, socket);
  }

  /** Tells every Host a Round's Roster as it is now, leaving out a socket that is closing. */
  private async rosterChanged(roundId: string, closing?: WebSocket) {
    const stored = await this.ctx.storage.get<StoredRoster>(rosterKey(roundId));
    this.tellHosts({ v: V, t: "roster", roundId, roster: this.withOnline(roundId, stored, closing) });
  }

  /** A stored Roster with each entry's connection: online while one of its laptop's sockets is open. */
  private withOnline(roundId: string, stored: StoredRoster | undefined, closing?: WebSocket): Roster {
    const online = new Set<string>();
    for (const socket of this.ctx.getWebSockets("contestant")) {
      const { seat } = socket.deserializeAttachment() as Attachment;
      if (socket !== closing && seat?.roundId === roundId) online.add(seat.seat);
    }
    return {
      entries: (stored?.entries ?? []).map((entry) => ({ ...entry, online: online.has(entry.seat) })),
      newest: stored?.newest ?? null,
    };
  }

  /** A Stage or phone follows the Current Round from now on. Before the claim it waits, and the
   * claim brings it the snapshot. */
  private async follow(socket: WebSocket) {
    if (!this.ctx.getTags(socket).some((role) => FOLLOWERS.includes(role as Role))) return;
    socket.serializeAttachment({ ...(socket.deserializeAttachment() as Attachment), follows: true } satisfies Attachment);
    const claim = await this.ctx.storage.get<Claim>("claim");
    if (!claim) return send(socket, { v: V, t: "unclaimed" });
    send(socket, await this.publicSnapshot(claim));
  }

  private async command(socket: WebSocket, command: LifecycleCommand) {
    if (!isHost(socket)) {
      return send(socket, { v: V, t: "refused", command: command.t, reason: "host-secret" });
    }
    // A socket is a Host's only once the Competition is claimed.
    const { rounds } = (await this.ctx.storage.get<Claim>("claim"))!;
    const next = transition(await this.lifecycle(), command, rounds, Date.now());
    if (!next) return send(socket, { v: V, t: "refused", command: command.t, reason: "transition" });
    await this.change(next);
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

  private async tellFollowers(claim: Claim) {
    const followers = this.ctx.getWebSockets().filter(follows);
    if (!followers.length) return;
    const snapshot = await this.publicSnapshot(claim);
    for (const socket of followers) send(socket, snapshot);
  }

  private async publicSnapshot(claim: Claim): Promise<ServerMessage> {
    // Nobody is on a Roster until Contestants send presence.
    return { v: V, t: "public", competition: summary(claim), lifecycle: await this.lifecycle(), roster: [] };
  }
}

const rosterKey = (roundId: string) => `roster:${roundId}`;

/** The presence in a Contestant's message, or null if a field is missing or malformed. */
function validPresence(message: Partial<Record<keyof Presence, unknown>>): Presence | null {
  const { roundId, seat, name, revision } = message;
  if (typeof roundId !== "string" || typeof seat !== "string" || typeof name !== "string") return null;
  if (typeof revision !== "string" || !/^\d+-\d{12}$/.test(revision)) return null;
  if (!seat || seat.length > MAX_SEAT_LENGTH || !name.trim()) return null;
  return { roundId, seat, name: name.trim().slice(0, MAX_NAME_LENGTH), revision };
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
