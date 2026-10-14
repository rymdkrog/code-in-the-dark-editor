import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";
import { fillTemplate } from "../../src/round-package/fill-template.ts";
import type { RoundData } from "../../src/round-package/round-data.ts";
import { gateNetwork } from "./no-network-gate.ts";

const dist = (file: string) => fileURLToPath(new URL(`../../dist/${file}`, import.meta.url));
export const PRACTICE = dist("citd-practice.html");
export const TEMPLATE = dist("core-editor.html");

// Every test runs behind the no-network gate.
export const test = base.extend<{ gate: void }>({
  gate: [
    async ({ context }, use) => {
      const check = await gateNetwork(context);
      await use();
      check();
    },
    { auto: true },
  ],
});

/** Opens a Round package, giving a name if this browser doesn't know one yet. */
export async function openPackage(page: Page, file = PRACTICE) {
  await page.goto(pathToFileURL(file).href);
  // The editor starts once the two-tab guard has answered, which can be after the page loads.
  const started = page.locator(".name-dialog[open], #editor textarea:focus").first();
  await expect(started).toBeAttached();
  if (await page.getByRole("dialog").isVisible()) await enterName(page, "Anna");
  // The editor takes focus (back) by itself, so the Contestant can type straight away.
  await expect(page.locator("#editor textarea")).toBeFocused();
}

/** The Round in a built package's data slot. */
export const roundIn = (file: string): RoundData =>
  JSON.parse(readFileSync(file, "utf8").match(/<script type="application\/json" id="round">([\s\S]*?)<\/script>/)![1]!);

/** Builds a Round package from the template: the practice Round with the given changes. */
export function makePackage(file: string, changes: Partial<RoundData>): string {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, fillTemplate(readFileSync(TEMPLATE, "utf8"), { ...roundIn(PRACTICE), ...changes }));
  return file;
}

export async function enterName(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(name);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

export const menuButton = (page: Page) => page.getByRole("button", { name: "Menu" });
export const menuItem = (page: Page, name: string) => page.getByRole("menuitem", { name });

/** Downloads a backup from the ⋯ menu and keeps it at `file`. */
export async function downloadBackup(page: Page, file: string) {
  const download = page.waitForEvent("download");
  await menuButton(page).click();
  await menuItem(page, "Download backup").click();
  await (await download).saveAs(file);
}

/** Picks `file` in the file chooser that Restore from backup… opens; a dialog then asks to confirm. */
export async function restoreFrom(page: Page, file: string) {
  const chooser = page.waitForEvent("filechooser");
  await menuButton(page).click();
  await menuItem(page, "Restore from backup…").click();
  await (await chooser).setFiles(file);
}

export const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

export const editorText = (page: Page) =>
  page.evaluate(() => (document.querySelector("#editor") as unknown as EditorElement).env.editor.getValue());

/** Puts `code` in the editor in one go, without ACE's auto-closing. */
export const setEditorText = (page: Page, code: string) =>
  page.evaluate((code) => {
    (document.querySelector("#editor") as unknown as EditorElement).env.editor.setValue(code, 1);
  }, code);

/** The editor's text with `|` at the caret. */
export const editorTextWithCaret = (page: Page) =>
  page.evaluate(() => {
    const { editor } = (document.querySelector("#editor") as unknown as EditorElement).env;
    const { row, column } = editor.getCursorPosition();
    const lines = editor.getValue().split("\n");
    lines[row] = `${lines[row]!.slice(0, column)}|${lines[row]!.slice(column)}`;
    return lines.join("\n");
  });

interface EditorElement {
  env: {
    editor: {
      getValue(): string;
      setValue(value: string, cursor: number): void;
      getCursorPosition(): { row: number; column: number };
    };
  };
}
