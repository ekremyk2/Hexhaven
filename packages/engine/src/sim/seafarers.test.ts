// T-706: the Seafarers scenario's large-scale simulation acceptance gate (docs/10 §7, M7). Plays
// seeded "Heading for New Shores" games at BOTH supported player counts (3 and 4) with the
// random-legal-move bot (sim/bot.ts, which builds/moves ships, settles islands, moves the pirate,
// and picks gold resources), asserting the config-aware base invariants I1–I10 (invariants.ts,
// seafarers-aware: sea hexes carry no token, ship supply conserved, one piece per edge, S6 Longest
// Trade Route recompute-vs-state) AND the seafarers S-clause invariants (seafarersInvariants.ts:
// ship-supply bounds, pirate-on-sea, island-chit legitimacy) after EVERY successful transition.
// `simulate` throws on the first violation or an I10 timeout, with the seed + action index + offending
// action folded in for a ready repro.
//
// Every game runs to the scenario's real 14-VP target (createGame resolves S10.1's target from the
// scenario, overriding the config value — so a 14-VP win is asserted, not the base 10).
//
// Ship-build + island stats (the T-706 headline deliverable — do bots actually build ships and claim
// islands, closing the T-705 flag?) are aggregated and emitted via process.stdout.write (packages/
// engine bans the console global), with regression assertions that keep the bot's ship/island play
// from silently regressing.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { getScenario } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';
import { WONDER_STAGES } from '../modules/seafarers/wonder.js';

/** Games per player count. 500 → 1,000 total (500@3p + 500@4p), the docs/10 §7 gate. */
const GAMES_PER = 500;

/** Generous I10 cap: a 14-VP scenario game with the bot's heavy ship movement runs longer than the
 *  4p/10-VP base, but observed max is ~3.3k — 12k leaves ample headroom. */
const MAX_ACTIONS = 12_000;

function seafarersConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    // createGame overrides this with the scenario's 14-VP target (S10.1); set here only to satisfy
    // the config type — the value is intentionally not the one the game plays to.
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
  };
}

interface CellStats {
  cell: string;
  playerCount: number;
  games: number;
  meanTurns: number;
  meanActions: number;
  maxActions: number;
  winsBySeat: Partial<Record<Seat, number>>;
  /** Ship-build headline: mean ships built per game, mean ship moves, peak ships one seat held. */
  meanShipsBuilt: number;
  meanShipMoves: number;
  maxPeakShipsOnBoard: number;
  gamesWithAShipFraction: number;
  /** Island headline: mean island chits earned per game, fraction of games where ANY island chit was
   *  earned, and fraction of games the WINNER personally held ≥1 island chit. */
  meanIslandChits: number;
  gamesReachingAnIslandFraction: number;
  winnerHeldIslandChitFraction: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    // simulate() throws (failing this test, repro-ready) on any base/seafarers invariant or I10 hit.
    results.push(simulate(`sea${playerCount}-${i}`, { config: seafarersConfig(playerCount), maxActions: MAX_ACTIONS }));
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let shipsBuilt = 0;
  let shipMoves = 0;
  let maxPeak = 0;
  let gamesWithShip = 0;
  let islandChits = 0;
  let gamesWithIsland = 0;
  let winnerWithChit = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    shipsBuilt += r.shipsBuilt ?? 0;
    shipMoves += r.shipMoves ?? 0;
    maxPeak = Math.max(maxPeak, r.peakShipsOnBoard ?? 0);
    if ((r.shipsBuilt ?? 0) > 0) gamesWithShip += 1;
    islandChits += r.islandChitsEarned ?? 0;
    if ((r.islandChitsEarned ?? 0) > 0) gamesWithIsland += 1;
    if ((r.winnerIslandChits ?? 0) > 0) winnerWithChit += 1;
  }

  const stats: CellStats = {
    cell: `${playerCount}p`,
    playerCount,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    meanShipsBuilt: shipsBuilt / GAMES_PER,
    meanShipMoves: shipMoves / GAMES_PER,
    maxPeakShipsOnBoard: maxPeak,
    gamesWithAShipFraction: gamesWithShip / GAMES_PER,
    meanIslandChits: islandChits / GAMES_PER,
    gamesReachingAnIslandFraction: gamesWithIsland / GAMES_PER,
    winnerHeldIslandChitFraction: winnerWithChit / GAMES_PER,
  };
  return { results, stats };
}

