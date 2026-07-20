import { describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import type { DiscardedEvent, StolenEvent } from './toastFormat';
import { planDiscardToast, planStealToast } from './toastFormat';

const ME = 0 as Seat;
const OTHER = 1 as Seat;
const ANOTHER = 2 as Seat;

describe('planDiscardToast (ER-9: own = types, others = count only)', () => {
  it('own discard (full cards event) -> self variant carrying the real bundle', () => {
    const ev = { type: 'discarded', seat: ME, cards: { lumber: 2, ore: 1 } } as DiscardedEvent;
    expect(planDiscardToast(ev, ME)).toEqual({ variant: 'self', cards: { lumber: 2, ore: 1 } });
  });

  it("someone else's discard, already redacted to a count -> other variant with that count", () => {
    const ev = { type: 'discarded', seat: OTHER, count: 4 } as DiscardedEvent;
    expect(planDiscardToast(ev, ME)).toEqual({ variant: 'other', seat: OTHER, count: 4 });
  });

  it('defensively derives the count from a full bundle too, if one somehow arrives for another seat', () => {
    const ev = { type: 'discarded', seat: OTHER, cards: { brick: 1, wool: 1 } } as DiscardedEvent;
    expect(planDiscardToast(ev, ME)).toEqual({ variant: 'other', seat: OTHER, count: 2 });
  });
});

describe('planStealToast (ER-10: thief/victim see the card, others see only that one moved)', () => {
  it('thief perspective (mySeat === to) -> thief variant with the victim + real card', () => {
    const ev = { type: 'stolen', from: OTHER, to: ME, card: 'wool' } as StolenEvent;
    expect(planStealToast(ev, ME)).toEqual({ variant: 'thief', victim: OTHER, card: 'wool' });
  });

  it('victim perspective (mySeat === from) -> victim variant with the thief + real card', () => {
    const ev = { type: 'stolen', from: ME, to: OTHER, card: 'grain' } as StolenEvent;
    expect(planStealToast(ev, ME)).toEqual({ variant: 'victim', thief: OTHER, card: 'grain' });
  });

  it('bystander perspective -> other variant, never carrying the card even if present', () => {
    const ev = { type: 'stolen', from: OTHER, to: ANOTHER, card: 'ore' } as StolenEvent;
    expect(planStealToast(ev, ME)).toEqual({ variant: 'other', thief: ANOTHER, victim: OTHER });
  });

  it('bystander perspective from an already-redacted event (no card field at all)', () => {
    const ev = { type: 'stolen', from: OTHER, to: ANOTHER } as StolenEvent;
    expect(planStealToast(ev, ME)).toEqual({ variant: 'other', thief: ANOTHER, victim: OTHER });
  });
});
