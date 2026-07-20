// cardMods modifier (T-904, docs/tasks/modifiers-cards-RESEARCH.md D1c "curated new dev-card
// types" + D1b "combined card plays"). Ships two independently dispatched, config-gated action
// types:
//   `playCardModCard`  — one of the 6 curated new dev-card TYPES (newCards.ts), mixed into the base
//                         deck like any other dev card.
//   `playCardModCombo` — one of the 5 curated "combined card play" one-shots (comboCards.ts), each
//                         consuming two existing base dev cards (or one Victory Point card) from
//                         hand in a single action.
// Neither needs `state.ext` — every card resolves immediately with no persistent/turn-scoped flags,
// so this module is the simplest possible shape: an `interceptAction` that recognizes its own two
// action types and falls through (`null`) to normal routing for everything else.
//
// PM WIRING (done): `ModifierId`/`ModifierConfigMap`/`AnyDevCardId`/the two `Action` members + zod
// schemas now live in packages/shared (types.ts, protocol/actions.ts); `registry.ts` registers this
// module; `devDeckAdditions` (below) folds `CARD_MOD_DEV_DECK_ADDITIONS` into the resolved dev deck
// additively (modules/index.ts's `resolveConstants`) — see that function's header for why additive,
// not the generic override every other `ModuleConstants` field uses. No `incompatibleWith`: nothing
// here touches C&K's progress-card/knight state, and a C&K game already disables ALL base dev-card
// actions outright (`DEV_CARDS_DISABLED`, C11.1) before routing ever reaches these — same "no-op
// while disabled" composition `playDevSameTurn.ts`'s header documents for the identical reason.
// Redaction: these 11 dev cards are exactly as hidden as the base 5 — no new redaction logic needed
// (a held `devCards[].type` of any of these ids is already opaque to other seats via the existing
// redaction rule for dev-card identities).

import type { RuleModule } from '../../types.js';
import { playCardModCombo } from './comboCards.js';
import { CARD_MOD_DEV_DECK_ADDITIONS, playCardModCard } from './newCards.js';

export { CARD_MOD_DEV_DECK_ADDITIONS, playCardModCard } from './newCards.js';
export { playCardModCombo } from './comboCards.js';
export type {
  CardModAction,
  CardModComboId,
  CardModDevCardId,
  CardModsConfig,
  PlayCardModCardAction,
  PlayCardModComboAction,
} from './types.js';

/**
 * The `cardMods` `RuleModule` — a plain constant, exactly like `friendlyRobberModule`/
 * `playDevSameTurnModule`/`harbormasterModule` (all param-less `true`-valued modifiers ignore their
 * config the same way; registry.ts wires them as `module: () => xModule`, never calling into a
 * factory).
 */
export const cardModsModule: RuleModule = {
  id: 'cardMods',
  constants: { devDeckAdditions: CARD_MOD_DEV_DECK_ADDITIONS },
  interceptAction(state, seat, action) {
    // Both action types are legal in exactly the same phases base dev-card plays are (R4.1):
    // preRoll or main. Every OTHER action type falls through untouched (`null`). Plain discriminated-
    // union narrowing on `action.type` — no cast needed now that both members are real `Action`s.
    if (action.type !== 'playCardModCard' && action.type !== 'playCardModCombo') return null;
    if (state.phase.kind !== 'preRoll' && state.phase.kind !== 'main') {
      return { ok: false, error: { code: 'WRONG_PHASE', message: 'dev-card plays are only legal in preRoll or main (R4.1)' } };
    }
    return action.type === 'playCardModCard'
      ? playCardModCard(state, seat, action)
      : playCardModCombo(state, seat, action);
  },
};
