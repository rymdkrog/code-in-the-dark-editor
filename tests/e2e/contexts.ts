// Browser contexts a test opens besides its own `page`'s. Playwright closes only the context it
// made, so one left open keeps its pages running, reconnecting and animating for the rest of the
// worker, and WebKit slows down for every test after it: enough on CI to time tests out.

import type { Browser, BrowserContext, BrowserContextOptions } from "@playwright/test";

const open = new Set<BrowserContext>();

/** A new context in `browser`, which `closeOwnContexts` closes if the test doesn't. */
export async function ownContext(browser: Browser, options?: BrowserContextOptions): Promise<BrowserContext> {
  const context = await browser.newContext(options);
  open.add(context);
  context.on("close", () => open.delete(context));
  return context;
}

/** Closes every context `ownContext` opened that is still open, the test failed or not. Each file
 * that opens them runs it in `test.afterEach`. */
export async function closeOwnContexts() {
  await Promise.all([...open].map((context) => context.close()));
}
