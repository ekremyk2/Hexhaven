// T-501 requirement 4: reconnect.spec — a mid-game page reload auto-rejoins (via the `hexhaven.session`
// localStorage token, ws/session.ts) to an IDENTICAL view, and a pending discard specifically
// survives a reload and can still be completed afterward.
import { test, expect } from "@playwright/test";
import {
  autoDiscard,
  boardFingerprint,
  closeAll,
  driveOneStep,
  fourPlayers,
  freshFlags,
  playSetupPhase,
} from "./helpers";

test.describe("reconnect", () => {
  test("a page reload mid-game resyncs an identical view (board fingerprint + own hand)", async ({
    browser,
  }) => {
    const game = await fourPlayers(browser);
    try {
      await playSetupPhase(game.pages);

      const page = game.pages[0]!;
      // Roll once so there's real post-setup state (production, `turn.roll`) to lose if reconnect
      // were broken, not just the empty just-placed board.
      await page.getByTestId("action-roll").click();
      await expect(page.getByTestId("dice-panel")).not.toContainText("–");

      const preFingerprint = await boardFingerprint(page);
      const preDiceText = await page.getByTestId("dice-panel").innerText();
      const preHandText = await page.getByTestId("hand").innerText();

      await page.reload();

      // The ws client's `maybeRejoin()` (ws/client.ts) fires on every fresh socket open, keyed off
      // the `hexhaven.session` entry `lobbySlice`/`ws/session.ts` wrote at seat-claim time — a real
      // browser reload preserves localStorage, so this exercises the actual `game.rejoin` wire path,
      // not a mock. Waiting on the action-bar reappearing (rather than a fixed delay) is the
      // deterministic signal requirement 6 asks for.
      await expect(page.getByTestId("action-bar")).toBeVisible();

      await expect
        .poll(async () => boardFingerprint(page))
        .toEqual(preFingerprint);
      await expect(page.getByTestId("dice-panel")).toHaveText(preDiceText);
      await expect(page.getByTestId("hand")).toHaveText(preHandText);
    } finally {
      await closeAll(game);
    }
  });

  test("a pending discard survives a reload and can still be completed afterward", async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const game = await fourPlayers(browser);
    try {
      await playSetupPhase(game.pages);

      const flags = freshFlags();
      const MAX_STEPS = 400;
      let discardSeat: number | null = null;
      let steps = 0;

      // Drive real turns WITHOUT auto-resolving a discard the moment one opens — the loop stops
      // the instant any seat's discard modal is merely pending, so this test controls exactly when
      // the reload happens relative to that decision.
      while (steps < MAX_STEPS && discardSeat === null) {
        const result = await driveOneStep(game.pages, flags, { resolveDiscards: false });
        steps += 1;
        if (result.kind === "discard") discardSeat = result.seat;
      }

      test.skip(
        discardSeat === null,
        `no natural 7-forced discard occurred within ${MAX_STEPS} steps under HEXHAVEN_TEST_SEED — ` +
          "this seed needs a nudge (constants.ts) or MAX_STEPS needs raising; see gameplay.spec.ts's " +
          "header for the same caveat.",
      );

      const page = game.pages[discardSeat!]!;
      const requiredText = await page.getByTestId("discard-selected-count").innerText();
      const preFingerprint = await boardFingerprint(page);

      await page.reload();

      // The engine's `discard` phase (`phase.pending`) is part of `PlayerView.phase`, resynced
      // wholesale on rejoin (T-205: `game.rejoin` -> `game.sync` -> the same `redact(state, seat)`
      // a fresh `game.syncRequest` would produce) — no special-casing needed for this to survive a
      // reload, which is exactly what this asserts.
      await expect(page.getByTestId("discard-modal")).toBeVisible();
      await expect(page.getByTestId("discard-selected-count")).toHaveText(requiredText);
      expect(await boardFingerprint(page)).toEqual(preFingerprint);

      await autoDiscard(page);
      await expect(page.getByTestId("discard-modal")).toBeHidden();
    } finally {
      await closeAll(game);
    }
  });
});
