import { describe, it, expect } from 'vitest';
import { pipCount, isRedNumber, contrastInk, PLAYER_COLORS, PLAYER_BADGES, TERRAIN_FILL } from './palette';

describe('board palette', () => {
  it('pip counts follow the dice probability (docs/01 R16)', () => {
    expect(pipCount(2)).toBe(1);
    expect(pipCount(12)).toBe(1);
    expect(pipCount(6)).toBe(5);
    expect(pipCount(8)).toBe(5);
    expect(pipCount(7)).toBe(6); // never on a token, but the formula peaks at 7
  });

  it('only 6 and 8 are red numbers', () => {
    expect(isRedNumber(6)).toBe(true);
    expect(isRedNumber(8)).toBe(true);
    expect(isRedNumber(5)).toBe(false);
    expect(isRedNumber(9)).toBe(false);
  });

  it('the near-white seat gets dark badge ink, others light', () => {
    expect(contrastInk(2)).toBe('#2b2416');
    expect(contrastInk(0)).toBe('#f7f1e3');
  });

  it('has a colour and badge for all six seats and every terrain', () => {
    for (let s = 0 as 0 | 1 | 2 | 3 | 4 | 5; s <= 5; s++) {
      expect(PLAYER_COLORS[s]).toMatch(/^#/);
      expect(PLAYER_BADGES[s].length).toBeGreaterThan(0);
    }
    for (const t of ['hills', 'forest', 'pasture', 'fields', 'mountains', 'desert'] as const) {
      expect(TERRAIN_FILL[t]).toMatch(/^#/);
    }
  });
});
