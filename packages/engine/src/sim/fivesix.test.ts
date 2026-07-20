// T-604: the 5–6 Player Extension's large-scale simulation acceptance gate. Plays seeded games at
// BOTH player counts (5 and 6) under BOTH extra-build turn rules (2015 SBP and 2022 Paired Players),
// asserting the config-aware base invariants I1–I10 (invariants.ts) AND the X12 turn-rule invariants
// (fivesixInvariants.ts) after every single transition. `simulate` throws on the first violation or
// an I10 timeout, with the seed + action index + offending action folded in for a ready repro.
//
// Seeded split (reported below): GAMES_PER games per (count × rule) cell → 4 cells. With
// GAMES_PER = 250 that is the task's 500@5 + 500@6, evenly halved across sbp/pairedPlayers
// (250+250 per count). Distinct seed prefixes per cell keep every game independently reproducible.
//
// Aggregate stats are emitted via process.stdout.write (packages/engine bans the console global).

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

type TurnRule = 'sbp' | 'pairedPlayers';

/** Games per (playerCount × turnRule) cell. 250 → 1,000 total (500@5 + 500@6, split per rule). */
const GAMES_PER = 250;

/** 5–6 games with an extra-build rule run longer than the 4p base; a generous I10 cap for them. */
const MAX_ACTIONS_5_6 = 12_000;

function cfg(playerCount: 5 | 6, rule: TurnRule): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // X1.1: target stays 10 in the extension
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: false, citiesKnights: false },
    variants: { fiveSixTurnRule: rule },
  };
}

interface CellStats {
  cell: string;
  playerCount: number;
  rule: TurnRule;
  games: number;
  meanTurns: number;
  meanActions: number;
  maxActions: number;
  winsBySeat: Partial<Record<Seat, number>>;
  longestRoadAwardedFraction: number;
  largestArmyAwardedFraction: number;
  sawSpecialBuildFraction: number;
  sawPartialTurnFraction: number;
  wonDuringPartialTurnCount: number;
}

function runCell(playerCount: 5 | 6, rule: TurnRule): { results: SimulateResult[]; stats: CellStats } {
  const prefix = `fs${playerCount}-${rule === 'sbp' ? 'sbp' : 'pp'}`;
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    // simulate() throws (failing this test, repro-ready) on any base/fiveSix invariant or I10 hit.
    results.push(simulate(`${prefix}-${i}`, { config: cfg(playerCount, rule), maxActions: MAX_ACTIONS_5_6 }));
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let lr = 0;
  let la = 0;
  let sbp = 0;
  let partial = 0;
  let wonPartial = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    if (r.longestRoadHolder !== null) lr += 1;
    if (r.largestArmyHolder !== null) la += 1;
    if (r.sawSpecialBuild) sbp += 1;
    if (r.sawPartialTurn) partial += 1;
    if (r.wonDuringPartialTurn) wonPartial += 1;
  }

  const stats: CellStats = {
    cell: `${playerCount}p/${rule}`,
    playerCount,
    rule,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    longestRoadAwardedFraction: lr / GAMES_PER,
    largestArmyAwardedFraction: la / GAMES_PER,
    sawSpecialBuildFraction: sbp / GAMES_PER,
    sawPartialTurnFraction: partial / GAMES_PER,
    wonDuringPartialTurnCount: wonPartial,
  };
  return { results, stats };
}

describe('T-604 5–6 Extension simulation & invariant suite (both turn rules)', () => {
  it(
    `plays ${GAMES_PER * 4} games (${GAMES_PER}× each of 5p/6p × sbp/pairedPlayers) with zero invariant violations`,
    () => {
      const cells: Array<[5 | 6, TurnRule]> = [
        [5, 'sbp'],
        [5, 'pairedPlayers'],
        [6, 'sbp'],
        [6, 'pairedPlayers'],
      ];

      const allStats: CellStats[] = [];
      for (const [count, rule] of cells) {
        const { results, stats } = runCell(count, rule);
        allStats.push(stats);

        // Every game terminated inside the cap and took at least one turn.
        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS_5_6);
          expect(r.turns).toBeGreaterThan(0);
        }

        // Each mode must actually exercise its OWN mechanic, and never the other's.
        if (rule === 'sbp') {
          expect(stats.sawSpecialBuildFraction).toBeGreaterThan(0.9);
          expect(stats.sawPartialTurnFraction).toBe(0);
        } else {
          expect(stats.sawPartialTurnFraction).toBeGreaterThan(0.9);
          expect(stats.sawSpecialBuildFraction).toBe(0);
        }

        // No lopsided seat distribution — every seat wins a nontrivial share (setup/turn-order sanity).
        for (let seat = 0; seat < count; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }
      }

      // FS-PP4 capability: across the two Paired-Players cells, "player 2" must win at least some
      // games on their partial turn (proves player 2 CAN win, X12).
      const pairedWon = allStats
        .filter((s) => s.rule === 'pairedPlayers')
        .reduce((sum, s) => sum + s.wonDuringPartialTurnCount, 0);
      expect(pairedWon).toBeGreaterThan(0);

      process.stdout.write(`\nT-604 fiveSix sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    600_000
  );
});
