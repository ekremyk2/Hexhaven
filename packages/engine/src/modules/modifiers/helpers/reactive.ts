// Reactive (non-`useHelper`) effects for Mayor and General (research §2) — both fire automatically
// off OTHER actions rather than a player-submitted `useHelper`:
//  - Mayor only sets up a one-rotation "eligible to grab a free card" flag after a dry roll; the
//    actual grab is still the player's choice of WHICH resource, via `useHelper{helper:'mayor'}`
//    (actions.ts's `useMayor` consumes the flag this sets).
//  - General is fully automatic: it silently waives the R6.1 discard for any seat holding it,
//    filtering them out of the `discard` sub-phase's `pending` list before anyone even sees a
//    discard prompt. No action variant exists for it at all.

import type { Action, GameEvent, GameState, Seat } from '@hexhaven/shared';
import { helpersExt } from './state.js';
import type { HelperId } from './types.js';

function holds(state: GameState, seat: Seat, helper: HelperId): boolean {
  return helpersExt(state)?.bySeat[seat]?.id === helper;
}

/**
 * Mayor (research §2 "when a die roll earns you no resources, take any 1 resource card"): after a
 * non-7 roll (the only kind that produces a `production` event), flag every Mayor-holding seat NOT
 * present in that event's `gains` (i.e. this roll paid them nothing) as eligible. Returns the SAME
 * `state` reference when nothing changes (no Mayor holder went dry this roll).
 */
export function applyMayorEligibility(
  state: GameState,
  action: Action,
  events: readonly GameEvent[]
): GameState {
  if (action.type !== 'rollDice') return state;
  const ext = helpersExt(state);
  if (!ext) return state;
  const prod = events.find((e): e is Extract<GameEvent, { type: 'production' }> => e.type === 'production');
  if (!prod) return state; // a rolled 7 never produces
  const gainedSeats = new Set(prod.gains.map((g) => g.seat));

  let changed = false;
  const mayorEligible = ext.mayorEligible.slice();
  for (const p of state.players) {
    if (!gainedSeats.has(p.seat) && holds(state, p.seat, 'mayor') && !mayorEligible[p.seat]) {
      mayorEligible[p.seat] = true;
      changed = true;
    }
  }
  if (!changed) return state;
  return { ...state, ext: { ...state.ext, helpers: { ...ext, mayorEligible } } };
}

/**
 * General (research §2 "on a 7, if you hold more than 7 cards you do not discard"): the instant the
 * `discard` sub-phase is open, strip every General-holding seat out of `pending` (zeroing their
 * owed amount) — they never see a discard prompt at all. If that empties `pending`, redirects
 * straight to `moveRobber` exactly like the natural R6.1→R6.2 handoff (phases/robber.ts's
 * `discardHandler`): discards only ever follow a rolled 7, whose `moveRobber` always carries
 * `returnTo:'main'`. Safe to call on every action — once the General holders are already filtered
 * out, a repeat call finds nothing left to waive and returns `null`.
 */
export function applyGeneralDiscardWaiver(
  state: GameState
): { state: GameState; events: GameEvent[] } | null {
  if (state.phase.kind !== 'discard') return null;
  const phase = state.phase;
  const waived = phase.pending.filter((s) => holds(state, s, 'general'));
  if (waived.length === 0) return null;

  const pending = phase.pending.filter((s) => !waived.includes(s));
  const amounts = { ...phase.amounts };
  for (const s of waived) amounts[s] = 0;

  if (pending.length === 0) {
    return { state: { ...state, phase: { kind: 'moveRobber', returnTo: 'main' } }, events: [] };
  }
  return { state: { ...state, phase: { ...phase, pending, amounts } }, events: [] };
}
