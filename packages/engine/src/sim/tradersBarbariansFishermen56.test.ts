// T-1050: Traders & Barbarians 5–6 framework + Fishermen 5–6 (the first proven scenario). Mirrors
// sim/fishermen.test.ts (T-1002's own 3p/4p gate) and sim/fiveSixCitiesKnights.test.ts's combined-
// game acceptance-gate shape: plays seeded `fiveSix + tradersBarbarians{scenario:'fishermen'}` games
// at BOTH 5 and 6 players, under BOTH extra-build turn rules (X12), asserting the base invariants
// I1–I10 (invariants.ts, config-aware — the base 5–6 bank/piece counts), the fiveSix FS/FS-PP turn-
// rule invariants, AND the fishermen FISH1–FISH3 invariants (fishermenInvariants.ts — no player-
// count/geometry assumptions, reused as-is) all at once (`simulate` runs each whenever its trigger is
// present). `simulate` throws on the first violation or an I10 timeout, with the seed + action index
// folded in for a ready repro.
//
// This is the FRAMEWORK proof for Phase 10B: T&B plays on the base board (no scenario frame,
// TB1.2), so 5–6 here means the SAME base 30-hex `GEOMETRY_EXT56` a plain fiveSix game uses
// (`createGame` routes T&B+fiveSix through the generic `generateBoard`, which already resolves
// `GEOMETRY_EXT56` once `resolveModules` allows the combo) — plus fishermen's fishing grounds now
// computed against the RESOLVED config geometry (fishermen.ts's `computeFishingGrounds`) instead of
// always the base 19-hex board. `TB_SCENARIO_SUPPORTS_56.fishermen` is what makes it reachable at
// all; every other T&B scenario stays 3–4p only until its own T-1051…T-1055 task.

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

const GAMES_PER = 20;
// A 5–6-player fiveSix game with an extra-build turn rule runs longer than a base 3–4p game (more
// seats, more SBP/Paired sub-phase actions) — mirrors fiveSixCitiesKnights.test.ts's cap.
const MAX_ACTIONS = 15_000;

function fishermen56Config(playerCount: 5 | 6, rule: 'sbp' | 'pairedPlayers'): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'fishermen' },
    },
    variants: { fiveSixTurnRule: rule },
  };
}

describe('T-1050 Traders & Barbarians 5–6 framework: Fishermen 5–6 (base 30-hex EXT56 board)', () => {
  for (const playerCount of [5, 6] as const) {
    for (const rule of ['sbp', 'pairedPlayers'] as const) {
      it(`plays ${GAMES_PER} full ${playerCount}-player fishermen games under the ${rule} rule with zero invariant violations`, () => {
        const results: SimulateResult[] = [];
        for (let i = 0; i < GAMES_PER; i++) {
          // Throws (failing this test, repro-ready) on any base/fiveSix/fishermen invariant or I10 hit.
          results.push(
            simulate(`tb56-fish-${rule}-${playerCount}-${i}`, {
              config: fishermen56Config(playerCount, rule),
              maxActions: MAX_ACTIONS,
            })
          );
        }

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        // ---- The fish mechanic was actually exercised, not just legal in principle --------------
        const gamesWithExchange = results.filter((r) => (r.fishExchanges ?? 0) > 0).length;
        const totalFishProduced = results.reduce((sum, r) => sum + (r.totalFishProduced ?? 0), 0);
        expect(gamesWithExchange / GAMES_PER).toBeGreaterThan(0.5);
        expect(totalFishProduced).toBeGreaterThan(0);
      });
    }
  }
});
