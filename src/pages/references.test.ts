import { describe, expect, it } from "vitest";
import { fillTemplate } from "../round-package/fill-template.ts";
import type { RoundData } from "../round-package/round-data.ts";
import { addRound, competitionFile, newCompetition, updateRound, type Competition } from "./prep/competition.ts";
import { dropMessage, referencesIn } from "./references.ts";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const asset = (dataUri: string) => ({ name: "page.png", dataUri, width: 1440, height: 900 });

function competition(): Competition {
  let made = addRound(addRound(addRound(newCompetition(), "heat", "heat1aaaaa"), "heat", "heat2bbbbb"), "final", "final0000");
  made = updateRound(made, "heat1aaaaa", (round) => ({ ...round, reference: asset(PNG) }));
  made = updateRound(made, "final0000", (round) => ({
    ...round,
    reference: asset("data:image/jpeg;base64,/9j/"),
    assets: [{ name: "logo.svg", dataUri: "data:image/svg+xml;base64,PHN2Zz4=", width: 10, height: 10 }],
  }));
  return made;
}

const TEMPLATE = `<!doctype html><html><head><title>Code in the Dark</title></head><body>
<script type="application/json" id="round"></script><script type="module">console.log("core");</script></body></html>`;

const round: RoundData = {
  competitionName: "Gothenburg 2026",
  filePrefix: "gbg26",
  roundName: "Heat 2",
  roundId: "heat2bbbbb",
  revision: "3-202610121403",
  editorVersion: "2.0.0+f72fd0a",
  shake: true,
  instructions: { rules: "No preview. </script> No help.", note: "", colours: [] },
  reference: PNG,
  assets: [],
};

describe("referencesIn", () => {
  it("finds every Round's Reference in a Competition file, by Round id, and which Rounds have none", () => {
    expect(referencesIn(competitionFile(competition()))).toEqual([
      { roundId: "heat1aaaaa", reference: PNG },
      { roundId: "heat2bbbbb", reference: null },
      { roundId: "final0000", reference: "data:image/jpeg;base64,/9j/" },
    ]);
  });

  it("finds the Reference in a Round package", () => {
    expect(referencesIn(fillTemplate(TEMPLATE, round))).toEqual([{ roundId: "heat2bbbbb", reference: PNG }]);
  });

  it("refuses anything else", () => {
    expect(referencesIn("")).toBeNull();
    expect(referencesIn("hello")).toBeNull();
    expect(referencesIn(JSON.stringify({ name: "not a Competition file" }))).toBeNull();
    expect(referencesIn("<!doctype html><title>Some page</title>")).toBeNull();
    expect(referencesIn(fillTemplate(TEMPLATE, { ...round, reference: "https://example.com/page.png" }))).toBeNull();
    expect(referencesIn(fillTemplate(TEMPLATE, { ...round, roundId: 7 as unknown as string }))).toBeNull();
  });
});

describe("dropMessage", () => {
  const rounds = [
    { id: "heat1aaaaa", name: "Heat 1" },
    { id: "heat2bbbbb", name: "Heat 2" },
    { id: "final0000", name: "Final" },
  ];

  it("names the Rounds whose References it loaded", () => {
    expect(dropMessage({ roundIds: ["heat1aaaaa"], refused: [] }, rounds)).toBe("Loaded the Reference for Heat 1.");
    expect(dropMessage({ roundIds: ["heat1aaaaa", "final0000"], refused: [] }, rounds)).toBe(
      "Loaded the References for Heat 1 and Final.",
    );
    expect(dropMessage({ roundIds: ["heat1aaaaa", "heat2bbbbb", "final0000"], refused: [] }, rounds)).toBe(
      "Loaded the References for Heat 1, Heat 2 and Final.",
    );
  });

  it("counts the Rounds it doesn't know", () => {
    expect(dropMessage({ roundIds: ["heat1aaaaa", "elsewhere1", "elsewhere2"], refused: [] }, rounds)).toBe(
      "Loaded the References for Heat 1 and 2 other Rounds.",
    );
    expect(dropMessage({ roundIds: ["elsewhere1"], refused: [] }, [])).toBe("Loaded the Reference for 1 other Round.");
  });

  it("names the files that held no References", () => {
    expect(dropMessage({ roundIds: [], refused: ["notes.txt"] }, rounds)).toBe("No References in notes.txt.");
    expect(dropMessage({ roundIds: ["final0000"], refused: ["a.txt", "b.png"] }, rounds)).toBe(
      "Loaded the Reference for Final. No References in a.txt, b.png.",
    );
  });
});
