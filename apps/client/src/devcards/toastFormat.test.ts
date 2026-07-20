import { describe, expect, it } from 'vitest';
import { events } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { planDevBoughtToast, planDevPlayedToast, planMonopolyToast } from './toastFormat';

const SEAT0 = 0 as Seat;
const SEAT1 = 1 as Seat;
const SEAT2 = 2 as Seat;
const SEAT3 = 3 as Seat;

describe('planDevPlayedToast (task requirement 5: opponent perspective only)', () => {
  it('null for the viewer\'s OWN play — they already know, no toast needed', () => {
    expect(planDevPlayedToast(events.devPlayed(SEAT0, 'knight'), SEAT0)).toBeNull();
  });

  it("an opponent's play surfaces the seat and (never-redacted) card type", () => {
    expect(planDevPlayedToast(events.devPlayed(SEAT1, 'roadBuilding'), SEAT0)).toEqual({
      seat: SEAT1,
      card: 'roadBuilding',
    });
  });
});

describe('planDevBoughtToast (task requirement 5: type redacted server-side, render what arrives)', () => {
  it("null for the viewer's OWN buy", () => {
    expect(planDevBoughtToast(events.devBought(SEAT0, 'monopoly'), SEAT0)).toBeNull();
  });

  it("an opponent's buy surfaces only the seat, even if the (unredacted, scripted) event carries a card", () => {
    expect(planDevBoughtToast(events.devBought(SEAT1, 'monopoly'), SEAT0)).toEqual({ seat: SEAT1 });
  });

  it('handles the ACTUALLY-redacted shape (no `card` field at all) the same way', () => {
    const redacted = { type: 'devBought' as const, seat: SEAT1 };
    expect(planDevBoughtToast(redacted, SEAT0)).toEqual({ seat: SEAT1 });
  });
});

describe('planMonopolyToast (task requirement 4: the "You collected…" result toast, public to everyone)', () => {
  it('variant "self" and the full per-seat breakdown when the viewer is the Monopoly player', () => {
    const ev = events.monopolyResolved(SEAT0, 'grain', [
      { seat: SEAT1, count: 3 },
      { seat: SEAT2, count: 2 },
      { seat: SEAT3, count: 0 },
    ]);
    expect(planMonopolyToast(ev, SEAT0)).toEqual({
      variant: 'self',
      seat: SEAT0,
      resource: 'grain',
      total: 5,
      breakdown: [
        { seat: SEAT1, count: 3 },
        { seat: SEAT2, count: 2 },
        { seat: SEAT3, count: 0 },
      ],
    });
  });

  it('variant "other" when a different seat played Monopoly — SAME public breakdown either way', () => {
    const ev = events.monopolyResolved(SEAT1, 'ore', [{ seat: SEAT0, count: 4 }]);
    const plan = planMonopolyToast(ev, SEAT0);
    expect(plan.variant).toBe('other');
    expect(plan.total).toBe(4);
  });
});
