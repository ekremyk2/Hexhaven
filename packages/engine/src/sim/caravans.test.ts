// T-1004: The Caravans of Hexhaven's simulation & invariant gate (docs/rules/traders-barbarians-rules.md
// §TB4). Plays seeded caravans games at BOTH supported player counts (3 and 4, §TB1.2 — T&B is 3-4p
// only for now) with the random-legal-move bot (sim/bot.ts, taught to `caravanVote`/`placeCamel`),
// asserting the base invariants I1–I10 (invariants.ts) AND the caravans CAR1–CAR4 invariants
// (caravansInvariants.ts: camel placement, `caravanVote` phase shape, between-two-camels VP, the
// 12-VP win target) after EVERY successful transition. `simulate` throws on the first violation or an
// I10 timeout, with the seed + action index + offending action folded in for a ready repro.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — enough to exercise the vote/camel-placement machinery repeatedly
 *  without the full 500-game headline gate T-706 uses for a bigger scenario acceptance sweep. */
const GAMES_PER = 60;

/** A caravans game plays to 12 VP (§TB4.4) rather than the base 10 — a little headroom over the
 *  base 4,000-action I10 cap for the extra `caravanVote`/`placeCamel` action types plus the higher
 *  target. */
const MAX_ACTIONS = 6000;

function caravansConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // overridden to 12 by createGame's caravans resolution (§TB4.4) — asserted below.
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'caravans' },
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
  meanCaravanVotesOpened: number;
  meanCamelsPlaced: number;
  gamesWithACamelFraction: number;
  meanWinnerCaravansVp: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`caravan${playerCount}-${i}`, { config: caravansConfig(playerCount), maxActions: MAX_ACTIONS })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let votesOpened = 0;
  let camelsPlaced = 0;
  let gamesWithACamel = 0;
  let winnerCaravansVp = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    votesOpened += r.caravanVotesOpened ?? 0;
    camelsPlaced += r.camelsPlaced ?? 0;
    if ((r.camelsPlaced ?? 0) > 0) gamesWithACamel += 1;
    winnerCaravansVp += r.winnerCaravansVp ?? 0;
  }

  const stats: CellStats = {
    cell: `${playerCount}p`,
    playerCount,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    meanCaravanVotesOpened: votesOpened / GAMES_PER,
    meanCamelsPlaced: camelsPlaced / GAMES_PER,
    gamesWithACamelFraction: gamesWithACamel / GAMES_PER,
    meanWinnerCaravansVp: winnerCaravansVp / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1004 Caravans simulation & invariant suite (3p + 4p)', () => {
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
          // §TB4.4: the win target is resolved to 12, not the config's 10 — a winner's reported
          // total already folds in any between-two-camels VP, so it's always >= 12 by construction.
          expect(r.winnerVp).toBeGreaterThanOrEqual(12);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- Caravans mechanics were actually exercised, not just legal in principle -------------
        expect(stats.meanCaravanVotesOpened).toBeGreaterThan(0.5);
        expect(stats.gamesWithACamelFraction).toBeGreaterThan(0.3);
        expect(stats.meanCamelsPlaced).toBeGreaterThan(0.3);
      }

      process.stdout.write(`\nT-1004 caravans sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
