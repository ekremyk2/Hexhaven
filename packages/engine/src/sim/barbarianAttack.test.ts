// T-1005: Barbarian Attack's simulation & invariant gate (docs/rules/traders-barbarians-rules.md
// §TB5). Plays seeded barbarianAttack games at BOTH supported player counts (3 and 4, §TB1.2 — T&B
// is 3-4p only for now) with the random-legal-move bot (sim/bot.ts, taught to
// `recruitKnight`/`moveBarbarianKnight`), asserting the base invariants I1–I10 (invariants.ts) AND
// the barbarianAttack BAR1–BAR4 invariants (barbarianAttackInvariants.ts: barbarian/knight
// placement shape, non-negative captured/gold, captured-barbarian VP) after EVERY successful
// transition. `simulate` throws on the first violation or an I10 timeout, with the seed + action
// index + offending action folded in for a ready repro.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — enough to exercise the knight recruit/move/combat machinery repeatedly
 *  without the full 500-game headline gate T-706 uses for a bigger scenario acceptance sweep. */
const GAMES_PER = 60;

/** No win-target override for this scenario (TB1.3: base 10 unless a clause says otherwise, and
 *  TB5 names none) — a little headroom over the base 4,000-action I10 cap for the extra
 *  `recruitKnight`/`moveBarbarianKnight` action types. */
const MAX_ACTIONS = 5000;

function barbarianAttackConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'barbarianAttack' },
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
  meanKnightsRecruited: number;
  meanKnightMoves: number;
  meanCombatsResolved: number;
  meanPillages: number;
  meanDispersals: number;
  gamesWithAKnightFraction: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`barb${playerCount}-${i}`, { config: barbarianAttackConfig(playerCount), maxActions: MAX_ACTIONS })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let knightsRecruited = 0;
  let knightMoves = 0;
  let combatsResolved = 0;
  let pillages = 0;
  let dispersals = 0;
  let gamesWithAKnight = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    knightsRecruited += r.knightsRecruited ?? 0;
    knightMoves += r.barbarianKnightMoves ?? 0;
    combatsResolved += r.barbarianCombatsResolved ?? 0;
    pillages += r.barbarianPillages ?? 0;
    dispersals += r.barbarianDispersals ?? 0;
    if ((r.knightsRecruited ?? 0) > 0) gamesWithAKnight += 1;
  }

  const stats: CellStats = {
    cell: `${playerCount}p`,
    playerCount,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    meanKnightsRecruited: knightsRecruited / GAMES_PER,
    meanKnightMoves: knightMoves / GAMES_PER,
    meanCombatsResolved: combatsResolved / GAMES_PER,
    meanPillages: pillages / GAMES_PER,
    meanDispersals: dispersals / GAMES_PER,
    gamesWithAKnightFraction: gamesWithAKnight / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1005 Barbarian Attack simulation & invariant suite (3p + 4p)', () => {
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

        // ---- Barbarian Attack mechanics were actually exercised, not just legal in principle -----
        expect(stats.gamesWithAKnightFraction).toBeGreaterThan(0.3);
        expect(stats.meanKnightsRecruited).toBeGreaterThan(0.3);
        // At least SOME barbarian resolution (combat/pillage/dispersal) happened across the cell —
        // a barbarianAttack game with a single small starting wave won't hit every outcome kind in
        // every single game, but the cell as a whole should.
        expect(stats.meanCombatsResolved + stats.meanPillages + stats.meanDispersals).toBeGreaterThan(0.3);
      }

      process.stdout.write(`\nT-1005 barbarianAttack sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
