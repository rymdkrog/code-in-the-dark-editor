// `npm run dev:demo` against the Worker in workerd.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, test } from "vitest";
import { parseCompetitionFile, roundStatus } from "../../src/pages/prep/competition.ts";
import type { RoundData } from "../../src/round-package/round-data.ts";
import { runDemo } from "../../scripts/dev-demo.ts";
import { roundIn } from "../round-packages.ts";
import { openSocket } from "./client.ts";
import { ORGANIZER_KEY, startWorker } from "./socket.ts";

const worker = startWorker();
const out = mkdtempSync(join(tmpdir(), "citd-dev-demo-"));
beforeAll(() => worker.listen(), 30_000);
afterAll(async () => {
  await worker.close();
  rmSync(out, { recursive: true, force: true });
});

const TEMPLATE = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n</head>\n<body>\n<script type="application/json" id="round"></script>\n</body>\n</html>\n`;

const practice: RoundData = {
  competitionName: "Code in the Dark",
  filePrefix: "citd",
  roundName: "Practice",
  roundId: "practice-6d1f0b9a4c",
  revision: "1-202610121403",
  editorVersion: "2.0.0+f72fd0a",
  shake: true,
  instructions: { rules: "No preview.", note: "Practice.", colours: [] },
  reference: "data:image/png;base64,iVBORw0KGgo=",
  assets: [],
};

const demo = async (organizerKey = ORGANIZER_KEY, workerUrl?: string) => {
  const { url } = await worker.listen();
  return runDemo({ workerUrl: workerUrl ?? url.origin, organizerKey, template: TEMPLATE, practice, editorVersion: "2.0.0+test", outRoot: out });
};

test("claims the Competition, so its Host secret reads it back", async () => {
  const { competition } = await demo();

  const { url } = await worker.listen();
  const host = await openSocket(url.origin, competition.audience.joinCode, "host");
  host.send({ t: "host", hostSecret: competition.audience.hostSecret });
  expect(await host.next()).toMatchObject({ t: "competition" });
  host.close();
});

test("writes a package per Round and the Competition file, in a folder of its own", async () => {
  const { competition, folder, packages, competitionPath } = await demo();

  expect(packages.map((file) => file.split("/").pop())).toEqual([
    "citd-demo-heat-1.html",
    "citd-demo-heat-2.html",
    "citd-demo-final.html",
  ]);
  for (const [i, file] of packages.entries()) {
    expect(file.startsWith(folder)).toBe(true);
    expect(roundIn(file)).toMatchObject({
      roundId: competition.rounds[i]!.id,
      reference: practice.reference,
      audience: { joinCode: competition.audience.joinCode, contestantToken: competition.audience.contestantToken },
    });
  }
  expect(competitionPath).toBe(join(folder, "demo.citd-competition.json"));
  const saved = parseCompetitionFile(readFileSync(competitionPath, "utf8"))!;
  expect(saved.rounds.map((round) => round.name)).toEqual(["Heat 1", "Heat 2", "Final"]);
  // Prep sees each package as exported, Revision 1, and up to date.
  for (const [i, round] of saved.rounds.entries()) {
    expect(round.revisions.map((revision) => revision.stamp)).toEqual([roundIn(packages[i]!).revision]);
    expect(roundStatus(saved, round)).toMatchObject({ kind: "exported" });
  }
});

test("prints the links and every package's file:// URL", async () => {
  const { competition, lines, packages } = await demo();
  const { url } = await worker.listen();
  const text = lines.join("\n");

  expect(text).toContain(`${url.origin}/host/#`);
  expect(text).toContain(`${url.origin}/stage/?c=${competition.audience.joinCode}`);
  expect(text).toContain(`${url.origin}/join?c=${competition.audience.joinCode}`);
  for (const file of packages) expect(text).toContain(pathToFileURL(file).href);
  expect(text).toContain("drop");
});

test("two runs get different Join codes and different folders", async () => {
  const first = await demo();
  const second = await demo();

  expect(second.competition.audience.joinCode).not.toBe(first.competition.audience.joinCode);
  expect(second.folder).not.toBe(first.folder);
});

test("a wrong Organizer key fails, saying where the key comes from, and writes nothing", async () => {
  const before = readdirSync(out);
  await expect(demo("not-the-key")).rejects.toThrow(
    "The Worker refused the Organizer key: check ORGANIZER_KEY or .dev.vars (and restart `npm run worker:dev` after changing it).",
  );
  expect(readdirSync(out)).toEqual(before);
});

test("an unreachable Worker fails, saying to start it", async () => {
  await expect(demo(ORGANIZER_KEY, "http://127.0.0.1:9")).rejects.toThrow("Couldn't reach the Worker at http://127.0.0.1:9: run `npm run worker:dev` first.");
});
