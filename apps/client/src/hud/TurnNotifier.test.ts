import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { needsAttention } from './TurnNotifier';

const ME = 0 as Seat;

function base(overrides: Partial<{ turnPlayer: Seat; phase: unknown; trade: unknown }> = {}): PlayerView {
  return {
    me: ME,
    turn: { player: overrides.turnPlayer ?? (0 as Seat) },
    phase: overrides.phase ?? { kind: 'main' },
    trade: overrides.trade ?? null,
  } as unknown as PlayerView;
}

describe('needsAttention (TurnNotifier trigger, T-507)', () => {
  it('true on the viewer\'s own turn, false on someone else\'s / when ended / no view', () => {
    expect(needsAttention(base({ turnPlayer: 0 as Seat }))).toBe(true);
    expect(needsAttention(base({ turnPlayer: 1 as Seat }))).toBe(false);
    expect(needsAttention(base({ phase: { kind: 'ended', winner: 0 } }))).toBe(false);
    expect(needsAttention(null)).toBe(false);
  });

  it('true when the viewer owes a discard or gold choice — even on another seat\'s turn', () => {
    expect(needsAttention(base({ turnPlayer: 1 as Seat, phase: { kind: 'discard', pending: [0], amounts: {} } }))).toBe(true);
    expect(needsAttention(base({ turnPlayer: 1 as Seat, phase: { kind: 'discard', pending: [2], amounts: {} } }))).toBe(false);
    expect(needsAttention(base({ turnPlayer: 1 as Seat, phase: { kind: 'chooseGoldResource', pending: [0], owed: {} } }))).toBe(true);
  });

  it('true when an open trade offer from another seat is awaiting the viewer\'s response', () => {
    const trade = { give: { wool: 1 }, receive: { brick: 1 }, responses: {} };
    expect(needsAttention(base({ turnPlayer: 1 as Seat, trade }))).toBe(true);
    // Already responded → no longer owed.
    expect(needsAttention(base({ turnPlayer: 1 as Seat, trade: { ...trade, responses: { 0: 'declined' } } }))).toBe(false);
  });
});
