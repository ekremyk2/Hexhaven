// Seafarers + Cities & Knights combined-game acceptance gate. This is the ONE supported multi-
// expansion combination (the official combined game; docs — Seafarers + C&K rules). Plays seeded
// combined games at both supported player counts (3 and 4) with the random-legal-move bot, asserting
// the config-aware base invariants (I1–I10) AND both expansions' clause invariants at once — the
// seafarers S-clauses (ships/islands/pirate) and the C&K C-clauses (commodities/knights/walls/
// barbarian/robber-lock/progress cards), which `simulate` runs whenever the respective ext block is
// present. `simulate` throws on the first violation or an I10 timeout, seed + action folded in.
//
// Two combo-specific corners this gate pins (both surfaced by the exploratory sim bundle):
//  - the robber-lock (C10.1) is asserted desert-AGNOSTICALLY here — the 3p Seafarers board has no
//    desert, so the lock means "never moves while locked", not "sits on the desert"
//    (citiesKnightsInvariants.ts);
//  - the C&K "Road Building" progress card is ship-aware on a Seafarers board (S11.1/S3.2), so it
//    never opens the free-placement sub-phase with only a sea edge legal and no ship (which would
//    soft-lock) — progressCards.ts `effectRoadBuilding`.

import { describe, expect, it } from 'vitest';
import type { GameConfig } from '@hexhaven/shared';
import { simulate } from './runGame.js';
import type { SimulateResult } from './runGame.js';

/** Games per player count. Smaller than the single-expansion gates (the combo is the widest action
 *  surface of all, so games are long) but still many independent seeds per cell. */
const GAMES_PER = 60;

/** Generous I10 cap — the combined game is the slowest to close (both expansions' subsystems cycle
 *  before a win), so well above the base 4,000, matching the seafarers/C&K gates. */
const MAX_ACTIONS = 15_000;

function comboConfig(playerCount: 3 | 4): Omit<GameConfig, 'seed'> {
  return {
    playerCount,
    // createGame resolves the real target (C&K 13-VP / the scenario's) — this only satisfies the type.
    targetVp: 10,
    board: 'random',
    tokenMethod: 'spiral',
    expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: true },
  };
}

describe('Seafarers + Cities & Knights combined game (the official multi-expansion combo)', () => {
  for (const playerCount of [3, 4] as const) {
    it(`plays ${GAMES_PER} full ${playerCount}-player games with all base + seafarers + C&K invariants holding`, () => {
      const results: SimulateResult[] = [];
      for (let i = 0; i < GAMES_PER; i++) {
        // Throws (failing this test, repro-ready) on any I1–I10 / seafarers / C&K invariant or I10 hit.
        results.push(simulate(`seack${playerCount}-${i}`, { config: comboConfig(playerCount), maxActions: MAX_ACTIONS }));
      }

      // Every game terminated within the cap.
      for (const r of results) expect(r.actions).toBeLessThan(MAX_ACTIONS);

      // Both expansions genuinely engaged across the cell (not just legal in principle): at least one
      // barbarian attack was resolved (C&K) and at least one ship was built (Seafarers) somewhere.
      expect(results.some((r) => (r.barbarianAttacks ?? 0) > 0)).toBe(true);
      expect(results.some((r) => (r.shipsBuilt ?? 0) > 0)).toBe(true);
    });
  }
});
