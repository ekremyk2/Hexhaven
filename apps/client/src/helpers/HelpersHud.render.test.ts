// Card/ability clarity pass: SSR render smoke tests for `HelpersHud`/`HelperDialogs`, mirroring
// `citiesKnights/ckPanels.render.test.ts`'s approach (`renderToStaticMarkup` + a minimal real
// i18next instance — this repo's test stack has no jsdom/@testing-library). Nothing here existed
// before this pass; the goal is to lock in that a player's OWN held helper always shows its name +
// ability description VISIBLY (not hover/dialog-only), and that the swap-candidate display list does
// too, since that was the concrete gap the audit found (previously just a bare count badge).
import { createElement } from 'react';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, HelpersExt, Seat } from '@hexhaven/shared';
import enHelpers from '../i18n/en/helpers.json';
import enLog from '../i18n/en/log.json';
import enCommon from '../i18n/en/common.json';
import { HelpersHud } from './HelpersHud';
import { SwapDialog } from './HelperDialogs';

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'log', 'helpers'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, log: enLog, helpers: enHelpers } },
  interpolation: { escapeValue: false },
});

const SEAT0 = 0 as Seat;
const NOOP = () => {};

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'helpers-hud-render-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
  modifiers: { helpers: true },
};

/** `ext.helpers` is only lazily created by the engine's first `afterAction` hook (T-905's
 *  `ensureHelpersExt`, not exported outside the engine package) — a bare `createGame` state has none
 *  yet, so every test here crafts one directly, the same way `ckPanels.render.test.ts` overrides
 *  `ext.citiesKnights` fields on top of what `createGame` already produced. */
function viewWith(helpers: HelpersExt): PlayerView {
  const g = createGame(CONFIG);
  const state: GameState = { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0 }, ext: { ...g.ext, helpers } };
  return redact(state, SEAT0);
}

const NO_HELPERS: HelpersExt = {
  display: ['mayor', 'general', 'explorer', 'mendicant', 'robberBride', 'merchant', 'captain', 'noblewoman', 'architect', 'priest'],
  bySeat: [null, null, null, null],
  usedThisTurn: [false, false, false, false],
  mayorEligible: [false, false, false, false],
  captainRate: [null, null, null, null],
  architectPeek: [null, null, null, null],
};

describe('HelpersHud renders nothing without the modifier (RK-13)', () => {
  it('returns null when view.ext.helpers is absent', () => {
    const g = createGame({ ...CONFIG, modifiers: undefined });
    const view = redact({ ...g, phase: { kind: 'main' } }, SEAT0);
    const html = renderToStaticMarkup(
      createElement(HelpersHud, { view, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toBe('');
  });
});

describe('HelpersHud "your helper" block (card/ability clarity pass)', () => {
  it('shows the none-yet state before any deal', () => {
    const view = viewWith(NO_HELPERS);
    const html = renderToStaticMarkup(
      createElement(HelpersHud, { view, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="helpers-hud-mine-none"');
  });

  it('shows the held helper\'s NAME and its ABILITY DESCRIPTION visibly (not tooltip-only)', () => {
    const held: HelpersExt = { ...NO_HELPERS, bySeat: [{ id: 'mendicant', side: 'A', acquiredTurn: 0 }, null, null, null] };
    const view = viewWith(held);
    const html = renderToStaticMarkup(
      createElement(HelpersHud, { view, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="helpers-hud-mine-name"');
    expect(html).toContain(enHelpers.name.mendicant);
    expect(html).toContain('data-testid="helpers-hud-mine-desc"');
    expect(html).toContain(enHelpers.desc.mendicant);
  });

  it('shows General\'s ability description too, even though it never gets a Use button (fully reactive)', () => {
    const held: HelpersExt = { ...NO_HELPERS, bySeat: [{ id: 'general', side: 'A', acquiredTurn: 0 }, null, null, null] };
    const view = viewWith(held);
    const html = renderToStaticMarkup(
      createElement(HelpersHud, { view, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain(enHelpers.desc.general);
    expect(html).toContain('data-testid="helper-auto-note"');
  });
});

describe('HelpersHud swap-candidate display list (card/ability clarity pass)', () => {
  it('shows every displayed helper\'s name + description, not just a bare count', () => {
    const view = viewWith(NO_HELPERS);
    const html = renderToStaticMarkup(
      createElement(HelpersHud, { view, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="helpers-hud-display-count"');
    for (const id of NO_HELPERS.display) {
      expect(html).toContain(`data-testid="helpers-hud-display-${id}"`);
      expect(html).toContain((enHelpers.name as Record<string, string>)[id]);
      expect(html).toContain((enHelpers.desc as Record<string, string>)[id]);
    }
  });
});

describe('SwapDialog (card/ability clarity pass)', () => {
  it('shows each choice\'s ability description alongside its name, not the name alone', () => {
    const choices = [{ id: 'captain' as const, label: enHelpers.name.captain }];
    const html = renderToStaticMarkup(
      createElement(SwapDialog, { open: true, choices, onConfirm: () => {}, onClose: () => {} }),
    );
    expect(html).toContain('data-testid="helper-swap-pick-captain"');
    expect(html).toContain(enHelpers.name.captain);
    expect(html).toContain(enHelpers.desc.captain);
  });
});
