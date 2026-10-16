import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fillTemplate, roundSlotJson } from "../../round-package/fill-template.ts";
import {
  addRound,
  newCompetition,
  nextRevision,
  packageFileName,
  roundData,
  roundStatus,
  updateAudience,
  type Competition,
} from "./competition.ts";
import { exportPackages, tryPackage } from "./export.ts";

const TEMPLATE = `<!doctype html>
<html><head><title>Code in the Dark</title></head>
<body><script type="application/json" id="round"></script></body></html>
`;
const VERSION = "2.0.0+test";
const NOW = new Date("2026-10-15T14:03:00Z");
const reference = { name: "reference.png", dataUri: "data:image/png;base64,iVBORw0KGgo=", width: 1280, height: 720 };

function competitionWith(heats: number): Competition {
  let competition: Competition = { ...newCompetition(), name: "Gothenburg 2026" };
  for (let i = 1; i <= heats; i++) competition = addRound(competition, "heat", `r${i}`);
  return { ...competition, rounds: competition.rounds.map((round) => ({ ...round, reference })) };
}

const folder = mkdtempSync(join(tmpdir(), "citd-export-"));
let zips = 0;
afterAll(() => rmSync(folder, { recursive: true, force: true }));

/** Each entry of the zip, read back by the system's own unzip. */
function unzipped(bytes: Uint8Array): Record<string, string> {
  const path = join(folder, `${++zips}.zip`);
  writeFileSync(path, bytes);
  const names = execFileSync("zipinfo", ["-1", path], { encoding: "utf8" }).trim().split("\n");
  return Object.fromEntries(names.map((name) => [name, execFileSync("unzip", ["-p", path, name], { encoding: "utf8" })]));
}

describe("exportPackages", () => {
  it("exports one Round as its own .html package", () => {
    const competition = competitionWith(1);
    const round = competition.rounds[0]!;

    const { file, revisions } = exportPackages(competition, [round], TEMPLATE, VERSION, NOW);

    expect(revisions).toEqual([{ id: "r1", revision: expect.objectContaining({ n: 1, stamp: "1-202610151403" }) }]);
    expect(file).toEqual({
      fileName: "citd-gothenburg-2026-heat-1.html",
      content: fillTemplate(TEMPLATE, roundData(competition, round, revisions[0]!.revision, VERSION)),
      type: "text/html",
    });
  });

  it("zips two or more Rounds, each entry exactly the package a single export would give", () => {
    let competition = competitionWith(2);
    // Heat 2 was exported before, so this is its Rev 2.
    competition = {
      ...competition,
      rounds: competition.rounds.map((round) =>
        round.id === "r2" ? { ...round, revisions: [{ n: 1, stamp: "1-202610140900", fingerprint: "old" }] } : round,
      ),
    };

    const { file, revisions } = exportPackages(competition, competition.rounds, TEMPLATE, VERSION, NOW);

    expect(file.fileName).toBe("citd-gothenburg-2026-packages.zip");
    expect(file.type).toBe("application/zip");
    expect(revisions.map(({ id, revision }) => [id, revision.stamp])).toEqual([
      ["r1", "1-202610151403"],
      ["r2", "2-202610151403"],
    ]);
    expect(unzipped(file.content as Uint8Array)).toEqual(
      Object.fromEntries(
        competition.rounds.map((round, i) => [
          packageFileName(competition, round),
          fillTemplate(TEMPLATE, roundData(competition, round, revisions[i]!.revision, VERSION)),
        ]),
      ),
    );
  });

  it("names the zip with the same prefix as the packages", () => {
    const competition = { ...competitionWith(2), prefix: "GBG 26" };
    const { file } = exportPackages(competition, competition.rounds, TEMPLATE, VERSION, NOW);
    expect(packageFileName(competition, competition.rounds[0]!)).toBe("citd-gbg-26-heat-1.html");
    expect(file.fileName).toBe("citd-gbg-26-packages.zip");
  });
});

describe("tryPackage", () => {
  const withAudience = (competition: Competition) =>
    updateAudience(competition, { enabled: true, workerUrl: "https://citd.example.workers.dev" });

  it("is the package an export would give, stamped with the next Revision", () => {
    const competition = competitionWith(1);
    const round = competition.rounds[0]!;

    expect(tryPackage(competition, round, TEMPLATE, VERSION, NOW)).toBe(
      fillTemplate(TEMPLATE, roundData(competition, round, nextRevision(competition, round, NOW), VERSION)),
    );
  });

  it("carries no Audience connection, so it opens no socket, even with the Audience layer on", () => {
    const competition = withAudience(competitionWith(1));
    const round = competition.rounds[0]!;
    expect(roundData(competition, round, { stamp: "" }, VERSION).audience).toBeDefined();

    const html = tryPackage(competition, round, TEMPLATE, VERSION, NOW);

    const data = JSON.parse(roundSlotJson(html)!);
    expect(data).not.toHaveProperty("audience");
    expect(data.revision).toBe("1-202610151403");
    expect(html).not.toContain("connect-src");
  });

  it("records nothing: the Round's Revisions and status stay as they were", () => {
    const competition = withAudience(competitionWith(1));
    const round = competition.rounds[0]!;
    const before = structuredClone(competition);

    tryPackage(competition, round, TEMPLATE, VERSION, NOW);

    expect(competition).toEqual(before);
    expect(roundStatus(competition, round)).toEqual({ kind: "not exported" });
  });
});
