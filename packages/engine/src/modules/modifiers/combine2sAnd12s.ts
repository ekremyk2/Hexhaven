// combine2sAnd12s modifier (T-901 proof #2: a production-HOOK modifier, docs/07 D-034 / docs/
// tasks/phase-9/PICKS.md "combine 2s & 12s"). House rule: a roll of 2 ALSO produces the 12-token
// hexes, and a roll of 12 ALSO produces the 2-token hexes.
//
// Implemented as a `phaseHooks.afterAction` seam (the same seam Cities & Knights' commodity
// production uses, modules/citiesKnights/index.ts's `handleProductionRoll`) rather than a patch
// inside `phases/roll.ts` (forbidden — expansion readiness, docs/10 §3): after the base roll (or
// an expansion's own production hook) has already applied its production to `next`, this hook
// computes a SECOND production pass for the complementary total against `next`'s bank/board — so
// the two passes debit the bank sequentially and never double-spend the same stock — and merges
// the result in. `resolveModules` appends modifiers after expansion modules (registry.ts), so this
// hook always runs after any expansion's own `afterAction`, composing on top of whatever it left
// (fiveSix/seafarers unchanged resource semantics; Cities & Knights' commodity-adjusted city yield
// on forest/pasture/mountains is a known simplification not covered by this proof modifier).
// No-op unless enabled (RK-13): the hook only ever fires via this module, never consulted by a
// base game with no modules active.

import type { GameState, PlayerState, ResourceType } from '@hexhaven/shared';
import { production } from '../../events.js';
import { resolveConstants } from '../index.js';
import { computeProduction, type ProductionResult } from '../../rules/production.js';
import type { RuleModule } from '../types.js';

/** The OTHER total that also produces this roll (R5.1's complement, house-rule), or `null` when
 *  this roll isn't a 2 or a 12 (includes 7, which already skipped production entirely). */
function complementOf(total: number): number | null {
  if (total === 2) return 12;
  if (total === 12) return 2;
  return null;
}

/** Applies `extra`'s gains to `state.players`/`state.bank` — the identical bank-debit accounting
 *  `phases/roll.ts`'s base roll uses for its own production. */
function applyExtraGains(state: GameState, extra: ProductionResult): Pick<GameState, 'players' | 'bank'> {
  const bank = { ...state.bank };
  const players: PlayerState[] = state.players.map((p) => {
    const gain = extra.gains.find((g) => g.seat === p.seat);
    if (!gain) return p;
    const resources = { ...p.resources };
    for (const res of Object.keys(gain.resources) as ResourceType[]) {
      const amt = gain.resources[res] ?? 0;
      resources[res] += amt;
      bank[res] -= amt;
    }
    return { ...p, resources };
  });
  return { players, bank };
}

export const combine2sAnd12sModule: RuleModule = {
  id: 'combine2sAnd12s',
  phaseHooks: {
    afterAction(_prev, next, action, events) {
      if (action.type !== 'rollDice') return null;
      const roll = next.turn.roll;
      if (!roll) return null;
      const complement = complementOf(roll[0] + roll[1]);
      if (complement === null) return null;

      // T-906 (docs/07 D-034 `customConstants.productionMultiplier`): composes with this house rule
      // too — absent (the base default) leaves this pass multiplied by 1, bit-identical (RK-13).
      const multiplier = resolveConstants(next.config).productionMultiplier ?? 1;
      const extra = computeProduction(next, complement, multiplier);
      if (extra.gains.length === 0 && extra.shortages.length === 0) return null;

      const { players, bank } = applyExtraGains(next, extra);
      return {
        state: { ...next, players, bank },
        events: [...events, production(extra.gains, extra.shortages)],
      };
    },
  },
};
