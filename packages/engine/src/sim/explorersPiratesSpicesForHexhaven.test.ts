// T-1112: the Explorers & Pirates "Spices for Hexhaven" scenario's simulation & invariant gate (docs/
// rules/explorers-pirates-rules.md §EP1.3(generalized)/§EP2/§EP3/§EP4/§EP9/§EP12.4, docs/tasks/
// phase-11/T-1112-spices-for-hexhaven.md). Plays seeded Spices for Hexhaven games at BOTH supported player
// counts (3 and 4, §EP1.2 — E&P is 3–4p only for now) with the random-legal-move bot (sim/bot.ts,
// taught the spice-mission flow on top of the Land Ho! ship/settler/founding/harbor actions),
// asserting the base invariants I1–I10 (invariants.ts) AND the Spices for Hexhaven EP-SPICE1–EP-SPICE6
// invariants (explorersPiratesSpiceInvariants.ts: cargo cap, ship cap/uniqueness, harbor <= founded,
// fog never leaks, spice points only accrue via delivery, spiceBenefit stays internally consistent)
// after EVERY successful transition.
//
// Spices for Hexhaven reuses Land Ho!'s exact board/movement/founding frame with the spice mission
// additionally ON (createGame.ts's generalized E&P branch, `EP_SCENARIO_CONFIG.spicesForHexhaven`) — so
// this suite doubles as the "the mission actually fires" proof the task calls for: it asserts BOTH
// that every game completes AND that spice points are actually delivered across the run (not just
// legal in principle) — mirroring how Fish for Hexhaven's own suite (T-1111) proves its mission fires.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — mirrors Fish for Hexhaven's own headroom allowance
 *  (explorersPiratesFishForHexhaven.test.ts). */
const GAMES_PER = 60;

/** Same headroom as Fish for Hexhaven's own suite — this scenario adds only the spice trade/delivery
 *  loop on top of the identical ship/exploration/founding frame, no new action-budget pressure
 *  expected. */
const MAX_ACTIONS = 6000;

function spicesForHexhavenConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_SCENARIO_CONFIG.spicesForHexhaven.winTarget (10, ⚠ VERIFY) by createGame.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      explorersPirates: { scenario: 'spicesForHexhaven' },
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
  meanSpiceTraded: number;
  meanSpiceDelivered: number;
  meanSpicePointsAwarded: number;
  gamesWithAFoundingFraction: number;
  gamesWithASpiceDeliveryFraction: number;
  /** T-1110 (fish-auto-haul fidelity fix leak proof): Spices for Hexhaven's own fish mission is off —
   *  `runGame.ts`'s `leakFishHauled`/`leakFishDelivered`/`leakTotalFishPointsAwarded` must stay
   *  exactly 0 across every game, proving the cross-mission leak (FOLLOWUPS.md) is closed: before
   *  this task, `seedFishSpiceV0` seeded real `fishShoals` here too (whenever fish||spice was on),
   *  so `haulFishOnArrival` could auto-haul + `deliverFish` could score fish points a spice-only game
   *  never intended. */
  totalLeakFishHauled: number;
  totalLeakFishDelivered: number;
  totalLeakFishPointsAwarded: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`spice${playerCount}-${i}`, {
        config: spicesForHexhavenConfig(playerCount),
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
  let spiceTraded = 0;
  let spiceDelivered = 0;
  let spicePointsAwarded = 0;
  let gamesWithFounding = 0;
  let gamesWithSpiceDelivery = 0;
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
    spiceTraded += r.epSpiceTraded ?? 0;
    spiceDelivered += r.epSpiceDelivered ?? 0;
    spicePointsAwarded += r.totalSpicePointsAwarded ?? 0;
    if ((r.epSettlementsFounded ?? 0) > 0) gamesWithFounding += 1;
    if ((r.epSpiceDelivered ?? 0) > 0) gamesWithSpiceDelivery += 1;
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
    meanSpiceTraded: spiceTraded / GAMES_PER,
    meanSpiceDelivered: spiceDelivered / GAMES_PER,
    meanSpicePointsAwarded: spicePointsAwarded / GAMES_PER,
    gamesWithAFoundingFraction: gamesWithFounding / GAMES_PER,
    gamesWithASpiceDeliveryFraction: gamesWithSpiceDelivery / GAMES_PER,
    totalLeakFishHauled: leakFishHauled,
    totalLeakFishDelivered: leakFishDelivered,
    totalLeakFishPointsAwarded: leakFishPointsAwarded,
  };
  return { results, stats };
}

