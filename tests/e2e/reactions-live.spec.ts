// The live flow for Reactions: a phone taps an emoji on a Contestant's row, and it floats up on
// that Contestant's open Round package, through the real Worker under `wrangler dev`.

import { expect, test } from "@playwright/test";
import { claimConsole, desk, heatPackage, laptop, newClaim } from "./host.ts";
import { WORKER_URL } from "./worker.ts";

test("a phone taps 🔥 on Ada's row, and it floats up on Ada's screen only", async ({ browser, page: host }, testInfo) => {
  const claim = newClaim();
  await claimConsole(host, claim);
  const ada = await laptop(browser, heatPackage(testInfo, claim, 1), "Ada");
  const bo = await laptop(browser, heatPackage(testInfo, claim, 1), "Bo");
  await desk(host).rail.getByRole("button", { name: /^Heat 1/ }).click();
  await desk(host).button("Start Round").click();

  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(`${WORKER_URL}/join?c=${claim.joinCode}`);
  const fire = phone.getByRole("button", { name: "React 🔥 to Ada" });
  await expect(fire).toBeEnabled({ timeout: 20_000 });
  await fire.click();

  // Drawn: the overlay has an emoji's pixels on it.
  const drawn = () =>
    ada.page.locator("canvas.reactions").evaluate((canvas: HTMLCanvasElement) =>
      canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((byte, i) => i % 4 === 3 && byte > 0),
    );
  await expect.poll(drawn).toBe(true);
  await bo.page.waitForTimeout(1000);
  await expect(bo.page.locator("canvas.reactions")).toHaveCount(0);
  await ada.close();
  await bo.close();
});
