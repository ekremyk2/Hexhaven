// T-401 requirement 2 tests: gating logic (pure functions) + static-markup checks for the
// disabled/"coming soon" states, following the same `renderToStaticMarkup` convention as
// ui/primitives.test.ts (no jsdom/@testing-library in this repo's test stack).
import { createElement } from 'react';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import type { RoomConfig } from '@hexhaven/shared';
import enCommon from '../i18n/en/common.json';
import enLobby from '../i18n/en/lobby.json';
import {
  beginnerAvailable,
  capFieldValue,
  CAP_FIELDS,
  costItemValue,
  customConstantsConfig,
  customTargetVpValue,
  DEFAULT_CUSTOM_TARGET_VP,
  DEFAULT_HEX_PIECES_CONFIG,
  DEFAULT_EP_SCENARIO,
  DEFAULT_ROOM_CONFIG,
  DEFAULT_SEAFARERS_SCENARIO,
  DEFAULT_TB_SCENARIO,
  EP_SCENARIOS,
  gameConfigForWinnability,
  hexPieceKinds,
  isCapFieldLimitless,
  isExpansionOn,
  isHexPieceKindOn,
  isModifierOn,
  OptionsPanel,
  playerCountOptions,
  selectedBoard,
  selectedEPScenario,
  selectedScenario,
  selectedTBScenario,
  selectedTurnRule,
  simpleFieldValue,
  SHIPPED_EXPANSIONS,
  SHIPPED_MODIFIERS,
  startingResourceValue,
  TB_SCENARIOS,
  winnabilityFor,
  withBoard,
  withCapField,
  withCapFieldLimitless,
  withCostItemField,
  withCustomConstants,
  withCustomTargetVp,
  withEPScenario,
  withExpansionToggled,
  withHexPieceKindToggled,
  withModifierToggled,
  withPlayerCount,
  withScenario,
  withStartingResource,
  withTBScenario,
  withTurnRule,
} from './OptionsPanel';

const FIVE_SIX_ON: RoomConfig = {
  ...DEFAULT_ROOM_CONFIG,
  playerCount: 6,
  expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true },
};

// OptionsPanel calls useTranslation itself (unlike the ui/** primitives, which take already-
// translated strings), so — unlike ui/primitives.test.ts — this needs a real i18next instance.
// `src/i18n/index.ts` can't be imported here: it registers `i18next-browser-languagedetector`,
// which reaches for `window`/`navigator` (fatal under vitest's `node` environment, same reason
// i18n/parity.test.ts reads the JSON directly instead). Initializing a minimal instance with the
// actual `en` resource JSON inline (no backend/detector) exercises the real production copy
// without touching the browser-only plugin.
void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'lobby'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, lobby: enLobby } },
  interpolation: { escapeValue: false },
});

describe('SHIPPED_EXPANSIONS (D-026: single flip point per wave)', () => {
  it('ships fiveSix (W1), seafarers (W2), citiesKnights (W3), tradersBarbarians (Phase 10) and explorersPirates (Phase 11)', () => {
    expect(SHIPPED_EXPANSIONS).toEqual({
      fiveSix: true,
      seafarers: true,
      citiesKnights: true,
      tradersBarbarians: true,
      explorersPirates: true,
    });
  });
});

describe('playerCountOptions (5/6 disabled until the fiveSix toggle is on)', () => {
  it('3 and 4 are always enabled', () => {
    const options = playerCountOptions(DEFAULT_ROOM_CONFIG);
    expect(options.find((o) => o.value === '3')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '4')?.disabled).toBe(false);
  });

  it('5 and 6 are disabled while fiveSix is off', () => {
    const options = playerCountOptions(DEFAULT_ROOM_CONFIG);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(true);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(true);
  });

  it('5 and 6 become enabled once fiveSix is toggled on', () => {
    const config: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true },
    };
    const options = playerCountOptions(config);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
  });

  it('5 and 6 are also enabled once seafarers is toggled on, even with fiveSix still off (T-751)', () => {
    const config: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, seafarers: { scenario: 'headingForNewShores' } },
    };
    expect(config.expansions.fiveSix).toBe(false);
    const options = playerCountOptions(config);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
  });
});

describe('withPlayerCount (T-751 — direct player-count changes keep the seafarers/fiveSix invariant)', () => {
  it('is a plain passthrough when seafarers is off', () => {
    const next = withPlayerCount(DEFAULT_ROOM_CONFIG, 6);
    expect(next.playerCount).toBe(6);
    expect(next.expansions.fiveSix).toBe(false); // unrelated to this toggle when seafarers is off
  });

  it('picking 5 or 6 with seafarers on turns fiveSix ON (the 5-6 Seafarers boards)', () => {
    const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount: 4, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, seafarers: { scenario: 'headingForNewShores' } } };
    const next = withPlayerCount(cfg, 6);
    expect(next.playerCount).toBe(6);
    expect(next.expansions.fiveSix).toBe(true);
    expect(next.expansions.seafarers).toEqual({ scenario: 'headingForNewShores' });
  });

  it('picking 3 or 4 with seafarers on turns fiveSix back OFF (the base 3/4 box)', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, seafarers: { scenario: 'headingForNewShores' } },
    };
    const next = withPlayerCount(cfg, 4);
    expect(next.playerCount).toBe(4);
    expect(next.expansions.fiveSix).toBe(false);
  });
});

describe('isExpansionOn / withExpansionToggled', () => {
  it('boolean expansions (fiveSix, citiesKnights) toggle on/off directly', () => {
    expect(isExpansionOn(DEFAULT_ROOM_CONFIG, 'fiveSix')).toBe(false);
    const on = withExpansionToggled(DEFAULT_ROOM_CONFIG, 'fiveSix', true);
    expect(isExpansionOn(on, 'fiveSix')).toBe(true);
    expect(withExpansionToggled(on, 'fiveSix', false).expansions.fiveSix).toBe(false);
  });

  it('turning fiveSix off drops player count back to 4 (docs/10 §2 invariant)', () => {
    const fiveSixOn: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true },
    };
    const next = withExpansionToggled(fiveSixOn, 'fiveSix', false);
    expect(next.playerCount).toBe(4);
  });

  it('seafarers toggles the discriminated false | {scenario} shape', () => {
    expect(isExpansionOn(DEFAULT_ROOM_CONFIG, 'seafarers')).toBe(false);
    const on = withExpansionToggled(DEFAULT_ROOM_CONFIG, 'seafarers', true);
    expect(on.expansions.seafarers).not.toBe(false);
    expect(isExpansionOn(on, 'seafarers')).toBe(true);
    expect(withExpansionToggled(on, 'seafarers', false).expansions.seafarers).toBe(false);
  });
});

