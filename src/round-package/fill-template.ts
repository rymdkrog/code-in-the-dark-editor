// Turns the Core Editor template into one Round's package. Pure: no DOM, no I/O, so the
// prep page and the build can both use it (and a CLI could wrap it).

import type { RoundData } from "./round-data.ts";

const SLOT = /<script type="application\/json" id="round">[\s\S]*?<\/script>/g;
const HEAD = /<head(\s[^>]*)?>/;
const BOM = "﻿";

export function fillTemplate(template: string, round: RoundData): string {
  const slots = template.match(SLOT) ?? [];
  if (slots.length !== 1) {
    throw new Error(`The template must have exactly one Round slot; found ${slots.length}`);
  }
  if (!HEAD.test(template)) {
    throw new Error("The template has no <head> to write the CSP into");
  }

  const json = JSON.stringify(round).replaceAll("</", "<\\/").replaceAll("<!--", "\\u003C!--");
  const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(round)}">`;

  const html = template
    .replace(SLOT, () => `<script type="application/json" id="round">${json}</script>`)
    .replace(HEAD, (head) => `${head}\n${meta}`);

  // The licence comment pushes <meta charset> past the 1024-byte encoding prescan,
  // so the byte order mark is what keeps the package UTF-8 from file://.
  return BOM + (html.startsWith(BOM) ? html.slice(BOM.length) : html);
}

function contentSecurityPolicy(round: RoundData): string {
  const directives = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data: blob:",
  ];
  if (round.audience) directives.push(`connect-src ${socketOrigin(round.audience.workerUrl)}`);
  return directives.join("; ");
}

const SOCKET_SCHEMES: Record<string, string> = { "https:": "wss:", "wss:": "wss:", "http:": "ws:", "ws:": "ws:" };

/** The origin of the Worker's sockets, e.g. `wss://citd.example.workers.dev`. Throws on a URL
 * that can't be one. */
export function socketOrigin(workerUrl: string): string {
  const url = URL.canParse(workerUrl) ? new URL(workerUrl) : undefined;
  const scheme = url && SOCKET_SCHEMES[url.protocol];
  if (!url || !scheme) throw new Error(`Not a usable Worker URL: ${workerUrl}`);
  return `${scheme}//${url.host}`;
}
