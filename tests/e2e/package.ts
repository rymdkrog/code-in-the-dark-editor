import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test as base, type Page } from "@playwright/test";
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

export async function openPackage(page: Page, file = PRACTICE) {
  await page.goto(pathToFileURL(file).href);
  await enterName(page, "Anna");
  // The editor takes focus back by itself, so the Contestant can type straight away.
  await expect(page.locator("#editor textarea")).toBeFocused();
}

export async function enterName(page: Page, name: string) {
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox").fill(name);
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
}

export const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

export const editorText = (page: Page) =>
  page.evaluate(() => (document.querySelector("#editor") as unknown as EditorElement).env.editor.getValue());

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
  env: { editor: { getValue(): string; getCursorPosition(): { row: number; column: number } } };
}
