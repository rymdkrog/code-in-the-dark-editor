import { describe, expect, it } from "vitest";
import { addRound, newCompetition, stageCopyFingerprint, updateRound, type Asset, type Competition } from "./competition.ts";
import { stageCopyPlan, stageCopyProblem } from "./stage-copy.ts";

const reference = (dataUri: string): Asset => ({ name: "page.png", dataUri, width: 1440, height: 900 });
const first = reference("data:image/png;base64,AAAA");
const second = reference("data:image/png;base64,BBBB");

/** Heat 1 with the first Reference, Heat 2 with the second, and a Final with none. */
function competition(): Competition {
  let competition = addRound(addRound(addRound(newCompetition(), "heat", "heat1"), "heat", "heat2"), "final", "final");
  competition = updateRound(competition, "heat1", (round) => ({ ...round, reference: first }));
  return updateRound(competition, "heat2", (round) => ({ ...round, reference: second }));
}

const none = { sent: {}, refusals: {} };

describe("stageCopyFingerprint", () => {
  it("follows the Reference's image, not its file name", () => {
    expect(stageCopyFingerprint(first)).toBe(stageCopyFingerprint({ ...first, name: "other.png" }));
    expect(stageCopyFingerprint(first)).not.toBe(stageCopyFingerprint(second));
  });
});

describe("stageCopyPlan", () => {
  it("sends every Round's copy to a Worker that holds none", () => {
    expect(stageCopyPlan(competition(), {}, none)).toEqual({
      set: [
        { roundId: "heat1", fingerprint: stageCopyFingerprint(first), reference: first },
        { roundId: "heat2", fingerprint: stageCopyFingerprint(second), reference: second },
      ],
      clear: [],
    });
  });

  it("doesn't re-send copies the Worker already holds", () => {
    const held = { heat1: stageCopyFingerprint(first), heat2: stageCopyFingerprint(second) };
    expect(stageCopyPlan(competition(), held, none)).toEqual({ set: [], clear: [] });
  });

  it("sends a replaced Reference's copy", () => {
    const held = { heat1: stageCopyFingerprint(second), heat2: stageCopyFingerprint(second) };
    expect(stageCopyPlan(competition(), held, none).set.map(({ roundId }) => roundId)).toEqual(["heat1"]);
  });

  it("clears the copy of a Round whose Reference was removed, or that is gone", () => {
    const held = {
      heat1: stageCopyFingerprint(first),
      heat2: stageCopyFingerprint(second),
      final: "stale",
      deleted: "stale",
    };
    expect(stageCopyPlan(competition(), held, none)).toEqual({ set: [], clear: ["final", "deleted"] });
  });

  it("doesn't send again what it sent and the Worker hasn't confirmed yet", () => {
    const sent = { heat1: stageCopyFingerprint(first), heat2: stageCopyFingerprint(second), gone: null };
    expect(stageCopyPlan(competition(), { gone: "stale" }, { sent, refusals: {} })).toEqual({ set: [], clear: [] });
  });

  it("doesn't send again a copy the Worker refused, until the Reference changes", () => {
    const refusals = { heat1: { fingerprint: stageCopyFingerprint(first), reason: "too-large" as const } };
    expect(stageCopyPlan(competition(), {}, { sent: {}, refusals }).set.map(({ roundId }) => roundId)).toEqual(["heat2"]);
    const stale = { heat1: { fingerprint: "an older Reference", reason: "too-large" as const } };
    expect(stageCopyPlan(competition(), {}, { sent: {}, refusals: stale }).set).toHaveLength(2);
  });
});

describe("stageCopyProblem", () => {
  it("says why the Worker refused a Round's copy", () => {
    expect(stageCopyProblem("too-large")).toMatch(/Stage copy.*too big/);
    expect(stageCopyProblem("not-image")).toMatch(/Stage copy.*isn't an image/);
    expect(stageCopyProblem("invalid")).toMatch(/Stage copy.*Round list/);
    expect(stageCopyProblem("host-secret")).toMatch(/Stage copy.*Host/);
    expect(stageCopyProblem("unreadable")).toMatch(/couldn.t make a Stage copy/);
  });
});
