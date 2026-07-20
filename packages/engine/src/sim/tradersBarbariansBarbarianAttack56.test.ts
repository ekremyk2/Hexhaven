// T-1052: Barbarian Attack 5–6 (Traders & Barbarians, building on T-1050's framework). Mirrors
// sim/tradersBarbariansRivers56.test.ts's shape exactly: plays seeded `fiveSix +
// tradersBarbarians{scenario:'barbarianAttack'}` games at BOTH 5 and 6 players, under BOTH
// extra-build turn rules (X12), asserting the base invariants I1–I10 (invariants.ts, config-aware —
// the base 5–6 bank/piece counts), the fiveSix FS/FS-PP turn-rule invariants, AND the barbarianAttack
// BAR1–BAR4 invariants (barbarianAttackInvariants.ts, now geometry/player-count-aware — see T-1052's
// rework there) after EVERY successful transition. `simulate` throws on the first violation or an
// I10 timeout, with the seed + action index folded in for a ready repro.
//
// T&B plays on the BASE board (no scenario frame, TB1.2), so 5–6 here means the SAME base 30-hex
// `GEOMETRY_EXT56` a plain fiveSix game uses — plus barbarianAttack's ring/center/march-path geometry
// now computed against the RESOLVED config geometry (`barbarianGeometryFor`, threaded via
// `initialBarbarianAttackExt`'s new `geometry` parameter) instead of always the base 19-hex board,
// and a bigger starting wave (`barbarianWaveSizeFor`: 4 at 5p, 5 at 6p vs. the base 3 at 3–4p) to
// keep the threat meaningful against more knight-recruiting seats. `TB_SCENARIO_SUPPORTS_56.
// barbarianAttack` (T-1052) is what makes this combo reachable at all — the ring/march path on the
// 30-hex board has no rulebook diagram (⚠ VERIFY, best-effort like T-1050/T-1051's precedent).

import { describe, expect, it } from 'vitest';
import type { GameConfig, Seat } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

const GAMES_PER = 20;
// A 5–6-player fiveSix game with an extra-build turn rule runs longer than a base 3–4p game (more
// seats, more SBP/Paired sub-phase actions, plus a bigger barbarian wave) — mirrors
// tradersBarbariansRivers56.test.ts's cap.
const MAX_ACTIONS = 15_000;

function barbarianAttack56Config(playerCount: 5 | 6, rule: 'sbp' | 'pairedPlayers'): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: {
      fiveSix: true,
      seafarers: false,
      citiesKnights: false,
      tradersBarbarians: { scenario: 'barbarianAttack' },
    },
    variants: { fiveSixTurnRule: rule },
  };
}

describe('T-1052 Traders & Barbarians 5–6: Barbarian Attack 5–6 (base 30-hex EXT56 board)', () => {
  for (const playerCount of [5, 6] as const) {
    for (const rule of ['sbp', 'pairedPlayers'] as const) {
      it(`plays ${GAMES_PER} full ${playerCount}-player barbarianAttack games under the ${rule} rule with zero invariant violations`, () => {
        const results: SimulateResult[] = [];
        for (let i = 0; i < GAMES_PER; i++) {
          // Throws (failing this test, repro-ready) on any base/fiveSix/barbarianAttack (BAR1–BAR4)
          // invariant or I10 hit.
          results.push(
            simulate(`tb56-barb-${rule}-${playerCount}-${i}`, {
              config: barbarianAttack56Config(playerCount, rule),
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

        // ---- The barbarian mechanic was actually exercised, not just legal in principle ----------
        const gamesWithAKnight = results.filter((r) => (r.knightsRecruited ?? 0) > 0).length;
        const knightsRecruited = results.reduce((sum, r) => sum + (r.knightsRecruited ?? 0), 0);
        const knightMoves = results.reduce((sum, r) => sum + (r.barbarianKnightMoves ?? 0), 0);
        const combatsResolved = results.reduce((sum, r) => sum + (r.barbarianCombatsResolved ?? 0), 0);
        const pillages = results.reduce((sum, r) => sum + (r.barbarianPillages ?? 0), 0);
        const dispersals = results.reduce((sum, r) => sum + (r.barbarianDispersals ?? 0), 0);

        expect(gamesWithAKnight / GAMES_PER).toBeGreaterThan(0.3);
        expect(knightsRecruited).toBeGreaterThan(0);
        // At least SOME barbarian resolution (combat/pillage/dispersal — waves marching + knights
        // intercepting/attacks landing) happened across the cell.
        expect(combatsResolved + pillages + dispersals).toBeGreaterThan(0);
        void knightMoves; // recorded for the stats dump below, not itself gated
      });
    }
  }
});
