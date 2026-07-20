// T-603 requirement 2/6: the seat-identity audit. Every seat 0–5 (the base four plus the 5–6
// extension's green ✚ / brown ⬟) must render a DISTINCT chip color and a DISTINCT shape badge —
// the colorblind-safe double-coding docs/11 §1/§4 require. Guards against a 4-seat assumption
// sneaking back in (a missing seat-4/5 entry, or a duplicated color/glyph).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { PLAYER_BADGES, PLAYER_COLORS } from './palette';
import { PlayerChip } from '../ui';

const ALL_SEATS = [0, 1, 2, 3, 4, 5] as Seat[];

describe('seat identity audit (docs/11 §1/§4 — all six seats distinct)', () => {
  it('has a color for every seat 0–5, all distinct', () => {
    const colors = ALL_SEATS.map((s) => PLAYER_COLORS[s]);
    expect(colors.every((c) => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
    expect(new Set(colors).size).toBe(6);
  });

  it('has a shape badge for every seat 0–5, all distinct', () => {
    const badges = ALL_SEATS.map((s) => PLAYER_BADGES[s]);
    expect(badges.every((b) => b.length > 0)).toBe(true);
    expect(new Set(badges).size).toBe(6);
  });

  it('includes the 5–6 extension colors/badges: green ✚ (seat 4), brown ⬟ (seat 5)', () => {
    expect(PLAYER_BADGES[4 as Seat]).toBe('✚');
    expect(PLAYER_BADGES[5 as Seat]).toBe('⬟');
    // Green + brown per docs/11 §1.
    expect(PLAYER_COLORS[4 as Seat].toLowerCase()).toBe('#2e7d32');
    expect(PLAYER_COLORS[5 as Seat].toLowerCase()).toBe('#6d4c2f');
  });

  it('PlayerChip renders a distinct seat-color class and the seat badge for all six seats', () => {
    const seenClasses = new Set<string>();
    for (const seat of ALL_SEATS) {
      const html = renderToStaticMarkup(createElement(PlayerChip, { seat, name: `P${seat}` }));
      expect(html, `seat ${seat} chip missing bg-seat-${seat}`).toContain(`bg-seat-${seat}`);
      expect(html, `seat ${seat} chip missing its badge glyph`).toContain(PLAYER_BADGES[seat]);
      seenClasses.add(`bg-seat-${seat}`);
    }
    expect(seenClasses.size).toBe(6);
  });
});
