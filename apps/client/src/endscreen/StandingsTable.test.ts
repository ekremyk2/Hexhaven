import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { StandingsTable } from './StandingsTable';
import type { StandingRow } from './standings';
import { initTestI18n } from './testI18n';

function row(overrides: Partial<StandingRow>): StandingRow {
  return {
    seat: 0 as Seat,
    settlements: 0,
    cities: 0,
    longestRoad: 0,
    largestArmy: 0,
    vpCards: null,
    total: 0,
    isWinner: false,
    isSelf: false,
    ...overrides,
  };
}

const NAMES: Record<number, string> = { 0: 'Ali', 1: 'Bea', 2: 'Cem', 3: 'Deniz' };
const seatName = (seat: Seat) => NAMES[seat] ?? `Seat ${seat + 1}`;

describe('StandingsTable (T-408 requirement 1: final VP breakdown table)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders one row per seat with the settlements/cities/total figures', () => {
    const rows = [
      row({ seat: 0 as Seat, settlements: 2, cities: 1, total: 4 }),
      row({ seat: 1 as Seat, settlements: 1, total: 1 }),
    ];
    const html = renderToStaticMarkup(createElement(StandingsTable, { rows, seatName }));
    expect(html).toContain('data-testid="standings-row-0"');
    expect(html).toContain('data-testid="standings-row-1"');
    expect(html).toContain('data-testid="standings-total-0"');
    expect(html.slice(html.indexOf('standings-total-0'))).toContain('>4<');
  });

  it("shows the Winner badge only on the winner's row", () => {
    const rows = [row({ seat: 0 as Seat, isWinner: true }), row({ seat: 1 as Seat })];
    const html = renderToStaticMarkup(createElement(StandingsTable, { rows, seatName }));
    const row0 = html.slice(html.indexOf('standings-row-0'), html.indexOf('standings-row-1'));
    const row1 = html.slice(html.indexOf('standings-row-1'));
    expect(row0).toContain('Winner');
    expect(row1).not.toContain('Winner');
  });

  it("shows the You badge only on the viewer's own row", () => {
    const rows = [row({ seat: 0 as Seat, isSelf: true }), row({ seat: 1 as Seat })];
    const html = renderToStaticMarkup(createElement(StandingsTable, { rows, seatName }));
    const row0 = html.slice(html.indexOf('standings-row-0'), html.indexOf('standings-row-1'));
    const row1 = html.slice(html.indexOf('standings-row-1'));
    expect(row0).toContain('You');
    expect(row1).not.toContain('You');
  });

  it('calls out revealed VP cards ("+N 🔒 revealed!"), never a bare count, when vpCards is known and > 0', () => {
    const rows = [row({ seat: 0 as Seat, vpCards: 2, total: 12 })];
    const html = renderToStaticMarkup(createElement(StandingsTable, { rows, seatName }));
    expect(html).toContain('+2 🔒 revealed!');
  });

  it('shows a hidden marker (not a number) when vpCards is null', () => {
    const rows = [row({ seat: 0 as Seat, vpCards: null })];
    const html = renderToStaticMarkup(createElement(StandingsTable, { rows, seatName }));
    expect(html).toContain('🔒 hidden');
    expect(html).not.toContain('+null');
  });

  it('renders the Longest Road / Largest Army award badges only when earned', () => {
    const rows = [
      row({ seat: 0 as Seat, longestRoad: 2, largestArmy: 0 }),
      row({ seat: 1 as Seat, longestRoad: 0, largestArmy: 2 }),
      row({ seat: 2 as Seat, longestRoad: 0, largestArmy: 0 }),
    ];
    const html = renderToStaticMarkup(createElement(StandingsTable, { rows, seatName }));
    const row0 = html.slice(html.indexOf('standings-row-0'), html.indexOf('standings-row-1'));
    const row1 = html.slice(html.indexOf('standings-row-1'), html.indexOf('standings-row-2'));
    const row2 = html.slice(html.indexOf('standings-row-2'));
    expect(row0).toContain('Longest Road');
    expect(row0).not.toContain('Largest Army');
    expect(row1).toContain('Largest Army');
    expect(row1).not.toContain('Longest Road');
    expect(row2).not.toContain('Longest Road');
    expect(row2).not.toContain('Largest Army');
  });

  it('resolves names via the seatName callback', () => {
    const rows = [row({ seat: 2 as Seat })];
    const html = renderToStaticMarkup(createElement(StandingsTable, { rows, seatName }));
    expect(html).toContain('Cem');
  });
});
