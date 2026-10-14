// The links between the prep page and the pages the Worker serves.

import { encodeClaim, type Claim } from "../protocol/protocol.ts";

/** The private Host console link. Its `#fragment` carries the whole claim and never reaches a server. */
export const hostConsoleLink = (workerOrigin: string, claim: Claim) => `${workerOrigin}/host/#${encodeClaim(claim)}`;

/** The read-only Stage's link: it needs only the public Join code. */
export const stageLink = (workerOrigin: string, joinCode: string) => `${workerOrigin}/stage/?c=${joinCode}`;

/** The socket URL for a page served by the Worker, on the same origin as the page. */
export const sameOriginSocket = (path: string) =>
  `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}${path}`;
