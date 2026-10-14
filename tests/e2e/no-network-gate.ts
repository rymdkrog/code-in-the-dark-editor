import { expect, type BrowserContext, type ConsoleMessage, type Frame, type Request } from "@playwright/test";

const ALLOWED_SCHEMES = ["file:", "data:", "blob:"];

/** The Reveal's frame, the Core Editor's only srcdoc document. */
const isReveal = (frame: Frame) => frame.url() === "about:srcdoc";

/**
 * The no-network gate. Takes the context offline, then records every request a page makes,
 * every CSP violation and every error it reports. The returned check fails on anything that
 * left file:, data: or blob:, and on any error. It also fails on any prompt(), confirm() or
 * alert(): Chromium leaves fullscreen for them, so the Core Editor uses <dialog> instead.
 *
 * The Reveal renders the Contestant's code, which may reach for the web. The package's CSP
 * blocking it there is the game rule working, so only what gets past the CSP fails the gate.
 */
export async function gateNetwork(context: BrowserContext): Promise<() => void> {
  const offending: string[] = [];
  const leaving = new Set<Request>();
  const errors: string[] = [];
  const browserDialogs: string[] = [];
  await context.setOffline(true);
  context.on("request", (request) => {
    if (!ALLOWED_SCHEMES.includes(new URL(request.url()).protocol)) leaving.add(request);
  });
  // Chromium reports a request the CSP blocks, then fails it.
  context.on("requestfailed", (request) => {
    if (request.failure()?.errorText === "csp" && isReveal(request.frame())) leaving.delete(request);
  });
  context.on("console", (message) => {
    if (message.type() === "error" && !fromRevealedCode(message)) errors.push(message.text());
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
  await context.exposeBinding("reportCspViolation", ({ frame }, uri: string) => {
    if (!isReveal(frame)) offending.push(`CSP: ${uri}`);
  });
  await context.addInitScript(() =>
    document.addEventListener("securitypolicyviolation", (event) =>
      (window as unknown as { reportCspViolation(uri: string): void }).reportCspViolation(event.blockedURI),
    ),
  );

  return () => {
    const requests = [...leaving].map((request) => request.url());
    expect([...offending, ...requests], "requests other than file:, data: or blob:").toEqual([]);
    expect(errors, "errors reported by the page").toEqual([]);
    expect(browserDialogs, "prompt(), confirm() or alert()").toEqual([]);
  };
}

/**
 * Whether an error comes from the Contestant's code in the Reveal: its blocked scripts, refused
 * loads and missing files. Not every browser says which frame an error came from, so during a
 * Reveal only errors placed in the editor's own page count.
 */
function fromRevealedCode(message: ConsoleMessage) {
  const page = message.page();
  return !!page && page.frames().some(isReveal) && message.location().url !== page.url();
}
