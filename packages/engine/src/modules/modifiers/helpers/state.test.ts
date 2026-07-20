// Unit tests for the `ext.helpers` lifecycle primitives (T-905): lazy init determinism, the
// initial deal, the A/B use→flip→return→redeal cycle, voluntary swaps, the once-per-rotation
// guard reset, and the `canUseHelper` eligibility gate. Crafted directly on `stateWith` states —
// no `resolveModules`/`reduce` involved (the modifier isn't wired into those yet).

import { describe, expect, it } from 'vitest';
import { stateWith } from '../../../testkit.js';
import {
  canUseHelper,
  dealNextHelper,
  ensureHelpersExt,
  finishHelperUse,
  helpersExt,
  resetForNewTurn,
  swapHelper,
} from './state.js';
import { HELPER_IDS } from './types.js';

describe('ensureHelpersExt', () => {
  it('creates a full display (all 10 helpers) + per-seat arrays, and is a no-op once created', () => {
    const state = stateWith();
    const ensured = ensureHelpersExt(state);
    const ext = helpersExt(ensured)!;
    expect(ext.display.slice().sort()).toEqual([...HELPER_IDS].sort());
    expect(ext.bySeat).toEqual([null, null, null, null]);
    expect(ext.usedThisTurn).toEqual([false, false, false, false]);
    expect(ext.mayorEligible).toEqual([false, false, false, false]);
    expect(ext.captainRate).toEqual([null, null, null, null]);

    const again = ensureHelpersExt(ensured);
    expect(again).toBe(ensured); // same reference — no-op
  });

  it('is deterministic per seed (same rng in, same shuffled display out)', () => {
    const a = ensureHelpersExt(stateWith());
    const b = ensureHelpersExt(stateWith());
    expect(helpersExt(a)!.display).toEqual(helpersExt(b)!.display);
  });

  it('advances state.rng (consumes a draw), so downstream randomness still differs from unshuffled', () => {
    const state = stateWith();
    const ensured = ensureHelpersExt(state);
    expect(ensured.rng).not.toBe(state.rng);
  });
});

describe('dealNextHelper', () => {
  it('deals the front of the display to a seat, side A, acquired this turn', () => {
    const state = ensureHelpersExt(stateWith());
    const front = helpersExt(state)!.display[0]!;
    const result = dealNextHelper(state, 0);
    expect(result.helper).toBe(front);
    const ext = helpersExt(result.state)!;
    expect(ext.bySeat[0]).toEqual({ id: front, side: 'A', acquiredTurn: state.turn.number });
    expect(ext.display).not.toContain(front);
    expect(ext.display.length).toBe(9);
  });

  it('is a no-op if the seat already holds a helper', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const again = dealNextHelper(dealt.state, 0);
    expect(again.helper).toBeNull();
    expect(again.state).toBe(dealt.state);
  });
});

describe('swapHelper', () => {
  it('returns the current helper to the display and takes the named one, side A, this turn', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const held = helpersExt(dealt.state)!.bySeat[0]!.id;
    const other = helpersExt(dealt.state)!.display[0]!;

    const swapped = swapHelper(dealt.state, 0, other);
    expect(swapped.ok).toBe(true);
    const ext = helpersExt(swapped.state)!;
    expect(ext.bySeat[0]).toEqual({ id: other, side: 'A', acquiredTurn: dealt.state.turn.number });
    expect(ext.display).toContain(held); // the old one went back to the display
    expect(ext.display).not.toContain(other);
  });

  it('fails when the named helper is not currently in the display', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const held = helpersExt(dealt.state)!.bySeat[0]!.id;
    const result = swapHelper(dealt.state, 0, held); // the seat's OWN helper is never in the display
    expect(result.ok).toBe(false);
    expect(result.state).toBe(dealt.state);
  });
});