describe('board picker (T-607: registry-driven preset picker per mode)', () => {
  it('defaults to Random when unset (back-compat with pre-T-606 configs)', () => {
    const noBoard: RoomConfig = { ...DEFAULT_ROOM_CONFIG };
    delete (noBoard as { board?: unknown }).board;
    expect(selectedBoard(noBoard)).toBe('random');
    expect(selectedBoard(DEFAULT_ROOM_CONFIG)).toBe('random');
  });

  it('records the chosen board (the create-room payload shape)', () => {
    expect(withBoard(DEFAULT_ROOM_CONFIG, 'beginner').board).toBe('beginner');
    expect(selectedBoard(withBoard(DEFAULT_ROOM_CONFIG, 'beginner'))).toBe('beginner');
    expect(selectedBoard(withBoard(DEFAULT_ROOM_CONFIG, 'random'))).toBe('random');
  });

  it('Beginner is available on the base board and NOT while fiveSix (30-hex) is on', () => {
    expect(beginnerAvailable(DEFAULT_ROOM_CONFIG)).toBe(true);
    expect(beginnerAvailable(FIVE_SIX_ON)).toBe(false);
  });

  it('turning fiveSix ON drops a Beginner selection back to Random (no verified 30-hex layout)', () => {
    const beginner = withBoard(DEFAULT_ROOM_CONFIG, 'beginner');
    const on = withExpansionToggled(beginner, 'fiveSix', true);
    expect(on.expansions.fiveSix).toBe(true);
    expect(on.board).toBe('random');
  });

  it('renders the base preset menu (Random + Beginner) selectable, no "coming soon" board entry', () => {
    const html = renderToStaticMarkup(
      createElement(OptionsPanel, { value: DEFAULT_ROOM_CONFIG, onChange: () => {} }),
    );
    expect(html).toContain('data-testid="board-preset-picker"');
    expect(html).toContain('aria-label="Board setup"');
    expect(html).toContain('Random');
    expect(html).toContain('Beginner');
    // No fixed-5-6 board is offered on the base board.
    expect(html).not.toContain('5-6 New Players');
  });

  it('renders the fiveSix preset menu (Random + the coming-soon 5-6 fixed board), Beginner absent', () => {
    const html = renderToStaticMarkup(
      createElement(OptionsPanel, { value: FIVE_SIX_ON, onChange: () => {} }),
    );
    expect(html).toContain('data-testid="board-preset-picker"');
    // The 5-6 fixed board is catalog-only — rendered but disabled with a coming-soon badge.
    expect(html).toContain('5-6 New Players');
    expect(html).toMatch(/5-6 New Players[\s\S]*?Coming soon/);
    // Beginner is a base-only preset — it is not in the fiveSix menu at all.
    expect(html).not.toContain('>Beginner<');
    // The board picker group itself is never fully disabled (Random stays selectable).
    expect(html).not.toMatch(/data-testid="board-preset-picker" aria-disabled="true"/);
  });
});

describe('Seafarers option wiring (T-705)', () => {
  it('toggling seafarers on selects the default scenario, caps players at 4, and turns fiveSix off', () => {
    const from: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount: 4 };
    const next = withExpansionToggled(from, 'seafarers', true);
    expect(next.expansions.seafarers).toEqual({ scenario: DEFAULT_SEAFARERS_SCENARIO });
    expect(next.expansions.fiveSix).toBe(false);
    expect(next.playerCount).toBeLessThanOrEqual(4);
  });

  it('turning seafarers on from a 5-6 fiveSix config KEEPS fiveSix and the player count (T-751 5-6 Seafarers boards)', () => {
    const next = withExpansionToggled(FIVE_SIX_ON, 'seafarers', true);
    expect(isExpansionOn(next, 'seafarers')).toBe(true);
    expect(next.expansions.fiveSix).toBe(true);
    expect(next.playerCount).toBe(6);
  });

  it('turning seafarers on from a 3/4-player fiveSix config still disables fiveSix (base 3/4 box)', () => {
    const fiveSixAt4: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount: 4, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true } };
    const next = withExpansionToggled(fiveSixAt4, 'seafarers', true);
    expect(isExpansionOn(next, 'seafarers')).toBe(true);
    expect(next.expansions.fiveSix).toBe(false);
    expect(next.playerCount).toBe(4);
  });

  it('turning fiveSix on turns off a 3/4-player seafarers selection (never started from 5/6 players)', () => {
    const sea = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'seafarers', true);
    const next = withExpansionToggled(sea, 'fiveSix', true);
    expect(next.expansions.seafarers).toBe(false);
    expect(next.expansions.fiveSix).toBe(true);
  });

  it('seafarers is selectable at 5 and 6 players too (T-751 — headingForNewShores ships 5/6 boards)', () => {
    for (const playerCount of [5, 6] as const) {
      const cfg: RoomConfig = {
        ...DEFAULT_ROOM_CONFIG,
        playerCount,
        expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true },
      };
      const on = withExpansionToggled(cfg, 'seafarers', true);
      expect(isExpansionOn(on, 'seafarers')).toBe(true);
      expect(on.expansions.fiveSix).toBe(true);
      expect(on.playerCount).toBe(playerCount);
    }
  });

  it('withScenario / selectedScenario round-trip the chosen scenario id', () => {
    const on = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 3 }, 'seafarers', true);
    expect(selectedScenario(on)).toBe(DEFAULT_SEAFARERS_SCENARIO);
    const set = withScenario(on, 'headingForNewShores');
    expect(set.expansions.seafarers).toEqual({ scenario: 'headingForNewShores' });
    expect(selectedScenario(set)).toBe('headingForNewShores');
  });

  it('withScenario picking a 5-6-ONLY scenario ("Open Horizons") forces fiveSix + bumps 3/4 up to 5 (T-752)', () => {
    const on = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'seafarers', true);
    expect(on.expansions.fiveSix).toBe(false);
    const set = withScenario(on, 'newWorld');
    expect(set.expansions.seafarers).toEqual({ scenario: 'newWorld' });
    expect(set.expansions.fiveSix).toBe(true);
    expect(set.playerCount).toBe(5);
  });

  it('withScenario picking "Open Horizons" from playerCount 6 keeps the count as-is (never bumped down)', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, seafarers: { scenario: DEFAULT_SEAFARERS_SCENARIO } },
    };
    const set = withScenario(cfg, 'newWorld');
    expect(set.playerCount).toBe(6);
    expect(set.expansions.fiveSix).toBe(true);
  });

  it('withScenario picking "Maiden Voyage" (all-counts) leaves fiveSix/playerCount alone', () => {
    const on = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'seafarers', true);
    const set = withScenario(on, 'headingForNewShores');
    expect(set.playerCount).toBe(4);
    expect(set.expansions.fiveSix).toBe(false);
  });

  it('withPlayerCount dropping to 3/4 while "Open Horizons" is selected falls back to the default scenario (T-752)', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, seafarers: { scenario: 'newWorld' } },
    };
    const next = withPlayerCount(cfg, 4);
    expect(next.playerCount).toBe(4);
    expect(next.expansions.fiveSix).toBe(false);
    expect(next.expansions.seafarers).toEqual({ scenario: DEFAULT_SEAFARERS_SCENARIO });
  });

  it('withPlayerCount moving between 5 and 6 while "Open Horizons" is selected keeps it selected', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 5,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, seafarers: { scenario: 'newWorld' } },
    };
    const next = withPlayerCount(cfg, 6);
    expect(next.playerCount).toBe(6);
    expect(next.expansions.fiveSix).toBe(true);
    expect(next.expansions.seafarers).toEqual({ scenario: 'newWorld' });
  });

  it('withExpansionToggled turning fiveSix off directly while "Open Horizons" is selected falls back to the default scenario (T-752)', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, seafarers: { scenario: 'newWorld' } },
    };
    const next = withExpansionToggled(cfg, 'fiveSix', false);
    expect(next.expansions.fiveSix).toBe(false);
    expect(next.expansions.seafarers).toEqual({ scenario: DEFAULT_SEAFARERS_SCENARIO });
    expect(next.playerCount).toBeLessThanOrEqual(4);
  });

  it('seafarers is selectable at 3 and 4 players (its board mode ships those counts)', () => {
    for (const playerCount of [3, 4] as const) {
      const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount };
      const on = withExpansionToggled(cfg, 'seafarers', true);
      expect(isExpansionOn(on, 'seafarers')).toBe(true);
      expect(on.playerCount).toBe(playerCount);
    }
  });

  it('renders the seafarers scenario picker (available now, no "coming soon" for it)', () => {
    const cfg = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'seafarers', true);
    const html = renderToStaticMarkup(createElement(OptionsPanel, { value: cfg, onChange: () => {} }));
    expect(html).toContain('Maiden Voyage');
    // The scenario radio must be enabled (aria-checked present, not aria-disabled="true" on it).
    const scenarioButton = html.slice(html.indexOf('Maiden Voyage') - 400, html.indexOf('Maiden Voyage'));
    expect(scenarioButton).not.toContain('aria-disabled="true"');
  });

  it('the picker hides "Open Horizons" at 4 players and shows it at 6 (T-752 player-count filtering)', () => {
    const at4 = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'seafarers', true);
    const html4 = renderToStaticMarkup(createElement(OptionsPanel, { value: at4, onChange: () => {} }));
    expect(html4).not.toContain('Open Horizons');

    const at6 = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 6, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true } }, 'seafarers', true);
    expect(at6.playerCount).toBe(6);
    const html6 = renderToStaticMarkup(createElement(OptionsPanel, { value: at6, onChange: () => {} }));
    expect(html6).toContain('Open Horizons');
    expect(html6).toContain('Maiden Voyage');
  });
});

