// T-1051: The Rivers of Hexhaven 5–6 (Traders & Barbarians, building on T-1050's framework). Mirrors
// sim/tradersBarbariansFishermen56.test.ts's shape exactly: plays seeded `fiveSix +
// tradersBarbarians{scenario:'rivers'}` games at BOTH 5 and 6 players, under BOTH extra-build turn
// rules (X12), asserting the base invariants I1–I10 (invariants.ts, config-aware — the base 5–6
// bank/piece counts), the fiveSix FS/FS-PP turn-rule invariants, AND the rivers RIV1–RIV5
// invariants (riversInvariants.ts — coin ledger, Wealthiest/Poorest VP correctness recomputed fresh
// off `ext.coins` every transition, bridges-only-on-river-edges, the per-turn coin-trade-counter
// reset; none of these assume a player count or a specific geometry) all at once (`simulate` runs
// each whenever its trigger is present). `simulate` throws on the first violation or an I10 timeout,
// with the seed + action index folded in for a ready repro. RIV2/RIV3 passing on every transition of
// every game below IS the sim's proof that the Wealthiest/Poorest Settler VP swing applies correctly
// at 5–6, not just in principle.
//
// T&B plays on the BASE board (no scenario frame, TB1.2), so 5–6 here means the SAME base 30-hex
// `GEOMETRY_EXT56` a plain fiveSix game uses — plus rivers' river edges/shore vertices/shore edges
// now computed against the RESOLVED config geometry (state.ts's `riverGeometryFor`, threaded via
// `initialRiversExt`'s new `geometry` parameter) instead of always the base 19-hex board.
// `TB_SCENARIO_SUPPORTS_56.rivers` (T-1051) is what makes this combo reachable at all — river layout
// on the 30-hex board has no rulebook diagram (⚠ VERIFY, best-effort like T-1050's fishing grounds).

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

const GAMES_PER = 20;
// A 5–6-player fiveSix game with an extra-build turn rule runs longer than a base 3–4p game (more
// seats, more SBP/Paired sub-phase actions) — mirrors tradersBarbariansFishermen56.test.ts's cap.
const MAX_ACTIONS = 15_000;

function rivers56Config(playerCount: 5 | 6, rule: 'sbp' | 'pairedPlayers'): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'rivers' },
    },
    variants: { fiveSixTurnRule: rule },
  };
}

describe('T-1051 Traders & Barbarians 5–6: Rivers 5–6 (base 30-hex EXT56 board)', () => {
  for (const playerCount of [5, 6] as const) {
    for (const rule of ['sbp', 'pairedPlayers'] as const) {
      it(`plays ${GAMES_PER} full ${playerCount}-player rivers games under the ${rule} rule with zero invariant violations`, () => {
        const results: SimulateResult[] = [];
        for (let i = 0; i < GAMES_PER; i++) {
          // Throws (failing this test, repro-ready) on any base/fiveSix/rivers (RIV1–RIV5) invariant
          // or I10 hit — RIV2/RIV3 recompute Wealthiest/Poorest fresh off `ext.coins` every
          // transition, so a pass here is itself the proof the VP swing resolves correctly at 5–6.
          results.push(
            simulate(`tb56-rivers-${rule}-${playerCount}-${i}`, {
              config: rivers56Config(playerCount, rule),
              maxActions: MAX_ACTIONS,
            })
          );
        }

        for (const r of results) {
          expect(r.actions).toBeLessThan(MAX_ACTIONS);
          expect(r.turns).toBeGreaterThan(0);
          expect(r.winner).toBeGreaterThanOrEqual(0);
          // Rivers doesn't override the base target (§TB1.3) — computeVp already folds in any
          // Wealthiest/Poorest swing, so a winner's reported total is always >= 10 by construction.
          expect(r.winnerVp).toBeGreaterThanOrEqual(10);
        }

        // ---- The river economy was actually exercised, not just legal in principle --------------
        const gamesWithBridge = results.filter((r) => (r.bridgesBuilt ?? 0) > 0).length;
        const gamesWithCoinTrade = results.filter((r) => (r.coinTrades ?? 0) > 0).length;
        const totalCoinsAwarded = results.reduce((sum, r) => sum + (r.totalCoinsAwarded ?? 0), 0);
        expect(gamesWithBridge / GAMES_PER).toBeGreaterThan(0.3);
        expect(totalCoinsAwarded).toBeGreaterThan(0);
        expect(gamesWithCoinTrade / GAMES_PER).toBeGreaterThan(0);
      });
    }
  }
});
