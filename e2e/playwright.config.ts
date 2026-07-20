// T-501: Playwright project config. `pnpm -w e2e` (root package.json) builds every workspace
// package first (`pnpm -w build` -> apps/server/dist + apps/client/dist), then this config's
// `webServer` boots the REAL built server (docs/02 §9's single-port deployment shape: Fastify
// serves the built client statically AND the ws hub on one port) against a fixed E2E port + a
// pinned `HEXHAVEN_TEST_SEED` (session.ts) so every suite's board/dice sequence is byte-for-byte
// identical across the "3 consecutive runs" flake check (task acceptance criterion 1).
import { defineConfig, devices } from "@playwright/test";
import { E2E_PORT, E2E_SEED, BASE_URL } from "./constants";

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: {
    // Deterministic-signal waits only (requirement 6) — this is a ceiling on how long a single
    // `expect(...).toX()` polls before failing, never a substitute for a fixed sleep.
    timeout: 15_000,
  },
  // One shared server instance per whole run (webServer below); running specs concurrently would
  // interleave rooms/sockets across files for no benefit and complicate the fixed-seed reasoning
  // (every room gets the SAME seed — harmless for independent games, but easier to reason about
  // serially). Matches requirement 6's flake-intolerance: no cross-worker interference to debug.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // `cwd` is resolved relative to this config file (e2e/), so `../` is the repo root — where
    // `pnpm -w build` already produced apps/server/dist/index.js + apps/client/dist/*.
    command: "node apps/server/dist/index.js",
    cwd: "../",
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(E2E_PORT),
      NODE_ENV: "production",
      LOG_LEVEL: "silent",
      HEXHAVEN_TEST_SEED: E2E_SEED,
      // Reach a win in a few turns (setup already grants 2 VP) so fullgame/gameplay specs finish in
      // seconds, not the multi-minute slog a real race to 10 would take.
      HEXHAVEN_TARGET_VP: "4",
    },
  },
});
