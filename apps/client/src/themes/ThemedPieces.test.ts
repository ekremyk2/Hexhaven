// Themed-piece render tests (T-907). Same node-env/renderToStaticMarkup + per-feature testI18n
// convention as `board/CommodityIcon.test.ts`/`board/CitiesKnightsPieces.test.ts`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { GEOMETRY, type HexId } from '@hexhaven/shared';
import { HEX_SIZE } from '../board/palette';
import { ThemedPieceLabel, ThemedRobber, themedRobberPosition } from './ThemedPieces';
import { THEME_IDS, THEMES } from './themes';
import { initTestI18n } from './testI18n';

const HEX_A = GEOMETRY.hexes[0]!.id as HexId;

describe('ThemedRobber (T-907)', () => {
  it.each(THEME_IDS)('renders theme "%s" tagged with its theme id and robberArt variant', (id) => {
    const html = renderToStaticMarkup(createElement(ThemedRobber, { themeId: id, x: 10, y: 20 }));
    expect(html).toContain('data-testid="themed-robber"');
    expect(html).toContain(`data-theme-id="${id}"`);
    expect(html).toContain(`data-robber-art="${THEMES[id].robberArt}"`);
  });

  it('classic and pirates render visibly different markup (a real reskin, not just a recolor)', () => {
    const classic = renderToStaticMarkup(createElement(ThemedRobber, { themeId: 'classic', x: 0, y: 0 }));
    const pirates = renderToStaticMarkup(createElement(ThemedRobber, { themeId: 'pirates', x: 0, y: 0 }));
    expect(classic).not.toBe(pirates);
  });

  it('classic and harvest render visibly different markup too', () => {
    const classic = renderToStaticMarkup(createElement(ThemedRobber, { themeId: 'classic', x: 0, y: 0 }));
    const harvest = renderToStaticMarkup(createElement(ThemedRobber, { themeId: 'harvest', x: 0, y: 0 }));
    expect(classic).not.toBe(harvest);
  });

  it('tags the hex id when supplied, omits the attribute entirely when not', () => {
    const withHex = renderToStaticMarkup(createElement(ThemedRobber, { themeId: 'classic', x: 0, y: 0, hexId: HEX_A }));
    expect(withHex).toContain(`data-hex-id="${HEX_A}"`);
    const withoutHex = renderToStaticMarkup(createElement(ThemedRobber, { themeId: 'classic', x: 0, y: 0 }));
    expect(withoutHex).not.toContain('data-hex-id');
  });

  it('pirates\' accent trims the hat in the theme\'s accent color', () => {
    const html = renderToStaticMarkup(createElement(ThemedRobber, { themeId: 'pirates', x: 0, y: 0 }));
    expect(html).toContain(THEMES.pirates.accent);
  });
});

describe('themedRobberPosition (pure geometry)', () => {
  it('resolves a HexId to the same pixel convention board/Pieces.tsx uses (hex.x/y * HEX_SIZE)', () => {
    const hex0 = GEOMETRY.hexes[0]!;
    const pos = themedRobberPosition(hex0.id as HexId);
    expect(pos.x).toBeCloseTo(hex0.x * HEX_SIZE);
    expect(pos.y).toBeCloseTo(hex0.y * HEX_SIZE);
  });

  it('throws a BUG error for an out-of-range hex id', () => {
    expect(() => themedRobberPosition(9999 as HexId)).toThrow(/BUG/);
  });
});

describe('ThemedPieceLabel (T-907)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  it('renders the classic theme\'s vanilla piece name', () => {
    const html = renderToStaticMarkup(createElement(ThemedPieceLabel, { themeId: 'classic', kind: 'robber' }));
    expect(html).toContain('data-testid="themed-label-robber"');
    expect(html).toContain('Robber');
  });

  it('renders the pirates theme\'s reskinned robber label', () => {
    const html = renderToStaticMarkup(createElement(ThemedPieceLabel, { themeId: 'pirates', kind: 'robber' }));
    expect(html).toContain('Buccaneer');
  });

  it.each([
    ['settlement', 'Homestead'],
    ['city', 'Manor'],
    ['road', 'Lane'],
  ] as const)('renders the harvest theme\'s %s label ("%s")', (kind, expected) => {
    const html = renderToStaticMarkup(createElement(ThemedPieceLabel, { themeId: 'harvest', kind }));
    expect(html).toContain(expected);
  });
});