describe('Cities & Knights option wiring (T-806)', () => {
  it('toggling citiesKnights on keeps a fiveSix selection (the C&K 5-6 combo, base 5-6 board)', () => {
    const next = withExpansionToggled(FIVE_SIX_ON, 'citiesKnights', true);
    expect(isExpansionOn(next, 'citiesKnights')).toBe(true);
    expect(next.expansions.fiveSix).toBe(true); // coexist — C&K 5-6 rides the base 5-6 board
    expect(next.expansions.seafarers).toBe(false);
    expect(next.playerCount).toBe(6); // 5/6 kept, since fiveSix is still on
  });

  it('turning fiveSix on keeps a citiesKnights selection (the C&K 5-6 combo)', () => {
    const ck = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'citiesKnights', true);
    const next = withExpansionToggled(ck, 'fiveSix', true);
    expect(next.expansions.citiesKnights).toBe(true);
    expect(next.expansions.fiveSix).toBe(true);
  });

  it('Seafarers + Cities & Knights COEXIST (the official combined game) — seafarers on keeps C&K', () => {
    const ck = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'citiesKnights', true);
    const next = withExpansionToggled(ck, 'seafarers', true);
    expect(isExpansionOn(next, 'citiesKnights')).toBe(true);
    expect(isExpansionOn(next, 'seafarers')).toBe(true);
    expect(next.expansions.fiveSix).toBe(false);
  });

  it('Seafarers + Cities & Knights COEXIST — C&K on keeps a seafarers selection', () => {
    const sea = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'seafarers', true);
    const next = withExpansionToggled(sea, 'citiesKnights', true);
    expect(isExpansionOn(next, 'seafarers')).toBe(true);
    expect(isExpansionOn(next, 'citiesKnights')).toBe(true);
    expect(next.expansions.fiveSix).toBe(false);
  });
});

