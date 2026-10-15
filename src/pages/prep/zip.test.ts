import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crc32, zip } from "./zip.ts";

const encode = (text: string) => new TextEncoder().encode(text);

/** Writes the zip to a temporary file, for the system's own unzip to read. */
function zipFile(bytes: Uint8Array): string {
  const path = join(mkdtempSync(join(tmpdir(), "citd-zip-")), "packages.zip");
  writeFileSync(path, bytes);
  return path;
}

describe("crc32", () => {
  it("matches the standard check value", () => {
    expect(crc32(encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("zip", () => {
  const modified = new Date(2026, 9, 15, 14, 3, 22);
  const binary = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 7919) % 256);
  const entries = [
    { name: "citd-gothenburg-2026-heat-1.html", data: encode("<!doctype html><p>Heat 1</p>\n"), modified },
    { name: "citd-gothenburg-2026-heat-2.html", data: binary, modified },
    { name: "empty.html", data: new Uint8Array(), modified },
  ];

  it("passes unzip's own integrity test", () => {
    const output = execFileSync("unzip", ["-t", zipFile(zip(entries))], { encoding: "utf8" });
    expect(output).toContain("No errors detected");
  });

  it("gives back every entry byte for byte, at the root, under its own name", () => {
    const path = zipFile(zip(entries));
    expect(execFileSync("zipinfo", ["-1", path], { encoding: "utf8" }).trim().split("\n")).toEqual(
      entries.map((entry) => entry.name),
    );
    for (const entry of entries) {
      expect(new Uint8Array(execFileSync("unzip", ["-p", path, entry.name]))).toEqual(entry.data);
    }
  });

  it("stores entries uncompressed, stamped with their time", () => {
    const listing = execFileSync("zipinfo", ["-l", zipFile(zip(entries))], { encoding: "utf8" });
    const heat1 = listing.split("\n").find((line) => line.endsWith("heat-1.html"))!;
    expect(heat1).toContain("stor");
    // DOS times have two-second resolution.
    expect(heat1).toMatch(/26-Oct-15 14:03/);
  });

  it("writes an empty archive for no entries", () => {
    expect(zip([])).toEqual(Uint8Array.from([0x50, 0x4b, 5, 6, ...new Array<number>(18).fill(0)]));
  });
});
