// What the dev-only control room shows: the Host console, the Stage and a few phones, each in a frame.

import type { Claim } from "../../protocol/protocol.ts";
import { hostConsoleLink, joinLink, stageLink } from "../links.ts";

export interface Frame {
  label: string;
  src: string;
  kind: "host" | "stage" | "phone";
}

/** The control room's frames for `claim`, from the control room at `page`. The Host console and
 * the Stage share its origin. Each phone gets a `phoneN.localhost` origin of its own on the same
 * port, so its own localStorage and voter id: never the control room's origin, which the Host
 * console's frame shares. */
export function controlRoomFrames(page: Pick<URL, "protocol" | "origin" | "port">, claim: Claim, phones: number): Frame[] {
  const port = page.port ? `:${page.port}` : "";
  return [
    { label: "Host console", src: hostConsoleLink(page.origin, claim), kind: "host" },
    { label: "Stage", src: stageLink(page.origin, claim.joinCode, claim.competitionName), kind: "stage" },
    ...Array.from({ length: phones }, (_, i): Frame => ({
      label: `Phone ${i + 1}`,
      src: joinLink(`${page.protocol}//phone${i + 1}.localhost${port}`, claim.joinCode),
      kind: "phone",
    })),
  ];
}

/** How many phones the control room's query asks for (`?phones=N`), from 2 to 4; 3 by default. */
export function phoneCount(search: string) {
  const asked = Number.parseInt(new URLSearchParams(search).get("phones") ?? "", 10);
  return Number.isNaN(asked) ? 3 : Math.min(4, Math.max(2, asked));
}
