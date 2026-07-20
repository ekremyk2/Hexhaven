// T-1152 (Phase 11B): Explorers & Pirates "The Pirate Lairs" at 5–6 players — mirrors
// `explorersPiratesPirateLairs.test.ts`'s own 3–4 suite exactly (same bot, same invariants, same
// win-target assertion, same lair-capture-fires + zero-fish-leak checks) — just at playerCount 5/6
// with `fiveSix: true`, on the T-1150 bigger frame (`buildLandHoBoard56`, 37 hexes) whose 18-hex fog
// ring carries 3 `'pirate'` exploration tiles (`EP_EXPLORATION_TILES_56`, vs the 3–4 board's 2) — so
// up to 3 lairs can spawn over a 5–6 game. A lair capture needs 3 landed crews on the SAME lair (a
// taller bar than a single fish haul/spice trade), so — mirroring the 3–4 suite's own reasoning —
// this suite asserts the AGGREGATE across the whole run is nonzero rather than requiring a capture in
// every game/cell.
//
// Games per cell mirrors Land Ho! 5–6's own proving-sim allowance (20 each pc5/pc6, spec).
// `MAX_ACTIONS` mirrors Land Ho! 5–6's own headroom bump.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Spec: 20 games each pc5/pc6 (mirrors explorersPiratesLandHo56.test.ts). */
const GAMES_PER = 20;

/** Mirrors Land Ho! 5–6's own headroom bump over the 3–4 suite's 6,000 cap. */
const MAX_ACTIONS = 20_000;

function pirateLairs56Config(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_SCENARIO_CONFIG.pirateLairs.winTarget (10, ⚠ VERIFY) by createGame.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      explorersPirates: { scenario: 'pirateLairs' },
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
  meanCrewsBuilt: number;
  meanCrewsLoaded: number;
  meanCrewsPlacedOnLair: number;
  totalLairsCaptured: number;
  totalLairPointsAwarded: number;
  gamesWithAFoundingFraction: number;
  gamesWithACrewPlacementFraction: number;
  totalLeakFishHauled: number;
  totalLeakFishDelivered: number;
  totalLeakFishPointsAwarded: number;
}

function runCell(playerCount: 5 | 6): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`lair56-${playerCount}-${i}`, {
        config: pirateLairs56Config(playerCount),
        maxActions: MAX_ACTIONS,
      })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let shipsBuilt = 0;
  let shipMoves = 0;
  let tilesRevealed = 0;
  let settlementsFounded = 0;
  let harborSettlementsBuilt = 0;
  let crewsBuilt = 0;
  let crewsLoaded = 0;
  let crewsPlacedOnLair = 0;
  let lairsCaptured = 0;
  let lairPointsAwarded = 0;
  let gamesWithFounding = 0;
  let gamesWithCrewPlacement = 0;
  let leakFishHauled = 0;
  let leakFishDelivered = 0;
  let leakFishPointsAwarded = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    shipsBuilt += r.epShipsBuilt ?? 0;
    shipMoves += r.epShipMoves ?? 0;
    tilesRevealed += r.epTilesRevealed ?? 0;
    settlementsFounded += r.epSettlementsFounded ?? 0;
    harborSettlementsBuilt += r.epHarborSettlementsBuilt ?? 0;
    crewsBuilt += r.epCrewsBuilt ?? 0;
    crewsLoaded += r.epCrewsLoaded ?? 0;
    crewsPlacedOnLair += r.epCrewsPlacedOnLair ?? 0;
    lairsCaptured += r.epLairsCaptured ?? 0;
    lairPointsAwarded += r.totalLairPointsAwarded ?? 0;
    if ((r.epSettlementsFounded ?? 0) > 0) gamesWithFounding += 1;
    if ((r.epCrewsPlacedOnLair ?? 0) > 0) gamesWithCrewPlacement += 1;
    leakFishHauled += r.leakFishHauled ?? 0;
    leakFishDelivered += r.leakFishDelivered ?? 0;
    leakFishPointsAwarded += r.leakTotalFishPointsAwarded ?? 0;
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
    meanCrewsBuilt: crewsBuilt / GAMES_PER,
    meanCrewsLoaded: crewsLoaded / GAMES_PER,
    meanCrewsPlacedOnLair: crewsPlacedOnLair / GAMES_PER,
    totalLairsCaptured: lairsCaptured,
    totalLairPointsAwarded: lairPointsAwarded,
    gamesWithAFoundingFraction: gamesWithFounding / GAMES_PER,
    gamesWithACrewPlacementFraction: gamesWithCrewPlacement / GAMES_PER,
    totalLeakFishHauled: leakFishHauled,
    totalLeakFishDelivered: leakFishDelivered,
    totalLeakFishPointsAwarded: leakFishPointsAwarded,
  };
  return { results, stats };
}

describe('T-1152 Explorers & Pirates The Pirate Lairs 5–6 simulation & invariant suite (5p + 6p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 5p/6p) to the win target with zero invariant violations, the pirate-lairs mission actually firing`,
    () => {
      const allStats: CellStats[] = [];
      let totalLairsCapturedAcrossRun = 0;
      let totalLairPointsAcrossRun = 0;
      let totalCrewsPlacedAcrossRun = 0;
      for (const playerCount of [5, 6] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);
        totalLairsCapturedAcrossRun += stats.totalLairsCaptured;
        totalLairPointsAcrossRun += stats.totalLairPointsAwarded;
        totalCrewsPlacedAcrossRun += stats.meanCrewsPlacedOnLair * GAMES_PER;

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

        // ---- crews are genuinely built/loaded on the bigger 5–6 frame -------------------------------
        expect(stats.meanCrewsBuilt).toBeGreaterThan(0);
        expect(stats.meanCrewsLoaded).toBeGreaterThan(0);

        // ---- T-1110 (fish-auto-haul fidelity fix) holds at 5–6 too ----------------------------------
        expect(stats.totalLeakFishHauled).toBe(0);
        expect(stats.totalLeakFishDelivered).toBe(0);
        expect(stats.totalLeakFishPointsAwarded).toBe(0);
      }

      // ---- a lair is still capturable on the bigger 5–6 fog ring (this task's own explicit ask) ----
      expect(totalCrewsPlacedAcrossRun).toBeGreaterThan(0);
      expect(totalLairsCapturedAcrossRun).toBeGreaterThan(0);
      expect(totalLairPointsAcrossRun).toBeGreaterThan(0);

      process.stdout.write(`\nT-1152 The Pirate Lairs 5-6 sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    600_000
  );
});
