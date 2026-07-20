// T-1152 (Phase 11B): Explorers & Pirates full campaign at 5–6 players — mirrors
// `explorersPiratesFullCampaign.test.ts`'s own 3–4 suite exactly (same bot, same composed invariants,
// same 17-VP win-target assertion, same "all three missions contribute VP in aggregate" check) — just
// at playerCount 5/6 with `fiveSix: true`, on the T-1150 bigger frame (`buildLandHoBoard56`, 37 hexes)
// with fish AND spice AND pirate lairs ALL on at once. The hardest 5–6 scenario to prove (highest VP
// ceiling, three missions competing for the same per-seat ship/cargo budget) — this suite is the
// task's own explicit "confirm the fullCampaign 17-VP is reachable at 5–6" proof.
//
// Games per cell mirrors Land Ho! 5–6's own proving-sim allowance (20 each pc5/pc6, spec — smaller
// than the 3–4 suite's 60 since this is a proving sim, not the headline acceptance gate).
// `MAX_ACTIONS` scales the 3–4 suite's own 10,000 cap by roughly the same ~3.3x headroom bump Land
// Ho! 5–6 applied over ITS 3–4 cap (6,000 → 20,000), rounded up for the extra mission load.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Spec: 20 games each pc5/pc6 (mirrors explorersPiratesLandHo56.test.ts). */
const GAMES_PER = 20;

/** Generous headroom over the 3–4 suite's 10,000 cap — bigger board + more seats + three simultaneous
 *  missions competing for the same ship/cargo budget. */
const MAX_ACTIONS = 35_000;

function fullCampaign56Config(playerCount: 5 | 6): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_SCENARIO_CONFIG.fullCampaign.winTarget (17, ⚠ VERIFY) by createGame.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      explorersPirates: { scenario: 'fullCampaign' },
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
  totalFishPointsAwarded: number;
  meanSpiceTraded: number;
  meanSpiceDelivered: number;
  totalSpicePointsAwarded: number;
  meanCrewsBuilt: number;
  meanCrewsLoaded: number;
  meanCrewsPlacedOnLair: number;
  totalLairsCaptured: number;
  totalLairPointsAwarded: number;
  gamesWithAFoundingFraction: number;
  gamesWithAFishDeliveryFraction: number;
  gamesWithASpiceDeliveryFraction: number;
  gamesWithACrewPlacementFraction: number;
}

function runCell(playerCount: 5 | 6): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`fullcampaign56-${playerCount}-${i}`, {
        config: fullCampaign56Config(playerCount),
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
  let fishHauled = 0;
  let fishDelivered = 0;
  let fishPointsAwarded = 0;
  let spiceTraded = 0;
  let spiceDelivered = 0;
  let spicePointsAwarded = 0;
  let crewsBuilt = 0;
  let crewsLoaded = 0;
  let crewsPlacedOnLair = 0;
  let lairsCaptured = 0;
  let lairPointsAwarded = 0;
  let gamesWithFounding = 0;
  let gamesWithFishDelivery = 0;
  let gamesWithSpiceDelivery = 0;
  let gamesWithCrewPlacement = 0;
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
    spiceTraded += r.epSpiceTraded ?? 0;
    spiceDelivered += r.epSpiceDelivered ?? 0;
    spicePointsAwarded += r.totalSpicePointsAwarded ?? 0;
    crewsBuilt += r.epCrewsBuilt ?? 0;
    crewsLoaded += r.epCrewsLoaded ?? 0;
    crewsPlacedOnLair += r.epCrewsPlacedOnLair ?? 0;
    lairsCaptured += r.epLairsCaptured ?? 0;
    lairPointsAwarded += r.totalLairPointsAwarded ?? 0;
    if ((r.epSettlementsFounded ?? 0) > 0) gamesWithFounding += 1;
    if ((r.epFishDelivered ?? 0) > 0) gamesWithFishDelivery += 1;
    if ((r.epSpiceDelivered ?? 0) > 0) gamesWithSpiceDelivery += 1;
    if ((r.epCrewsPlacedOnLair ?? 0) > 0) gamesWithCrewPlacement += 1;
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
    totalFishPointsAwarded: fishPointsAwarded,
    meanSpiceTraded: spiceTraded / GAMES_PER,
    meanSpiceDelivered: spiceDelivered / GAMES_PER,
    totalSpicePointsAwarded: spicePointsAwarded,
    meanCrewsBuilt: crewsBuilt / GAMES_PER,
    meanCrewsLoaded: crewsLoaded / GAMES_PER,
    meanCrewsPlacedOnLair: crewsPlacedOnLair / GAMES_PER,
    totalLairsCaptured: lairsCaptured,
    totalLairPointsAwarded: lairPointsAwarded,
    gamesWithAFoundingFraction: gamesWithFounding / GAMES_PER,
    gamesWithAFishDeliveryFraction: gamesWithFishDelivery / GAMES_PER,
    gamesWithASpiceDeliveryFraction: gamesWithSpiceDelivery / GAMES_PER,
    gamesWithACrewPlacementFraction: gamesWithCrewPlacement / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1152 Explorers & Pirates full campaign 5–6 simulation & invariant suite (5p + 6p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 5p/6p) to the 17-VP win target with zero invariant violations, all three missions actually firing`,
    () => {
      const allStats: CellStats[] = [];
      let totalFishPointsAcrossRun = 0;
      let totalSpicePointsAcrossRun = 0;
      let totalLairPointsAcrossRun = 0;
      let totalLairsCapturedAcrossRun = 0;
      for (const playerCount of [5, 6] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);
        totalFishPointsAcrossRun += stats.totalFishPointsAwarded;
        totalSpicePointsAcrossRun += stats.totalSpicePointsAwarded;
        totalLairPointsAcrossRun += stats.totalLairPointsAwarded;
        totalLairsCapturedAcrossRun += stats.totalLairsCaptured;

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §EP1.3 (generalized): the full campaign plays to EP_SCENARIO_CONFIG.fullCampaign.winTarget
          // (17, ⚠ VERIFY) at 5–6 too — the task's own hardest bar, confirmed reachable here.
          expect(r.winnerVp).toBeGreaterThanOrEqual(17);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);

        // ---- EVERY mission is genuinely exercised per cell on the bigger 5–6 frame -----------------
        expect(stats.meanFishDelivered).toBeGreaterThan(0);
        expect(stats.meanSpiceDelivered).toBeGreaterThan(0);
        expect(stats.meanCrewsBuilt).toBeGreaterThan(0);
        expect(stats.meanCrewsLoaded).toBeGreaterThan(0);
      }

      // ---- ALL THREE missions contribute VP across the WHOLE run at 5–6 too — the task's own literal
      // "fishPoints > 0 AND spicePoints > 0 AND lairPoints > 0" ask. ------------------------------------
      expect(totalFishPointsAcrossRun).toBeGreaterThan(0);
      expect(totalSpicePointsAcrossRun).toBeGreaterThan(0);
      expect(totalLairsCapturedAcrossRun).toBeGreaterThan(0);
      expect(totalLairPointsAcrossRun).toBeGreaterThan(0);

      process.stdout.write(`\nT-1152 full campaign 5-6 sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    900_000
  );
});
