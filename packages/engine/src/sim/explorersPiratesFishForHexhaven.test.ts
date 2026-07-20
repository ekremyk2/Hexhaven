// T-1111: the Explorers & Pirates "Fish for Hexhaven" scenario's simulation & invariant gate (docs/rules/
// explorers-pirates-rules.md §EP1.3(generalized)/§EP2/§EP3/§EP4/§EP5/§EP8/§EP12.4, docs/tasks/
// phase-11/T-1111-ep-mission-framework-fish.md). Plays seeded Fish for Hexhaven games at BOTH supported
// player counts (3 and 4, §EP1.2 — E&P is 3–4p only for now) with the random-legal-move bot (sim/
// bot.ts, taught the fish-mission flow on top of the Land Ho! ship/settler/founding/harbor actions),
// asserting the base invariants I1–I10 (invariants.ts) AND the Fish for Hexhaven EP-FISH1–EP-FISH5
// invariants (explorersPiratesFishInvariants.ts: cargo cap, ship cap/uniqueness, harbor <= founded,
// fog never leaks, fish points only accrue via delivery) after EVERY successful transition.
//
// Fish for Hexhaven reuses Land Ho!'s exact board/movement/founding frame with the fish mission
// additionally ON (createGame.ts's generalized E&P branch, `EP_SCENARIO_CONFIG.fishForHexhaven`) — so
// this suite doubles as the "the mission actually fires" proof the task calls for: it asserts BOTH
// that every game completes AND that fish points are actually delivered across the run (not just
// legal in principle) — mirroring how Land Ho!'s own suite proves ships/exploration/founding/harbor
// all fire during ordinary random-bot play.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — mirrors Land Ho!'s own headroom allowance (explorersPiratesLandHo.test.ts). */
const GAMES_PER = 60;

/** Same headroom as Land Ho!'s own suite — this scenario adds only the fish-delivery loop on top of
 *  the identical ship/exploration/founding frame, no new action-budget pressure expected. */
const MAX_ACTIONS = 6000;

function fishForHexhavenConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to EP_SCENARIO_CONFIG.fishForHexhaven.winTarget (10, ⚠ VERIFY) by createGame.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
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
  /** T-1110 (fish-auto-haul fidelity fix leak proof, mirror direction): Fish for Hexhaven's own spice
   *  mission is off — `runGame.ts`'s `leakSpiceTraded`/`leakSpiceDelivered`/
   *  `leakTotalSpicePointsAwarded` must stay exactly 0 across every game, proving the mirror-image
   *  cross-mission leak (a fish-only scenario incidentally trading/delivering spice, since `villages`
   *  used to be seeded here too whenever fish||spice was on) is closed. */
  totalLeakSpiceTraded: number;
  totalLeakSpiceDelivered: number;
  totalLeakSpicePointsAwarded: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`fish${playerCount}-${i}`, { config: fishForHexhavenConfig(playerCount), maxActions: MAX_ACTIONS })
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

describe('T-1111 Explorers & Pirates Fish for Hexhaven simulation & invariant suite (3p + 4p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 3p/4p) to the win target with zero invariant violations, fish mission actually firing`,
    () => {
      const allStats: CellStats[] = [];
      let totalFishPointsAwarded = 0;
      for (const playerCount of [3, 4] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);
        totalFishPointsAwarded += stats.meanFishPointsAwarded * GAMES_PER;

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // §EP1.3 (generalized): Fish for Hexhaven plays to EP_SCENARIO_CONFIG.fishForHexhaven.winTarget
          // (10, ⚠ VERIFY), not the base 10 passed in `fishForHexhavenConfig` by coincidence of value —
          // this assertion is the same shape as Land Ho!'s own "not just the base config value" check.
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- E&P mechanics (reused from Land Ho!'s frame) were actually exercised -----------------
        expect(stats.meanShipsBuilt).toBeGreaterThan(0.5);
        expect(stats.meanShipMoves).toBeGreaterThan(0.5);
        expect(stats.meanTilesRevealed).toBeGreaterThan(0);

        // ---- THE FISH MISSION ITSELF actually fires — the task's own "prove it, don't ship a
        // mission that never triggers" requirement ------------------------------------------------
        expect(stats.meanFishHauled).toBeGreaterThan(0);
        expect(stats.meanFishDelivered).toBeGreaterThan(0);
        expect(stats.meanFishPointsAwarded).toBeGreaterThan(0);
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
        expect(stats.gamesWithAFishDeliveryFraction).toBeGreaterThan(0.15);

        // ---- T-1110 (fish-auto-haul fidelity fix, mirror direction): Fish for Hexhaven has the spice
        // mission OFF — spice must never accrue here anymore (`villages`/`tradeSpice` are only ever
        // seeded/available for a spice-mission scenario now). ------------------------------------
        expect(stats.totalLeakSpiceTraded).toBe(0);
        expect(stats.totalLeakSpiceDelivered).toBe(0);
        expect(stats.totalLeakSpicePointsAwarded).toBe(0);
      }

      // Across the WHOLE run (both cells), fish points were actually awarded — not a fluke of one cell.
      expect(totalFishPointsAwarded).toBeGreaterThan(0);

      process.stdout.write(`\nT-1111 Fish for Hexhaven sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
