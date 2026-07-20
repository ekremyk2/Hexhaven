// T-806: SSR render smoke tests for the new C&K panels (no jsdom/@testing-library in this repo's
// test stack — `renderToStaticMarkup` + a minimal real i18next instance, mirroring
// `options/OptionsPanel.test.ts`'s approach). Verifies each panel renders its key testids for a
// crafted C&K view and renders NOTHING for a base game (RK-13: base HUD/controls stay untouched).
import { createElement } from 'react';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import { createGame, redact } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, Seat } from '@hexhaven/shared';
import enCitiesKnights from '../i18n/en/citiesKnights.json';
import enLog from '../i18n/en/log.json';
import enCommon from '../i18n/en/common.json';
import { CitiesKnightsHud } from './CitiesKnightsHud';
import { CommodityTradePanel } from './CommodityTradePanel';
import { ImprovementsPanel } from './ImprovementsPanel';
import { KnightControls } from './KnightControls';
import { ProgressHandPanel } from './ProgressHandPanel';
import {
  AlchemistDialog,
  ChoicePickerDialog,
  CommercialHarborDialog,
  DeserterDialog,
  InventorDialog,
  MerchantFleetDialog,
  SpyDialog,
} from './ProgressCardDialogs';

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'log', 'citiesKnights'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, log: enLog, citiesKnights: enCitiesKnights } },
  interpolation: { escapeValue: false },
});

const SEAT0 = 0 as Seat;

const BASE_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'ck-panels-render-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};
const CK_CONFIG: GameConfig = { ...BASE_CONFIG, targetVp: 13, expansions: { ...BASE_CONFIG.expansions, citiesKnights: true } };

function ckMainPhaseView(overrides: Partial<GameState> = {}): PlayerView {
  const g = createGame(CK_CONFIG);
  const state: GameState = { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: SEAT0, rolled: true }, ...overrides };
  return redact(state, SEAT0);
}

const NOOP = () => {};

describe('C&K panels render nothing for a base game (RK-13)', () => {
  const baseView = redact(createGame(BASE_CONFIG), SEAT0);

  it('ImprovementsPanel/KnightControls/CommodityTradePanel/CitiesKnightsHud all render null', () => {
    expect(renderToStaticMarkup(createElement(ImprovementsPanel, { view: baseView, mySeat: SEAT0, dispatch: NOOP }))).toBe('');
    expect(renderToStaticMarkup(createElement(KnightControls, { view: baseView, mySeat: SEAT0, uiMode: 'idle', setMode: NOOP }))).toBe('');
    expect(renderToStaticMarkup(createElement(CommodityTradePanel, { view: baseView, mySeat: SEAT0, dispatch: NOOP }))).toBe('');
    expect(renderToStaticMarkup(createElement(CitiesKnightsHud, { view: baseView, mySeat: SEAT0, seatName: (s) => `Seat ${s}` }))).toBe('');
  });
});