describe('T-1112 Explorers & Pirates Spices for Hexhaven simulation & invariant suite (3p + 4p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 3p/4p) to the win target with zero invariant violations, spice mission actually firing`,
    () => {
      const allStats: CellStats[] = [];
      let totalSpicePointsAwarded = 0;
      for (const playerCount of [3, 4] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);
        totalSpicePointsAwarded += stats.meanSpicePointsAwarded * GAMES_PER;

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §EP1.3 (generalized): Spices for Hexhaven plays to EP_SCENARIO_CONFIG.spicesForHexhaven.winTarget
          // (10, ⚠ VERIFY), not the base 10 passed in `spicesForHexhavenConfig` by coincidence of value —
          // this assertion is the same shape as Fish for Hexhaven's own "not just the base config value"
          // check.
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- E&P mechanics (reused from Land Ho!'s frame) were actually exercised -----------------
        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);

        // ---- THE SPICE MISSION ITSELF actually fires — the task's own "prove it, don't ship a
        // mission that never triggers" requirement ------------------------------------------------
        expect(stats.meanSpiceTraded).toBeGreaterThan(0);
        expect(stats.meanSpiceDelivered).toBeGreaterThan(0);
        expect(stats.meanSpicePointsAwarded).toBeGreaterThan(0);
        // T-1114 (full campaign) tuned the SHARED sim bot (bot.ts) for a genuine correctness/
        // efficiency fix — the ship-move heuristic now steers by true sea-route BFS distance instead
        // of straight-line hex distance (`seaEdgeDistanceToGoals`), fixing an oscillation bug where a
        // ship could get stuck orbiting two edges forever; a settler/crew reserve-stockpiling waste
        // was also capped. Both changes make an ordinary game reach its win target measurably faster
        // (fewer wasted actions) for EVERY E&P scenario, this one included — which mechanically leaves
        // less time for a delivery to happen at least once in EVERY game, even though the mission
        // itself fires just as reliably per action (the three assertions above, and the aggregate
        // check below, are unaffected). Lowered from 0.3 to 0.15 to reflect that faster baseline,
        // mirroring the same bar T-1114's own full-campaign suite uses for the identical reason
        // (explorersPiratesFullCampaign.test.ts) — still comfortably nonzero, not a one-off fluke.
        expect(stats.gamesWithASpiceDeliveryFraction).toBeGreaterThan(0.15);

        // ---- T-1110 (fish-auto-haul fidelity fix): Spices for Hexhaven has the fish mission OFF — fish
        // must never accrue here anymore. Before this task, `seedFishSpiceV0` seeded real
        // `fishShoals` in this scenario too (whenever `missions.fish || missions.spice` was on), so
        // `haulFishOnArrival` could auto-haul + `deliverFish` could score fish points a spice-only
        // game never intended — THE cross-mission leak this task closes (FOLLOWUPS.md). ------------
        expect(stats.totalLeakFishHauled).toBe(0);
        expect(stats.totalLeakFishDelivered).toBe(0);
        expect(stats.totalLeakFishPointsAwarded).toBe(0);
      }

      // Across the WHOLE run (both cells), spice points were actually awarded — not a fluke of one
      // cell.
      expect(totalSpicePointsAwarded).toBeGreaterThan(0);

      process.stdout.write(`\nT-1112 Spices for Hexhaven sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
