// Exporting Round packages: one Round downloads as its own .html, two or more as one zip, so the
// browser doesn't hold back a run of downloads behind a "multiple downloads" prompt.

import { fillTemplate } from "../../round-package/fill-template.ts";
import {
  nextRevision,
  packageFileName,
  packagesZipFileName,
  packageWorkerOrigin,
  roundData,
  type Competition,
  type Revision,
  type Round,
} from "./competition.ts";
import { zip } from "./zip.ts";

export interface ExportFile {
  fileName: string;
  content: string | Uint8Array<ArrayBuffer>;
  type: string;
}

/**
 * Why Round packages would export offline, or null when they connect to the Worker. Each package
 * bakes this in, so fixing it later means exporting and handing out every package again.
 */
export function offlineExport(competition: Competition): "audience off" | "invalid worker url" | null {
  if (packageWorkerOrigin(competition)) return null;
  return competition.audience.enabled ? "invalid worker url" : "audience off";
}

/** The one file to download for the Rounds, and the Revision each Round records for it. */
export function exportPackages(
  competition: Competition,
  rounds: Round[],
  template: string,
  editorVersion: string,
  now: Date,
): { file: ExportFile; revisions: { id: string; revision: Revision }[] } {
  const packages = rounds.map((round) => {
    const revision = nextRevision(competition, round, now);
    const html = fillTemplate(template, roundData(competition, round, revision, editorVersion));
    return { id: round.id, revision, name: packageFileName(competition, round), html };
  });
  const revisions = packages.map(({ id, revision }) => ({ id, revision }));
  if (packages.length === 1) {
    const [only] = packages;
    return { file: { fileName: only!.name, content: only!.html, type: "text/html" }, revisions };
  }
  const encoder = new TextEncoder();
  const content = zip(packages.map(({ name, html }) => ({ name, data: encoder.encode(html), modified: now })));
  return { file: { fileName: packagesZipFileName(competition), content, type: "application/zip" }, revisions };
}

/**
 * The package Try opens: what exporting the Round now would give, but with no Audience connection,
 * so it opens no socket and lands on no Roster. It carries the stamp the next Revision would get,
 * recorded nowhere.
 */
export function tryPackage(
  competition: Competition,
  round: Round,
  template: string,
  editorVersion: string,
  now: Date,
): string {
  const data = roundData(competition, round, nextRevision(competition, round, now), editorVersion);
  delete data.audience;
  return fillTemplate(template, data);
}
