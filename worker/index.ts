// The Audience layer's Worker. It routes each Competition's sockets to that Competition's
// Durable Object; the Host console, Stage and Audience phone pages are its static assets.
// There is no Origin allowlist: every file:// page sends `Origin: null`.

import { parseSocketPath } from "../src/protocol/protocol.ts";

export { Competition } from "./competition.ts";

export interface Env {
  COMPETITIONS: DurableObjectNamespace<import("./competition.ts").Competition>;
  /** The Worker secret a Host types to claim a Competition. Nothing stores it. */
  ORGANIZER_KEY?: string;
}

export default {
  async fetch(request, env): Promise<Response> {
    const socket = parseSocketPath(new URL(request.url).pathname);
    if (!socket) return reply("Not found", 404);
    if (request.headers.get("Upgrade") !== "websocket") return reply("Expected a WebSocket", 426);
    return env.COMPETITIONS.getByName(socket.joinCode).fetch(request);
  },
} satisfies ExportedHandler<Env>;

const reply = (body: string, status: number) =>
  new Response(body, { status, headers: { "Access-Control-Allow-Origin": "*" } });
