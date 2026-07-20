// Shared constants between `playwright.config.ts` (webServer wiring) and every spec — kept in one
// place so the port/seed are never typed twice and can't drift out of sync.

/** Fixed, non-default port for the E2E server instance (docs/04: "boots server on an ephemeral
 * port" — a dedicated fixed port is used instead of a truly ephemeral one so Playwright's built-in
 * `webServer.url` health-check has a known address to poll; it's still isolated from the dev
 * server's default 8080, so a `pnpm dev` left running elsewhere never collides with the suite). */
export const E2E_PORT = 8199;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/**
 * `HEXHAVEN_TEST_SEED` (session.ts, T-501 cross-task edit): pins every room's board layout + dice RNG
 * to the exact same deterministic sequence on every run — the entire basis of requirement 6's
 * "zero tolerated" flake policy. All four suites import this one constant so a future reseed (if a
 * suite's scripted turn budget ever needs adjusting) is a one-line change.
 */
export const E2E_SEED = "T-501-e2e-fixed-seed-v1";

/** Seat-indexed nicknames used by every suite that creates/joins a room — distinct, non-overlapping
 * substrings so `currentTurnOwnerSeat` (helpers.ts) can match one against the DicePanel's rendered
 * text unambiguously. */
export const NICKNAMES = ["Alice", "Bram", "Cleo", "Deniz"] as const;
