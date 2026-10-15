// Round packages and Competitions made from the practice Round, outside any browser: the e2e
// suites and `npm run dev:demo` both build on them.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mintCredentials } from "../src/pages/prep/competition.ts";
import type { Claim } from "../src/protocol/protocol.ts";
import { fillTemplate } from "../src/round-package/fill-template.ts";
import type { RoundData } from "../src/round-package/round-data.ts";

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));
export const PRACTICE = root("dist/citd-practice.html");
export const TEMPLATE = root("dist/core-editor.html");

/** The Round in a built package's data slot. */
export const roundIn = (file: string): RoundData =>
  JSON.parse(readFileSync(file, "utf8").match(/<script type="application\/json" id="round">([\s\S]*?)<\/script>/)![1]!);

/** Builds a Round package from the template: the practice Round with the given changes. */
export function makePackage(file: string, changes: Partial<RoundData>): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, fillTemplate(readFileSync(TEMPLATE, "utf8"), { ...roundIn(PRACTICE), ...changes }));
  return file;
}

/** The practice Round's id, from its fixture, so it reads without a build. */
export const HEAT: string = JSON.parse(readFileSync(root("fixtures/practice/round.json"), "utf8")).roundId;

/** A Competition of the practice Round and a Final, with fresh credentials. */
export const newClaim = (): Claim => ({
  competitionName: "Gothenburg 2026",
  ...mintCredentials(),
  rounds: [
    { id: HEAT, name: "Heat 1" },
    { id: "final00000", name: "Final" },
  ],
});
