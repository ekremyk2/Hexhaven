// T-1006: the main scenario's simulation & invariant gate (docs/rules/traders-barbarians-rules.md
// §TB6). Plays seeded tradersBarbarians games at BOTH supported player counts (3 and 4, §TB1.2 — T&B
// is 3-4p only for now) with the random-legal-move bot (sim/bot.ts, taught to load/move wagons),
// asserting the base invariants I1–I10 (invariants.ts) AND the TBM1–TBM5 invariants
// (tradersBarbariansMainInvariants.ts: wagon count/shape, non-negative commodities/gold/deliveries,
// path-barbarian edge validity, delivery VP) after EVERY successful transition. `simulate` throws on
// the first violation or an I10 timeout, with the seed + action index + offending action folded in
// for a ready repro.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — enough to exercise the wagon load/move/delivery machinery repeatedly
 *  without the full 500-game headline gate T-706 uses for a bigger scenario acceptance sweep. */
const GAMES_PER = 60;

/** No win-target override for this scenario (TB1.3: base 10 unless a clause says otherwise, and
 *  §TB6 names none, unlike Caravans' 12) — a little headroom over the base 4,000-action I10 cap for
 *  the extra `moveWagon` action type. */
const MAX_ACTIONS = 5000;

function tradersBarbariansMainConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'tradersBarbarians' },
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
  meanWagonsPlaced: number;
  meanWagonMoves: number;
  meanDeliveries: number;
  gamesWithADeliveryFraction: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`tbmain${playerCount}-${i}`, {
        config: tradersBarbariansMainConfig(playerCount),
        maxActions: MAX_ACTIONS,
      })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let wagonsPlaced = 0;
  let wagonMoves = 0;
  let deliveries = 0;
  let gamesWithADelivery = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    wagonsPlaced += r.wagonsPlaced ?? 0;
    wagonMoves += r.wagonMoves ?? 0;
    deliveries += r.deliveriesCompleted ?? 0;
    if ((r.deliveriesCompleted ?? 0) > 0) gamesWithADelivery += 1;
  }

  const stats: CellStats = {
    cell: `${playerCount}p`,
    playerCount,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    meanWagonsPlaced: wagonsPlaced / GAMES_PER,
    meanWagonMoves: wagonMoves / GAMES_PER,
    meanDeliveries: deliveries / GAMES_PER,
    gamesWithADeliveryFraction: gamesWithADelivery / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1006 the main scenario simulation & invariant suite (3p + 4p)', () => {
  it(
    `plays ${GAMES_PER * 2} games (${GAMES_PER}× each of 3p/4p) to wins with zero invariant violations`,
    () => {
      const allStats: CellStats[] = [];
      for (const playerCount of [3, 4] as const) {
        const { results, stats } = runCell(playerCount);
        allStats.push(stats);

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- The trade-route economy was actually exercised, not just legal in principle ---------
        expect(stats.meanWagonsPlaced).toBeGreaterThan(0.3);
        expect(stats.meanWagonMoves).toBeGreaterThan(0.3);
        expect(stats.gamesWithADeliveryFraction).toBeGreaterThan(0.1);
      }

      process.stdout.write(`\nT-1006 tradersBarbariansMain sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
