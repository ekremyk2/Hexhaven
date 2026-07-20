// T-1113: the Explorers & Pirates "The Pirate Lairs" scenario's simulation & invariant gate (docs/
// rules/explorers-pirates-rules.md §EP1.3(generalized)/§EP2/§EP3/§EP4/§EP7/§EP12.4, docs/tasks/
// phase-11/T-1113-pirate-lairs.md). Plays seeded Pirate Lairs games at BOTH supported player counts
// (3 and 4, §EP1.2 — E&P is 3–4p only for now) with the random-legal-move bot (sim/bot.ts, taught
// the crew-build/load/place-on-lair flow on top of the Land Ho! ship/settler/founding/harbor
// actions), asserting the base invariants I1–I10 (invariants.ts) AND the Pirate Lairs
// EP-LAIR1–EP-LAIR7 invariants (explorersPiratesPirateLairsInvariants.ts: cargo cap, ship
// cap/uniqueness, harbor <= founded, fog never leaks, lair points only accrue via a captured lair,
// crews never exceed supply, an active lair never persists at/above the 3-crew capture threshold)
// after EVERY successful transition.
//
// The Pirate Lairs scenario reuses Land Ho!'s exact board/movement/founding frame with the
// pirateLairs mission additionally ON (createGame.ts's generalized E&P branch,
// `EP_SCENARIO_CONFIG.pirateLairs`) — so this suite doubles as the "the mission actually fires"
// proof the task calls for: it asserts BOTH that every game completes AND that at least one lair is
// actually captured across the whole run (not just legal in principle) — mirroring how Fish/Spice
// for Hexhaven's own suites (T-1111/T-1112) prove their missions fire. Lair capture needs 3 landed
// crews (any mix of seats) on the SAME lair — a taller bar than a single fish haul or paid spice
// trade — so, unlike those two suites, this one does NOT require every game (or even every cell) to
// see a capture; it requires the AGGREGATE across the whole run to be nonzero, which is the task's
// own literal ask ("at least one lair is captured across the run").

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — mirrors Fish/Spice for Hexhaven's own headroom allowance. */
const GAMES_PER = 60;

/** Same headroom as Fish/Spice for Hexhaven's own suites — this scenario adds only the crew build/
 *  load/place loop on top of the identical ship/exploration/founding frame, no new action-budget
 *  pressure expected (crews are cheap, EP_CREW_COST mirrors EP_SETTLER_COST). */
const MAX_ACTIONS = 6000;

function pirateLairsConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_SCENARIO_CONFIG.pirateLairs.winTarget (10, ⚠ VERIFY) by createGame.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
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
  /** T-1110 (fish-auto-haul fidelity fix leak proof): Pirate Lairs has neither the fish nor the spice
   *  mission on — `runGame.ts`'s `leakFishHauled`/`leakFishDelivered`/`leakTotalFishPointsAwarded`
   *  must stay exactly 0 across every game, proving the cross-mission leak (FOLLOWUPS.md) never fires
   *  here either. */
  totalLeakFishHauled: number;
  totalLeakFishDelivered: number;
  totalLeakFishPointsAwarded: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`lair${playerCount}-${i}`, {
        config: pirateLairsConfig(playerCount),
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

describe('T-1113 Explorers & Pirates The Pirate Lairs simulation & invariant suite (3p + 4p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 3p/4p) to the win target with zero invariant violations, the pirate-lairs mission actually firing`,
    () => {
      const allStats: CellStats[] = [];
      let totalLairsCapturedAcrossRun = 0;
      let totalLairPointsAcrossRun = 0;
      let totalCrewsPlacedAcrossRun = 0;
      for (const playerCount of [3, 4] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);
        totalLairsCapturedAcrossRun += stats.totalLairsCaptured;
        totalLairPointsAcrossRun += stats.totalLairPointsAwarded;
        totalCrewsPlacedAcrossRun += stats.meanCrewsPlacedOnLair * GAMES_PER;

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §EP1.3 (generalized): The Pirate Lairs plays to EP_SCENARIO_CONFIG.pirateLairs.winTarget
          // (10, ⚠ VERIFY), not the base 10 passed in `pirateLairsConfig` by coincidence of value —
          // same shape as Fish/Spice for Hexhaven's own "not just the base config value" check.
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- E&P mechanics (reused from Land Ho!'s frame) were actually exercised -----------------
        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);

        // ---- crews are genuinely built/loaded/landed (legal-in-principle isn't enough — the bot
        // must actually walk the chain) ------------------------------------------------------------
        expect(stats.meanCrewsBuilt).toBeGreaterThan(0);
        expect(stats.meanCrewsLoaded).toBeGreaterThan(0);

        // ---- T-1110 (fish-auto-haul fidelity fix): Pirate Lairs has neither the fish nor the spice
        // mission ON — fish must never accrue here (`fishShoals` is only ever seeded for a
        // fish-mission scenario now, createGame.ts, and `haulFishOnArrival`/`deliverFishHandler`
        // themselves also re-check `epFishMissionActive`, goldFishSpice.ts) ------------------------
        expect(stats.totalLeakFishHauled).toBe(0);
        expect(stats.totalLeakFishDelivered).toBe(0);
        expect(stats.totalLeakFishPointsAwarded).toBe(0);
      }

      // ---- THE PIRATE LAIRS MISSION ITSELF actually fires — the task's own "prove it, don't ship a
      // mission that never triggers" requirement, at the AGGREGATE level this task calls for ("at
      // least one lair is captured across the run"), since capture (3 landed crews on one lair) is a
      // taller bar than a single fish haul/spice trade and needn't hit in every game/cell. ----------
      expect(totalCrewsPlacedAcrossRun).toBeGreaterThan(0);
      expect(totalLairsCapturedAcrossRun).toBeGreaterThan(0);
      expect(totalLairPointsAcrossRun).toBeGreaterThan(0);

      process.stdout.write(`\nT-1113 The Pirate Lairs sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
