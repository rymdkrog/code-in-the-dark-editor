import { describe, expect, it } from "vitest";
import { V, type CompetitionSummary, type ServerMessage } from "../../protocol/protocol.ts";
import { CONNECTING, hostSocketUrl, standingAfter, type Standing } from "./host-socket.ts";

const audience = {
  enabled: true,
  workerUrl: "https://citd.example.workers.dev/",
  joinCode: "K7XQ2N",
};

const summary: CompetitionSummary = {
  name: "Gothenburg 2026",
  joinCode: "K7XQ2N",
  rounds: [
    { id: "heat000001", name: "Heat 1" },
    { id: "final00000", name: "Final" },
  ],
};

const snapshot: ServerMessage = {
  v: V,
  t: "competition",
  competition: summary,
  lifecycle: { current: "heat000001", phase: "upcoming", durationMs: 900_000, endsAt: null },
  rosters: {},
  tallies: {},
};

const claimed: Standing = { kind: "claimed", rounds: summary.rounds, leftOut: null };

describe("hostSocketUrl", () => {
  it("is the Worker's Host socket for the Join code, like a Round package's", () => {
    expect(hostSocketUrl(audience)).toBe("wss://citd.example.workers.dev/socket/K7XQ2N/host");
    expect(hostSocketUrl({ ...audience, workerUrl: " http://localhost:8788 " })).toBe(
      "ws://localhost:8788/socket/K7XQ2N/host",
    );
  });

  it("is none while the Audience layer is off", () => {
    expect(hostSocketUrl({ ...audience, enabled: false })).toBeNull();
  });

  it("is none for a Worker URL that isn't one", () => {
    expect(hostSocketUrl({ ...audience, workerUrl: "" })).toBeNull();
    expect(hostSocketUrl({ ...audience, workerUrl: "citd.example.workers.dev" })).toBeNull();
    expect(hostSocketUrl({ ...audience, workerUrl: "ftp://citd.example.workers.dev" })).toBeNull();
  });
});

describe("standingAfter", () => {
  it("is connecting once the socket opens, until the Worker answers", () => {
    expect(standingAfter({ kind: "unreachable" }, { t: "open" })).toEqual(CONNECTING);
    expect(standingAfter(claimed, { t: "open" })).toEqual(CONNECTING);
  });

  it("is unreachable while the socket is down", () => {
    expect(standingAfter(CONNECTING, { t: "down" })).toEqual({ kind: "unreachable" });
    expect(standingAfter(claimed, { t: "down" })).toEqual({ kind: "unreachable" });
  });

  it("follows the Worker's answer to the Host secret", () => {
    expect(standingAfter(CONNECTING, { v: V, t: "unclaimed" })).toEqual({ kind: "unclaimed", refusal: null });
    expect(standingAfter(CONNECTING, { v: V, t: "host-refused" })).toEqual({ kind: "refused" });
    expect(standingAfter(CONNECTING, snapshot)).toEqual(claimed);
  });

  it("keeps a claim's refusal until the next answer", () => {
    const refused = standingAfter({ kind: "unclaimed", refusal: null }, { v: V, t: "claim-refused", reason: "organizer-key" });
    expect(refused).toEqual({ kind: "unclaimed", refusal: "organizer-key" });
    expect(standingAfter(refused, snapshot)).toEqual(claimed);
  });

  it("names the Current Round a refused Round list leaves out, until the Worker takes a list", () => {
    const leftOut = standingAfter(standingAfter(claimed, snapshot), {
      v: V,
      t: "rounds-refused",
      reason: "current-round",
      roundId: "heat000001",
    });
    expect(leftOut).toEqual({ ...claimed, leftOut: "heat000001" });
    expect(standingAfter(leftOut, snapshot)).toEqual(claimed);
  });

  it("ignores what only a control desk needs, and anything it doesn't know", () => {
    const ignored: unknown[] = [
      { v: V, t: "lifecycle", lifecycle: { current: null, phase: null, durationMs: 900_000, endsAt: null } },
      { v: V, t: "roster", roundId: "heat000001", roster: { entries: [], newest: null } },
      { v: V, t: "tally", roundId: "heat000001", tally: {} },
      { v: V, t: "refused", command: "start", reason: "transition" },
      { v: V, t: "something-new" },
      null,
      "pong",
    ];
    for (const message of ignored) expect(standingAfter(claimed, message)).toBe(claimed);
  });
});
