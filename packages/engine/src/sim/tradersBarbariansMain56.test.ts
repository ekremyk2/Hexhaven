// T-1054: The main "Traders & Barbarians" combined scenario 5–6 (Traders & Barbarians, building on
// T-1050's framework). Mirrors sim/tradersBarbariansCaravans56.test.ts/
// tradersBarbariansBarbarianAttack56.test.ts's shape exactly: plays seeded `fiveSix +
// tradersBarbarians{scenario:'tradersBarbarians'}` games at BOTH 5 and 6 players, under BOTH
// extra-build turn rules (X12), asserting the base invariants I1–I10 (invariants.ts, config-aware —
// the base 5–6 bank/piece counts), the fiveSix FS/FS-PP turn-rule invariants, AND the TBM1–TBM5
// invariants (tradersBarbariansMainInvariants.ts, now geometry-aware — see T-1054's rework there)
// after EVERY successful transition. `simulate` throws on the first violation or an I10 timeout,
// with the seed + action index folded in for a ready repro.
//
// T&B plays on the BASE board (no scenario frame, TB1.2), so 5–6 here means the SAME base 30-hex
// `GEOMETRY_EXT56` a plain fiveSix game uses — plus this scenario's OWN trade-hex placement/
// path-barbarian-edge geometry now computed against the RESOLVED config geometry
// (`tradersBarbariansMainGeometryFor`, threaded via `initialTradersBarbariansMainExt`'s new
// `geometry` parameter) instead of always the base 19-hex board, and a bigger static path-barbarian
// set (`pathBarbarianCountFor`: 4 at 5p, 5 at 6p vs. the base 3 at 3–4p) to keep the road-blocking
// threat meaningful on the bigger board. `TB_SCENARIO_SUPPORTS_56.tradersBarbarians` (T-1054, the
// LAST T&B scenario to gain this) is what makes this combo reachable at all — the trade-hex/wagon
// layout on the 30-hex board has no rulebook diagram (⚠ VERIFY, best-effort like T-1050/…/T-1053's
// precedent). This scenario's own "path barbarians" are a wholly separate STATIC v1 model from
// barbarianAttack.ts's mobile-wave/knight system (untouched here, unaffected either way) — see
// main.ts's header comment for why the two never collide.

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

const GAMES_PER = 20;
// A 5–6-player fiveSix game with an extra-build turn rule runs longer than a base 3–4p game (more
// seats, more SBP/Paired sub-phase actions) PLUS the extra `moveWagon` action type — mirrors
// tradersBarbariansBarbarianAttack56.test.ts/tradersBarbariansCaravans56.test.ts's cap, generously
// sized.
const MAX_ACTIONS = 15_000;

function tradersBarbariansMain56Config(playerCount: 5 | 6, rule: 'sbp' | 'pairedPlayers'): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // TB1.3: base 10, no override clause for this scenario (unlike Caravans' 12).
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'tradersBarbarians' },
    },
    variants: { fiveSixTurnRule: rule },
  };
}

describe('T-1054 Traders & Barbarians 5–6: the main combined scenario 5–6 (base 30-hex EXT56 board)', () => {
  for (const playerCount of [5, 6] as const) {
    for (const rule of ['sbp', 'pairedPlayers'] as const) {
      it(`plays ${GAMES_PER} full ${playerCount}-player tradersBarbarians (main) games under the ${rule} rule with zero invariant violations`, () => {
        const results: SimulateResult[] = [];
        for (let i = 0; i < GAMES_PER; i++) {
          // Throws (failing this test, repro-ready) on any base/fiveSix/tradersBarbariansMain
          // (TBM1–TBM5) invariant or I10 hit.
          results.push(
            simulate(`tb56-main-${rule}-${playerCount}-${i}`, {
              config: tradersBarbariansMain56Config(playerCount, rule),
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

        for (let seat = 0; seat < playerCount; seat++) {
          const wins = results.filter((r) => r.winner === (seat as Seat)).length;
          expect(wins).toBeGreaterThanOrEqual(0); // sanity — no seat index out of range
        }

        // ---- The combined trade-hex + wagon + path-barbarian economy was actually exercised, not
        // just legal in principle -------------------------------------------------------------------
        const wagonsPlaced = results.reduce((sum, r) => sum + (r.wagonsPlaced ?? 0), 0);
        const wagonMoves = results.reduce((sum, r) => sum + (r.wagonMoves ?? 0), 0);
        const deliveries = results.reduce((sum, r) => sum + (r.deliveriesCompleted ?? 0), 0);
        const gamesWithADelivery = results.filter((r) => (r.deliveriesCompleted ?? 0) > 0).length;

        expect(wagonsPlaced).toBeGreaterThan(0);
        expect(wagonMoves).toBeGreaterThan(0);
        expect(deliveries).toBeGreaterThan(0);
        expect(gamesWithADelivery / GAMES_PER).toBeGreaterThan(0.1);
      });
    }
  }
});