describe('Traders & Barbarians option wiring (T-1008)', () => {
  it('toggling tradersBarbarians on selects the default scenario, caps players at 4, and clears every other expansion', () => {
    const from: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount: 4 };
    const next = withExpansionToggled(from, 'tradersBarbarians', true);
    expect(next.expansions.tradersBarbarians).toEqual({ scenario: DEFAULT_TB_SCENARIO });
    expect(next.expansions.fiveSix).toBe(false);
    expect(next.expansions.seafarers).toBe(false);
    expect(next.expansions.citiesKnights).toBe(false);
    expect(next.playerCount).toBeLessThanOrEqual(4);
  });

  // T-1050 (Phase 10B): the default scenario (fishermen) now supports 5–6 (TB_SCENARIO_SUPPORTS_56),
  // so this KEEPS fiveSix + the player count instead of dropping to the base board — mirrors the
  // Seafarers T-751 "turning seafarers on from a 5-6 fiveSix config KEEPS fiveSix" test above.
  it('turning tradersBarbarians on from a fiveSix 6-player config KEEPS fiveSix and the player count (T-1050 fishermen 5-6)', () => {
    const next = withExpansionToggled(FIVE_SIX_ON, 'tradersBarbarians', true);
    expect(isExpansionOn(next, 'tradersBarbarians')).toBe(true);
    expect(next.expansions.tradersBarbarians).toEqual({ scenario: DEFAULT_TB_SCENARIO });
    expect(next.expansions.fiveSix).toBe(true);
    expect(next.playerCount).toBe(6);
  });

  it('turning any other expansion on clears a tradersBarbarians selection (standalone from Seafarers/C&K)', () => {
    const tb = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'tradersBarbarians', true);
    expect(withExpansionToggled(tb, 'seafarers', true).expansions.tradersBarbarians).toBe(false);
    expect(withExpansionToggled(tb, 'citiesKnights', true).expansions.tradersBarbarians).toBe(false);
  });

  // T-1054: tradersBarbarians (the main scenario) was the LAST T&B scenario to gain 5–6 support —
  // every declared scenario now KEEPS fiveSix + the player count when toggled on, so this test no
  // longer has a "still 3-4p only" witness scenario left to assert against (T-1051/T-1053's own
  // versions of this test used rivers/caravans as that witness in turn, until each gained support).
  it('turning fiveSix on KEEPS every T&B scenario selection (5-6-capable, T-1050/T-1051/T-1052/T-1053/T-1054 — all five)', () => {
    const fish = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'tradersBarbarians', true);
    const fishWithFiveSix = withExpansionToggled(fish, 'fiveSix', true);
    expect(fishWithFiveSix.expansions.tradersBarbarians).toEqual({ scenario: 'fishermen' });
    expect(fishWithFiveSix.expansions.fiveSix).toBe(true);

    const rivers = withTBScenario(fish, 'rivers');
    const riversWithFiveSix = withExpansionToggled(rivers, 'fiveSix', true);
    expect(riversWithFiveSix.expansions.tradersBarbarians).toEqual({ scenario: 'rivers' });
    expect(riversWithFiveSix.expansions.fiveSix).toBe(true);

    const caravans = withTBScenario(fish, 'caravans');
    const caravansWithFiveSix = withExpansionToggled(caravans, 'fiveSix', true);
    expect(caravansWithFiveSix.expansions.tradersBarbarians).toEqual({ scenario: 'caravans' });
    expect(caravansWithFiveSix.expansions.fiveSix).toBe(true);

    const main = withTBScenario(fish, 'tradersBarbarians');
    const mainWithFiveSix = withExpansionToggled(main, 'fiveSix', true);
    expect(mainWithFiveSix.expansions.tradersBarbarians).toEqual({ scenario: 'tradersBarbarians' });
    expect(mainWithFiveSix.expansions.fiveSix).toBe(true);
  });

  it('withTBScenario / selectedTBScenario round-trip the chosen scenario id', () => {
    const on = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 3 }, 'tradersBarbarians', true);
    expect(selectedTBScenario(on)).toBe(DEFAULT_TB_SCENARIO);
    const set = withTBScenario(on, 'rivers');
    expect(set.expansions.tradersBarbarians).toEqual({ scenario: 'rivers' });
    expect(selectedTBScenario(set)).toBe('rivers');
  });

  it('withTBScenario switching from fishermen (5-6) to rivers (also 5-6, T-1051) while at 5/6 KEEPS the board', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, tradersBarbarians: { scenario: 'fishermen' } },
    };
    const set = withTBScenario(cfg, 'rivers');
    expect(set.expansions.tradersBarbarians).toEqual({ scenario: 'rivers' });
    expect(set.expansions.fiveSix).toBe(true);
    expect(set.playerCount).toBe(6);
  });

  it('withTBScenario switching from fishermen (5-6) to caravans (also 5-6, T-1053) while at 5/6 KEEPS the board', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, tradersBarbarians: { scenario: 'fishermen' } },
    };
    const set = withTBScenario(cfg, 'caravans');
    expect(set.expansions.tradersBarbarians).toEqual({ scenario: 'caravans' });
    expect(set.expansions.fiveSix).toBe(true);
    expect(set.playerCount).toBe(6);
  });

  it('withTBScenario switching from fishermen (5-6) to tradersBarbarians (main scenario, also 5-6, T-1054) while at 5/6 KEEPS the board', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, tradersBarbarians: { scenario: 'fishermen' } },
    };
    const set = withTBScenario(cfg, 'tradersBarbarians');
    expect(set.expansions.tradersBarbarians).toEqual({ scenario: 'tradersBarbarians' });
    expect(set.expansions.fiveSix).toBe(true);
    expect(set.playerCount).toBe(6);
  });

  it('withTBScenario switching between fishermen and rivers at 3/4 players leaves fiveSix/playerCount alone', () => {
    const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount: 4, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, tradersBarbarians: { scenario: 'fishermen' } } };
    const set = withTBScenario(cfg, 'rivers');
    expect(set.playerCount).toBe(4);
    expect(set.expansions.fiveSix).toBe(false);
  });

  it('tradersBarbarians is selectable at 3 and 4 players regardless of scenario (§TB1.2)', () => {
    for (const playerCount of [3, 4] as const) {
      const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount };
      const on = withExpansionToggled(cfg, 'tradersBarbarians', true);
      expect(isExpansionOn(on, 'tradersBarbarians')).toBe(true);
      expect(on.playerCount).toBe(playerCount);
    }
  });

  it('a fishermen selection is ALSO selectable at 5 and 6 players (T-1050 — the first 5-6-capable T&B scenario)', () => {
    for (const playerCount of [5, 6] as const) {
      const cfg: RoomConfig = {
        ...DEFAULT_ROOM_CONFIG,
        playerCount,
        expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true },
      };
      const on = withExpansionToggled(cfg, 'tradersBarbarians', true);
      expect(isExpansionOn(on, 'tradersBarbarians')).toBe(true);
      expect(on.expansions.tradersBarbarians).toEqual({ scenario: 'fishermen' });
      expect(on.expansions.fiveSix).toBe(true);
      expect(on.playerCount).toBe(playerCount);
    }
  });

  it('playerCountOptions enables 5/6 once a 5-6-capable T&B scenario (fishermen) is selected, even with fiveSix still off', () => {
    const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, tradersBarbarians: { scenario: 'fishermen' } } };
    expect(cfg.expansions.fiveSix).toBe(false);
    const options = playerCountOptions(cfg);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
  });

  it('playerCountOptions enables 5/6 for rivers too (T-1051 — the second 5-6-capable T&B scenario)', () => {
    const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, tradersBarbarians: { scenario: 'rivers' } } };
    const options = playerCountOptions(cfg);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
  });

  it('playerCountOptions enables 5/6 for caravans too (T-1053 — a 5-6-capable T&B scenario)', () => {
    const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, tradersBarbarians: { scenario: 'caravans' } } };
    const options = playerCountOptions(cfg);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
  });

  it('playerCountOptions enables 5/6 for tradersBarbarians too (T-1054 — the last 5-6-capable T&B scenario; every scenario now supports it)', () => {
    const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, tradersBarbarians: { scenario: 'tradersBarbarians' } } };
    const options = playerCountOptions(cfg);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
  });

  it('withPlayerCount picking 5/6 with fishermen selected turns fiveSix ON', () => {
    const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount: 4, expansions: { ...DEFAULT_ROOM_CONFIG.expansions, tradersBarbarians: { scenario: 'fishermen' } } };
    const next = withPlayerCount(cfg, 6);
    expect(next.playerCount).toBe(6);
    expect(next.expansions.fiveSix).toBe(true);
    expect(next.expansions.tradersBarbarians).toEqual({ scenario: 'fishermen' });
  });

  it('withPlayerCount picking 3/4 with fishermen selected turns fiveSix back OFF', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, tradersBarbarians: { scenario: 'fishermen' } },
    };
    const next = withPlayerCount(cfg, 4);
    expect(next.playerCount).toBe(4);
    expect(next.expansions.fiveSix).toBe(false);
  });

  it('renders the T&B scenario picker with all 5 scenarios, none disabled', () => {
    const cfg = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'tradersBarbarians', true);
    const html = renderToStaticMarkup(createElement(OptionsPanel, { value: cfg, onChange: () => {} }));
    expect(html).toContain('data-testid="tb-scenario-options"');
    expect(TB_SCENARIOS.length).toBe(5);
    expect(html).toContain('The Fishermen');
    expect(html).toContain('The Rivers');
    expect(html).toContain('The Caravans');
    expect(html).toContain('Barbarian Attack');
    // The main scenario shares its display name with the expansion itself ("Roads & Raiders");
    // React escapes the ampersand in rendered markup.
    expect(html.match(/Roads &amp; Raiders/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/aria-label="Roads &amp; Raiders scenario" aria-disabled="true"/);
  });

  it('does not render the scenario picker while tradersBarbarians is off', () => {
    const html = renderToStaticMarkup(createElement(OptionsPanel, { value: DEFAULT_ROOM_CONFIG, onChange: () => {} }));
    expect(html).not.toContain('data-testid="tb-scenario-options"');
  });
});

