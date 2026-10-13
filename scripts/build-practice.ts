// Builds dist/citd-practice.html: a pure-offline practice Round package from the
// template and the fixture in fixtures/practice/, which we own.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fillTemplate } from "../src/round-package/fill-template.ts";
import type { RoundData } from "../src/round-package/round-data.ts";
import { editorVersion } from "./editor-version.ts";

const root = (path: string) => new URL(`../${path}`, import.meta.url);
const fixture = (path: string) => root(`fixtures/practice/${path}`);

interface PracticeFixture extends Omit<RoundData, "revision" | "editorVersion" | "reference" | "assets"> {
  assets: string[];
}

const practice = JSON.parse(readFileSync(fixture("round.json"), "utf8")) as PracticeFixture;

const pngDataUri = (png: Buffer) => `data:image/png;base64,${png.toString("base64")}`;

// The width and height live big-endian in the PNG's IHDR chunk.
const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

const round: RoundData = {
  ...practice,
  revision: `1-${revisionStamp()}`,
  editorVersion: editorVersion(),
  reference: pngDataUri(readFileSync(fixture("reference.png"))),
  assets: practice.assets.map((name) => {
    const png = readFileSync(fixture(`assets/${name}`));
    return { name, ...pngSize(png), dataUri: pngDataUri(png) };
  }),
};

const template = readFileSync(root("dist/core-editor.html"), "utf8");
const html = fillTemplate(template, round);
writeFileSync(root("dist/citd-practice.html"), html);
console.log(`dist/citd-practice.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} kB  (Revision ${round.revision})`);

/** The UTC minute of the last commit, so rebuilding the same commit gives the same Revision. */
function revisionStamp(): string {
  let date = new Date();
  try {
    date = new Date(execFileSync("git", ["log", "-1", "--format=%cI"], { encoding: "utf8" }).trim());
  } catch {
    // Not a git checkout: stamp the build time instead.
  }
  return date.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}
