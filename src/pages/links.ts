// The links between the prep page and the pages the Worker serves.

import { encodeClaim, type Claim } from "../protocol/protocol.ts";

/** The private Host console link. Its `#fragment` carries the whole claim and never reaches a server. */
export const hostConsoleLink = (workerOrigin: string, claim: Claim) => `${workerOrigin}/host/#${encodeClaim(claim)}`;

/** The dev-only control room's link (see src/pages/dev/), with the same claim as the Host console
 * link. On localhost rather than 127.0.0.1, so that its phones' `phoneN.localhost` origins resolve. */
export function controlRoomLink(workerOrigin: string, claim: Claim) {
  const url = new URL(hostConsoleLink(workerOrigin, claim).replace("/host/#", "/dev/#"));
  if (url.hostname === "127.0.0.1") url.hostname = "localhost";
  return url.href;
}

/** The read-only Stage's link: it needs only the public Join code. The Competition name rides
 * along so the Stage can show it before the claim, when the Worker doesn't know it yet. */
export function stageLink(workerOrigin: string, joinCode: string, competitionName: string) {
  const query = new URLSearchParams({ c: joinCode });
  if (competitionName) query.set("n", competitionName);
  return `${workerOrigin}/stage/?${query}`;
}

/** The Audience phone page's link, which the Stage shows as a QR code. */
export const joinLink = (workerOrigin: string, joinCode: string) => `${workerOrigin}/join?c=${joinCode}`;

/** The socket URL for a page served by the Worker, on the same origin as the page. */
export const sameOriginSocket = (path: string) =>
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
