import { describe, expect, it } from "vitest";
import { refusal } from "./worker-url.ts";

describe("refusal", () => {
  it("lets a local Worker through", () => {
    expect(refusal("http://localhost:8787", false)).toBeNull();
    expect(refusal("http://127.0.0.1:9000", false)).toBeNull();
  });

  it("refuses a remote Worker unless --allow-remote is given", () => {
    expect(refusal("https://citd.example.workers.dev", false)).toBe(
      "Refusing https://citd.example.workers.dev: it isn't local. Pass --allow-remote to use it anyway.",
    );
    expect(refusal("https://citd.example.workers.dev", true)).toBeNull();
  });

  it("always refuses the e2e Worker's port", () => {
    const why = "Refusing http://localhost:8788: that's the port `npm run test:e2e` runs its Worker on.";
    expect(refusal("http://localhost:8788", false)).toBe(why);
    expect(refusal("http://localhost:8788", true)).toBe(why);
  });

  it("refuses what isn't an http(s) URL", () => {
    expect(refusal("localhost:8787", false)).toBe("Refusing localhost:8787: the Worker URL isn't an http(s) URL.");
  });
});
