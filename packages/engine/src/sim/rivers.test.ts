// T-1003: The Rivers of Hexhaven's simulation & invariant gate (docs/rules/traders-barbarians-rules.md
// §TB3). Plays seeded rivers games at BOTH supported player counts (3 and 4, §TB1.2 — T&B is 3-4p
// only for now) with the random-legal-move bot (sim/bot.ts, taught to occasionally `buildBridge`/
// `tradeCoins`), asserting the base invariants I1–I10 (invariants.ts) AND the rivers RIV1–RIV5
// invariants (riversInvariants.ts: coin ledger, Wealthiest/Poorest VP correctness, bridges only on
// river edges, the per-turn coin-trade counter) after EVERY successful transition. `simulate` throws
// on the first violation or an I10 timeout, with the seed + action index + offending action folded
// in for a ready repro.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — enough to exercise bridge/coin-trade play repeatedly without the full
 *  500-game headline gate T-706 uses for a bigger scenario acceptance sweep. */
const GAMES_PER = 60;

/** A rivers game is still base-board/base-target (§TB1.2/TB1.3) — the base 4,000-action I10 cap
 *  applies; a little headroom for the extra `buildBridge`/`tradeCoins` action types. */
const MAX_ACTIONS = 5000;

function riversConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'rivers' },
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
  meanBridgesBuilt: number;
  gamesWithABridgeFraction: number;
  meanCoinTrades: number;
  gamesWithACoinTradeFraction: number;
  meanTotalCoinsAwarded: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`river${playerCount}-${i}`, { config: riversConfig(playerCount), maxActions: MAX_ACTIONS })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let bridges = 0;
  let gamesWithBridge = 0;
  let trades = 0;
  let gamesWithTrade = 0;
  let coinsAwarded = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    bridges += r.bridgesBuilt ?? 0;
    if ((r.bridgesBuilt ?? 0) > 0) gamesWithBridge += 1;
    trades += r.coinTrades ?? 0;
    if ((r.coinTrades ?? 0) > 0) gamesWithTrade += 1;
    coinsAwarded += r.totalCoinsAwarded ?? 0;
  }

  const stats: CellStats = {
    cell: `${playerCount}p`,
    playerCount,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    meanBridgesBuilt: bridges / GAMES_PER,
    gamesWithABridgeFraction: gamesWithBridge / GAMES_PER,
    meanCoinTrades: trades / GAMES_PER,
    gamesWithACoinTradeFraction: gamesWithTrade / GAMES_PER,
    meanTotalCoinsAwarded: coinsAwarded / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1003 Rivers simulation & invariant suite (3p + 4p)', () => {
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
          // Rivers doesn't override the base target (§TB1.3) — computeVp already folds in any
          // Wealthiest/Poorest swing, so a winner's reported total is always >= 10 by construction.
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- Rivers mechanics were actually exercised, not just legal in principle ---------------
        expect(stats.gamesWithABridgeFraction).toBeGreaterThan(0.5);
        expect(stats.meanBridgesBuilt).toBeGreaterThan(0.5);
        expect(stats.meanTotalCoinsAwarded).toBeGreaterThan(0);
        expect(stats.gamesWithACoinTradeFraction).toBeGreaterThan(0.2);
      }

      process.stdout.write(`\nT-1003 rivers sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
