import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The lockstep version stamped into every built file: `version+shortsha`. */
export function editorVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    version: string;
  };
  return `${version}+${shortSha()}`;
}

function shortSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}
