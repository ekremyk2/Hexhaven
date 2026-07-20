// T-1002: The Fishermen of Hexhaven's simulation & invariant gate (docs/rules/traders-barbarians-
// rules.md §TB2). Plays seeded fishermen games at BOTH supported player counts (3 and 4, §TB1.2 —
// T&B is 3–4p only for now) with the random-legal-move bot (sim/bot.ts, taught to occasionally
// `exchangeFish`/`passOldBoot`), asserting the base invariants I1–I10 (invariants.ts, whose I7 is
// already Old-Boot-target-aware via `winTargetFor`) AND the fishermen FISH1–FISH3 invariants
// (fishermenInvariants.ts: fish conservation across stack + hands + spent, a real Old Boot holder,
// the boot-adjusted win target honored) after EVERY successful transition. `simulate` throws on the
// first violation or an I10 timeout, with the seed + action index + offending action folded in for a
// ready repro.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count — enough to exercise fish production/exchange/Old-Boot play repeatedly
 *  without the full 500-game headline gate T-706 uses for a bigger scenario acceptance sweep. */
const GAMES_PER = 60;

/** A fishermen game is still base-board/base-target (§TB1.2/TB1.3) — the base 4,000-action I10 cap
 *  applies; a little headroom for the extra `exchangeFish`/`passOldBoot` action types. */
const MAX_ACTIONS = 5000;

function fishermenConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: false,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'fishermen' },
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
  meanFishExchanges: number;
  gamesWithAnExchangeFraction: number;
  meanOldBootPasses: number;
  meanTotalFishProduced: number;
  winnerHeldOldBootFraction: number;
}

function runCell(playerCount: 3 | 4): { results: SimulateResult[]; stats: CellStats } {
  const results: SimulateResult[] = [];
  for (let i = 0; i < GAMES_PER; i++) {
    results.push(
      simulate(`fish${playerCount}-${i}`, { config: fishermenConfig(playerCount), maxActions: MAX_ACTIONS })
    );
  }

  const winsBySeat: Partial<Record<Seat, number>> = {};
  let exchanges = 0;
  let gamesWithExchange = 0;
  let bootPasses = 0;
  let fishProduced = 0;
  let winnerWithBoot = 0;
  for (const r of results) {
    winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
    exchanges += r.fishExchanges ?? 0;
    if ((r.fishExchanges ?? 0) > 0) gamesWithExchange += 1;
    bootPasses += r.oldBootPasses ?? 0;
    fishProduced += r.totalFishProduced ?? 0;
    if (r.winnerHeldOldBoot) winnerWithBoot += 1;
  }

  const stats: CellStats = {
    cell: `${playerCount}p`,
    playerCount,
    games: GAMES_PER,
    meanTurns: results.reduce((s, r) => s + r.turns, 0) / GAMES_PER,
    meanActions: results.reduce((s, r) => s + r.actions, 0) / GAMES_PER,
    maxActions: Math.max(...results.map((r) => r.actions)),
    winsBySeat,
    meanFishExchanges: exchanges / GAMES_PER,
    gamesWithAnExchangeFraction: gamesWithExchange / GAMES_PER,
    meanOldBootPasses: bootPasses / GAMES_PER,
    meanTotalFishProduced: fishProduced / GAMES_PER,
    winnerHeldOldBootFraction: winnerWithBoot / GAMES_PER,
  };
  return { results, stats };
}

describe('T-1002 Fishermen simulation & invariant suite (3p + 4p)', () => {
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
          // The base target (§TB1.3 — fishermen doesn't override it); the Old Boot holder needs one
          // more (winTargetFor), so a winning holder can legitimately show 11.
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        for (let seat = 0; seat < playerCount; seat++) {
          expect(stats.winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
        }

        // ---- Fishermen mechanics were actually exercised, not just legal in principle -----------
        expect(stats.gamesWithAnExchangeFraction).toBeGreaterThan(0.5);
        expect(stats.meanFishExchanges).toBeGreaterThan(0.5);
        expect(stats.meanTotalFishProduced).toBeGreaterThan(0);
      }

      process.stdout.write(`\nT-1002 fishermen sim stats:\n${JSON.stringify(allStats, null, 2)}\n`);
    },
    300_000
  );
});
