// One Durable Object per Competition, addressed by its Join code. Plain WebSocket Hibernation
// API, no framework. Its storage, not its memory, holds the claim, so a restart loses nothing.

import { DurableObject } from "cloudflare:workers";
import {
  CLOSE_VERSION,
  isClaim,
  parseSocketPath,
  PING,
  PONG,
  V,
  type Claim,
  type ClientMessage,
  type CompetitionSummary,
  type ServerMessage,
} from "../src/protocol/protocol.ts";
import type { Env } from "./index.ts";

/** What a socket carries through hibernation. */
interface Attachment {
  joinCode: string;
  /** Set once the socket has shown the Host secret. */
  host?: true;
}

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
    server.serializeAttachment({ joinCode } satisfies Attachment);
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
    }
  }

  private async greetHost(socket: WebSocket, hostSecret: unknown) {
    const claim = await this.ctx.storage.get<Claim>("claim");
    if (!claim) return send(socket, { v: V, t: "unclaimed" });
    if (!sameSecret(hostSecret, claim.hostSecret)) return send(socket, { v: V, t: "host-refused" });
    this.admitHost(socket, claim);
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
    this.admitHost(socket, existing ?? claim);
  }

  private admitHost(socket: WebSocket, claim: Claim) {
    socket.serializeAttachment({ ...(socket.deserializeAttachment() as Attachment), host: true } satisfies Attachment);
    send(socket, { v: V, t: "competition", competition: summary(claim) });
  }
}

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
