import { describe, expect, it } from 'vitest';
import type { ResourceBundle, ResourceType } from '@hexhaven/shared';
import { autoDiscardBundle, canConfirmDiscard, selectionTotal, stepSelection } from './discardLogic';

const HAND: Record<ResourceType, number> = { brick: 1, lumber: 3, wool: 0, grain: 2, ore: 4 };

describe('selectionTotal / canConfirmDiscard (requirement 1: exact-N confirm gate)', () => {
  it('sums a sparse selection, treating absent keys as 0', () => {
    expect(selectionTotal({ brick: 2, ore: 1 })).toBe(3);
    expect(selectionTotal({})).toBe(0);
  });

  it('confirm is disabled below, above, and exactly at 0 required; enabled only at exact N', () => {
    expect(canConfirmDiscard({ brick: 1, lumber: 2 }, 4)).toBe(false); // 3 < 4
    expect(canConfirmDiscard({ brick: 1, lumber: 2, ore: 2 }, 4)).toBe(false); // 5 > 4
    expect(canConfirmDiscard({ brick: 1, lumber: 3 }, 4)).toBe(true); // exactly 4
    expect(canConfirmDiscard({}, 0)).toBe(false); // never confirmable with nothing owed
  });
});

describe('stepSelection (requirement 1: per-resource stepper capped by hand)', () => {
  it('increments up to the cap and no further', () => {
    let s: ResourceBundle = {};
    s = stepSelection(s, 'brick', 1, 1);
    expect(s).toEqual({ brick: 1 });
    s = stepSelection(s, 'brick', 1, 1); // already at cap 1 — no-op
    expect(s).toEqual({ brick: 1 });
  });

  it('decrements down to 0 and drops the key entirely (never leaves a zero-value entry)', () => {
    let s: ResourceBundle = { brick: 1 };
    s = stepSelection(s, 'brick', -1, 4);
    expect(s).toEqual({});
    // decrementing again from empty stays at 0, still no key
    s = stepSelection(s, 'brick', -1, 4);
    expect(s).toEqual({});
  });

  it('never mutates the input selection object', () => {
    const original = { lumber: 1 };
    const next = stepSelection(original, 'lumber', 1, 3);
    expect(original).toEqual({ lumber: 1 });
    expect(next).toEqual({ lumber: 2 });
  });
});

describe('autoDiscardBundle (requirement 1: "auto" = largest counts first, T-206-consistent)', () => {
  it('always takes from whichever resource is currently the largest pile', () => {
    // HAND: ore(4) > lumber(3) > grain(2) > brick(1) > wool(0). Re-evaluated every step, so the
    // pile sizes interleave: ore(4→3), tie ore/lumber(3/3)→lumber wins the tie(3→2),
    // ore(3)>lumber(2)→ore(3→2), tie ore/lumber(2/2)→lumber wins the tie(2→1).
    const bundle = autoDiscardBundle(HAND, 4);
    expect(selectionTotal(bundle)).toBe(4);
    expect(bundle).toEqual({ ore: 2, lumber: 2 });
  });

  it('breaks ties by resource priority order (brick > lumber > wool > grain > ore)', () => {
    const tiedHand: Record<ResourceType, number> = { brick: 2, lumber: 2, wool: 0, grain: 0, ore: 0 };
    const bundle = autoDiscardBundle(tiedHand, 2);
    // Both start tied at 2 -> brick wins the first pick (priority order); after brick drops to 1,
    // lumber (still 2) is picked next.
    expect(bundle).toEqual({ brick: 1, lumber: 1 });
  });

  it('never exceeds what the hand actually holds for any resource', () => {
    const bundle = autoDiscardBundle(HAND, 4);
    for (const [res, count] of Object.entries(bundle) as [ResourceType, number][]) {
      expect(count).toBeLessThanOrEqual(HAND[res]);
    }
  });

  it('stops early (defensively) if owed somehow exceeds the total hand', () => {
    const smallHand: Record<ResourceType, number> = { brick: 1, lumber: 0, wool: 0, grain: 0, ore: 0 };
    expect(autoDiscardBundle(smallHand, 5)).toEqual({ brick: 1 });
  });
});
