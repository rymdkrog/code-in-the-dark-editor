// `npm run dev:demo`: builds a demo Competition, claims it on a local `wrangler dev` and writes its
// Round packages and Competition file to dist/demo/, then prints every link.
//
//   npm run build && npm run worker:dev   # once, in another terminal
//   npm run dev:demo [-- --allow-remote]
//
// WORKER_URL defaults to http://localhost:8787. The Organizer key comes from ORGANIZER_KEY or .dev.vars.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { controlRoomLink, hostConsoleLink, joinLink, stageLink } from "../src/pages/links.ts";
import {
  addRound,
  claimOf,
  competitionFile,
  competitionFileName,
  mintRoundId,
  newCompetition,
  nextRevision,
  packageFileName,
  roundData,
  updateAudience,
  updateRound,
  workerOrigin,
  type Competition,
} from "../src/pages/prep/competition.ts";
import { fillTemplate } from "../src/round-package/fill-template.ts";
import type { RoundData } from "../src/round-package/round-data.ts";
import { PRACTICE, roundIn, TEMPLATE } from "../tests/round-packages.ts";
import { WORKER_PORT as E2E_WORKER_PORT } from "../tests/e2e/worker.ts";
import { openSocket } from "../tests/worker/client.ts";
import { editorVersion } from "./editor-version.ts";

/** Why the script won't claim on the Worker at `workerUrl`, or null if it will. */
export function refusal(workerUrl: string, allowRemote: boolean): string | null {
  if (!workerOrigin(workerUrl)) return `Refusing ${workerUrl}: WORKER_URL isn't an http(s) URL.`;
  const { hostname, port } = new URL(workerUrl);
  if (port === String(E2E_WORKER_PORT)) {
    return `Refusing ${workerUrl}: that's the port \`npm run test:e2e\` runs its Worker on.`;
  }
  if (!allowRemote && hostname !== "localhost" && hostname !== "127.0.0.1") {
    return `Refusing ${workerUrl}: it isn't local. Pass --allow-remote to claim there anyway.`;
  }
  return null;
}

