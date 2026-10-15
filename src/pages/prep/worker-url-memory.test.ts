import { describe, expect, it } from "vitest";
import { newCompetition } from "./competition.ts";
import { workerUrlMemory } from "./worker-url-memory.ts";

const WORKER = "https://citd.example.workers.dev/";

function fakeStore() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

// One store for the memory's lifetime, as localStorage is.
function remembering() {
  const store = fakeStore();
  return workerUrlMemory(() => store);
}

const throwing = {
  getItem(): string | null {
    throw new Error("SecurityError");
  },
  setItem() {
    throw new Error("QuotaExceededError");
  },
};

const off = { ...newCompetition().audience, enabled: false, workerUrl: "" };

describe("workerUrlMemory", () => {
  it("fills a remembered Worker URL into an empty one when the Audience layer is turned on", () => {
    const memory = remembering();
    memory.remember(WORKER);

    expect(memory.fill(off, { enabled: true })).toEqual({ enabled: true, workerUrl: WORKER });
  });

  it("remembers the URL trimmed, as typed, not reduced to its origin", () => {
    const memory = remembering();
    memory.remember("  https://citd.example.workers.dev/some/path  ");

    expect(memory.fill(off, { enabled: true }).workerUrl).toBe("https://citd.example.workers.dev/some/path");
  });

  it("replaces the remembered URL with a newer valid one", () => {
    const memory = remembering();
    memory.remember(WORKER);
    memory.remember("http://localhost:8787");

    expect(memory.fill(off, { enabled: true }).workerUrl).toBe("http://localhost:8787");
  });

  it("keeps the remembered URL when an invalid or empty one is typed", () => {
    const memory = remembering();
    memory.remember(WORKER);
    memory.remember("citd.example");
    memory.remember("ftp://citd.example");
    memory.remember("   ");

    expect(memory.fill(off, { enabled: true }).workerUrl).toBe(WORKER);
  });

  it("keeps a Competition's own Worker URL when the Audience layer is turned on", () => {
    const memory = remembering();
    memory.remember(WORKER);

    expect(memory.fill({ ...off, workerUrl: "http://own.example" }, { enabled: true })).toEqual({ enabled: true });
  });

  it("fills a Worker URL that's only whitespace", () => {
    const memory = remembering();
    memory.remember(WORKER);

    expect(memory.fill({ ...off, workerUrl: "  " }, { enabled: true }).workerUrl).toBe(WORKER);
  });

  it("fills only when the Audience layer goes from off to on", () => {
    const memory = remembering();
    memory.remember(WORKER);
    const on = { ...off, enabled: true };

    expect(memory.fill(on, { enabled: true })).toEqual({ enabled: true });
    expect(memory.fill(off, { enabled: false })).toEqual({ enabled: false });
    expect(memory.fill(on, { joinCode: "ABCDEF" })).toEqual({ joinCode: "ABCDEF" });
  });

  it("fills nothing when no URL has been typed", () => {
    expect(remembering().fill(off, { enabled: true })).toEqual({ enabled: true });
  });

  it("keeps the remembered URL in its own citd-prep: key", () => {
    const store = fakeStore();
    workerUrlMemory(() => store).remember(WORKER);

    expect([...store.items]).toEqual([["citd-prep:worker-url", WORKER]]);
  });

  it("ignores a stored value that isn't a valid Worker URL", () => {
    const store = fakeStore();
    store.setItem("citd-prep:worker-url", "citd.example");

    expect(workerUrlMemory(() => store).fill(off, { enabled: true })).toEqual({ enabled: true });
  });

  it("remembers and fills nothing when storage throws", () => {
    const memory = workerUrlMemory(() => throwing);
    memory.remember(WORKER);

    expect(memory.fill(off, { enabled: true })).toEqual({ enabled: true });
  });

  it("remembers and fills nothing when storage can't even be reached", () => {
    const memory = workerUrlMemory(() => {
      throw new Error("SecurityError");
    });
    memory.remember(WORKER);

    expect(memory.fill(off, { enabled: true })).toEqual({ enabled: true });
  });
});
