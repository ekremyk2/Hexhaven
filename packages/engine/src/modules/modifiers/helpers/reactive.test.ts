// Unit tests for the two fully-automatic helpers (T-905): Mayor's dry-roll eligibility flag and
// General's discard waiver. Neither has a `useHelper` action of its own (Mayor's actual grab is
// tested in actions.test.ts) — these hooks are exercised directly, mirroring how index.ts's
// `afterAction` calls them.

import { describe, expect, it } from 'vitest';
import type { Action, GameEvent, Seat } from '@hexhaven/shared';
import { stateWith } from '../../../testkit.js';
import { applyGeneralDiscardWaiver, applyMayorEligibility } from './reactive.js';
import { dealNextHelper, ensureHelpersExt, helpersExt } from './state.js';
import type { HelperId } from './types.js';

/** A `stateWith` base with `seat` already holding `helper` (side A, dealt on a past turn so the
 *  "same turn you received it" guard never interferes with these reactive-hook tests). */
function withHelper(seat: Seat, helper: HelperId) {
  const ensured = ensureHelpersExt(stateWith());
  const ext = helpersExt(ensured)!;
  const bySeat = ext.bySeat.slice();
  bySeat[seat] = { id: helper, side: 'A', acquiredTurn: -1 };
  return { ...ensured, ext: { ...ensured.ext, helpers: { ...ext, bySeat } } } as typeof ensured;
}

/** A full 6-seat `Record<Seat, number>` (the discard phase's `amounts` shape), zero except the
 *  seats named in `over` — mirrors `phases/roll.ts`'s `zeroSeatAmounts`. */
function fullAmounts(over: Partial<Record<Seat, number>>): Record<Seat, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...over };
}

describe('applyMayorEligibility', () => {
  const roll: Action = { type: 'rollDice' };

  it('flags a Mayor-holding seat absent from the production gains (a dry roll)', () => {
    const state = withHelper(1, 'mayor');
    const events: GameEvent[] = [
      { type: 'production', gains: [{ seat: 0, resources: { brick: 1 } }], shortages: [] },
    ];
    const flagged = applyMayorEligibility(state, roll, events);
    expect(helpersExt(flagged)!.mayorEligible[1]).toBe(true);
    expect(helpersExt(flagged)!.mayorEligible[0]).toBe(false);
  });

  it('does NOT flag a Mayor-holding seat that DID gain this roll (same-reference no-op)', () => {
    const state = withHelper(0, 'mayor');
    const events: GameEvent[] = [
      { type: 'production', gains: [{ seat: 0, resources: { brick: 1 } }], shortages: [] },
    ];
    expect(applyMayorEligibility(state, roll, events)).toBe(state);
  });

  it('is a no-op for a non-rollDice action, and for a rolled 7 (no production event at all)', () => {
    const state = withHelper(0, 'mayor');
    expect(applyMayorEligibility(state, { type: 'endTurn' }, [])).toBe(state);
    const sevenEvents: GameEvent[] = [{ type: 'diceRolled', seat: 0, roll: [3, 4] }];
    expect(applyMayorEligibility(state, roll, sevenEvents)).toBe(state);
  });

  it('is a no-op before ext.helpers exists', () => {
    const bare = stateWith();
    expect(applyMayorEligibility(bare, roll, [])).toBe(bare);
  });
});

describe('applyGeneralDiscardWaiver', () => {
  it('filters a General-holding pending seat out, zeroing their owed amount', () => {
    const state = {
      ...withHelper(1, 'general'),
      phase: { kind: 'discard' as const, pending: [1, 2] as Seat[], amounts: fullAmounts({ 1: 5, 2: 4 }) },
    };
    const result = applyGeneralDiscardWaiver(state);
    expect(result).not.toBeNull();
    expect(result!.state.phase).toEqual({
      kind: 'discard',
      pending: [2],
      amounts: fullAmounts({ 1: 0, 2: 4 }),
    });
  });

  it('redirects straight to moveRobber(returnTo:main) when waiving empties pending', () => {
    const state = {
      ...withHelper(1, 'general'),
      phase: { kind: 'discard' as const, pending: [1] as Seat[], amounts: fullAmounts({ 1: 5 }) },
    };
    const result = applyGeneralDiscardWaiver(state);
    expect(result!.state.phase).toEqual({ kind: 'moveRobber', returnTo: 'main' });
  });

  it('is a no-op outside the discard phase', () => {
    expect(applyGeneralDiscardWaiver(withHelper(1, 'general'))).toBeNull();
  });

  it('is a no-op when nobody pending holds General', () => {
    const state = {
      ...ensureHelpersExt(stateWith()),
      phase: { kind: 'discard' as const, pending: [1] as Seat[], amounts: fullAmounts({ 1: 5 }) },
    };
    expect(applyGeneralDiscardWaiver(state)).toBeNull();
  });

  it('a second call after the first is a no-op (idempotent — nothing left to waive)', () => {
    const state = {
      ...withHelper(1, 'general'),
      phase: { kind: 'discard' as const, pending: [1, 2] as Seat[], amounts: fullAmounts({ 1: 5, 2: 4 }) },
    };
    const once = applyGeneralDiscardWaiver(state)!;
    expect(applyGeneralDiscardWaiver(once.state)).toBeNull();
  });
});

// Sanity: dealNextHelper is exercised more thoroughly in state.test.ts; this just confirms the
// `withHelper` test fixture above lines up with the real deal path's shape.
describe('withHelper fixture sanity', () => {
  it('matches the shape dealNextHelper produces (minus acquiredTurn, forced to -1 here)', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    expect(helpersExt(dealt.state)!.bySeat[0]).toMatchObject({ side: 'A' });
  });
});
