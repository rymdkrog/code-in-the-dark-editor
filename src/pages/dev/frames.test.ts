import { describe, expect, it } from "vitest";
import { newClaim } from "../../../tests/round-packages.ts";
import { hostConsoleLink, joinLink, stageLink } from "../links.ts";
import { controlRoomFrames, phoneCount } from "./frames.ts";

const claim = newClaim();
const at = (href: string) => new URL(href);

describe("controlRoomFrames", () => {
  it("puts the Host console and the Stage on the control room's own origin", () => {
    const [host, stage] = controlRoomFrames(at("http://localhost:8787/dev/"), claim, 2);
    expect(host).toEqual({ label: "Host console", src: hostConsoleLink("http://localhost:8787", claim), kind: "host" });
    expect(stage).toEqual({
      label: "Stage",
      src: stageLink("http://localhost:8787", claim.joinCode, claim.competitionName),
      kind: "stage",
    });
  });

  it("puts each phone on a localhost subdomain of its own, on the control room's port", () => {
    const phones = controlRoomFrames(at("http://localhost:8787/dev/"), claim, 3).slice(2);
    expect(phones).toEqual([1, 2, 3].map((n) => ({
      label: `Phone ${n}`,
      src: joinLink(`http://phone${n}.localhost:8787`, claim.joinCode),
      kind: "phone",
    })));
  });

  it("keeps the phones on localhost subdomains when the control room is opened on 127.0.0.1", () => {
    const [, , phone] = controlRoomFrames(at("http://127.0.0.1:9000/dev/"), claim, 2);
    expect(phone!.src).toBe(joinLink("http://phone1.localhost:9000", claim.joinCode));
  });

  it("leaves the port out when the control room has none", () => {
    const [, , phone] = controlRoomFrames(at("http://localhost/dev/"), claim, 2);
    expect(phone!.src).toBe(joinLink("http://phone1.localhost", claim.joinCode));
  });
});

describe("phoneCount", () => {
  it("is 3 unless the query asks for 2 to 4", () => {
    expect(phoneCount("")).toBe(3);
    expect(phoneCount("?phones=2")).toBe(2);
    expect(phoneCount("?phones=4")).toBe(4);
    expect(phoneCount("?phones=1")).toBe(2);
    expect(phoneCount("?phones=9")).toBe(4);
    expect(phoneCount("?phones=lots")).toBe(3);
  });
});
