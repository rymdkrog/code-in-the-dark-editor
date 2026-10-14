import { afterAll, beforeAll, expect, test } from "vitest";
import { smoke } from "./smoke.ts";
import { ORGANIZER_KEY, startWorker } from "./socket.ts";

const worker = startWorker();
beforeAll(() => worker.listen(), 30_000);
afterAll(() => worker.close());

test("the smoke test claims a throwaway Competition with Origin: null and round-trips it", async () => {
  const { url } = await worker.listen();

  const passed = await smoke(url.href, ORGANIZER_KEY);

  expect(passed).toEqual([
    "a Host socket with Origin: null claimed a throwaway Competition",
    "a second Host socket read the claim back",
    "a Contestant socket with Origin: null reached the Roster",
    "every role's socket answered a ping",
  ]);
});

test("the smoke test fails, saying why, when the Organizer key is wrong", async () => {
  const { url } = await worker.listen();

  await expect(smoke(url.href, "not-the-key")).rejects.toThrow(
    'claiming a throwaway Competition: expected "competition", got {"v":1,"t":"claim-refused","reason":"organizer-key"}',
  );
});
