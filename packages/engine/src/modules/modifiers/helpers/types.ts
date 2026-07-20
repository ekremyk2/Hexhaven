// Local types for "The Helpers of Hexhaven" modifier (T-905, docs/tasks/modifiers-helpers-RESEARCH.md).
// PM WIRING (done): `HelperId`/`HelperAssignment`/`HelpersExt`/`UseHelperAction`/`SwapHelperAction`
// now live in packages/shared/src/types.ts (the real `Action`/`GameState.ext` unions) — re-exported
// here (plus derived local aliases) so every sibling file in this folder keeps importing from
// `./types.js` unchanged.
//
// Merchant and Priest are flagged the two trickiest helpers (research §6) — see actions.ts for the
// specific simplifications each takes; the other 7 (+ General, fully reactive) are straightforward.

import type { Action, GameEvent } from '@hexhaven/shared';

export type { HelperId, HelperAssignment, HelpersExt, UseHelperAction, SwapHelperAction } from '@hexhaven/shared';
import type { HelperId } from '@hexhaven/shared';

/** Deal/draft order (research §3): the shared display starts as this list, shuffled once per game
 *  via the seeded rng (see `state.ts`'s `ensureHelpersExt`) — never `Math.random` (docs/05 §2). */
export const HELPER_IDS: readonly HelperId[] = [
  'mayor',
  'general',
  'explorer',
  'mendicant',
  'robberBride',
  'merchant',
  'captain',
  'noblewoman',
  'architect',
  'priest',
];

/** The real `Action` union narrowed to this modifier's two members — a plain derived alias (no
 *  duplicate shape to keep in sync now that both are real `Action` members). */
export type HelperAction = Extract<Action, { type: 'useHelper' | 'swapHelper' }>;

/** The real `GameEvent` union narrowed to this modifier's three members. */
export type HelperDealtEvent = Extract<GameEvent, { type: 'helperDealt' }>;
export type HelperUsedEvent = Extract<GameEvent, { type: 'helperUsed' }>;
export type HelperSwappedEvent = Extract<GameEvent, { type: 'helperSwapped' }>;
export type HelperEvent = HelperDealtEvent | HelperUsedEvent | HelperSwappedEvent;
