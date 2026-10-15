import { describe, expect, it } from "vitest";
import { addRound, newCompetition, updateRound, type Competition } from "../src/pages/prep/competition.ts";
import { isNewerRevision, isRevision } from "../src/round-package/revision.ts";
import { isStale, REACTIONS, type PublicEntry, type Roster } from "../src/protocol/protocol.ts";
import { crowdRevisions, crowdRound, fakeName, parseCrowdArgs, pickReaction, pickVote, seatOf, voterOf } from "./crowd.ts";

describe("parseCrowdArgs", () => {
  it("takes the Competition file, with 4 Contestants, 12 phones and nothing stale by default", () => {
    expect(parseCrowdArgs(["demo.citd-competition.json"])).toEqual({
      file: "demo.citd-competition.json",
      contestants: 4,
      phones: 12,
      round: null,
      stale: 0,
      allowRemote: false,
    });
  });

  it("reads every option, in either form", () => {
    expect(
      parseCrowdArgs(["--contestants", "6", "c.json", "--phones=3", "--round", "Final", "--stale", "2", "--allow-remote"]),
    ).toEqual({ file: "c.json", contestants: 6, phones: 3, round: "Final", stale: 2, allowRemote: true });
  });

  it("explains a missing file, an unknown option or a bad count in one line", () => {
    expect(parseCrowdArgs([])).toEqual({ problem: expect.stringMatching(/^Usage: npm run dev:crowd -- <Competition file>/) });
    expect(parseCrowdArgs(["c.json", "--phone", "3"])).toEqual({ problem: expect.stringContaining("--phone") });
    expect(parseCrowdArgs(["c.json", "--phones", "many"])).toEqual({
      problem: "--phones takes a whole number, not many.",
    });
    expect(parseCrowdArgs(["c.json", "--contestants=-1"])).toEqual({
      problem: "--contestants takes a whole number, not -1.",
    });
    expect(parseCrowdArgs(["a.json", "b.json"])).toEqual({ problem: expect.stringMatching(/^Usage:/) });
  });

  it("refuses more stale entries than Contestants", () => {
    expect(parseCrowdArgs(["c.json", "--contestants", "2", "--stale", "3"])).toEqual({
      problem: "--stale 3 is more than the 2 Contestants.",
    });
  });
});

const competition = (): Competition => {
  let competition = newCompetition();
  for (const kind of ["final", "heat", "heat"] as const) competition = addRound(competition, kind, `${kind}${competition.rounds.length}`);
  return competition;
};

describe("crowdRound", () => {
  it("is the first Heat by default", () => {
    expect(crowdRound(competition(), null)).toMatchObject({ id: "heat1", name: "Heat 1" });
  });

  it("picks a Round by name or by id", () => {
    expect(crowdRound(competition(), "Heat 2")).toMatchObject({ id: "heat2" });
    expect(crowdRound(competition(), "final0")).toMatchObject({ name: "Final" });
  });

  it("refuses a Round the Competition doesn't have", () => {
    expect(crowdRound(competition(), "Heat 9")).toEqual({
      problem: 'There\'s no Round "Heat 9" in this Competition: it has Heat 1, Heat 2 and Final.',
    });
  });

  it("falls back to the first Round without Heats, and refuses a Competition without Rounds", () => {
    const finalOnly = addRound(newCompetition(), "final", "final0");
    expect(crowdRound(finalOnly, null)).toMatchObject({ id: "final0" });
    expect(crowdRound(newCompetition(), null)).toEqual({ problem: "This Competition has no Rounds." });
  });
});

describe("seats and voters", () => {
  it("are the same on every run, and different per Join code, Round and index", () => {
    expect(seatOf("K7XQ2N", "heat1", 0)).toBe(seatOf("K7XQ2N", "heat1", 0));
    const seats = new Set([
      seatOf("K7XQ2N", "heat1", 0),
      seatOf("K7XQ2N", "heat1", 1),
      seatOf("K7XQ2N", "heat2", 0),
      seatOf("ABCDEF", "heat1", 0),
    ]);
    expect(seats.size).toBe(4);
    expect(voterOf("K7XQ2N", 0)).toBe(voterOf("K7XQ2N", 0));
    expect(voterOf("K7XQ2N", 0)).not.toBe(voterOf("K7XQ2N", 1));
  });

  it("fit the Worker's limits", () => {
    expect(seatOf("K7XQ2N", "heat1", 99).length).toBeLessThanOrEqual(64);
    expect(voterOf("K7XQ2N", 99).length).toBeLessThanOrEqual(64);
  });
});

