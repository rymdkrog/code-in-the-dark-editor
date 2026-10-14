// The real Worker, run by Playwright under `wrangler dev` (see playwright.config.ts).

export const WORKER_PORT = 8788;
export const WORKER_URL = `http://localhost:${WORKER_PORT}`;
export const WORKER_ORGANIZER_KEY = "e2e-organizer-key";