describe('T-706 Seafarers simulation & invariant suite (Heading for New Shores, 3p + 4p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 3p/4p) to 14-VP wins with zero invariant violations`,
    () => {
      const allStats: CellStats[] = [];
      for (const playerCount of [3, 4] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);

        for (const r of results) {
          // Terminated inside the cap, took at least one turn, and reached the scenario's 14-VP win.
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the scenario target, not base 10
          // Ship supply never exceeded 15 (S1.1) at its peak in any game of this cell.
          expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15);
        }

        // No lopsided seat distribution — every seat wins a nontrivial share (setup/turn-order sanity).
        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- Ship-build regression (T-705 flag): bots DO build ships, in nearly every game -------
        expect(stats.gamesWithAShipFraction).toBeGreaterThan(0.95);
        expect(stats.meanShipsBuilt).toBeGreaterThan(5);
        expect(stats.meanShipMoves).toBeGreaterThan(0); // the moveShip (S7) path is exercised

        // ---- Island regression: bots reach small islands and claim chits (S10.6) ----------------
        expect(stats.gamesReachingAnIslandFraction).toBeGreaterThan(0.5);
        expect(stats.meanIslandChits).toBeGreaterThan(0.5);
        // Island VP is a real winning path, not just incidental: winners frequently hold a chit.
        expect(stats.winnerHeldIslandChitFraction).toBeGreaterThan(0.25);
      }

      process.stdout.write(`\nT-706 seafarers sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    600_000
  );
});

// ---------------------------------------------------------------------------
// T-751 — Seafarers 5–6 extension smoke (Heading for New Shores, best-effort boards)
// ---------------------------------------------------------------------------
// A lightweight smoke gate (NOT the full 500-game/cell statistical suite above): the 5p/6p boards
// are best-effort reconstructions (scenario.ts verify[]), so this only asserts the combo actually
// works end-to-end — `createGame` accepts fiveSix+seafarers at 5/6 players, the bot can play a full
// game to the scenario's 14-VP target on each best-effort board, and the base/seafarers invariants
// hold throughout. RK-13 isolation (byte-identical base-game digest) is checked separately.

const FIVE_SIX_SMOKE_GAMES = 20;

function fiveSixSeafarersConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
    // The client ALWAYS writes `pairedPlayers` for a fiveSix game (OptionsPanel.tsx withExpansionToggled)
    // — SBP is disabled in the picker (product decision, 2026-07-14: too slow/clicky at 6 players), so
    // no real game ever plays fiveSix+seafarers with the engine's bare `sbp` default. Match that here:
    // the SBP special-build bot path (sim/bot.ts) predates this combo and doesn't know about seafarers
    // sea/land edges, an unrelated pre-existing gap in a disabled feature, not something T-751 need fix.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-751 Seafarers 5-6 extension smoke (Heading for New Shores, 5p + 6p, best-effort boards)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 14-VP wins with zero invariant violations (fiveSix + seafarers combo)',
    (playerCount) => {
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        // simulate() throws (failing this test, repro-ready) on any base/seafarers invariant or I10 hit.
        const r = simulate(`sea56-${playerCount}-${i}`, {
          config: fiveSixSeafarersConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the scenario target, not base 10
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-752 — New World smoke (5-6-ONLY scenario, random-by-design best-effort boards)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751's above (NOT the full statistical suite): New World has no
// 3p/4p boards at all (boardPresets.ts gates it to `players: [5, 6]`), so this is its only sim
// coverage — asserts the combo works end-to-end at both counts it ships.

function newWorldConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'newWorld' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig above — the client always writes pairedPlayers for a fiveSix
    // game (SBP is disabled in the picker), so match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-752 New World smoke (5p + 6p, 5-6-only scenario, best-effort/random-by-design boards)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 14-VP wins with zero invariant violations (fiveSix + seafarers newWorld combo)',
    (playerCount) => {
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        const r = simulate(`newworld-${playerCount}-${i}`, {
          config: newWorldConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the scenario target, not base 10
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-753 — Through the Desert smoke (5-6-ONLY scenario, best-effort boards)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751/T-752's above: Through the Desert has no 3p/4p boards at all
// (boardPresets.ts gates it to `players: [5, 6]`), so this is its only sim coverage — asserts the
// combo works end-to-end at both counts it ships, roads crossing the desert band included.

function throughTheDesertConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'throughTheDesert' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig/newWorldConfig above — the client always writes pairedPlayers
    // for a fiveSix game (SBP is disabled in the picker), so match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-753 Through the Desert smoke (5p + 6p, 5-6-only scenario, best-effort boards)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 14-VP wins with zero invariant violations (fiveSix + seafarers throughTheDesert combo)',
    (playerCount) => {
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        const r = simulate(`throughthedesert-${playerCount}-${i}`, {
          config: throughTheDesertConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the scenario target, not base 10
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-754 — The Forgotten Tribe smoke (5-6-ONLY scenario, best-effort boards, per-island reward VP)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751/T-752/T-753's above: The Forgotten Tribe has no 3p/4p boards
// at all (boardPresets.ts gates it to `players: [5, 6]`), so this is its only sim coverage — asserts
// the combo works end-to-end at both counts it ships, including the per-island `islandRewards` VP
// mechanic (chits.ts) firing through the same `islandSettled` event as every other scenario.

function forgottenTribeConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'forgottenTribe' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig/newWorldConfig/throughTheDesertConfig above — the client always
    // writes pairedPlayers for a fiveSix game (SBP is disabled in the picker), so match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-754 The Forgotten Tribe smoke (5p + 6p, 5-6-only scenario, best-effort boards, per-island reward VP)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 14-VP wins with zero invariant violations (fiveSix + seafarers forgottenTribe combo)',
    (playerCount) => {
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        const r = simulate(`forgottentribe-${playerCount}-${i}`, {
          config: forgottenTribeConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the scenario target, not base 10
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-755 — The Six Islands smoke (5-6-ONLY scenario, NO main island — the key sim risk)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751/T-752/T-753/T-754's above, but this scenario carries a real
// structural risk the others don't: with NO main island (every cell `region: 'small'`, T-755 "The
// model"), starting settlements land on these ~6-hex islands themselves — if an island were too small
// to fit 5-6 players' distance-2-legal setup spots, `createGame`/the setup phase would throw. THIS
// TEST is the arbiter the task spec calls for: pc6 setup succeeding here is the confirmation the
// six-island layout (scenario.ts SIX_ISLANDS) is big enough. Plays to the scenario's raised 18-VP
// target (not the usual 14 — starting settlements earn island chits here, inflating VP symmetrically).

function sixIslandsConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 18-VP target (T-755)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'sixIslands' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig/newWorldConfig/throughTheDesertConfig/forgottenTribeConfig above —
    // the client always writes pairedPlayers for a fiveSix game (SBP is disabled in the picker), so
    // match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-755 The Six Islands smoke (5p + 6p, 5-6-only scenario, NO main island, best-effort boards)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 18-VP wins with zero invariant violations (fiveSix + seafarers sixIslands combo) — pc6 setup fitting on six ~6-hex islands is the key risk',
    (playerCount) => {
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        // simulate() throws (failing this test, repro-ready) if setup can't find a legal placement —
        // the scenario's defining risk (T-755): with no main island, ALL starting settlements must fit
        // on these six ~6-hex islands.
        const r = simulate(`sixislands-${playerCount}-${i}`, {
          config: sixIslandsConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(18); // T-755 — the raised scenario target, not 14
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-756 — The Fog Islands smoke (5-6-ONLY scenario, NEW MECHANIC: fog exploration)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751/.../T-755's above, PLUS the mechanic-specific assertion this
// task's spec calls for: `fogTilesRevealed` (runGame.ts, computed from `ext.seafarers.fog.hidden`'s
// shrinkage) must be > 0 in every game — proof the reveal hook (folded into buildShip/moveShip,
// modules/seafarers/index.ts's afterAction) actually fires during ordinary random-bot play, not just
// in the unit tests (fog.test.ts) that drive it directly.

function fogIslandsConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'fogIslands' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig/newWorldConfig/.../sixIslandsConfig above — the client always
    // writes pairedPlayers for a fiveSix game (SBP is disabled in the picker), so match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-756 The Fog Islands smoke (5p + 6p, 5-6-only scenario, fog exploration mechanic)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 14-VP wins with zero invariant violations AND reveals fog during play (fiveSix + seafarers fogIslands combo)',
    (playerCount) => {
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        const r = simulate(`fogislands-${playerCount}-${i}`, {
          config: fogIslandsConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the standard scenario target
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound
        // The task's own sim requirement: at least SOME fog gets revealed during ordinary play.
        expect(r.fogTilesRevealed ?? 0).toBeGreaterThan(0);
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-757 — Cloth for Hexhaven smoke (5-6-ONLY scenario, NEW MECHANIC: cloth villages -> VP)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751/.../T-756's above, PLUS the mechanic-specific assertion this
// task's spec calls for: `clothTotal` (runGame.ts, summed from `ext.seafarers.cloth` at game end) must
// be > 0 in every game — proof the cloth production hook (folded into the SAME dice-roll hook gold
// production uses, modules/seafarers/index.ts's afterAction) actually fires during ordinary random-bot
// play, not just in the unit tests (cloth.test.ts) that drive it directly — the exact T-756 lesson
// ("the fog scenario initially shipped with its mechanic never firing in real play") applied here.

function clothForHexhavenConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'clothForHexhaven' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig/newWorldConfig/.../fogIslandsConfig above — the client always
    // writes pairedPlayers for a fiveSix game (SBP is disabled in the picker), so match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-757 Cloth for Hexhaven smoke (5p + 6p, 5-6-only scenario, cloth-village -> VP mechanic)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 14-VP wins with zero invariant violations AND produces cloth during play (fiveSix + seafarers clothForHexhaven combo)',
    (playerCount) => {
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        const r = simulate(`clothforhexhaven-${playerCount}-${i}`, {
          config: clothForHexhavenConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the standard scenario target
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound
        // The task's own sim requirement: at least SOME cloth gets produced during ordinary play.
        expect(r.clothTotal ?? 0).toBeGreaterThan(0);
      }
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-758 — The Pirate Islands smoke (5-6-ONLY scenario, NEW MECHANIC: auto-moving pirate track + lairs)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751/.../T-757's above, PLUS the two mechanic-specific assertions
// this task's spec calls for: the pirate must actually ADVANCE along its track during ordinary play
// (`pirateAdvances`, runGame.ts's ground-truth count of every `pirateTrackIndex` change over the
// game — NOT the same as the number of `rollDice` actions, since a roll of 7 routes to `discard`/
// `moveRobber` instead of `main` and never fires the hook — cross-checked exactly against the final
// track index, `finalIndex === pirateAdvances % trackLength`, a strong deterministic proof the hook
// fires every time it's supposed to), and at least one lair must be captured across the 20-game run
// (`lairsCaptured`).
//
// ⚠ CRITICAL (the task's own deadlock risk): the auto-moving pirate blocks ship build/move (S8.5)
// wherever it currently sits. `r.actions` must stay BELOW `MAX_ACTIONS` for EVERY game — a game that
// hits the cap (bots unable to make progress) is exactly the deadlock this task was warned against,
// and the FIRST assertion below (`toBeLessThan(MAX_ACTIONS)`) is the sim's verdict on that risk (the
// pirate track was deliberately routed through this board's non-harbor sea cells — see scenario.ts's
// PIRATE_ISLANDS header — specifically to keep this assertion green).

function pirateIslandsConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'pirateIslands' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig/newWorldConfig/.../clothForHexhavenConfig above — the client always
    // writes pairedPlayers for a fiveSix game (SBP is disabled in the picker), so match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-758 The Pirate Islands smoke (5p + 6p, 5-6-only scenario, auto-moving pirate track + lair mechanic)', () => {
  it.each([5, 6] as const)(
    'plays %ip games to 14-VP wins with zero invariant violations, completing (not maxActions), the pirate advancing every roll, and a lair captured across the run (fiveSix + seafarers pirateIslands combo)',
    (playerCount) => {
      const trackLength = getScenario('pirateIslands')?.boards[playerCount]?.pirateTrack?.length ?? 0;
      expect(trackLength).toBeGreaterThan(0);

      let anyLairCaptured = false;
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        const r = simulate(`pirateislands-${playerCount}-${i}`, {
          config: pirateIslandsConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        // The deadlock-risk verdict: the game must COMPLETE (reach the target), never hit maxActions.
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.winnerVp).toBeGreaterThanOrEqual(14); // S10.1 — the standard scenario target
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound

        // The pirate advances one track step (wrapping) EVERY time the hook actually fires — proof it
        // isn't a one-off or a fluke: cross-check the final track index against `pirateAdvances`, the
        // ground-truth count of actual index changes this game (NOT the same as the number of
        // `rollDice` actions — a roll of 7 routes to `discard`/`moveRobber` instead of `main`, so the
        // hook never fires for it; see runGame.ts's own in-loop comment).
        expect(r.pirateAdvances ?? 0).toBeGreaterThan(0);
        expect(r.pirateTrackIndexFinal ?? -1).toBe((r.pirateAdvances ?? 0) % trackLength);

        if ((r.lairsCaptured ?? 0) > 0) anyLairCaptured = true;
      }
      // The task's own sim requirement: at least one lair gets captured somewhere across the run.
      expect(anyLairCaptured).toBe(true);
    },
    120_000
  );
});

// ---------------------------------------------------------------------------
// T-759 — The Wonders of Hexhaven smoke (5-6-ONLY scenario, FINAL scenario, NEW MECHANIC: build-a-wonder
// ALTERNATE WIN)
// ---------------------------------------------------------------------------
// Same lightweight smoke gate as T-751/.../T-758's above, PLUS the mechanic-specific assertion this
// task's spec calls for: the alternate win must actually DECIDE at least one game across the 20-game
// run at EACH player count (`winnerWonderStagesDone >= WONDER_STAGES`) — proof the build hook (folded
// into `buildSettlement`/`buildCity`) and the alternate win (`checkWin`) both actually fire during
// ordinary random-bot play, the exact T-756/T-757 lesson ("a mechanic that never fires in real play")
// applied here. Unlike every other scenario's smoke above, `winnerVp` is NOT asserted >= 14
// unconditionally — a wonder win can (and, per this assertion, sometimes does) happen BELOW the
// scenario's 14-VP target; the per-game check below accepts EITHER a normal 14-VP win or a completed
// wonder as the legitimate reason the game ended.

function wondersOfHexhavenConfig(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides this with the scenario's 14-VP target (S10.1)
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: { scenario: 'wondersOfHexhaven' }, citiesKnights: false },
    // Mirrors fiveSixSeafarersConfig/newWorldConfig/.../pirateIslandsConfig above — the client always
    // writes pairedPlayers for a fiveSix game (SBP is disabled in the picker), so match that here too.
    variants: { fiveSixTurnRule: 'pairedPlayers' },
  };
}

describe('T-759 The Wonders of Hexhaven smoke (5p + 6p, 5-6-only scenario, FINAL scenario, build-a-wonder alternate win)', () => {
  it.each([5, 6] as const)(
    'plays %ip games with zero invariant violations, AND the alternate win decides at least one game (fiveSix + seafarers wondersOfHexhaven combo)',
    (playerCount) => {
      let anyWonderWin = false;
      for (let i = 0; i < FIVE_SIX_SMOKE_GAMES; i++) {
        const r = simulate(`wondersofhexhaven-${playerCount}-${i}`, {
          config: wondersOfHexhavenConfig(playerCount),
          maxActions: MAX_ACTIONS,
        });
        expect(r.actions).toBeLessThan(MAX_ACTIONS);
        expect(r.turns).toBeGreaterThan(0);
        expect(r.winner).toBeGreaterThanOrEqual(0);
        expect(r.winner).toBeLessThan(playerCount);
        expect(r.peakShipsOnBoard ?? 0).toBeLessThanOrEqual(15); // S1.1 ship-supply bound

        // The game must end for a LEGITIMATE reason: either the winner reached the scenario's 14-VP
        // target normally, or they completed every wonder stage (possibly below 14 VP) — one of the
        // two MUST be true; nothing else ends a game in this scenario.
        const wonderWin = (r.winnerWonderStagesDone ?? 0) >= WONDER_STAGES;
        expect(r.winnerVp >= 14 || wonderWin).toBe(true);
        if (wonderWin) anyWonderWin = true;
      }
      // The task's own sim requirement: the alternate win must actually DECIDE at least one game —
      // not just accrue silently (the exact T-756 lesson: "the mechanic never fired in real play").
      expect(anyWonderWin).toBe(true);
    },
    120_000
  );
});