describe('Explorers & Pirates option wiring (T-1108)', () => {
  it('toggling explorersPirates on selects Landfall, caps players at 4, and clears every other expansion', () => {
    const from: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount: 4 };
    const next = withExpansionToggled(from, 'explorersPirates', true);
    expect(next.expansions.explorersPirates).toEqual({ scenario: DEFAULT_EP_SCENARIO });
    expect(next.expansions.fiveSix).toBe(false);
    expect(next.expansions.seafarers).toBe(false);
    expect(next.expansions.citiesKnights).toBe(false);
    expect(next.expansions.tradersBarbarians).toBe(false);
    expect(next.playerCount).toBeLessThanOrEqual(4);
  });

  // T-1150 (Phase 11B): the default scenario (landHo) now supports 5–6 (EP_SCENARIO_SUPPORTS_56), so
  // this KEEPS fiveSix + the player count instead of dropping to the base board — mirrors T-1050's
  // equivalent T&B/fishermen test.
  it('turning explorersPirates on from a fiveSix 6-player config KEEPS fiveSix and the player count (T-1150 landHo 5-6)', () => {
    const next = withExpansionToggled(FIVE_SIX_ON, 'explorersPirates', true);
    expect(isExpansionOn(next, 'explorersPirates')).toBe(true);
    expect(next.expansions.explorersPirates).toEqual({ scenario: DEFAULT_EP_SCENARIO });
    expect(next.expansions.fiveSix).toBe(true);
    expect(next.playerCount).toBe(6);
  });

  it('turning any other expansion on clears an explorersPirates selection (standalone from Seafarers/C&K/T&B)', () => {
    const ep = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'explorersPirates', true);
    expect(withExpansionToggled(ep, 'seafarers', true).expansions.explorersPirates).toBe(false);
    expect(withExpansionToggled(ep, 'citiesKnights', true).expansions.explorersPirates).toBe(false);
    expect(withExpansionToggled(ep, 'tradersBarbarians', true).expansions.explorersPirates).toBe(false);
  });

  // T-1150 (Phase 11B): landHo (the default, and today only, E&P scenario) supports 5–6
  // (EP_SCENARIO_SUPPORTS_56) — turning fiveSix ON no longer clears an explorersPirates selection,
  // mirrors T-1050's equivalent T&B/fishermen test.
  it('turning fiveSix on KEEPS an explorersPirates (landHo) selection (T-1150, 5-6-capable)', () => {
    const ep = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'explorersPirates', true);
    const withFiveSix = withExpansionToggled(ep, 'fiveSix', true);
    expect(withFiveSix.expansions.explorersPirates).toEqual({ scenario: DEFAULT_EP_SCENARIO });
    expect(withFiveSix.expansions.fiveSix).toBe(true);
  });

  it('turning explorersPirates on clears a tradersBarbarians selection, and vice versa', () => {
    const tb = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'tradersBarbarians', true);
    const ep = withExpansionToggled(tb, 'explorersPirates', true);
    expect(ep.expansions.tradersBarbarians).toBe(false);
    expect(isExpansionOn(ep, 'explorersPirates')).toBe(true);
    const backToTb = withExpansionToggled(ep, 'tradersBarbarians', true);
    expect(backToTb.expansions.explorersPirates).toBe(false);
  });

  it('withEPScenario / selectedEPScenario round-trip the chosen scenario id', () => {
    const on = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 3 }, 'explorersPirates', true);
    expect(selectedEPScenario(on)).toBe(DEFAULT_EP_SCENARIO);
    const set = withEPScenario(on, 'landHo');
    expect(set.expansions.explorersPirates).toEqual({ scenario: 'landHo' });
    expect(selectedEPScenario(set)).toBe('landHo');
  });

  // T-1161: switching to any of the four newly-listed scenarios at 5/6 players must NOT clamp back to
  // 4 — all five support the 5–6 extension (EP_SCENARIO_SUPPORTS_56), so `withEPScenario` keeps the
  // fiveSix board + the chosen player count. `EP_SCENARIOS.slice(1)` = the four non-landHo scenarios.
  it('withEPScenario to each newly-listed scenario keeps a 5/6 player count (no spurious clamp)', () => {
    for (const scenario of EP_SCENARIOS.slice(1)) {
      for (const playerCount of [5, 6] as const) {
        const cfg: RoomConfig = {
          ...DEFAULT_ROOM_CONFIG,
          playerCount,
          expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, explorersPirates: { scenario: 'landHo' } },
        };
        const set = withEPScenario(cfg, scenario);
        expect(set.expansions.explorersPirates).toEqual({ scenario });
        expect(set.expansions.fiveSix).toBe(true);
        expect(set.playerCount).toBe(playerCount);
      }
    }
  });

  it('playerCountOptions enables 5/6 for every newly-listed E&P scenario too (T-1161)', () => {
    for (const scenario of EP_SCENARIOS) {
      const cfg: RoomConfig = {
        ...DEFAULT_ROOM_CONFIG,
        expansions: { ...DEFAULT_ROOM_CONFIG.expansions, explorersPirates: { scenario } },
      };
      const options = playerCountOptions(cfg);
      expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
      expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
    }
  });

  it('explorersPirates is selectable at 3 and 4 players (EP1.2 — 3-4p only)', () => {
    for (const playerCount of [3, 4] as const) {
      const cfg: RoomConfig = { ...DEFAULT_ROOM_CONFIG, playerCount };
      const on = withExpansionToggled(cfg, 'explorersPirates', true);
      expect(isExpansionOn(on, 'explorersPirates')).toBe(true);
      expect(on.playerCount).toBe(playerCount);
    }
  });

  // T-1150 (Phase 11B): mirrors T-1050's equivalent T&B/fishermen `playerCountOptions`/`withPlayerCount`
  // tests — landHo (today's sole, and default, E&P scenario) is the first (and so far only) 5-6-capable
  // E&P scenario.
  it('playerCountOptions enables 5/6 once explorersPirates (landHo) is selected, even with fiveSix still off', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, explorersPirates: { scenario: 'landHo' } },
    };
    expect(cfg.expansions.fiveSix).toBe(false);
    const options = playerCountOptions(cfg);
    expect(options.find((o) => o.value === '5')?.disabled).toBe(false);
    expect(options.find((o) => o.value === '6')?.disabled).toBe(false);
  });

  it('withPlayerCount picking 5/6 with explorersPirates (landHo) selected turns fiveSix ON', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 4,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, explorersPirates: { scenario: 'landHo' } },
    };
    const next = withPlayerCount(cfg, 6);
    expect(next.playerCount).toBe(6);
    expect(next.expansions.fiveSix).toBe(true);
    expect(next.expansions.explorersPirates).toEqual({ scenario: 'landHo' });
  });

  it('withPlayerCount picking 3/4 with explorersPirates (landHo) selected turns fiveSix back OFF', () => {
    const cfg: RoomConfig = {
      ...DEFAULT_ROOM_CONFIG,
      playerCount: 6,
      expansions: { ...DEFAULT_ROOM_CONFIG.expansions, fiveSix: true, explorersPirates: { scenario: 'landHo' } },
    };
    const next = withPlayerCount(cfg, 4);
    expect(next.playerCount).toBe(4);
    expect(next.expansions.fiveSix).toBe(false);
  });

  it('renders the E&P scenario picker with all 5 scenarios, none disabled (T-1161)', () => {
    const cfg = withExpansionToggled({ ...DEFAULT_ROOM_CONFIG, playerCount: 4 }, 'explorersPirates', true);
    const html = renderToStaticMarkup(createElement(OptionsPanel, { value: cfg, onChange: () => {} }));
    expect(html).toContain('data-testid="ep-scenario-options"');
    expect(EP_SCENARIOS.length).toBe(5);
    expect(EP_SCENARIOS[0]).toBe(DEFAULT_EP_SCENARIO); // landHo stays first/default
    expect(html).toContain('Landfall');
    expect(html).toContain('Fish for Hexhaven');
    expect(html).toContain('Spices for Hexhaven');
    expect(html).toContain('The Pirate Lairs');
    // The full-campaign scenario shares its display name with the expansion itself
    // ("Sails & Scoundrels"); React escapes the ampersand in rendered markup.
    expect(html.match(/Sails &amp; Scoundrels/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(html).not.toMatch(/aria-label="Sails &amp; Scoundrels scenario" aria-disabled="true"/);
  });

  it('does not render the scenario picker while explorersPirates is off', () => {
    const html = renderToStaticMarkup(createElement(OptionsPanel, { value: DEFAULT_ROOM_CONFIG, onChange: () => {} }));
    expect(html).not.toContain('data-testid="ep-scenario-options"');
  });
});

