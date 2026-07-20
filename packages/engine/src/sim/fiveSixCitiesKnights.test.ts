// 5–6 player extension + Cities & Knights combined-game acceptance gate. This is the official C&K
// 5–6 game, which reuses the base 5–6 board (GEOMETRY_EXT56) — no new geometry, only rule
// interactions. Plays seeded combined games at 5 and 6 players under BOTH extra-build turn rules,
// asserting the config-aware base invariants (I1–I10), the fiveSix X12 turn-rule invariants, AND the
// C&K clause invariants all at once (simulate runs each whenever its trigger is present). `simulate`
// throws on the first violation or an I10 timeout.
//
// Two combo-specific corners this gate pins (both surfaced by the exploratory sim bundle):
//  - the Special Building Phase must NOT offer `buyDevCard` in a C&K game (no dev deck — C11.1);
//    legalSpecialBuildActions gates it on isCitiesKnightsState (fiveSix/common.ts).
//  - Paired Players: player 2 may already hold the win the instant their partial turn opens (C&K
//    accrues VP out of turn via barbarian Defender-of-Hexhaven VP + metropolis), so FS-PP1 accepts an
//    open-straight-into-`ended` win as a legitimate player-2 win (fivesixInvariants.ts).

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { simulate } from './runGame.js';

const GAMES_PER = 40;
const MAX_ACTIONS = 15_000;

function comboConfig(playerCount: 5 | 6, rule: 'sbp' | 'pairedPlayers'): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    targetVp: 10, // createGame overrides with C&K's 13-VP target (C1.1); value here only satisfies the type
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: true, seafarers: false, citiesKnights: true },
    variants: { fiveSixTurnRule: rule },
  };
}

describe('5–6 extension + Cities & Knights combined game (official C&K 5–6, base 5–6 board)', () => {
  for (const playerCount of [5, 6] as const) {
    for (const rule of ['sbp', 'pairedPlayers'] as const) {
      it(`plays ${GAMES_PER} full ${playerCount}-player games under the ${rule} rule with all invariants holding`, () => {
        const results = [];
        for (let i = 0; i < GAMES_PER; i++) {
          // Throws (failing this test, repro-ready) on any base / fiveSix / C&K invariant or I10 hit.
          results.push(simulate(`56ck-${rule}-${playerCount}-${i}`, { config: comboConfig(playerCount, rule), maxActions: MAX_ACTIONS }));
        }
        for (const r of results) expect(r.actions).toBeLessThan(MAX_ACTIONS);
        // C&K genuinely engaged: at least one barbarian attack resolved somewhere in the cell.
        expect(results.some((r) => (r.barbarianAttacks ?? 0) > 0)).toBe(true);
      });
    }
  }
});
