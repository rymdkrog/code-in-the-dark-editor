import { expect, test, type Page } from "@playwright/test";
import { decodeClaim } from "../../src/protocol/protocol.ts";
import { exportRound, newRound, openAudiencePane, openPackage, REFERENCE, turnOnAudience } from "./prep.ts";

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
  const invalid = await openPackage(browser, (await exportRound(page, testInfo)).path);

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