describe("fakeName", () => {
  it("is readable and different for each Contestant, even past the list", () => {
    const names = Array.from({ length: 60 }, (_, i) => fakeName(i));
    expect(new Set(names).size).toBe(60);
    expect(names[0]).toMatch(/^[A-Z][a-z]+ [A-Z][a-z-]+$/);
  });
});

describe("crowdRevisions", () => {
  const roster = (revisions: string[]): Roster => ({
    entries: revisions.map((revision, i) => ({ seat: `s${i}`, name: "x", revision, online: true })),
    newest: revisions.reduce((a, b) => (isNewerRevision(b, a) ? b : a)),
  });
  const staleCount = (revisions: string[]) => {
    const r = roster(revisions);
    return r.entries.filter((entry) => isStale(entry, r)).length;
  };
  const round = (stamps: string[]) =>
    updateRound(competition(), "heat1", (round) => ({
      ...round,
      revisions: stamps.map((stamp, i) => ({ n: i + 1, stamp, fingerprint: "f" })),
    })).rounds.find((round) => round.id === "heat1")!;

  it("gives every Contestant the Round's last Revision", () => {
    expect(crowdRevisions(round(["1-202610121403", "2-202610131000"]), 3, 0)).toEqual(Array(3).fill("2-202610131000"));
  });

  it("gives K of them the Revision before, so exactly K show stale", () => {
    const revisions = crowdRevisions(round(["1-202610121403", "2-202610131000"]), 4, 1);
    expect(revisions.filter((revision) => revision === "1-202610121403")).toHaveLength(1);
    expect(staleCount(revisions)).toBe(1);
  });

  it("makes up an older Revision when the Round has only one", () => {
    const revisions = crowdRevisions(round(["1-202610121403"]), 4, 2);
    expect(revisions.every(isRevision)).toBe(true);
    expect(staleCount(revisions)).toBe(2);
  });

  it("makes up a Revision when the Round was never exported", () => {
    const revisions = crowdRevisions(round([]), 3, 1);
    expect(revisions.every(isRevision)).toBe(true);
    expect(staleCount(revisions)).toBe(1);
  });
});

const entry = (id: string, more: Partial<PublicEntry> = {}): PublicEntry => ({ id, name: id, online: true, ...more });

/** A random source that walks through `values`, over and over. */
const sequence = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe("pickReaction", () => {
  it("picks an emoji and an online entry with a laptop", () => {
    const roster = [entry("by-hand", { handAdded: true }), entry("away", { online: false }), entry("ada"), entry("bo")];
    expect(pickReaction(roster, sequence(0.99, 0.99))).toEqual({ seat: "bo", e: REACTIONS.at(-1) });
    expect(pickReaction(roster, sequence(0, 0))).toEqual({ seat: "ada", e: REACTIONS[0] });
  });

  it("is null when nobody can get a Reaction", () => {
    expect(pickReaction([entry("by-hand", { handAdded: true }), entry("away", { online: false })], Math.random)).toBeNull();
    expect(pickReaction([], Math.random)).toBeNull();
  });
});

describe("pickVote", () => {
  it("is null on an empty Roster", () => {
    expect(pickVote([], Math.random)).toBeNull();
  });

  it("votes for any entry, by hand or offline too", () => {
    const roster = [entry("ada"), entry("away", { online: false }), entry("by-hand", { handAdded: true })];
    const picked = new Set(Array.from({ length: 200 }, (_, i) => pickVote(roster, sequence((i + 0.5) / 200))));
    expect(picked).toEqual(new Set(["ada", "away", "by-hand"]));
  });

  it("weights the first entry so it clearly leads", () => {
    const roster = ["ada", "bo", "cy", "di"].map((id) => entry(id));
    const votes: Record<string, number> = {};
    for (let i = 0; i < 1000; i++) {
      const seat = pickVote(roster, sequence((i + 0.5) / 1000))!;
      votes[seat] = (votes[seat] ?? 0) + 1;
    }
    const [first, second] = Object.values(votes).sort((a, b) => b - a);
    expect(votes.ada).toBe(first);
    expect(first!).toBeGreaterThan(2 * second!);
  });
});
