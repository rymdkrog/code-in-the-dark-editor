import { describe, expect, it } from "vitest";
import { fillTemplate } from "./fill-template.ts";
import type { RoundData } from "./round-data.ts";

const TEMPLATE = `<!-- licences -->
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Code in the Dark</title>
<style>body { background: black; }</style>
</head>
<body>
<script type="application/json" id="round"></script>
<script type="module">console.log("core");</script>
</body>
</html>
`;

const round: RoundData = {
  competitionName: "Gothenburg 2026",
  roundName: "Heat 2",
  roundId: "r_8f3kq2",
  revision: "3-202610121403",
  editorVersion: "2.0.0+f72fd0a",
  shake: true,
  instructions: {
    rules: "No preview. No help.",
    note: "Nav links don't need hover states.",
    colours: [{ hex: "#FF00AA", label: "Accent" }],
  },
  reference: "data:image/png;base64,iVBORw0KGgo=",
  assets: [{ name: "beach.jpg", width: 640, height: 480, dataUri: "data:image/jpeg;base64,/9j/" }],
};

const slotContent = (html: string) => {
  const match = html.match(/<script type="application\/json" id="round">([\s\S]*?)<\/script>/);
  if (!match) throw new Error("no slot in output");
  return match[1]!;
};

const csp = (html: string) => {
  const match = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  return match?.[1];
};

describe("fillTemplate", () => {
  it("puts the Round into the slot as JSON", () => {
    const html = fillTemplate(TEMPLATE, round);

    expect(JSON.parse(slotContent(html))).toEqual(round);
  });

  it("leaves the rest of the template alone", () => {
    const html = fillTemplate(TEMPLATE, round);

    expect(html).toContain("<!-- licences -->\n<!doctype html>");
    expect(html).toContain('<script type="module">console.log("core");</script>');
    expect(html).toContain("<style>body { background: black; }</style>");
  });

  it("escapes </ as <\\/ so Round text can't close the slot", () => {
    const hostile = {
      ...round,
      instructions: { ...round.instructions, note: '</script><script>alert("hi")</script>' },
    };

    const html = fillTemplate(TEMPLATE, hostile);

    expect(slotContent(html)).not.toContain("</");
    expect(slotContent(html)).toContain('<\\/script><script>alert(\\"hi\\")<\\/script>');
    expect(JSON.parse(slotContent(html))).toEqual(hostile);
  });

  it("escapes <!-- so Round text can't swallow the slot's closing tag", () => {
    // `<!--` followed by `<script` puts the HTML tokenizer in the script data double-escaped
    // state, where the slot's own `</script>` would no longer end the element.
    const hostile = { ...round, roundName: "<!--<script>" };

    const html = fillTemplate(TEMPLATE, hostile);

    expect(slotContent(html)).not.toContain("<!--");
    expect(JSON.parse(slotContent(html))).toEqual(hostile);
  });

  it("keeps replacement patterns like $& in Round text literally", () => {
    const tricky = { ...round, roundName: "Heat $& $' $` $1" };

    const html = fillTemplate(TEMPLATE, tricky);

    expect(JSON.parse(slotContent(html)).roundName).toBe("Heat $& $' $` $1");
  });

  it("writes a CSP that only allows inline code and data:/blob: media when there is no Worker URL", () => {
    const html = fillTemplate(TEMPLATE, round);

    expect(csp(html)).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:",
    );
  });

  it("adds connect-src for the Worker's socket origin when a Worker URL is given", () => {
    const html = fillTemplate(TEMPLATE, {
      ...round,
      audience: {
        workerUrl: "https://citd.example.workers.dev/some/path?x=1",
        joinCode: "K7XQ2N",
        contestantToken: "t0k3n",
      },
    });

    expect(csp(html)).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; connect-src wss://citd.example.workers.dev",
    );
  });

  it("allows a plain ws: socket for a local http Worker", () => {
    const html = fillTemplate(TEMPLATE, {
      ...round,
      audience: { workerUrl: "http://localhost:8787", joinCode: "K7XQ2N", contestantToken: "t0k3n" },
    });

    expect(csp(html)).toMatch(/; connect-src ws:\/\/localhost:8787$/);
  });

  it("refuses a Worker URL it can't turn into a socket origin", () => {
    for (const workerUrl of ["not a url", "ftp://example.com", "javascript:alert(1)"]) {
      expect(() =>
        fillTemplate(TEMPLATE, { ...round, audience: { workerUrl, joinCode: "K7XQ2N", contestantToken: "t" } }),
      ).toThrow(/Worker URL/);
    }
  });

  it("writes the CSP into the head, before any script or style", () => {
    const html = fillTemplate(TEMPLATE, round);
    const cspAt = html.indexOf("Content-Security-Policy");

    expect(cspAt).toBeGreaterThan(html.indexOf("<head>"));
    expect(cspAt).toBeLessThan(html.indexOf("<style>"));
    expect(cspAt).toBeLessThan(html.indexOf("<script"));
  });

  it("starts the package with a single UTF-8 byte order mark", () => {
    // The licence comment pushes <meta charset> past the 1024-byte prescan window.
    expect(fillTemplate(TEMPLATE, round).startsWith("﻿<!-- licences -->")).toBe(true);
    expect(fillTemplate(`﻿${TEMPLATE}`, round).startsWith("﻿<!-- licences -->")).toBe(true);
  });

  it("fills a template whose only content is the slot", () => {
    const html = fillTemplate('<head></head><script type="application/json" id="round"></script>', round);

    expect(JSON.parse(slotContent(html))).toEqual(round);
  });

  it("refuses a template without exactly one slot", () => {
    const slot = '<script type="application/json" id="round"></script>';

    expect(() => fillTemplate("<head></head><body></body>", round)).toThrow(/exactly one/);
    expect(() => fillTemplate(`<head></head>${slot}${slot}`, round)).toThrow(/exactly one/);
  });

  it("refuses a template without a head to write the CSP into", () => {
    expect(() => fillTemplate('<script type="application/json" id="round"></script>', round)).toThrow(/<head>/);
  });
});