/** The Organizer key from the environment, else from the text of .dev.vars; null if neither has one. */
export function organizerKeyIn(env: string | undefined, devVars: string | null): string | null {
  if (env) return env;
  const line = devVars?.match(/^\s*ORGANIZER_KEY\s*=\s*(.*?)\s*$/m)?.[1];
  return line?.replace(/^(["'])(.*)\1$/, "$2") || null;
}

/** Heat 1, Heat 2 and a Final, each with the practice Round's Reference and assets, with the
 * Audience layer on at `workerUrl` and fresh credentials. */
export function demoCompetition(workerUrl: string, practice: RoundData): Competition {
  let competition: Competition = { ...newCompetition(), name: "Demo" };
  for (const kind of ["heat", "heat", "final"] as const) competition = addRound(competition, kind, mintRoundId());
  for (const { id, name } of competition.rounds) {
    competition = updateRound(competition, id, (round) => ({
      ...round,
      reference: { name: "reference.png", dataUri: practice.reference, ...pngSize(practice.reference) },
      assets: practice.assets.map((asset) => ({ ...asset })),
      note: `${name} of the demo Competition.`,
      colours: practice.instructions.colours,
    }));
  }
  return updateAudience(competition, { enabled: true, workerUrl });
}

/** A PNG data: URI's pixel size, from its IHDR chunk; null if it's too short to have one. */
function pngSize(dataUri: string): { width: number | null; height: number | null } {
  const png = Buffer.from(dataUri.replace(/^data:image\/png;base64,/, ""), "base64");
  return png.length >= 24 ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20) } : { width: null, height: null };
}

/** A failure the script explains in one line, without a stack trace. */
export class DemoError extends Error {}

interface DemoOptions {
  workerUrl: string;
  organizerKey: string;
  template: string;
  practice: RoundData;
  editorVersion: string;
  /** Each run writes to a new folder in here. */
  outRoot: string;
}

/** Builds and claims a demo Competition, writes its files and returns what to print. */
export async function runDemo(options: DemoOptions) {
  const { workerUrl, organizerKey } = options;
  const origin = workerOrigin(workerUrl)!;
  let competition = demoCompetition(origin, options.practice);
  const claim = claimOf(competition);

  const host = await openSocket(origin, claim.joinCode, "host").catch(() => {
    throw new DemoError(`Couldn't reach the Worker at ${origin}: run \`npm run worker:dev\` first.`);
  });
  try {
    host.send({ t: "claim", organizerKey, claim });
    const answer = await host.next(5000).catch(() => {
      throw new DemoError(`The Worker at ${origin} didn't answer the claim: is \`npm run worker:dev\` running there?`);
    });
    if (answer.t === "claim-refused" && (answer.reason === "organizer-key" || answer.reason === "no-organizer-key")) {
      throw new DemoError(
        "The Worker refused the Organizer key: check ORGANIZER_KEY or .dev.vars (and restart `npm run worker:dev` after changing it).",
      );
    }
    if (answer.t !== "competition") throw new DemoError(`The Worker didn't take the claim: ${JSON.stringify(answer)}`);
  } finally {
    host.close();
  }

  const now = new Date();
  const folder = join(options.outRoot, `${now.toISOString().slice(0, 19).replace(/[-:]/g, "")}-${claim.joinCode}`);
  mkdirSync(folder, { recursive: true });
  const packages = competition.rounds.map((round) => {
    const file = join(folder, packageFileName(competition, round));
    const revision = nextRevision(competition, round, now);
    writeFileSync(file, fillTemplate(options.template, roundData(competition, round, revision, options.editorVersion)));
    // Recorded as prep records an export, so prep shows the Round as exported.
    competition = updateRound(competition, round.id, (round) => ({ ...round, revisions: [...round.revisions, revision] }));
    return file;
  });
  const competitionPath = join(folder, competitionFileName(competition));
  writeFileSync(competitionPath, competitionFile(competition));

  const lines = [
    `Claimed "${claim.competitionName}" on ${origin} as ${claim.joinCode}.`,
    "",
    ...demoLinks(origin, claim),
    "",
    ...competition.rounds.map((round, i) => `${round.name.padEnd(13)} ${pathToFileURL(packages[i]!).href}`),
    "",
    `Open the Stage and drop ${pathToFileURL(competitionPath).href} on it to give it the References.`,
  ];
  return { competition, folder, packages, competitionPath, lines };
}

/** The links to the pages the Worker at `origin` serves for `claim`. */
export function demoLinks(origin: string, claim: ReturnType<typeof claimOf>) {
  return [
    `Host console  ${hostConsoleLink(origin, claim)}`,
    `Control room  ${controlRoomLink(origin, claim)}`,
    `Stage         ${stageLink(origin, claim.joinCode, claim.competitionName)}`,
    `Join          ${joinLink(origin, claim.joinCode)}`,
  ];
}

const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

async function main() {
  const workerUrl = process.env.WORKER_URL || "http://localhost:8787";
  const why = refusal(workerUrl, process.argv.includes("--allow-remote"));
  if (why) throw new DemoError(why);
  if (!existsSync(TEMPLATE) || !existsSync(PRACTICE)) {
    throw new DemoError("The Core Editor template isn't built: run `npm run build` first.");
  }
  const devVars = root(".dev.vars");
  const organizerKey = organizerKeyIn(process.env.ORGANIZER_KEY, existsSync(devVars) ? readFileSync(devVars, "utf8") : null);
  if (!organizerKey) {
    throw new DemoError("No Organizer key: set ORGANIZER_KEY, or copy .dev.vars.example to .dev.vars and set it there.");
  }
  const { lines } = await runDemo({
    workerUrl,
    organizerKey,
    template: readFileSync(TEMPLATE, "utf8"),
    practice: roundIn(PRACTICE),
    editorVersion: editorVersion(),
    outRoot: root("dist/demo"),
  });
  console.log(lines.join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    if (!(error instanceof DemoError)) throw error;
    console.error(error.message);
    process.exit(1);
  }
}
