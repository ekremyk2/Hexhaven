// `state.ext.helpers` lifecycle helpers (T-905): lazy init, the initial deal + A/B use/return/
// redeal lifecycle, voluntary swaps, and the once-per-rotation guard reset. All pure — every
// function returns a NEW state (or the SAME reference when nothing changed), never mutates `state`.

import type { GameState, Seat } from '@hexhaven/shared';
import { shuffle } from '../../../rng.js';
import { HELPER_IDS } from './types.js';
import type { HelperId, HelpersExt } from './types.js';

/** Reads `state.ext.helpers`, or `undefined` before `ensureHelpersExt` has run once (or when the
 *  modifier is inactive — this module is simply never in `activeModules`, so nothing ever calls it). */
export function helpersExt(state: GameState): HelpersExt | undefined {
  return state.ext?.helpers;
}

function withHelpersExt(state: GameState, ext: HelpersExt): GameState {
  return { ...state, ext: { ...state.ext, helpers: ext } };
}

/**
 * Lazily initializes `ext.helpers` the first time this module's `afterAction` hook ever sees
 * `state` — the config-gate substitute for a dedicated `initState` hook, which `RuleModule`
 * (modules/types.ts) doesn't define. Shuffles the display via the seeded rng (docs/05 §2 — never
 * `Math.random`), so it is deterministic per seed. A no-op (same reference) once `ext.helpers`
 * already exists.
 */
export function ensureHelpersExt(state: GameState): GameState {
  if (helpersExt(state)) return state;
  const n = state.config.playerCount;
  const shuffled = shuffle(state.rng, HELPER_IDS);
  const ext: HelpersExt = {
    display: shuffled.array,
    bySeat: Array.from({ length: n }, () => null),
    usedThisTurn: Array.from({ length: n }, () => false),
    mayorEligible: Array.from({ length: n }, () => false),
    captainRate: Array.from({ length: n }, () => null),
    // Architect peek reveal (redact.ts hidden-info UX fix): no pending peeks at game start.
    architectPeek: Array.from({ length: n }, () => null),
  };
  return withHelpersExt({ ...state, rng: shuffled.state }, ext);
}

/**
 * Deals the next display helper to `seat` (the initial deal on their 2nd setup settlement, or the
 * automatic re-deal after a B-side use — research §3). `helper: null` means nothing happened
 * (`ext.helpers` missing, the display is empty — never true with 10 helpers ≤ 6 players — or `seat`
 * already holds one).
 */
export function dealNextHelper(state: GameState, seat: Seat): { state: GameState; helper: HelperId | null } {
  const ext = helpersExt(state);
  if (!ext) return { state, helper: null };
  if (ext.bySeat[seat] != null) return { state, helper: null };
  const next = ext.display[0];
  if (next === undefined) return { state, helper: null };
  const bySeat = ext.bySeat.slice();
  bySeat[seat] = { id: next, side: 'A', acquiredTurn: state.turn.number };
  const display = ext.display.slice(1);
  return { state: withHelpersExt(state, { ...ext, display, bySeat }), helper: next };
}

/** Returns `seat`'s current helper to the back of the display and clears their assignment. */
function returnHelper(state: GameState, seat: Seat): GameState {
  const ext = helpersExt(state);
  if (!ext) return state;
  const held = ext.bySeat[seat];
  if (!held) return state;
  const bySeat = ext.bySeat.slice();
  bySeat[seat] = null;
  const display = [...ext.display, held.id];
  return withHelpersExt(state, { ...ext, display, bySeat });
}

/**
 * Voluntary swap (research §3): return the current helper to the display and take a NAMED one
 * instead, side 'A', freshly "acquired" this turn. Does not touch `usedThisTurn`. `ok:false` when
 * `take` isn't currently in the display (including "it's the seat's own current helper" — a helper
 * only ever sits in the display OR a `bySeat` slot, never both).
 */
export function swapHelper(state: GameState, seat: Seat, take: HelperId): { state: GameState; ok: boolean } {
  const ext = helpersExt(state);
  if (!ext || !ext.display.includes(take)) return { state, ok: false };
  const returned = returnHelper(state, seat);
  const returnedExt = helpersExt(returned)!;
  const display = returnedExt.display.filter((h) => h !== take);
  const bySeat = returnedExt.bySeat.slice();
  bySeat[seat] = { id: take, side: 'A', acquiredTurn: returned.turn.number };
  return { state: withHelpersExt(returned, { ...returnedExt, display, bySeat }), ok: true };
}

/**
 * The A/B lifecycle after a successfully-executed use (research §3): a side-'A' use flips to 'B'
 * (same physical helper, kept); a side-'B' use returns it to the display and immediately deals a
 * fresh one (always dealt at side 'A'). Always marks `usedThisTurn[seat]`. Returns which side this
 * use just consumed and, if a re-deal happened, the new helper id — both purely for the caller's
 * event detail.
 */
export function finishHelperUse(
  state: GameState,
  seat: Seat
): { state: GameState; side: 'A' | 'B'; redealtTo: HelperId | null } {
  const ext = helpersExt(state);
  if (!ext) return { state, side: 'A', redealtTo: null };
  const held = ext.bySeat[seat];
  if (!held) return { state, side: 'A', redealtTo: null };

  const usedThisTurn = ext.usedThisTurn.slice();
  usedThisTurn[seat] = true;

  if (held.side === 'A') {
    const bySeat = ext.bySeat.slice();
    bySeat[seat] = { ...held, side: 'B' };
    return { state: withHelpersExt(state, { ...ext, usedThisTurn, bySeat }), side: 'A', redealtTo: null };
  }

  const marked = withHelpersExt(state, { ...ext, usedThisTurn });
  const returned = returnHelper(marked, seat);
  const redealt = dealNextHelper(returned, seat);
  return { state: redealt.state, side: 'B', redealtTo: redealt.helper };
}

/**
 * Once-per-turn-ROTATION reset (research §3 "no chaining"): clears every seat's `usedThisTurn` /
 * `mayorEligible` / `captainRate` whenever `turn.number` advances. Deliberately global (every seat,
 * not just the incoming turn owner) — several abilities (Mayor's dry-roll grab, most obviously)
 * react to OTHER players' rolls, not just the holder's own turn, so "once per turn" is modeled here
 * as "once per rotation of the dice" rather than "once between your own turns" (a simplification the
 * source material doesn't fully disambiguate — see the task report).
 */
export function resetForNewTurn(state: GameState): GameState {
  const ext = helpersExt(state);
  if (!ext) return state;
  const n = ext.usedThisTurn.length;
  return withHelpersExt(state, {
    ...ext,
    usedThisTurn: Array.from({ length: n }, () => false),
    mayorEligible: Array.from({ length: n }, () => false),
    captainRate: Array.from({ length: n }, () => null),
    // Peek reveal hygiene (redact.ts hidden-info UX fix): a pending Architect peek never outlives
    // the turn-rotation it was requested on, same discipline as the fields above.
    architectPeek: Array.from({ length: n }, () => null),
  });
}

/** Common eligibility gate for every `useHelper` action (research §3): `seat` must hold `helper`
 *  right now, not have used a helper already this rotation, and not be the very turn they received
 *  it ("you can never use a helper the same turn you received it"). */
export function canUseHelper(state: GameState, seat: Seat, helper: HelperId): boolean {
  const ext = helpersExt(state);
  if (!ext) return false;
  const held = ext.bySeat[seat];
  if (!held || held.id !== helper) return false;
  if (ext.usedThisTurn[seat]) return false;
  if (held.acquiredTurn === state.turn.number) return false;
  return true;
}
