// The dev-only control room under `wrangler dev`, which Playwright starts with CITD_CONTROL_ROOM=1
// (see playwright.config.ts): the Host console, the Stage and three phones, each in a frame.

import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { controlRoomLink } from "../../src/pages/links.ts";
import { desk, newClaim } from "./host.ts";
import { WORKER_ORGANIZER_KEY, WORKER_URL } from "./worker.ts";

// Firefox and WebKit on Linux CI ask the system resolver for phoneN.localhost; Chromium never does.
test.skip(({ browserName }) => browserName !== "chromium", "phoneN.localhost resolves everywhere only in Chromium");

const frame = (room: Page, label: string) => room.frameLocator(`iframe[title="${label}"]`);
const header = (phone: FrameLocator) => phone.getByRole("banner");

async function vote(phone: FrameLocator, name: string) {
  await phone.getByRole("list", { name: "Roster" }).getByRole("button", { name }).click();
  await expect(phone.getByText(`✓ You voted for ${name}`)).toBeVisible();
}

test("the control room steps a Round on the Host console, the Stage and each phone follow, and each phone is one voter", async ({
  page: room,
}) => {
  const claim = newClaim();
  await room.goto(controlRoomLink(WORKER_URL, claim));
  const host = frame(room, "Host console");
  const stage = frame(room, "Stage");
  const phones = [1, 2, 3].map((n) => frame(room, `Phone ${n}`));

  await host.getByLabel("Organizer key").fill(WORKER_ORGANIZER_KEY);
  await host.getByRole("button", { name: "Claim" }).click();
  await expect(host.getByRole("banner")).toContainText("live");
  for (const phone of phones) await expect(phone.getByText("✓ You're in")).toBeVisible();

  const { rail, button, dialog } = desk(host);
  await rail.getByRole("button", { name: /^Heat 1/ }).click();
  for (const name of ["Ada", "Bo"]) {
    await host.getByLabel("Add a Contestant by hand").fill(name);
    await host.getByRole("button", { name: "Add", exact: true }).click();
  }
  await expect(stage.getByText("Up next")).toBeVisible();
  for (const phone of phones) await expect(header(phone)).toContainText("Up next");

  await button("Start Round").click();
  await expect(stage.getByText("Up next")).toHaveCount(0);
  for (const phone of phones) await expect(header(phone)).toContainText("Running");

  await button("End early").click();
  await dialog.getByRole("button", { name: "End now" }).click();
  await expect(stage.getByText("Time's up · Reveals next")).toBeVisible();
  for (const phone of phones) await expect(header(phone)).toContainText("Time's up");

  await button("Open voting").click();
  await vote(phones[0]!, "Ada");
  await vote(phones[1]!, "Bo");
  await expect(stage.getByLabel("Turnout")).toHaveText("2");
  await expect(host.getByLabel("Turnout")).toHaveText("2 votes");

  // Reloading reloads that phone's frame alone, and it comes back as the same voter.
  const markEveryFrame = async () => {
    for (const f of room.frames()) await f.evaluate(() => ((window as { marked?: boolean }).marked = true));
  };
  const stillMarked = (url: RegExp) =>
    room.frames().find((f) => url.test(f.url()))!.evaluate(() => (window as { marked?: boolean }).marked === true);
  await markEveryFrame();
  await room.getByRole("region", { name: "Phone 1" }).getByRole("button", { name: "Reload" }).click();
  await expect(phones[0]!.getByText("✓ You voted for Ada")).toBeVisible();
  expect(await stillMarked(/\/\/phone1\.localhost:/)).toBe(false);
  for (const url of [/\/\/phone2\.localhost:/, /\/\/phone3\.localhost:/, /\/host\//, /\/stage\//]) {
    expect(await stillMarked(url)).toBe(true);
  }
  await phones[0]!.getByRole("button", { name: "Change my vote" }).click();
  await vote(phones[0]!, "Bo");
  await expect(host.getByLabel("Turnout")).toHaveText("2 votes");

  await button("Close voting & show results").click();
  await expect(stage.getByRole("list", { name: "Results" }).getByRole("listitem")).toHaveText([/2.*Bo/, /0.*Ada/]);
  for (const phone of phones) {
    await expect(phone.getByRole("heading", { name: "Voting closed · Eyes on the Stage" })).toBeVisible();
  }
});

test("without a claim, the control room says how to open it", async ({ page }) => {
  await page.goto(`${WORKER_URL}/dev/`);
  await expect(page.getByText("Open this page as /dev/#<claim>")).toBeVisible();
});
