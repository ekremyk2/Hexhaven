// T-501 requirement 2: lobby.spec — create/join (bad code, full-lobby rejection), ready gating,
// and start -> all 4 land on the game screen with an identical board fingerprint.
import { test, expect } from "@playwright/test";
import {
  boardFingerprint,
  closeAll,
  createRoom,
  fourPlayers,
  joinRoomExpectingError,
  joinRoomExpectingSuccess,
  readyUp,
} from "./helpers";
import { NICKNAMES } from "./constants";

test.describe("lobby", () => {
  test("joining a code with no live room shows an inline error", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      // A well-formed but certainly-unused room code (docs/02 §7: 5 chars, A-HJ-NP-Z2-9).
      await joinRoomExpectingError(page, "Solo", "ZZZZ2");
      await expect(page.getByTestId("home-join-card").getByRole("alert")).toHaveText(
        "That game doesn't exist.",
      );
      // The URL never left Home — a rejected join must not navigate.
      await expect(page).toHaveURL(/\/$/);
    } finally {
      await context.close();
    }
  });

  test("a 5th join attempt against a full 4-player lobby is rejected", async ({ browser }) => {
    const contexts = await Promise.all([0, 1, 2, 3, 4].map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    try {
      const { code } = await createRoom(pages[0]!, NICKNAMES[0]!);
      for (let seat = 1; seat < 4; seat++) {
        await joinRoomExpectingSuccess(pages[seat]!, NICKNAMES[seat]!, code);
      }
      // 4 seats now full (the default `RoomConfig.playerCount` is 4, OptionsPanel.tsx) — a 5th
      // join must bounce with LOBBY_FULL, never silently seat itself.
      await joinRoomExpectingError(pages[4]!, "Fifth", code);
      await expect(pages[4]!.getByTestId("home-join-card").getByRole("alert")).toHaveText(
        "That lobby is full.",
      );
      await expect(pages[4]!).toHaveURL(/\/$/);
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("ready gating: Start stays disabled until every seat is filled and ready", async ({ browser }) => {
    const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    try {
      const { code } = await createRoom(pages[0]!, NICKNAMES[0]!);
      const startButton = pages[0]!.getByRole("button", { name: "Start game" });

      // Only seat 0 present: Start is disabled (3 seats still empty).
      await expect(startButton).toBeDisabled();

      for (let seat = 1; seat < 4; seat++) {
        await joinRoomExpectingSuccess(pages[seat]!, NICKNAMES[seat]!, code);
      }
      await expect(pages[0]!.getByTestId("lobby-seat-3")).toContainText(NICKNAMES[3]!);

      // Full, but nobody's readied yet — still disabled.
      await expect(startButton).toBeDisabled();

      // Ready seats 1-3, leaving the host not-ready: still disabled (D-025 needs EVERY seat).
      for (let seat = 1; seat < 4; seat++) await readyUp(pages[seat]!);
      await expect(pages[0]!.getByTestId("lobby-seat-1")).toContainText("Ready");
      await expect(startButton).toBeDisabled();

      // Host readies too: now enabled.
      await readyUp(pages[0]!);
      await expect(startButton).toBeEnabled();
    } finally {
      await Promise.all(contexts.map((c) => c.close()));
    }
  });

  test("starting a full-ready lobby lands all 4 seats on the game screen with an identical board", async ({
    browser,
  }) => {
    const game = await fourPlayers(browser);
    try {
      // Every page already asserts action-bar visibility inside `fourPlayers` (`waitForGameScreen`)
      // — the requirement-2 core assertion is that the PUBLIC board layout is byte-identical
      // across all four independently-redacted views (docs/02 §6: board/terrain/tokens are never
      // hidden, so this is exactly the kind of thing that must never differ per viewer).
      const fingerprints = await Promise.all(game.pages.map((p) => boardFingerprint(p)));
      expect(fingerprints[0]!.length).toBeGreaterThan(0);
      for (const fp of fingerprints.slice(1)) {
        expect(fp).toEqual(fingerprints[0]);
      }
    } finally {
      await closeAll(game);
    }
  });
});
