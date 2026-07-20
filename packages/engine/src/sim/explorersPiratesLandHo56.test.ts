// T-1150 (Phase 11B): Explorers & Pirates Land Ho! at 5–6 players — the FIRST consumer of the E&P
// 5–6 framework (bigger board, `buildLandHoBoard56`; bigger exploration supply,
// `EP_EXPLORATION_TILES_56`). Mirrors `explorersPiratesLandHo.test.ts`'s own 3–4 suite exactly (same
// bot, same invariants, same win-target assertion) — just at playerCount 5/6 with `fiveSix: true`.
// Games per cell is smaller than the 3–4 suite's 60 (spec: 20 each) since this is a proving sim, not
// the headline acceptance gate; `MAX_ACTIONS` is bumped well above the 3–4 board's 6,000 cap — the
// 5–6 board is much bigger (37 hexes: 19-hex home island / 18-hex fog ring, vs 7/12) and seats more
// players, so games naturally run longer.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Spec: 20 games each pc5/pc6. */
const GAMES_PER = 20;

/** Generous headroom over the 3–4 suite's 6,000 cap — bigger board (37 vs 19 hexes) + more seats
 *  (5–6 vs 3–4) means more ship-building/exploration/founding actions before the 8-VP target. */
const MAX_ACTIONS = 20_000;

function landHo56Config(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to 8 (EP_SCENARIO_CONFIG.landHo.winTarget) by createGame — §EP1.3.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      explorersPirates: { scenario: 'landHo' },
    },
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
  meanShipsBuilt: number;
  meanShipMoves: number;
  meanTilesRevealed: number;
  meanSettlementsFounded: number;
  meanHarborSettlementsBuilt: number;
  gamesWithAFoundingFraction: number;
  gamesWithAHarborUpgradeFraction: number;
}

function runCell(playerCount: 5 | 6): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`landho56-${playerCount}-${i}`, { config: landHo56Config(playerCount), maxActions: MAX_ACTIONS })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let shipsBuilt = 0;
  let shipMoves = 0;
  let tilesRevealed = 0;
  let settlementsFounded = 0;
  let harborSettlementsBuilt = 0;
  let gamesWithFounding = 0;
  let gamesWithHarborUpgrade = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    shipsBuilt += r.epShipsBuilt ?? 0;
    shipMoves += r.epShipMoves ?? 0;
    tilesRevealed += r.epTilesRevealed ?? 0;
    settlementsFounded += r.epSettlementsFounded ?? 0;
    harborSettlementsBuilt += r.epHarborSettlementsBuilt ?? 0;
    if ((r.epSettlementsFounded ?? 0) > 0) gamesWithFounding += 1;
    if ((r.epHarborSettlementsBuilt ?? 0) > 0) gamesWithHarborUpgrade += 1;
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
    meanTilesRevealed: tilesRevealed / GAMES_PER,
    meanSettlementsFounded: settlementsFounded / GAMES_PER,
    meanHarborSettlementsBuilt: harborSettlementsBuilt / GAMES_PER,
    gamesWithAFoundingFraction: gamesWithFounding / GAMES_PER,
    gamesWithAHarborUpgradeFraction: gamesWithHarborUpgrade / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1150 Explorers & Pirates Land Ho! 5–6 simulation & invariant suite (5p + 6p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 5p/6p) to the 8-VP win with zero invariant violations`,
    () => {
      const allStats: CellStats[] = [];
      for (const playerCount of [5, 6] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §EP1.3: Land Ho! plays to 8 VP, not the base 10 passed in `landHo56Config` (⚠ VERIFY kept
          // at 8 for 5–6 too — no source says otherwise).
          expect(r.winnerVp).toBeGreaterThanOrEqual(8);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- E&P mechanics were actually exercised, not just legal in principle -----------------
        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);
        expect(stats.meanSettlementsFounded).toBeGreaterThan(0);
        // Harbor upgrades (settlement -> harbor settlement) fire at least occasionally — a weaker bar
        // than the 3–4 suite's own 0.3 fraction (a much bigger 5–6 board may shift the bot's build
        // priorities); this still confirms the "founded/upgraded" half of the core loop actually runs.
        expect(stats.gamesWithAHarborUpgradeFraction).toBeGreaterThan(0);
      }

      process.stdout.write(`\nT-1150 Land Ho! 5-6 sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    600_000
  );
});
