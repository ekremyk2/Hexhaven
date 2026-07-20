// T-112: the engine's real acceptance gate. 1,000 seeded games, played start-to-finish by the
// random-legal-move bot (bot.ts), each asserting I1–I9 after every transition and the I9 replay
// spot-check every 50 actions (invariants.ts / runGame.ts). `simulate` throws on the first
// violation or an I10 (4,000-action) timeout — a thrown error here IS a failing test, with the
// seed + action index + offending action folded into the message for repro.
//
// Aggregate stats are written via `process.stdout.write` rather than `console.*`: packages/engine
// bans the `console` global outright (eslint.config.js, engine purity) — that ban applies to every
// .ts file under this path, tests included.

import { describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';

const GAME_COUNT = 1000;

describe('T-112 simulation bot & invariant suite', () => {
  it(`plays ${GAME_COUNT} seeded games with zero invariant violations`, () => {
    const results = [];
    for (let i = 0; i < GAME_COUNT; i++) {
      // simulate() throws (failing this test, with a repro-ready message) on any I1–I9/I10 hit.
      results.push(simulate(`sim-${i}`));
    }

    expect(results).toHaveLength(GAME_COUNT);
    for (const r of results) {
      expect(r.actions).toBeLessThan(4000);
      expect(r.turns).toBeGreaterThan(0);
    }

    // ---- Aggregate stats for PM eyeballing (task requirement 4) ----------------------------
    const totalTurns = results.reduce((sum, r) => sum + r.turns, 0);
    const totalActions = results.reduce((sum, r) => sum + r.actions, 0);
    const winsBySeat: Partial<Record<Seat, number>> = {};
    let longestRoadAwarded = 0;
    let largestArmyAwarded = 0;
    for (const r of results) {
      winsBySeat[r.winner] = (winsBySeat[r.winner] ?? 0) + 1;
      if (r.longestRoadHolder !== null) longestRoadAwarded += 1;
      if (r.largestArmyHolder !== null) largestArmyAwarded += 1;
    }

    const stats = {
      games: GAME_COUNT,
      meanTurns: totalTurns / GAME_COUNT,
      meanActions: totalActions / GAME_COUNT,
      maxActions: Math.max(...results.map((r) => r.actions)),
      winsBySeat,
      longestRoadAwardedFraction: longestRoadAwarded / GAME_COUNT,
      largestArmyAwardedFraction: largestArmyAwarded / GAME_COUNT,
    };
    process.stdout.write(`\nT-112 sim stats: ${JSON.stringify(stats, null, 2)}\n`);

    // Every seat should win a nontrivial share across 1,000 games — a lopsided distribution here
    // (e.g. one seat never winning) would point at a bug in setup/turn-order handling.
    for (let seat = 0; seat < 4; seat++) {
      expect(winsBySeat[seat as Seat] ?? 0).toBeGreaterThan(0);
    }
  }, 180_000);
});
