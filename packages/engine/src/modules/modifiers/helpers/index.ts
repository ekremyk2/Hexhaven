// "The Helpers of Hexhaven" modifier (T-905, docs/tasks/modifiers-helpers-RESEARCH.md). One helper
// card per seat, dealt as each player places their SECOND setup settlement (research §3), each
// granting a special ability fireable at most once per turn-rotation. PM WIRING (done): `useHelper`/
// `swapHelper` are real `Action` members and `helperDealt`/`helperUsed`/`helperSwapped` are real
// `GameEvent` members (packages/shared/src/types.ts) — `asHelperAction` below is now a plain
// discriminated-union narrow, no `unknown` cast.
//
// Merchant and Priest are flagged the two trickiest helpers (research §6) — see actions.ts for the
// specific simplifications each takes; the other 7 (+ General, fully reactive) are straightforward.
//
// Composition: research §3 — helpers may not fire during a 5-6 Special Building Phase, enforced
// below before any dispatch. Nothing here special-cases Cities & Knights; Priest/Architect simply
// become unusable in a C&K game once `citiesKnights` disables the base dev-card actions
// (`DEV_CARDS_DISABLED`) and there is no `knight` DEV CARD to discard — a design call flagged for
// the PM rather than a hard hard-coded incompatibility (see registry.ts's entry for this modifier).

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../../reduce.js';
import { err } from '../../../reduce.js';
import type { RuleModule } from '../../types.js';
import {
  captainBankTrade,
  useArchitect,
  useArchitectBeginPeek,
  useCaptain,
  useExplorer,
  useMayor,
  useMendicant,
  useMerchant,
  useNoblewoman,
  usePriest,
  useRobberBride,
} from './actions.js';
import { asGameEvent, helperDealt, helperSwapped } from './events.js';
import { applyGeneralDiscardWaiver, applyMayorEligibility } from './reactive.js';
import { dealNextHelper, ensureHelpersExt, helpersExt, resetForNewTurn, swapHelper } from './state.js';
import type { HelperAction } from './types.js';

/** Plain discriminated-union narrow on `action.type` — both members are real `Action`s now. */
function asHelperAction(action: Action): HelperAction | null {
  return action.type === 'useHelper' || action.type === 'swapHelper' ? action : null;
}

function dispatchHelperAction(state: GameState, seat: Seat, action: HelperAction): EngineResult {
  if (action.type === 'swapHelper') {
    const gave = helpersExt(state)?.bySeat[seat]?.id ?? null;
    const result = swapHelper(state, seat, action.take);
    if (!result.ok) return err('NOT_A_CANDIDATE', `helper ${action.take} is not currently in the display`);
    return { ok: true, state: result.state, events: [asGameEvent(helperSwapped(seat, gave, action.take))] };
  }

  switch (action.helper) {
    case 'mayor':
      return useMayor(state, seat, action.resource);
    case 'explorer':
      return useExplorer(state, seat, action.from, action.to);
    case 'mendicant':
      return useMendicant(state, seat, action.edge, action.replace, action.substitute);
    case 'robberBride':
      return useRobberBride(state, seat, action.target);
    case 'merchant':
      return useMerchant(state, seat, action.targets, action.demand, action.giveBack);
    case 'captain':
      return useCaptain(state, seat, action.resource);
    case 'noblewoman':
      return useNoblewoman(state, seat, action.target);
    case 'architect':
      // Peek reveal (redact.ts hidden-info UX fix): `beginPeek` reveals the real top-3 to the
      // acting seat's view; the (unchanged) commit shape takes over once `beginPeek` is absent/false.
      return action.beginPeek === true
        ? useArchitectBeginPeek(state, seat)
        : useArchitect(state, seat, action.pick, action.replace, action.substitute);
    case 'priest':
      return usePriest(state, seat, action.build, action.vertex);
    default: {
      // Exhaustiveness check: a new `UseHelperAction` member without a `case` above fails to
      // compile here rather than silently falling through at runtime.
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/**
 * Pre-routing interception (docs/10 §3): handles `useHelper`/`swapHelper` entirely (the base engine
 * has no route for either — PM WIRING will widen `Action`, but this module works standalone even
 * before that), and reroutes a `bankTrade` matching the seat's active Captain rate to
 * `captainBankTrade`. `null` for everything else, falling through to normal routing untouched.
 */
function interceptAction(state: GameState, seat: Seat, action: Action): EngineResult | null {
  const helperAction = asHelperAction(action);
  if (helperAction) {
    if (state.phase.kind === 'specialBuild') {
      return err('WRONG_PHASE', 'helpers may not be used during the Special Building Phase (research §3)');
    }
    return dispatchHelperAction(ensureHelpersExt(state), seat, helperAction);
  }

  if (action.type === 'bankTrade') {
    const rate = helpersExt(state)?.captainRate[seat];
    if (rate && rate === action.give) {
      return captainBankTrade(state, seat, action.give, action.receive);
    }
  }

  return null;
}

/**
 * `seat` may submit `useHelper{helper:'mayor'}` even on another seat's turn (research §2: Mayor
 * reacts to ANY roll, not just the holder's own) — every other helper stays turn-owner-only via the
 * base actor guard (unchanged).
 */
function isActorAllowed(_state: GameState, _seat: Seat, action: Action): boolean {
  const helperAction = asHelperAction(action);
  return helperAction?.type === 'useHelper' && helperAction.helper === 'mayor';
}

/**
 * Post-action bookkeeping (docs/10 §3), in order: (1) lazily create `ext.helpers` on the very first
 * action this module ever sees (the `initState` substitute — see state.ts); (2) the initial deal,
 * the instant a seat's SECOND setup settlement lands; (3) Mayor's dry-roll eligibility flag;
 * (4) General's automatic discard waiver; (5) the once-per-rotation guard reset on a genuine turn
 * advance. Returns `null` (no-op) only when NONE of these ever fire, which never happens once
 * `ext.helpers` needs creating — so in practice this always returns a replacement on turn 1.
 */
function afterAction(
  prev: GameState,
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  actingSeat: Seat
): { state: GameState; events: GameEvent[] } | null {
  let state = ensureHelpersExt(next);
  let changed = state !== next;
  const outEvents: GameEvent[] = [...events];

  if (
    action.type === 'placeSetupSettlement' &&
    state.phase.kind === 'setup' &&
    state.phase.round === 2 &&
    state.phase.expect === 'road'
  ) {
    const dealt = dealNextHelper(state, actingSeat);
    if (dealt.helper) {
      state = dealt.state;
      outEvents.push(asGameEvent(helperDealt(actingSeat, dealt.helper)));
      changed = true;
    }
  }

  const withMayor = applyMayorEligibility(state, action, outEvents);
  if (withMayor !== state) {
    state = withMayor;
    changed = true;
  }

  const waived = applyGeneralDiscardWaiver(state);
  if (waived) {
    state = waived.state;
    changed = true;
  }

  if (next.turn.number !== prev.turn.number) {
    state = resetForNewTurn(state);
    changed = true;
  }

  return changed ? { state, events: outEvents } : null;
}

export const helpersModule: RuleModule = {
  id: 'helpers',
  interceptAction,
  isActorAllowed,
  phaseHooks: { afterAction },
};
