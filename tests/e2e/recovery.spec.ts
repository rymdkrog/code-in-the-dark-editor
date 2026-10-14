import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, firefox, webkit, type BrowserContext, type Page } from "@playwright/test";
import { gateNetwork } from "./no-network-gate.ts";
import { editorText, makePackage, openPackage, PRACTICE, roundIn, test } from "./package.ts";

// The recovery suite: a Contestant never loses work.

const ENGINES = { chromium, firefox, webkit };

/**
 * A browser with a profile on disk, so it can be closed or killed and opened again on the
 * same storage, as a Contestant reopening their browser would.
 */
function browserProfile(browserName: keyof typeof ENGINES) {
  // Each test launches a browser twice; Firefox alone can take seconds to start.
  test.slow();
  const dir = mkdtempSync(join(tmpdir(), "citd-profile-"));
  const checks: (() => void)[] = [];
  return {
    async open(): Promise<BrowserContext> {
      const context = await ENGINES[browserName].launchPersistentContext(dir);
      checks.push(await gateNetwork(context));
      return context;
    },
    /** SIGKILLs the browser: no unload events, no shutdown, as in a crash. */
    kill() {
      // The profile directory is on every browser's command line, and on no one else's.
      execFileSync("pkill", ["-KILL", "-f", dir]);
    },
    checkGate: () => checks.forEach((check) => check()),
  };
}

/**
 * Closes the tab as a person does: unload events run, and the gate answers any "leave the
 * page?" question yes. Playwright's plain close can tear the page down halfway through
 * `pagehide`.
 *
 * Playwright can't do this in WebKit: closing with unload events hangs, and a plain close
 * tears the page down mid-`pagehide`. There the tab closes once the 300 ms save is in, and
 * the refresh test covers the save in `pagehide`.
 */
async function closeTab(page: Page, browserName: keyof typeof ENGINES) {
  if (browserName === "webkit") {
    await page.waitForTimeout(400);
    await page.close();
    return;
  }
  const closed = page.waitForEvent("close");
  await page.close({ runBeforeUnload: true });
  await closed;
}

test("a refresh straight after typing restores the code", async ({ page }) => {
  await openPackage(page);
  await page.keyboard.type("<h1>Still here</h1>");

  await page.reload();

  await expect.poll(() => editorText(page)).toBe("<h1>Still here</h1></h1>");
});

test("closing the tab straight after typing and reopening the file restores the code", async ({
  browserName,
  context,
  page,
}) => {
  await openPackage(page);
  await page.keyboard.type("<h1>Still here</h1>");

  await closeTab(page, browserName);
  const reopened = await context.newPage();
  await openPackage(reopened);

  expect(await editorText(reopened)).toBe("<h1>Still here</h1></h1>");
});

test("closing the window straight after typing and reopening the file restores the code", async ({
  browserName,
}) => {
  const profile = browserProfile(browserName);
  const before = await profile.open();
  const page = await before.newPage();
  await openPackage(page);
  await page.keyboard.type("<h1>Still here</h1>");

  // A person closing the window unloads its tabs, then the browser shuts down. Playwright's
  // browser close alone skips unload events in Chromium, like a force quit.
  await closeTab(page, browserName);
  await before.close();
  const after = await profile.open();
  const reopened = await after.newPage();
  await openPackage(reopened);

  expect(await editorText(reopened)).toBe("<h1>Still here</h1></h1>");
  await after.close();
  profile.checkGate();
});

test("killing the browser mid-typing loses at most the last 300 ms", async ({ browserName }) => {
  const profile = browserProfile(browserName);
  const before = await profile.open();
  const page = await before.newPage();
  await openPackage(page);

  // Steady typing, never pausing long enough for a plain debounce to fire.
  const typed: { text: string; at: number }[] = [];
  const keys = "abcdefghijklmnopqrstuvwxyz".repeat(2);
  for (const key of keys) {
    await page.keyboard.type(key);
    typed.push({ text: keys.slice(0, typed.length + 1), at: Date.now() });
    await page.waitForTimeout(40);
  }
  const killedAt = Date.now();
  profile.kill();
  await before.close().catch(() => {});

  const after = await profile.open();
  const reopened = await after.newPage();
  await openPackage(reopened);

  // After a kill the code comes back from IndexedDB, which answers a moment after the editor opens.
  const safe = typed.findLast(({ at }) => at <= killedAt - 300)!.text;
  await expect.poll(async () => (await editorText(reopened)).length).toBeGreaterThanOrEqual(safe.length);
  const restored = await editorText(reopened);
  expect(keys.startsWith(restored), `restored ${JSON.stringify(restored)}`).toBe(true);
  await after.close();
  profile.checkGate();
});

