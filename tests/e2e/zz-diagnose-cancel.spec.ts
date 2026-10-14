// TEMPORARY: diagnoses the Reveal Cancel click that fails only on CI Firefox. To be removed.
import { type Page } from "@playwright/test";
import { openPackage, test } from "./package.ts";

const record = (page: Page) =>
  page.evaluate(() => {
    const log: string[] = [];
    (window as unknown as { diag: string[] }).diag = log;
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "invalid", "focusin", "blur"]) {
      window.addEventListener(
        type,
        (event) => log.push(`${type}@${(event.target as Element).tagName ?? "?"}.${(event.target as Element).className ?? ""}`),
        true,
      );
    }
    document.querySelector(".reveal-dialog")!.addEventListener("close", () => log.push("close"));
  });
const read = (page: Page) =>
  page.evaluate(() => ({
    log: (window as unknown as { diag: string[] }).diag.join(" "),
    open: document.querySelector<HTMLDialogElement>(".reveal-dialog")!.open,
    active: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
    hasFocus: document.hasFocus(),
  }));

test("diagnose the Reveal Cancel click", async ({ page, browserName }) => {
  test.skip(browserName !== "firefox");
  const out: string[] = [];
  for (const variant of ["as-test", "no-invalid", "invalid-wait-1s", "invalid-then-two-clicks"]) {
    await page.close().catch(() => {});
    page = await page.context().newPage();
    await openPackage(page);
    await page.keyboard.type("<h1>");
    await page.getByRole("button", { name: "Reveal", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox").fill("no");
    await record(page);
    if (variant !== "no-invalid") await page.keyboard.press("Enter");
    if (variant === "invalid-wait-1s") await page.waitForTimeout(1000);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(500);
    out.push(`${variant} after 1st click: ${JSON.stringify(await read(page))}`);
    if (variant === "invalid-then-two-clicks" && (await read(page)).open) {
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(500);
      out.push(`${variant} after 2nd click: ${JSON.stringify(await read(page))}`);
    }
  }
  throw new Error(`DIAG\n${out.join("\n")}`);
});