describe('ImprovementsPanel (C4)', () => {
  it('renders one buy control per track', () => {
    const view = ckMainPhaseView();
    const html = renderToStaticMarkup(createElement(ImprovementsPanel, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toContain('data-testid="ck-improvements-panel"');
    expect(html).toContain('data-testid="ck-buy-improvement-trade"');
    expect(html).toContain('data-testid="ck-buy-improvement-politics"');
    expect(html).toContain('data-testid="ck-buy-improvement-science"');
  });

  it('shows each track\'s L3 ability as an ALWAYS-VISIBLE short caption when the Buy button isn\'t blocked, not hover-only (card/ability clarity pass)', () => {
    // Needs an owned city + enough commodities so `computeImprovementState` returns ENABLED (not
    // `noCityOwned`/`cantAfford`) — the default `ckMainPhaseView()` fixture owns no city, which
    // would show the blocked-reason line instead (see the next test).
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, cities: [0] as typeof p.cities } : p));
    const commodities = ck.commodities.map((c, i) => (i === SEAT0 ? { paper: 5, cloth: 5, coin: 5 } : c));
    const state: GameState = {
      ...g,
      players,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: SEAT0, rolled: true },
      ext: { ...g.ext, citiesKnights: { ...ck, commodities } },
    };
    const view = redact(state, SEAT0);
    const html = renderToStaticMarkup(createElement(ImprovementsPanel, { view, mySeat: SEAT0, dispatch: NOOP }));
    // The visible caption text is present OUTSIDE any tooltip's own markup (checked by testid — the
    // full sentence still rides a Tooltip for extra detail, but the short one-liner is what a player
    // reads without hovering; measured against a real 375px mobile column, the FULL sentence used to
    // wrap 5-6 lines there, which is why this is the short form and not `improvements.ability.*`).
    expect(html).toContain('data-testid="ck-ability-text-trade"');
    expect(html).toContain(enCitiesKnights.improvements.abilityShort.trade);
    expect(html).toContain('data-testid="ck-ability-text-politics"');
    expect(html).toContain(enCitiesKnights.improvements.abilityShort.politics);
    expect(html).toContain('data-testid="ck-ability-text-science"');
    expect(html).toContain(enCitiesKnights.improvements.abilityShort.science);
    // Never BOTH the ability caption and a blocked-reason line for the same track (card/ability
    // clarity pass: stacking both would double the exact "all 3 disabled" worst case the original
    // scroll-elimination pass already budgeted the footer for).
    expect(html).not.toContain('data-testid="ck-improvement-reason-trade"');
  });

  it('shows the blocked reason instead of the ability caption when the Buy button IS blocked (never both, same track)', () => {
    // The default fixture's seat0 owns no city yet, so every track is blocked on `noCityOwned`.
    const view = ckMainPhaseView();
    const html = renderToStaticMarkup(createElement(ImprovementsPanel, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toContain('data-testid="ck-improvement-reason-trade"');
    expect(html).not.toContain('data-testid="ck-ability-text-trade"');
  });

  it('shows what levels 4/5 unlock (Metropolis) once, shared across all 3 tracks', () => {
    const view = ckMainPhaseView();
    const html = renderToStaticMarkup(createElement(ImprovementsPanel, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toContain('data-testid="ck-improvements-metropolis-hint"');
    // `renderToStaticMarkup` HTML-escapes the apostrophe in the copy ("track's" -> "track&#x27;s"),
    // so this checks the two halves around it rather than the raw literal string.
    expect(html).toContain('L4 claims that track');
    expect(html).toContain('Metropolis (city +2 VP); L5 can recapture it.');
  });
});

describe('KnightControls (C7/C9)', () => {
  it('renders every knight/wall mode-toggle button', () => {
    const view = ckMainPhaseView();
    const html = renderToStaticMarkup(createElement(KnightControls, { view, mySeat: SEAT0, uiMode: 'idle', setMode: NOOP }));
    for (const testid of [
      'ck-action-build-knight',
      'ck-action-activate-knight',
      'ck-action-promote-knight',
      'ck-action-move-knight',
      'ck-action-displace-knight',
      'ck-action-chase-robber',
      'ck-action-build-wall',
    ]) {
      expect(html).toContain(`data-testid="${testid}"`);
    }
  });

  it('shows the two-step pick hint only while a two-step mode is active', () => {
    const view = ckMainPhaseView();
    const idle = renderToStaticMarkup(createElement(KnightControls, { view, mySeat: SEAT0, uiMode: 'idle', setMode: NOOP }));
    expect(idle).not.toContain('ck-two-step-hint');
    const moving = renderToStaticMarkup(createElement(KnightControls, { view, mySeat: SEAT0, uiMode: 'movingKnight', setMode: NOOP }));
    expect(moving).toContain('data-testid="ck-two-step-hint"');
  });
});

describe('CitiesKnightsHud (C3/C4/C8)', () => {
  it('renders the compact barbarian strip and the VIEWER seat\'s own commodities/improvements (rail redesign)', () => {
    const view = ckMainPhaseView();
    const html = renderToStaticMarkup(createElement(CitiesKnightsHud, { view, mySeat: SEAT0, seatName: (s) => `Seat ${s}` }));
    expect(html).toContain('data-testid="barbarian-track"');
    expect(html).toContain('data-testid="ck-commodities-0"');
    expect(html).toContain('data-testid="ck-improvements-0"');
  });

  it('shows the requested seat\'s own detail, not every seat\'s (the biggest rail-overflow offender)', () => {
    const view = ckMainPhaseView();
    const html = renderToStaticMarkup(createElement(CitiesKnightsHud, { view, mySeat: 1 as Seat, seatName: (s) => `Seat ${s}` }));
    expect(html).toContain('data-testid="ck-commodities-1"');
    expect(html).not.toContain('data-testid="ck-commodities-0"');
    expect(html).not.toContain('data-testid="ck-commodities-2"');
  });
});

describe('CommodityTradePanel (C4.5)', () => {
  it('renders the trigger button when it is the seat\'s turn in main phase', () => {
    const view = ckMainPhaseView();
    const html = renderToStaticMarkup(createElement(CommodityTradePanel, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toContain('data-testid="ck-commodity-trade-trigger"');
  });

  it('renders nothing when it is not the seat\'s turn', () => {
    const g = createGame(CK_CONFIG);
    const state: GameState = { ...g, phase: { kind: 'main' }, turn: { ...g.turn, player: 1 as Seat, rolled: true } };
    const view = redact(state, SEAT0);
    const html = renderToStaticMarkup(createElement(CommodityTradePanel, { view, mySeat: SEAT0, dispatch: NOOP }));
    expect(html).toBe('');
  });
});

describe('ProgressHandPanel (C6)', () => {
  it('renders the empty state with no cards held', () => {
    const view = ckMainPhaseView();
    const own = view.players.find((p) => p.seat === SEAT0 && 'resources' in p) as Parameters<typeof ProgressHandPanel>[0]['own'];
    const html = renderToStaticMarkup(
      createElement(ProgressHandPanel, { view, own, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="ck-progress-hand-panel"');
    expect(html).toContain('data-testid="ck-progress-hand-empty"');
  });

  it('renders a Play button for each held card', () => {
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const progressHand = ck.progressHand.map((h, i) => (i === SEAT0 ? [...h, 'irrigation' as const, 'bishop' as const] : h));
    const state: GameState = {
      ...g,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: SEAT0, rolled: true },
      ext: { ...g.ext, citiesKnights: { ...ck, progressHand } },
    };
    const view = redact(state, SEAT0);
    const own = view.players.find((p) => p.seat === SEAT0 && 'resources' in p) as Parameters<typeof ProgressHandPanel>[0]['own'];
    const html = renderToStaticMarkup(
      createElement(ProgressHandPanel, { view, own, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="ck-progress-card-irrigation"');
    expect(html).toContain('data-testid="ck-progress-card-bishop"');
    expect(html).toContain('data-testid="ck-play-irrigation"');
    expect(html).toContain('data-testid="ck-play-bishop"');
  });

  it('offers Alchemist a Play button in the preRoll window (its unique timing)', () => {
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const progressHand = ck.progressHand.map((h, i) => (i === SEAT0 ? [...h, 'alchemist' as const] : h));
    // preRoll, not yet rolled — the Alchemist window.
    const state: GameState = {
      ...g,
      phase: { kind: 'preRoll' },
      turn: { ...g.turn, player: SEAT0, rolled: false },
      ext: { ...g.ext, citiesKnights: { ...ck, progressHand } },
    };
    const view = redact(state, SEAT0);
    const own = view.players.find((p) => p.seat === SEAT0 && 'resources' in p) as Parameters<typeof ProgressHandPanel>[0]['own'];
    const html = renderToStaticMarkup(
      createElement(ProgressHandPanel, { view, own, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toContain('data-testid="ck-play-alchemist"');
    // The button is enabled (no aria-disabled=true directly on it) since it's the correct window.
    expect(html).not.toMatch(/data-testid="ck-play-alchemist"[^>]*aria-disabled="true"/);
  });

  it('disables Medicine\'s Play button when the seat cannot afford 2 ore + 1 grain (coordinator follow-up)', () => {
    const g = createGame(CK_CONFIG);
    const ck = g.ext!.citiesKnights!;
    const progressHand = ck.progressHand.map((h, i) => (i === SEAT0 ? [...h, 'medicine' as const] : h));
    // A legal target exists (a settlement to upgrade) but the seat holds no ore/grain at all.
    const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, settlements: [0] as typeof p.settlements } : p));
    const state: GameState = {
      ...g,
      players,
      phase: { kind: 'main' },
      turn: { ...g.turn, player: SEAT0, rolled: true },
      ext: { ...g.ext, citiesKnights: { ...ck, progressHand } },
    };
    const view = redact(state, SEAT0);
    const own = view.players.find((p) => p.seat === SEAT0 && 'resources' in p) as Parameters<typeof ProgressHandPanel>[0]['own'];
    const html = renderToStaticMarkup(
      createElement(ProgressHandPanel, { view, own, mySeat: SEAT0, seatName: (s) => `Seat ${s}`, dispatch: NOOP, uiMode: 'idle', setMode: NOOP }),
    );
    expect(html).toMatch(/data-testid="ck-play-medicine"[^>]*disabled=""/);
  });
});

describe('progress-card param dialogs (T-806 P3)', () => {
  it('AlchemistDialog renders both die rows when open', () => {
    const html = renderToStaticMarkup(
      createElement(AlchemistDialog, { open: true, onConfirm: () => {}, onClose: () => {} }),
    );
    expect(html).toContain('data-testid="ck-alchemist-dialog"');
    expect(html).toContain('data-testid="ck-alchemist-yellow-1"');
    expect(html).toContain('data-testid="ck-alchemist-red-6"');
  });

  it('InventorDialog renders both hex-pick rows from the supplied choices', () => {
    const choices = [0, 1, 2].map((n) => ({ value: n, label: `Hex ${n}`, testid: `ck-inventor-x-${n}` }));
    const html = renderToStaticMarkup(
      createElement(InventorDialog, { open: true, hexChoices: choices, onConfirm: () => {}, onClose: () => {} }),
    );
    expect(html).toContain('data-testid="ck-inventor-dialog"');
    expect(html).toContain('data-testid="ck-inventor-a-0"');
    expect(html).toContain('data-testid="ck-inventor-b-2"');
  });

  it('MerchantFleetDialog / CommercialHarborDialog render their give/receive rows', () => {
    const mf = renderToStaticMarkup(
      createElement(MerchantFleetDialog, { open: true, onConfirm: () => {}, onClose: () => {} }),
    );
    expect(mf).toContain('data-testid="ck-merchant-fleet-give-resource-ore"');
    expect(mf).toContain('data-testid="ck-merchant-fleet-receive-commodity-coin"');

    const ch = renderToStaticMarkup(
      createElement(CommercialHarborDialog, { open: true, onConfirm: () => {}, onClose: () => {} }),
    );
    expect(ch).toContain('data-testid="ck-commercial-harbor-resource-brick"');
    expect(ch).toContain('data-testid="ck-commercial-harbor-commodity-paper"');
  });

  it('DeserterDialog renders the opponent-knight and placement rows', () => {
    const knights = [{ targetSeat: 1, targetVertex: 5, label: 'Seat 1 Lvl 1', testid: 'ck-deserter-knight-1-5' }];
    const placements = [{ value: 7, label: 'Spot 7', testid: 'ck-deserter-place-7' }];
    const html = renderToStaticMarkup(
      createElement(DeserterDialog, { open: true, knightChoices: knights, placementChoices: placements, onConfirm: () => {}, onClose: () => {} }),
    );
    expect(html).toContain('data-testid="ck-deserter-dialog"');
    expect(html).toContain('data-testid="ck-deserter-knight-1-5"');
    expect(html).toContain('data-testid="ck-deserter-place-7"');
  });

  it('SpyDialog renders only the seat row before any seat is picked (peek reveal fix)', () => {
    const seats = [{ seat: 1, count: 2, label: 'Seat 1', testid: 'ck-spy-seat-1' }];
    const html = renderToStaticMarkup(
      createElement(SpyDialog, {
        open: true,
        seatChoices: seats,
        peek: null,
        onBeginPeek: () => {},
        onConfirm: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain('data-testid="ck-spy-dialog"');
    expect(html).toContain('data-testid="ck-spy-seat-1"');
    // The card section (peeking placeholder or real card buttons) only appears once a seat is picked
    // (client state) — SSR with no seat selected shows just the seat row.
    expect(html).not.toContain('data-testid="ck-spy-peeking"');
    expect(html).not.toContain('data-testid="ck-spy-card-0"');
  });

  it('ChoicePickerDialog renders each choice + a disabled confirm until one is picked', () => {
    const choices = [{ value: 3, label: 'Spot 3', testid: 'ck-x-3' }];
    const html = renderToStaticMarkup(
      createElement(ChoicePickerDialog, {
        open: true,
        testid: 'ck-generic-dialog',
        title: 'Pick',
        instructions: 'Pick one',
        confirmLabel: 'OK',
        choices,
        onConfirm: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain('data-testid="ck-generic-dialog"');
    expect(html).toContain('data-testid="ck-x-3"');
    expect(html).toMatch(/data-testid="ck-generic-dialog-confirm"[^>]*disabled/);
  });
});