describe('OptionsPanel markup (unshipped expansions render disabled + "coming soon")', () => {
  function render(value: RoomConfig = DEFAULT_ROOM_CONFIG) {
    return renderToStaticMarkup(createElement(OptionsPanel, { value, onChange: () => {} }));
  }

  // T-901 added a sibling "Modifiers" section (`data-testid="modifiers-options"`) whose entries can
  // be disabled for their OWN reasons (an incompatibility, not "unshipped") — these expansions-only
  // assertions scope to JUST the expansions fragment so that section's disabled state doesn't leak in.
  function expansionsHtml(html: string): string {
    const start = html.indexOf('data-testid="expansions-options"');
    const end = html.indexOf('data-testid="modifiers-options"');
    return html.slice(start, end === -1 ? undefined : end);
  }

  it('renders no UNSHIPPED expansion toggle group as aria-disabled (fiveSix/seafarers/citiesKnights all shipped)', () => {
    const html = expansionsHtml(render());
    expect(html.match(/role="radiogroup" aria-label="[^"]*" aria-disabled="true"/g)).toBeNull();
  });

  it('marks the 5/6 player-count options individually disabled, not the whole group', () => {
    const html = render();
    expect(html).toContain('aria-label="Number of players"');
    // The player-count group itself must not be disabled (3/4 stay pickable).
    expect(html).not.toMatch(/aria-label="Number of players" aria-disabled="true"/);
  });

  it('shows no "coming soon" badge now that fiveSix, seafarers and citiesKnights all ship', () => {
    const html = expansionsHtml(render());
    expect(html.match(/Coming soon/g)).toBeNull();
  });

  it('shows the turn-rule selector only when the 5-6 toggle is on', () => {
    expect(render(DEFAULT_ROOM_CONFIG)).not.toContain('data-testid="turn-rule-options"');
    const on = render(FIVE_SIX_ON);
    expect(on).toContain('data-testid="turn-rule-options"');
    expect(on).toContain('Special Building Phase');
    expect(on).toContain('Paired Players');
  });
});

describe('winnability warning markup (docs/07 D-034 "limits + winnability")', () => {
  function render(value: RoomConfig = DEFAULT_ROOM_CONFIG) {
    return renderToStaticMarkup(createElement(OptionsPanel, { value, onChange: () => {} }));
  }

  it('shows no winnability warning/endless note for the default (winnable) room config', () => {
    const html = render();
    expect(html).not.toContain('data-testid="winnability-warning"');
    expect(html).not.toContain('data-testid="winnability-endless-note"');
  });

  it('shows the prominent warning once the resolved target exceeds the reachable ceiling', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    const unwinnable = withCustomConstants(on, { targetVp: 999, maxSettlements: 1, maxCities: 1 });
    const html = render(unwinnable);
    expect(html).toContain('data-testid="winnability-warning"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('unwinnable');
  });

  it('shows the endless-game note (not the warning) once targetVp is set limitless', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    const endless = withCustomConstants(on, { targetVp: null });
    const html = render(endless);
    expect(html).not.toContain('data-testid="winnability-warning"');
    expect(html).toContain('data-testid="winnability-endless-note"');
    expect(html).toContain('Endless game');
  });
});

describe('turn-rule selector (X12, T-602 config.variants.fiveSixTurnRule)', () => {
  it('defaults to Paired Players when unset (SBP disabled in the picker, 2026-07-14)', () => {
    expect(selectedTurnRule(DEFAULT_ROOM_CONFIG)).toBe('pairedPlayers');
    expect(selectedTurnRule(FIVE_SIX_ON)).toBe('pairedPlayers');
  });

  it('pins Paired Players into the config when fiveSix is toggled on (engine still defaults to SBP)', () => {
    const on = withExpansionToggled(DEFAULT_ROOM_CONFIG, 'fiveSix', true);
    expect(on.variants?.fiveSixTurnRule).toBe('pairedPlayers');
  });

  it('records the chosen rule under config.variants (the create-room payload shape)', () => {
    const paired = withTurnRule(FIVE_SIX_ON, 'pairedPlayers');
    expect(paired.variants?.fiveSixTurnRule).toBe('pairedPlayers');
    expect(selectedTurnRule(paired)).toBe('pairedPlayers');
    expect(selectedTurnRule(withTurnRule(paired, 'sbp'))).toBe('sbp');
  });

  it('drops the (now-inert) turn-rule selection when fiveSix is toggled off', () => {
    const paired = withTurnRule(FIVE_SIX_ON, 'pairedPlayers');
    const off = withExpansionToggled(paired, 'fiveSix', false);
    expect(off.expansions.fiveSix).toBe(false);
    expect(off.variants?.fiveSixTurnRule).toBeUndefined();
  });
});

