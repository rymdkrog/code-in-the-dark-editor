import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fillTemplate } from "../../round-package/fill-template.ts";
import { addRound, newCompetition, packageFileName, roundData, type Competition } from "./competition.ts";
import { exportPackages } from "./export.ts";

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

/** Each entry of the zip, read back by the system's own unzip. */
function unzipped(bytes: Uint8Array): Record<string, string> {
  const path = join(mkdtempSync(join(tmpdir(), "citd-export-")), "packages.zip");
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
