// Commodity + improvement-track atoms (T-805 requirement 5). Same node-env/renderToStaticMarkup +
// per-feature testI18n convention as `BarbarianTrack.test.ts`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { CommodityIcon, ImprovementTrackDisplay } from './CommodityIcon';
import { initTestI18n } from './testI18n';
import { COMMODITY_COLOR, TRACK_COLOR } from './citiesKnightsPalette';

describe('CommodityIcon (C3.1)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders a bare glyph with no count when count is omitted', () => {
    const html = renderToStaticMarkup(createElement(CommodityIcon, { commodity: 'paper' }));
    expect(html).toContain('data-testid="commodity-icon-paper"');
    expect(html).not.toContain('data-testid="commodity-icon-paper-count"');
  });

  it('renders the count badge (including 0) when supplied', () => {
    const html = renderToStaticMarkup(createElement(CommodityIcon, { commodity: 'coin', count: 0 }));
    expect(html).toContain('data-testid="commodity-icon-coin-count"');
    expect(html).toContain('>0<');
  });

  it.each(['paper', 'cloth', 'coin'] as const)('colors the %s badge from COMMODITY_COLOR', (commodity) => {
    const html = renderToStaticMarkup(createElement(CommodityIcon, { commodity }));
    expect(html).toContain(COMMODITY_COLOR[commodity]);
  });
});

describe('ImprovementTrackDisplay (C4.1)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders the translated track name and level pips clamped to 0..5', () => {
    const html = renderToStaticMarkup(createElement(ImprovementTrackDisplay, { track: 'trade', level: 3 }));
    expect(html).toContain('data-testid="improvement-track-trade"');
    expect(html).toContain('data-level="3"');
    expect(html).toContain('Trade');
    expect(html).toContain('3/5');
  });

  it('clamps an out-of-range level into 0..5', () => {
    const html = renderToStaticMarkup(createElement(ImprovementTrackDisplay, { track: 'science', level: 9 }));
    expect(html).toContain('data-level="5"');
    expect(html).toContain('5/5');
  });

  it.each(['trade', 'politics', 'science'] as const)('colors the %s track name from TRACK_COLOR', (track) => {
    const html = renderToStaticMarkup(createElement(ImprovementTrackDisplay, { track, level: 1 }));
    expect(html).toContain(TRACK_COLOR[track]);
  });
});
