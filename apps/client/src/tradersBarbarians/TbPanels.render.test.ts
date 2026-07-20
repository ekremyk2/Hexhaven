// T-1008: SSR render smoke tests for the new T&B panels (no jsdom/@testing-library in this repo's
// test stack — `renderToStaticMarkup` + a minimal real i18next instance), mirroring
// `citiesKnights/ckPanels.render.test.ts`'s approach exactly. Verifies each panel renders its key
// testids for a crafted scenario view and renders NOTHING for a base game (RK-13).
import { createElement } from 'react';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import enCommon from '../i18n/en/common.json';
import enTradersBarbarians from '../i18n/en/tradersBarbarians.json';
import { TbActionPanel } from './TbActionPanel';
import { TbHud } from './TbHud';

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'tradersBarbarians'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, tradersBarbarians: enTradersBarbarians } },
  interpolation: { escapeValue: false },
});

const SEAT0 = 0 as Seat;

const BASE_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'tb-panels-render-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

function tbConfig(scenario: string): GameConfig {
  return { ...BASE_CONFIG, expansions: { ...BASE_CONFIG.expansions, tradersBarbarians: { scenario } } };
}

function mainPhaseView(scenario: string, overrides: Partial<GameState> = {}): PlayerView {
  const g = createGame(tbConfig(scenario));
  const state: GameState = { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
  return redact(state, SEAT0);
}

const NOOP = () => {};
const SEAT_NAME = (s: Seat) => `Seat ${s}`;

describe('T&B panels render nothing for a base game (RK-13)', () => {
  const baseView = redact(createGame(BASE_CONFIG), SEAT0);

  it('TbActionPanel and TbHud both render null', () => {
    expect(
      renderToStaticMarkup(
        createElement(TbActionPanel, { view: baseView, mySeat: SEAT0, seatName: SEAT_NAME, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
      ),
    ).toBe('');
    expect(renderToStaticMarkup(createElement(TbHud, { view: baseView, mySeat: SEAT0 }))).toBe('');
  });
});

describe('TbActionPanel / TbHud per scenario', () => {
  it('fishermen: exchange buttons + Old Boot pass control', () => {
    const view = mainPhaseView('fishermen');
    const panelHtml = renderToStaticMarkup(
      createElement(TbActionPanel, { view, mySeat: SEAT0, seatName: SEAT_NAME, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(panelHtml).toContain('data-testid="tb-action-panel"');
    expect(panelHtml).toContain('data-testid="tb-fishermen-controls"');
    expect(panelHtml).toContain('data-testid="tb-exchange-fish-removeRobber"');
    expect(panelHtml).toContain('data-testid="tb-exchange-fish-steal"');
    expect(panelHtml).toContain('data-testid="tb-exchange-fish-devCard"');
    // No raw i18n key leaks through (every t() call resolved to real copy).
    expect(panelHtml).not.toMatch(/fishermen\.exchange\./);

    const hudHtml = renderToStaticMarkup(createElement(TbHud, { view, mySeat: SEAT0 }));
    expect(hudHtml).toContain('data-testid="tb-hud-fish"');
  });

  it('rivers: build-bridge + trade-coins controls', () => {
    const view = mainPhaseView('rivers');
    const html = renderToStaticMarkup(
      createElement(TbActionPanel, { view, mySeat: SEAT0, seatName: SEAT_NAME, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="tb-rivers-controls"');
    expect(html).toContain('data-testid="tb-build-bridge"');
    expect(html).toContain('data-testid="tb-trade-coins"');

    const hudHtml = renderToStaticMarkup(createElement(TbHud, { view, mySeat: SEAT0 }));
    expect(hudHtml).toContain('data-testid="tb-hud-coins"');
  });

  it('caravans: camels-remaining note (no vote open yet on a fresh game)', () => {
    const view = mainPhaseView('caravans');
    const html = renderToStaticMarkup(
      createElement(TbActionPanel, { view, mySeat: SEAT0, seatName: SEAT_NAME, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="tb-caravans-controls"');
    expect(html).toContain('22 camels left in supply');

    const hudHtml = renderToStaticMarkup(createElement(TbHud, { view, mySeat: SEAT0 }));
    expect(hudHtml).toContain('data-testid="tb-hud-camels"');
  });

  it('barbarianAttack: recruit + move knight controls', () => {
    const view = mainPhaseView('barbarianAttack');
    const html = renderToStaticMarkup(
      createElement(TbActionPanel, { view, mySeat: SEAT0, seatName: SEAT_NAME, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="tb-barbarian-attack-controls"');
    expect(html).toContain('data-testid="tb-recruit-knight"');
    expect(html).toContain('data-testid="tb-move-knight"');

    const hudHtml = renderToStaticMarkup(createElement(TbHud, { view, mySeat: SEAT0 }));
    expect(hudHtml).toContain('data-testid="tb-hud-captured"');
  });

  it('the main scenario: no-wagons hint on a fresh game + commodities row', () => {
    const view = mainPhaseView('tradersBarbarians');
    const html = renderToStaticMarkup(
      createElement(TbActionPanel, { view, mySeat: SEAT0, seatName: SEAT_NAME, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="tb-main-controls"');
    expect(html).toContain('data-testid="tb-commodities"');
    expect(html).toContain('No wagons yet');

    const hudHtml = renderToStaticMarkup(createElement(TbHud, { view, mySeat: SEAT0 }));
    expect(hudHtml).toContain('data-testid="tb-hud-commodities"');
  });
});
