// Regenerates the practice Round's Reference and asset from their sources in
// fixtures/practice/. The PNGs are committed; run this only when the sources change.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const fixture = (path: string) => new URL(`../fixtures/practice/${path}`, import.meta.url);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

await page.setContent(`<body style="margin:0;background:transparent">${readFileSync(fixture("moon.svg"), "utf8")}</body>`);
const moon = await page.locator("svg").screenshot({ omitBackground: true });
writeFileSync(fixture("assets/moon.png"), moon);

const html = readFileSync(fixture("reference.html"), "utf8").replace(
  "assets/moon.png",
  `data:image/png;base64,${moon.toString("base64")}`,
);
await page.setContent(html);
writeFileSync(fixture("reference.png"), await page.screenshot());

await browser.close();
