// T-1108: SSR render smoke tests for the new E&P panels (no jsdom/@testing-library in this repo's
// test stack — `renderToStaticMarkup` + a minimal real i18next instance), mirroring
// `tradersBarbarians/TbPanels.render.test.ts`'s approach exactly. Verifies each panel renders its
// key testids for a crafted Land Ho! view and renders NOTHING for a base game (RK-13).
import { createElement } from 'react';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { createGame, isSeaEdge, redact } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import { GEOMETRY, type EdgeId, type GameConfig, type GameState, type Seat, type VertexId } from '@hexhaven/shared';
import enCommon from '../i18n/en/common.json';
import enExplorersPirates from '../i18n/en/explorersPirates.json';
import { EpActionPanel } from './EpActionPanel';
import { EpHud } from './EpHud';

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'explorersPirates'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, explorersPirates: enExplorersPirates } },
  interpolation: { escapeValue: false },
});

const SEAT0 = 0 as Seat;

const BASE_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ep-panels-render-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

function epConfig(): GameConfig {
  return { ...BASE_CONFIG, expansions: { ...BASE_CONFIG.expansions, explorersPirates: { scenario: 'landHo' } } };
}

function findSeaEdge(state: GameState): { edge: EdgeId; vertex: VertexId } {
  for (const e of GEOMETRY.edges) {
    if (isSeaEdge(state, e.id)) return { edge: e.id, vertex: e.a as VertexId };
  }
  throw new Error('BUG: no sea edge found on the Land Ho! v1 board');
}

function mainPhaseView(overrides: Partial<GameState> = {}): PlayerView {
  const g = createGame(epConfig());
  const state: GameState = { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
  return redact(state, SEAT0);
}

const NOOP = () => {};

describe('E&P panels render nothing for a base game (RK-13)', () => {
  const baseView = redact(createGame(BASE_CONFIG), SEAT0);

  it('EpActionPanel and EpHud both render null', () => {
    expect(
      renderToStaticMarkup(
        createElement(EpActionPanel, { view: baseView, mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
      ),
    ).toBe('');
    expect(renderToStaticMarkup(createElement(EpHud, { view: baseView, mySeat: SEAT0 }))).toBe('');
  });
});

describe('EpActionPanel / EpHud on a fresh Land Ho! game', () => {
  it('shows every action + the ships list empty-state', () => {
    const view = mainPhaseView();
    const html = renderToStaticMarkup(
      createElement(EpActionPanel, { view, mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="ep-action-panel"');
    expect(html).toContain('data-testid="ep-build-ship"');
    expect(html).toContain('data-testid="ep-move-ship"');
    expect(html).toContain('data-testid="ep-build-settler"');
    expect(html).toContain('data-testid="ep-load-settler"');
    expect(html).toContain('data-testid="ep-unload-settler"');
    expect(html).toContain('data-testid="ep-found-settlement"');
    expect(html).toContain('data-testid="ep-upgrade-to-harbor"');
    expect(html).toContain('No ships yet');
    // No raw i18n key leaks through (every t() call resolved to real copy).
    expect(html).not.toMatch(/landHo\./);

    const hudHtml = renderToStaticMarkup(createElement(EpHud, { view, mySeat: SEAT0 }));
    expect(hudHtml).toContain('data-testid="ep-hud"');
    expect(hudHtml).toContain('data-testid="ep-hud-gold"');
    expect(hudHtml).toContain('Gold: 0');
    expect(hudHtml).toContain('data-testid="ep-hud-harbor-settlements"');
    expect(hudHtml).toContain('data-testid="ep-hud-settler-reserve"');
  });

  it('lists the seat\'s own ships once one is built', () => {
    const created = createGame(epConfig());
    const { edge } = findSeaEdge(created);
    const ext = created.ext!.explorersPirates!;
    const view = mainPhaseView({
      ext: { ...created.ext, explorersPirates: { ...ext, ships: [{ seat: SEAT0, edge, cargo: [] }] } },
    });
    const html = renderToStaticMarkup(
      createElement(EpActionPanel, { view, mySeat: SEAT0, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain(`data-testid="ep-ship-${edge}"`);
    expect(html).not.toContain('No ships yet');
  });
});