// Headless pages are never hidden or blurred, so these events are fired by hand. The browser
// is killed 100 ms later, before the 300 ms save could run.
for (const leaving of ["blur", "visibilitychange→hidden"] as const) {
  test(`switching away (${leaving}) saves at once`, async ({ browserName }) => {
    const profile = browserProfile(browserName);
    const before = await profile.open();
    const page = await before.newPage();
    await openPackage(page);
    await page.keyboard.type("x");

    await page.evaluate((leaving) => {
      if (leaving === "blur") dispatchEvent(new Event("blur"));
      else {
        Object.defineProperty(document, "visibilityState", { value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      }
    }, leaving);
    await page.waitForTimeout(100);
    profile.kill();
    await before.close().catch(() => {});
    const after = await profile.open();
    const reopened = await after.newPage();
    await openPackage(reopened);

    await expect.poll(() => editorText(reopened)).toBe("x");
    await after.close();
    profile.checkGate();
  });
}

test("undo straight after reopening keeps the restored code", async ({ page }) => {
  await openPackage(page);
  await page.keyboard.type("my code");
  await page.reload();
  await expect(page.locator("#editor textarea")).toBeFocused();
  await expect.poll(() => editorText(page)).toBe("my code");

  await page.keyboard.press("ControlOrMeta+z");
  await page.keyboard.press("ControlOrMeta+z");

  expect(await editorText(page)).toBe("my code");
});

test("two Rounds never see each other's code", async ({ page }) => {
  const heat = makePackage(test.info().outputPath("citd-heat-1.html"), { roundId: "heat-1-a1b2c3", roundName: "Heat 1" });
  const final = makePackage(test.info().outputPath("citd-final.html"), { roundId: "final-d4e5f6", roundName: "Final" });

  await openPackage(page, heat);
  await page.keyboard.type("heat code");
  await openPackage(page, final);
  expect(await editorText(page)).toBe("");
  await page.keyboard.type("final code");
  await openPackage(page, heat);

  expect(await editorText(page)).toBe("heat code");
});

test("a newer Revision of the Round opens with the same autosave", async ({ page, browserName }) => {
  test.skip(browserName === "firefox", "Firefox keeps one store per file path; Restore from backup covers it");
  const round = { roundId: "heat-2-a1b2c3", roundName: "Heat 2" };
  const first = makePackage(test.info().outputPath("rev-1/citd-heat-2.html"), { ...round, revision: "1-202610121403" });
  const second = makePackage(test.info().outputPath("rev-2/citd-heat-2.html"), { ...round, revision: "2-202610121510" });

  await openPackage(page, first);
  await page.keyboard.type("my code");
  await openPackage(page, second);

  expect(await editorText(page)).toBe("my code");
});

// No Contestant sees storage keys, but the ticket requires the prefix: it is what keeps Rounds
// apart in browsers that share one store across local files. The name is the one deliberate
// exception: it belongs to the laptop, not the Round.
test("every key the editor stores is under the Round id, and other keys are left alone", async ({ page }) => {
  const { roundId } = roundIn(PRACTICE);
  await openPackage(page);
  await page.evaluate(() => {
    localStorage.setItem("someone-else", "theirs");
    localStorage.setItem("other-round:code", "other Round's code");
  });

  await page.keyboard.type("my code");

  await expect.poll(() => indexedDBKeys(page)).toEqual([`${roundId}:code`]);
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys.filter((key) => !["someone-else", "other-round:code", "citd:name"].includes(key))).toEqual([
    `${roundId}:code`,
  ]);
  expect(await page.evaluate(() => localStorage.getItem("someone-else"))).toBe("theirs");
  expect(await page.evaluate(() => localStorage.getItem("other-round:code"))).toBe("other Round's code");
});

const STORAGE_FAILING = "Autosave isn't working — download a backup";

/** Makes every localStorage write throw while `window.failStorage` is true, as a full disk does. */
const breakStorage = (page: Page, from: "open" | "later") =>
  page.addInitScript((failing) => {
    const flags = window as unknown as { failStorage: boolean };
    flags.failStorage = failing;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (flags.failStorage) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      setItem.call(this, key, value);
    };
  }, from === "open");

const failStorage = (page: Page, failing: boolean) =>
  page.evaluate((failing) => ((window as unknown as { failStorage: boolean }).failStorage = failing), failing);

test("when storage fails on open, an icon says so and typing carries on", async ({ page }) => {
  await breakStorage(page, "open");

  await openPackage(page);

  await expect(page.getByTitle(STORAGE_FAILING)).toBeVisible();
  await page.keyboard.type("still typing");
  expect(await editorText(page)).toBe("still typing");
});

test("when a later save fails, the icon appears until a save succeeds", async ({ page }) => {
  await breakStorage(page, "later");
  await openPackage(page);
  await expect(page.getByTitle(STORAGE_FAILING)).toBeHidden();

  await failStorage(page, true);
  await page.keyboard.type("one");
  await expect(page.getByTitle(STORAGE_FAILING)).toBeVisible();

  await failStorage(page, false);
  await page.keyboard.type(" two");
  await expect(page.getByTitle(STORAGE_FAILING)).toBeHidden();
  expect(await editorText(page)).toBe("one two");
});

/** Every key in every IndexedDB database the page can see. */
const indexedDBKeys = (page: Page) =>
  page.evaluate(async () => {
    const keys: IDBValidKey[] = [];
    for (const { name } of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(name!);
        request.onsuccess = () => resolve(request.result);
      });
      for (const store of db.objectStoreNames) {
        const storeKeys = await new Promise<IDBValidKey[]>((resolve) => {
          const request = db.transaction(store).objectStore(store).getAllKeys();
          request.onsuccess = () => resolve(request.result);
        });
        keys.push(...storeKeys);
      }
      db.close();
    }
    return keys;
  });