describe('finishHelperUse: the A/B lifecycle (research §3)', () => {
  it('a side-A use flips to side B, keeping the same helper, and marks usedThisTurn', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const held = helpersExt(dealt.state)!.bySeat[0]!.id;
    const finished = finishHelperUse(dealt.state, 0);
    expect(finished.side).toBe('A');
    expect(finished.redealtTo).toBeNull();
    const ext = helpersExt(finished.state)!;
    expect(ext.bySeat[0]).toMatchObject({ id: held, side: 'B' });
    expect(ext.usedThisTurn[0]).toBe(true);
  });

  it('a side-B use returns the helper to the display and deals a fresh side-A one', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const held = helpersExt(dealt.state)!.bySeat[0]!.id;
    const afterA = finishHelperUse(dealt.state, 0).state; // now side B
    const finished = finishHelperUse(afterA, 0);
    expect(finished.side).toBe('B');
    expect(finished.redealtTo).not.toBeNull();
    expect(finished.redealtTo).not.toBe(held);
    const ext = helpersExt(finished.state)!;
    expect(ext.bySeat[0]?.id).toBe(finished.redealtTo);
    expect(ext.bySeat[0]?.side).toBe('A');
    expect(ext.display).toContain(held); // the spent helper is back in the display
  });
});

describe('resetForNewTurn', () => {
  it('clears usedThisTurn/mayorEligible/captainRate for EVERY seat', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const used = finishHelperUse(dealt.state, 0).state; // usedThisTurn[0] = true
    const ext = helpersExt(used)!;
    const flagged = {
      ...ext,
      mayorEligible: [true, true, false, false],
      captainRate: ['brick', null, null, null] as (typeof ext.captainRate)[number][],
    };
    const flaggedState: typeof used = { ...used, ext: { ...used.ext, helpers: flagged } };

    const reset = resetForNewTurn(flaggedState);
    const resetExt = helpersExt(reset)!;
    expect(resetExt.usedThisTurn).toEqual([false, false, false, false]);
    expect(resetExt.mayorEligible).toEqual([false, false, false, false]);
    expect(resetExt.captainRate).toEqual([null, null, null, null]);
    // The A/B assignment itself is untouched by a rotation reset.
    expect(resetExt.bySeat[0]).toEqual(ext.bySeat[0]);
  });
});

describe('canUseHelper', () => {
  it('false before ext.helpers exists', () => {
    expect(canUseHelper(stateWith(), 0, 'mayor')).toBe(false);
  });

  it('false when the seat holds a DIFFERENT helper', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const held = helpersExt(dealt.state)!.bySeat[0]!.id;
    const other = HELPER_IDS.find((h) => h !== held)!;
    expect(canUseHelper(dealt.state, 0, other)).toBe(false);
  });

  it('false the very turn the helper was received', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const held = helpersExt(dealt.state)!.bySeat[0]!.id;
    expect(dealt.state.turn.number).toBeDefined();
    expect(canUseHelper(dealt.state, 0, held)).toBe(false);
  });

  it('false once already used this rotation, true again after resetForNewTurn', () => {
    const dealt = dealNextHelper(ensureHelpersExt(stateWith()), 0);
    const held = helpersExt(dealt.state)!.bySeat[0]!.id;
    // Bump acquiredTurn into the past so the "same turn" guard doesn't also block it.
    const later = {
      ...dealt.state,
      ext: {
        ...dealt.state.ext,
        helpers: {
          ...helpersExt(dealt.state)!,
          bySeat: helpersExt(dealt.state)!.bySeat.map((a, i) => (i === 0 ? { ...a!, acquiredTurn: -1 } : a)),
        },
      },
    } as typeof dealt.state;
    expect(canUseHelper(later, 0, held)).toBe(true);

    const used = finishHelperUse(later, 0).state;
    expect(canUseHelper(used, 0, held)).toBe(false); // now side B, but usedThisTurn just got set

    const reset = resetForNewTurn(used);
    expect(canUseHelper(reset, 0, held)).toBe(true);
  });
});
