import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { decodeClaim } from "../../src/protocol/protocol.ts";
import { downloadFrom, exportRound, newRound, openAudiencePane, openPackage, REFERENCE, turnOnAudience } from "./prep.ts";

const WORKER = "https://citd.example.workers.dev";

/** The minted Join code, as the pane shows it. */
const joinCode = (page: Page) => page.getByLabel("Join code").textContent();

test("a package exports offline while the Audience layer is off or its Worker URL is invalid", async ({
  page,
  browser,
}, testInfo) => {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  const off = await openPackage(browser, (await exportRound(page, testInfo)).path);
  expect(off.round.audience).toBeUndefined();
  await off.close();

  await turnOnAudience(page, "citd.example.workers.dev/oops");
  await expect(page.getByText("Not a valid Worker URL: packages export offline.")).toBeVisible();
  await page.getByRole("button", { name: /^Heat 1/ }).click();
  await page.getByRole("button", { name: /^(Re-)?[Ee]xport$/ }).click();
  const anyway = page.getByRole("dialog").getByRole("button", { name: "Export anyway" });
  const invalid = await openPackage(browser, (await downloadFrom(anyway, testInfo)).path);

  expect(invalid.round.audience).toBeUndefined();
  await invalid.close();
});

test("the Audience pane mints credentials locally; packages and the Host console link carry them", async ({
  page,
  browser,
}, testInfo) => {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await page.getByRole("button", { name: "+ Final" }).click();

  await turnOnAudience(page, `${WORKER}/`);

  const code = await joinCode(page);
  expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
  const token = await page.getByLabel("Contestant token").textContent();
  expect(token!.length).toBeGreaterThanOrEqual(32);
  const hostLink = await page.getByRole("link", { name: "Open Host console" }).getAttribute("href");
  expect(hostLink).toMatch(`${WORKER}/host/#`);
  const claim = decodeClaim(new URL(hostLink!).hash)!;
  expect(claim.hostSecret.length).toBeGreaterThanOrEqual(32);
  // The Host secret is masked on the page.
  await expect(page.getByText(claim.hostSecret)).toHaveCount(0);
  await expect(page.getByLabel("Host secret")).toContainText("•");
  await expect(page.getByLabel("Stage link")).toHaveText(`${WORKER}/stage/?c=${code}&n=Gothenburg+2026`);

  await page.getByRole("button", { name: /^Heat 1/ }).click();
  const opened = await openPackage(browser, (await exportRound(page, testInfo)).path);
  expect(opened.round.audience).toEqual({ workerUrl: WORKER, joinCode: code, contestantToken: token });
  expect(claim).toEqual({
    competitionName: "Gothenburg 2026",
    joinCode: code,
    hostSecret: claim.hostSecret,
    contestantToken: token,
    rounds: [
      { id: opened.round.roundId, name: "Heat 1" },
      { id: expect.any(String), name: "Final" },
    ],
    // Stamped when the Final was added.
    roundsChangedAt: expect.any(Number),
  });
  await opened.close();
});

test("Mint new credentials… replaces every credential and marks every Round as changed", async ({
  page,
  browser,
}, testInfo) => {
  await newRound(page);
  await page.getByLabel("Choose a Reference").setInputFiles(REFERENCE);
  await turnOnAudience(page, WORKER);
  const heat = page.getByRole("button", { name: /^Heat 1/ });
  await heat.click();
  await exportRound(page, testInfo);
  await expect(heat).not.toContainText("changed");
  await openAudiencePane(page);
  const before = { code: await joinCode(page), token: await page.getByLabel("Contestant token").textContent() };

  await page.getByRole("button", { name: "Mint new credentials…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("before the Host claims");
  await dialog.getByRole("button", { name: "Mint new credentials" }).click();

  await expect(dialog).toBeHidden();
  const code = await joinCode(page);
  expect(code).not.toBe(before.code);
  await expect(page.getByLabel("Contestant token")).not.toHaveText(before.token!);
  await expect(heat).toContainText("changed since Rev 1");
  await heat.click();
  const opened = await openPackage(browser, (await exportRound(page, testInfo)).path);
  expect(opened.round.audience?.joinCode).toBe(code);
  await expect(heat).not.toContainText("changed");
  await opened.close();
});

test("the prep page shows the editor version in its footer", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText(/^Code in the Dark editor \d+\.\d+\.\d+\+\w+$/)).toBeVisible();
});

test("a new Competition's Audience layer starts with the last valid Worker URL typed in this browser", async ({
  page,
}, testInfo) => {
  const workerUrl = page.getByLabel("Worker URL");
  await newRound(page);
  await turnOnAudience(page, `  ${WORKER}/  `);
  await workerUrl.blur();
  // Deleting a URL passes through valid stubs like https://c, which aren't remembered.
  await workerUrl.fill("https://c");
  await workerUrl.fill("citd.example");
  await workerUrl.blur();
  const saved = await downloadFrom(page.getByRole("button", { name: "Save Competition file" }), testInfo);
  const file = JSON.parse(readFileSync(saved.path, "utf8"));
  // Only the Competition's own Worker URL, the invalid one last typed, is in its file.
  expect(JSON.stringify(file).match(/workers\.dev/g)).toBeNull();

  // Another Worker URL, from a file rather than typed.
  file.competition.audience.workerUrl = "https://other.example.workers.dev";
  await page.getByRole("button", { name: "New Competition" }).click();
  await page.getByRole("button", { name: "Replace without saving" }).click();
  await page.getByLabel("Open a Competition file").setInputFiles({
    name: "other.citd-competition.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(file)),
  });
  await openAudiencePane(page);
  await page.getByLabel(/Audience layer/).uncheck();
  await page.getByLabel(/Audience layer/).check();
  await expect(workerUrl).toHaveValue("https://other.example.workers.dev");

  await page.getByRole("button", { name: "New Competition" }).click();
  await page.getByRole("button", { name: "Replace without saving" }).click();
  await openAudiencePane(page);
  await page.getByLabel(/Audience layer/).check();
  await expect(workerUrl).toHaveValue(`${WORKER}/`);
});

test("without browser storage, the Audience layer starts with an empty Worker URL", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage is off", "SecurityError");
      },
    });
  });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));

  await page.goto("/");
  await turnOnAudience(page, WORKER);
  await page.getByRole("button", { name: "New Competition" }).click();
  await page.getByRole("button", { name: "Replace without saving" }).click();
  await openAudiencePane(page);
  await page.getByLabel(/Audience layer/).check();

  await expect(page.getByLabel("Worker URL")).toHaveValue("");
  expect(errors).toEqual([]);
});
