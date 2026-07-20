// T-1152 (Phase 11B): Explorers & Pirates "Fish for Hexhaven" at 5–6 players — mirrors
// `explorersPiratesFishForHexhaven.test.ts`'s own 3–4 suite exactly (same bot, same invariants, same
// win-target assertion, same fish-mission-fires + zero-spice-leak checks) — just at playerCount 5/6
// with `fiveSix: true`, on the T-1150 bigger frame (`buildLandHoBoard56`, 37 hexes) whose fish
// shoals/villages/councilVertex are now seeded via the scaled `FISH_SHOAL_COUNT_56`/`VILLAGE_COUNT_56`
// counts against the resolved 5–6 geometry (createGame.ts's `seedFishSpiceV0` opts, this task).
//
// Games per cell mirrors Land Ho! 5–6's own proving-sim allowance (20 each pc5/pc6, spec, vs the 3–4
// suite's 60) — this is a proving sim, not the headline acceptance gate. `MAX_ACTIONS` mirrors Land
// Ho! 5–6's own headroom bump (bigger board + more seats means longer games).

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Spec: 20 games each pc5/pc6 (mirrors explorersPiratesLandHo56.test.ts). */
const GAMES_PER = 20;

/** Mirrors Land Ho! 5–6's own headroom bump over the 3–4 suite's 6,000 cap. */
const MAX_ACTIONS = 20_000;

function fishForHexhaven56Config(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_SCENARIO_CONFIG.fishForHexhaven.winTarget (10, ⚠ VERIFY) by createGame.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      explorersPirates: { scenario: 'fishForHexhaven' },
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
  meanFishHauled: number;
  meanFishDelivered: number;
  meanFishPointsAwarded: number;
  gamesWithAFoundingFraction: number;
  gamesWithAFishDeliveryFraction: number;
  totalLeakSpiceTraded: number;
  totalLeakSpiceDelivered: number;
  totalLeakSpicePointsAwarded: number;
}

function runCell(playerCount: 5 | 6): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`fish56-${playerCount}-${i}`, { config: fishForHexhaven56Config(playerCount), maxActions: MAX_ACTIONS })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let shipsBuilt = 0;
  let shipMoves = 0;
  let tilesRevealed = 0;
  let settlementsFounded = 0;
  let harborSettlementsBuilt = 0;
  let fishHauled = 0;
  let fishDelivered = 0;
  let fishPointsAwarded = 0;
  let gamesWithFounding = 0;
  let gamesWithFishDelivery = 0;
  let leakSpiceTraded = 0;
  let leakSpiceDelivered = 0;
  let leakSpicePointsAwarded = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    shipsBuilt += r.epShipsBuilt ?? 0;
    shipMoves += r.epShipMoves ?? 0;
    tilesRevealed += r.epTilesRevealed ?? 0;
    settlementsFounded += r.epSettlementsFounded ?? 0;
    harborSettlementsBuilt += r.epHarborSettlementsBuilt ?? 0;
    fishHauled += r.epFishHauled ?? 0;
    fishDelivered += r.epFishDelivered ?? 0;
    fishPointsAwarded += r.totalFishPointsAwarded ?? 0;
    if ((r.epSettlementsFounded ?? 0) > 0) gamesWithFounding += 1;
    if ((r.epFishDelivered ?? 0) > 0) gamesWithFishDelivery += 1;
    leakSpiceTraded += r.leakSpiceTraded ?? 0;
    leakSpiceDelivered += r.leakSpiceDelivered ?? 0;
    leakSpicePointsAwarded += r.leakTotalSpicePointsAwarded ?? 0;
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
    meanFishHauled: fishHauled / GAMES_PER,
    meanFishDelivered: fishDelivered / GAMES_PER,
    meanFishPointsAwarded: fishPointsAwarded / GAMES_PER,
    gamesWithAFoundingFraction: gamesWithFounding / GAMES_PER,
    gamesWithAFishDeliveryFraction: gamesWithFishDelivery / GAMES_PER,
    totalLeakSpiceTraded: leakSpiceTraded,
    totalLeakSpiceDelivered: leakSpiceDelivered,
    totalLeakSpicePointsAwarded: leakSpicePointsAwarded,
  };
  return { results, stats };
}

describe('T-1152 Explorers & Pirates Fish for Hexhaven 5–6 simulation & invariant suite (5p + 6p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 5p/6p) to the win target with zero invariant violations, fish mission actually firing`,
    () => {
      const allStats: CellStats[] = [];
      let totalFishPointsAwarded = 0;
      for (const playerCount of [5, 6] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);
        totalFishPointsAwarded += stats.meanFishPointsAwarded * GAMES_PER;

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);

        // ---- THE FISH MISSION ITSELF actually fires on the bigger 5–6 frame -----------------------
        expect(stats.meanFishHauled).toBeGreaterThan(0);
        expect(stats.meanFishDelivered).toBeGreaterThan(0);
        expect(stats.meanFishPointsAwarded).toBeGreaterThan(0);

        // ---- T-1110 (fish-auto-haul fidelity fix, mirror direction) holds at 5–6 too ---------------
        expect(stats.totalLeakSpiceTraded).toBe(0);
        expect(stats.totalLeakSpiceDelivered).toBe(0);
        expect(stats.totalLeakSpicePointsAwarded).toBe(0);
      }

      expect(totalFishPointsAwarded).toBeGreaterThan(0);

      process.stdout.write(`\nT-1152 Fish for Hexhaven 5-6 sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    600_000
  );
});
