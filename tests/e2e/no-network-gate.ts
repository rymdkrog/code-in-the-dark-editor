import { expect, type BrowserContext } from "@playwright/test";

const ALLOWED_SCHEMES = ["file:", "data:", "blob:"];

/**
 * The no-network gate. Takes the context offline, then records every request a page makes,
 * every CSP violation and every error it reports. The returned check fails on anything that
 * left file:, data: or blob:, and on any error. It also fails on any prompt(), confirm() or
 * alert(): Chromium leaves fullscreen for them, so the Core Editor uses <dialog> instead.
 */
export async function gateNetwork(context: BrowserContext): Promise<() => void> {
  const offending: string[] = [];
  const errors: string[] = [];
  const browserDialogs: string[] = [];
  await context.setOffline(true);
  context.on("request", (request) => {
    if (!ALLOWED_SCHEMES.includes(new URL(request.url()).protocol)) offending.push(request.url());
  });
  context.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  context.on("weberror", (error) => errors.push(String(error.error())));
  // "Leave the page?" is answered yes, as a person closing the tab would.
  context.on("dialog", (dialog) => {
    if (dialog.type() === "beforeunload") return void dialog.accept();
    browserDialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  // A request the package's CSP blocks never reaches the network, so it never shows up
  // as a request. Count the violation itself.
  await context.exposeBinding("reportCspViolation", (_source, uri: string) => offending.push(`CSP: ${uri}`));
  await context.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      (window as unknown as { reportCspViolation(uri: string): void }).reportCspViolation(event.blockedURI),
    ),
  );

  return () => {
    expect(offending, "requests other than file:, data: or blob:").toEqual([]);
    expect(errors, "errors reported by the page").toEqual([]);
    expect(browserDialogs, "prompt(), confirm() or alert()").toEqual([]);
  };
}