describe('Modifiers menu (T-901, docs/07 D-034) — pure toggle/param logic', () => {
  // Rendering assertions for the modifier ROWS themselves (grouping, disabled/tooltip states,
  // hexPieces per-kind picker, customConstants params panel) now live in ModifiersDialog.test.ts —
  // that UI moved out of OptionsPanel's inline markup into a popup (ModifiersDialog). This describe
  // block keeps only the pure gating-logic assertions, which are unaffected by where the UI lives.

  it('SHIPPED_MODIFIERS ships every declared modifier (T-901 proof pair, wave A-1, cardMods/helpers, eventCards, customConstants)', () => {
    expect(SHIPPED_MODIFIERS).toEqual({
      customTargetVp: true,
      combine2sAnd12s: true,
      eventCards: true,
      friendlyRobber: true,
      playDevSameTurn: true,
      harbormaster: true,
      cardMods: true,
      helpers: true,
      customConstants: true,
      hexPieces: true,
      shuffleNumbers: true,
      hiddenSetupNumbers: true,
    });
  });

  it('toggling hexPieces on (the generic path) seeds the one reference kind; off clears the key', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'hexPieces', true);
    expect(isModifierOn(on, 'hexPieces')).toBe(true);
    expect(on.modifiers?.hexPieces).toEqual(DEFAULT_HEX_PIECES_CONFIG);
    const off = withModifierToggled(on, 'hexPieces', false);
    expect(isModifierOn(off, 'hexPieces')).toBe(false);
    expect(off.modifiers).toBeUndefined();
  });

  describe('T-903: hexPieces per-kind multi-select', () => {
    // The per-kind picker's MARKUP (all 5 kind names) is asserted in ModifiersDialog.test.ts now
    // that the picker lives in the popup, not inline. These stay: pure gating logic only.

    it('hexPieceKinds/isHexPieceKindOn read an empty selection while the modifier is off', () => {
      expect(hexPieceKinds(DEFAULT_ROOM_CONFIG)).toEqual([]);
      expect(isHexPieceKindOn(DEFAULT_ROOM_CONFIG, 'trader')).toBe(false);
    });

    it('withHexPieceKindToggled turns a single kind on from scratch', () => {
      const on = withHexPieceKindToggled(DEFAULT_ROOM_CONFIG, 'trader', true);
      expect(isModifierOn(on, 'hexPieces')).toBe(true);
      expect(hexPieceKinds(on)).toEqual(['trader']);
      expect(isHexPieceKindOn(on, 'trader')).toBe(true);
      expect(isHexPieceKindOn(on, 'wizard')).toBe(false);
    });

    it('any subset may coexist — each kind toggles independently', () => {
      let config = withHexPieceKindToggled(DEFAULT_ROOM_CONFIG, 'wizard', true);
      config = withHexPieceKindToggled(config, 'banker', true);
      config = withHexPieceKindToggled(config, 'poaching', true);
      expect(hexPieceKinds(config).slice().sort()).toEqual(['banker', 'poaching', 'wizard']);
      // Turning one back off leaves the other two untouched.
      config = withHexPieceKindToggled(config, 'banker', false);
      expect(hexPieceKinds(config).slice().sort()).toEqual(['poaching', 'wizard']);
    });

    it('turning the LAST enabled kind off drops the whole hexPieces modifier entry', () => {
      const on = withHexPieceKindToggled(DEFAULT_ROOM_CONFIG, 'robinHood', true);
      const off = withHexPieceKindToggled(on, 'robinHood', false);
      expect(isModifierOn(off, 'hexPieces')).toBe(false);
      expect(off.modifiers).toBeUndefined();
    });

    it('toggling an already-on kind on again is a no-op (no duplicate entries)', () => {
      const on = withHexPieceKindToggled(DEFAULT_ROOM_CONFIG, 'wizard', true);
      const again = withHexPieceKindToggled(on, 'wizard', true);
      expect(hexPieceKinds(again)).toEqual(['wizard']);
    });
  });

  it('isModifierOn / withModifierToggled round-trip a param-less modifier', () => {
    expect(isModifierOn(DEFAULT_ROOM_CONFIG, 'combine2sAnd12s')).toBe(false);
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'combine2sAnd12s', true);
    expect(isModifierOn(on, 'combine2sAnd12s')).toBe(true);
    expect(on.modifiers?.combine2sAnd12s).toBe(true);
    const off = withModifierToggled(on, 'combine2sAnd12s', false);
    expect(isModifierOn(off, 'combine2sAnd12s')).toBe(false);
    // Dropping the only enabled modifier clears the whole `modifiers` object (byte-identical to an
    // untouched config — RK-13).
    expect(off.modifiers).toBeUndefined();
  });

  it('toggling customTargetVp on seeds the default param; withCustomTargetVp edits it', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customTargetVp', true);
    expect(isModifierOn(on, 'customTargetVp')).toBe(true);
    expect(customTargetVpValue(on)).toBe(DEFAULT_CUSTOM_TARGET_VP);
    const edited = withCustomTargetVp(on, 7);
    expect(customTargetVpValue(edited)).toBe(7);
  });

  it('withCustomTargetVp is a no-op while the modifier is off', () => {
    expect(withCustomTargetVp(DEFAULT_ROOM_CONFIG, 7)).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('toggling multiple modifiers keeps each other intact', () => {
    const both = withModifierToggled(
      withModifierToggled(DEFAULT_ROOM_CONFIG, 'customTargetVp', true),
      'combine2sAnd12s',
      true
    );
    expect(isModifierOn(both, 'customTargetVp')).toBe(true);
    expect(isModifierOn(both, 'combine2sAnd12s')).toBe(true);
    const oneOff = withModifierToggled(both, 'customTargetVp', false);
    expect(isModifierOn(oneOff, 'customTargetVp')).toBe(false);
    expect(isModifierOn(oneOff, 'combine2sAnd12s')).toBe(true);
  });

  // Rendering assertions for these rows (grouping, disabled states, the compatibility-matrix
  // tooltip reason, the customTargetVp/customConstants params panels appearing) now live in
  // ModifiersDialog.test.ts alongside the rest of the popup's markup.
});

