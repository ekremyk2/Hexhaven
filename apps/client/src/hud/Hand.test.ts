import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Seat } from '@hexhaven/shared';
import { Hand } from './Hand';
import { makeOwnPlayerView } from './testFixtures';
import { initTestI18n } from './testI18n';

const SEAT = 0 as Seat;

// Hand is resources-only (dev cards live in DevCardsPanel now — see Hand.tsx header). Dev-card
// rendering/NEW-badge coverage lives with DevCardsPanel; these cover the resource cells.
describe('Hand (T-402 requirement 4: viewer\'s own resource hand)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders every resource type\'s exact count, including zero', () => {
    const own = makeOwnPlayerView(SEAT, { resources: { brick: 2, lumber: 0, wool: 1, grain: 3, ore: 0 } });
    const html = renderToStaticMarkup(createElement(Hand, { own }));
    expect(html).toContain('data-testid="hand-resource-brick"');
    expect(html.match(/data-testid="hand-resource-brick-count"[^>]*>2</)).toBeTruthy();
    expect(html.match(/data-testid="hand-resource-lumber-count"[^>]*>0</)).toBeTruthy();
  });

  it('shows a resource icon/glyph on every cell, not a bare number (playtest readability fix)', () => {
    const own = makeOwnPlayerView(SEAT, { resources: { brick: 2, lumber: 0, wool: 1, grain: 3, ore: 0 } });
    const html = renderToStaticMarkup(createElement(Hand, { own }));
    // Each resource cell renders its glyph plus a translated aria-label — never just a bare digit.
    for (const glyph of ['🧱', '🌲', '🐑', '🌾', '⛰️']) {
      expect(html).toContain(glyph);
    }
  });

  it('does not render any dev-card chips (those moved to DevCardsPanel)', () => {
    const own = makeOwnPlayerView(SEAT, { devCards: [{ type: 'knight', boughtOnTurn: 5 }] });
    const html = renderToStaticMarkup(createElement(Hand, { own }));
    expect(html).not.toContain('data-testid="hand-devcard-0"');
  });
});
