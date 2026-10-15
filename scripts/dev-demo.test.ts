import { describe, expect, it } from "vitest";
import { hostConsoleLink, joinLink, stageLink } from "../src/pages/links.ts";
import { claimOf } from "../src/pages/prep/competition.ts";
import type { RoundData } from "../src/round-package/round-data.ts";
import { demoCompetition, demoLinks, organizerKeyIn, refusal } from "./dev-demo.ts";

describe("refusal", () => {
  it("lets a local Worker through", () => {
    expect(refusal("http://localhost:8787", false)).toBeNull();
    expect(refusal("http://127.0.0.1:9000", false)).toBeNull();
  });

  it("refuses a remote Worker unless --allow-remote is given", () => {
    expect(refusal("https://citd.example.workers.dev", false)).toBe(
      "Refusing https://citd.example.workers.dev: it isn't local. Pass --allow-remote to claim there anyway.",
    );
    expect(refusal("https://citd.example.workers.dev", true)).toBeNull();
  });

  it("always refuses the e2e Worker's port", () => {
    const why = "Refusing http://localhost:8788: that's the port `npm run test:e2e` runs its Worker on.";
    expect(refusal("http://localhost:8788", false)).toBe(why);
    expect(refusal("http://localhost:8788", true)).toBe(why);
  });

  it("refuses what isn't an http(s) URL", () => {
    expect(refusal("localhost:8787", false)).toBe("Refusing localhost:8787: WORKER_URL isn't an http(s) URL.");
  });
});

describe("organizerKeyIn", () => {
  it("takes ORGANIZER_KEY over .dev.vars", () => {
    expect(organizerKeyIn("from-env", "ORGANIZER_KEY=from-file")).toBe("from-env");
  });

  it("reads ORGANIZER_KEY from .dev.vars, past comments and quotes", () => {
    expect(organizerKeyIn(undefined, '# The key\nOTHER=x\nORGANIZER_KEY = "s3cret=="\n')).toBe("s3cret==");
  });

  it("is null when neither has one", () => {
    expect(organizerKeyIn(undefined, null)).toBeNull();
    expect(organizerKeyIn("", "# ORGANIZER_KEY=commented-out\nORGANIZER_KEY=")).toBeNull();
  });
});

const practice: RoundData = {
  competitionName: "Code in the Dark",
  filePrefix: "citd",
  roundName: "Practice",
  roundId: "practice-6d1f0b9a4c",
  revision: "1-202610121403",
  editorVersion: "2.0.0+f72fd0a",
  shake: true,
  instructions: { rules: "No preview.", note: "Practice.", colours: [{ hex: "#FFE66D", label: "Moon" }] },
  reference: `data:image/png;base64,${Buffer.from("89504e470d0a1a0a0000000d49484452000000020000000308060000", "hex").toString("base64")}`,
  assets: [{ name: "moon.png", width: 64, height: 64, dataUri: "data:image/png;base64,iVBORw0KGgo=" }],
};

describe("demoCompetition", () => {
  const competition = demoCompetition("http://localhost:8787", practice);

  it("has Heat 1, Heat 2 and a Final, each with the practice Reference and assets", () => {
    expect(competition.rounds.map((round) => round.name)).toEqual(["Heat 1", "Heat 2", "Final"]);
    for (const round of competition.rounds) {
      expect(round.reference).toEqual({ name: "reference.png", dataUri: practice.reference, width: 2, height: 3 });
      expect(round.assets).toEqual(practice.assets);
      expect(round.colours).toEqual(practice.instructions.colours);
    }
  });

  it("has the Audience layer on, pointing at the Worker", () => {
    expect(competition.audience).toMatchObject({ enabled: true, workerUrl: "http://localhost:8787" });
    expect(claimOf(competition).rounds).toHaveLength(3);
  });

  it("mints new credentials each time", () => {
    const again = demoCompetition("http://localhost:8787", practice);
    expect(again.audience.joinCode).not.toBe(competition.audience.joinCode);
    expect(again.audience.hostSecret).not.toBe(competition.audience.hostSecret);
  });
});

describe("demoLinks", () => {
  const claim = claimOf(demoCompetition("http://localhost:8787", practice));
  // The control room takes the same claim as the Host console.
  const controlRoom = `Control room  ${hostConsoleLink("http://localhost:8787", claim).replace("/host/#", "/dev/#")}`;

  it("lists the Host console, the control room, the Stage and the join link", () => {
    expect(demoLinks("http://localhost:8787", claim)).toEqual([
      `Host console  ${hostConsoleLink("http://localhost:8787", claim)}`,
      controlRoom,
      `Stage         ${stageLink("http://localhost:8787", claim.joinCode, claim.competitionName)}`,
      `Join          ${joinLink("http://localhost:8787", claim.joinCode)}`,
    ]);
  });

  it("opens the control room on localhost, so that its phone subdomains resolve", () => {
    expect(demoLinks("http://127.0.0.1:8787", claim)[1]).toBe(controlRoom);
  });
});