describe('customConstants params panel (T-906, docs/07 D-034) — pure param logic', () => {
  // The panel's MARKUP (fields appearing once enabled) is asserted in ModifiersDialog.test.ts.

  it('toggling customConstants on seeds an EMPTY config (every field stays absent until edited)', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    expect(isModifierOn(on, 'customConstants')).toBe(true);
    expect(customConstantsConfig(on)).toEqual({});
  });

  it('simpleFieldValue defaults to the base constant while unset, then round-trips an edit', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    expect(simpleFieldValue(on, 'productionMultiplier')).toBe(1);
    const edited = withCustomConstants(on, { productionMultiplier: 3 });
    expect(simpleFieldValue(edited, 'productionMultiplier')).toBe(3);
  });

  it('withCustomConstants is a no-op while the modifier is off', () => {
    expect(withCustomConstants(DEFAULT_ROOM_CONFIG, { productionMultiplier: 3 })).toEqual(DEFAULT_ROOM_CONFIG);
  });

  it('startingResourceValue defaults to 0; withStartingResource sets/clears an amount', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    expect(startingResourceValue(on, 'brick')).toBe(0);
    const withBrick = withStartingResource(on, 'brick', 2);
    expect(startingResourceValue(withBrick, 'brick')).toBe(2);
    const cleared = withStartingResource(withBrick, 'brick', 0);
    expect(startingResourceValue(cleared, 'brick')).toBe(0);
    expect(customConstantsConfig(cleared).startingResources).toEqual({});
  });

  it('costItemValue defaults to the base COSTS table; withCostItemField overrides one cell without dropping the rest', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    expect(costItemValue(on, 'settlement', 'brick')).toBe(1);
    expect(costItemValue(on, 'settlement', 'wool')).toBe(1);
    const edited = withCostItemField(on, 'settlement', 'brick', 3);
    // The edited resource changes...
    expect(costItemValue(edited, 'settlement', 'brick')).toBe(3);
    // ...but the OTHER base resources for that item are snapshotted, not silently dropped.
    expect(costItemValue(edited, 'settlement', 'lumber')).toBe(1);
    expect(costItemValue(edited, 'settlement', 'wool')).toBe(1);
    expect(costItemValue(edited, 'settlement', 'grain')).toBe(1);
    // A different item (road) is untouched.
    expect(costItemValue(edited, 'road', 'brick')).toBe(1);
  });
});

describe('customConstants limits + Limitless toggles (docs/07 D-034 "limits + winnability") — pure param logic', () => {
  it('every cap field defaults to its base constant while unset', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    expect(capFieldValue(on, 'targetVp')).toBe(10);
    expect(capFieldValue(on, 'maxSettlements')).toBe(5);
    expect(capFieldValue(on, 'maxCities')).toBe(4);
    expect(capFieldValue(on, 'maxRoads')).toBe(15);
    expect(capFieldValue(on, 'maxCityWalls')).toBe(3);
    expect(capFieldValue(on, 'maxKnightsPerLevel')).toBe(2);
    expect(capFieldValue(on, 'maxProgressCards')).toBe(4);
    for (const field of CAP_FIELDS) expect(isCapFieldLimitless(on, field)).toBe(false);
  });

  it('withCapField sets a finite override, round-tripped by capFieldValue', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    const edited = withCapField(on, 'maxSettlements', 8);
    expect(capFieldValue(edited, 'maxSettlements')).toBe(8);
    expect(isCapFieldLimitless(edited, 'maxSettlements')).toBe(false);
  });

  it('withCapFieldLimitless(true) sets the null sentinel; capFieldValue reports null', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    const limitless = withCapFieldLimitless(on, 'maxCities', true);
    expect(isCapFieldLimitless(limitless, 'maxCities')).toBe(true);
    expect(capFieldValue(limitless, 'maxCities')).toBeNull();
    expect(customConstantsConfig(limitless).maxCities).toBeNull();
  });

  it('withCapFieldLimitless(false) restores the base default rather than clearing to absent', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    const limitless = withCapFieldLimitless(on, 'maxRoads', true);
    const restored = withCapFieldLimitless(limitless, 'maxRoads', false);
    expect(isCapFieldLimitless(restored, 'maxRoads')).toBe(false);
    expect(capFieldValue(restored, 'maxRoads')).toBe(15);
  });
});

describe('winnabilityFor / gameConfigForWinnability (docs/07 D-034 "limits + winnability")', () => {
  it('the default room config is winnable (base 10 VP target, base piece caps)', () => {
    const result = winnabilityFor(DEFAULT_ROOM_CONFIG);
    expect(result.winnable).toBe(true);
    expect(result.endless).toBe(false);
  });

  it('a customConstants.targetVp above the resolved max reports unwinnable with the reachable ceiling', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    // Base max: 4 cities x 2 + 5 settlements x 1 = 13, +2 longest road +2 largest army +5 dev VP = 22.
    // A target far beyond any resolved source (buildings capped at the default 5/4 piece supply)
    // is unreachable once the piece caps stay at their base default.
    const tooHigh = withCustomConstants(on, { targetVp: 999, maxSettlements: 1, maxCities: 1 });
    const result = winnabilityFor(tooHigh);
    expect(result.winnable).toBe(false);
    expect(result.endless).toBe(false);
    expect(typeof result.maxAchievable).toBe('number');
  });

  it('a null (limitless) targetVp reports endless — never unwinnable', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    const endless = withCustomConstants(on, { targetVp: null });
    const result = winnabilityFor(endless);
    expect(result.endless).toBe(true);
    expect(result.winnable).toBe(true);
  });

  it('gameConfigForWinnability carries the room selection through to a full GameConfig shape', () => {
    const config = gameConfigForWinnability(DEFAULT_ROOM_CONFIG);
    expect(config.playerCount).toBe(DEFAULT_ROOM_CONFIG.playerCount);
    expect(config.expansions).toEqual(DEFAULT_ROOM_CONFIG.expansions);
  });
});

describe('Modifiers button (popup relocation — the inline modifier menu now opens a Modal)', () => {
  function render(value: RoomConfig = DEFAULT_ROOM_CONFIG) {
    return renderToStaticMarkup(createElement(OptionsPanel, { value, onChange: () => {} }));
  }

  it('shows a "Modifiers (0)" count when nothing is enabled', () => {
    const html = render(DEFAULT_ROOM_CONFIG);
    expect(html).toContain('data-testid="modifiers-open-button"');
    const button = html.slice(html.indexOf('data-testid="modifiers-open-button"'));
    expect(button.slice(0, button.indexOf('</button>'))).toContain('Modifiers (0)');
  });

  it('the count reflects exactly the enabled modifiers, including hexPieces once a kind is picked', () => {
    let config = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customTargetVp', true);
    config = withModifierToggled(config, 'combine2sAnd12s', true);
    config = withHexPieceKindToggled(config, 'wizard', true);
    const html = render(config);
    const button = html.slice(html.indexOf('data-testid="modifiers-open-button"'));
    expect(button.slice(0, button.indexOf('</button>'))).toContain('Modifiers (3)');
  });

  it('the button opens a dialog (aria-haspopup), and the popup content is NOT in the static markup while closed', () => {
    const config = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customTargetVp', true);
    const html = render(config);
    expect(html).toContain('aria-haspopup="dialog"');
    // The dialog defaults to closed — none of its grouped-section content should leak into the
    // panel's own markup (it used to render inline before this relocation).
    expect(html).not.toContain('data-testid="modifiers-dialog-content"');
    expect(html).not.toContain('role="dialog"');
  });
});
