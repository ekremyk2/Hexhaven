// Popup-relocation tests (user request: convert OptionsPanel's inline modifier multi-select into
// a dedicated Modal). Follows the same `renderToStaticMarkup` + real-i18next-instance convention as
// OptionsPanel.test.ts (no jsdom/@testing-library in this repo's test stack, so "the button opens
// the modal" is exercised the same way GoldDialog/DiscardModal are: render the dialog directly with
// `open: true`/`open: false` rather than simulating a click — see GoldDialog.test.ts's header note).
// The pure toggle/param LOGIC (`withModifierToggled`, `withHexPieceKindToggled`, the customConstants
// helpers, etc.) is already exhaustively covered in OptionsPanel.test.ts; this file only asserts the
// dialog's markup: grouping, the disabled/tooltip-reason states, and the sub-panels revealing.
import { createElement } from 'react';
import i18next from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';
import { describe, expect, it } from 'vitest';
import type { RoomConfig } from '@hexhaven/shared';
import enCommon from '../i18n/en/common.json';
import enLobby from '../i18n/en/lobby.json';
import {
  DEFAULT_ROOM_CONFIG,
  isCustomTargetVpLimitless,
  withCustomConstants,
  withCustomTargetVpLimitless,
  withExpansionToggled,
  withModifierToggled,
} from './OptionsPanel';
import { ModifiersDialog } from './ModifiersDialog';

void i18next.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  ns: ['common', 'lobby'],
  defaultNS: 'common',
  resources: { en: { common: enCommon, lobby: enLobby } },
  interpolation: { escapeValue: false },
});

const CK_ON: RoomConfig = withExpansionToggled(DEFAULT_ROOM_CONFIG, 'citiesKnights', true);
const NO_OP = () => {};

function render(open: boolean, value: RoomConfig = DEFAULT_ROOM_CONFIG) {
  return renderToStaticMarkup(createElement(ModifiersDialog, { open, value, onChange: NO_OP, onClose: NO_OP }));
}

describe('ModifiersDialog (popup relocation of the T-901 inline modifier menu)', () => {
  it('renders nothing while closed', () => {
    expect(render(false)).toBe('');
  });

  it('renders as a labeled dialog when open, titled "Modifiers"', () => {
    const html = render(true);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Modifiers');
    expect(html).toContain('data-testid="modifiers-dialog-content"');
  });

  it('groups every modifier into exactly one of the labeled sections', () => {
    const html = render(true);
    expect(html).toContain('data-testid="modifier-group-robberPieces"');
    expect(html).toContain('data-testid="modifier-group-cards"');
    expect(html).toContain('data-testid="modifier-group-houseRules"');
    expect(html).toContain('data-testid="modifier-group-board"');
    expect(html).toContain('Robber &amp; pieces');
    expect(html).toContain('Cards');
    expect(html).toContain('House rules');
    expect(html).toContain('Board setup');

    const robberGroup = html.slice(
      html.indexOf('data-testid="modifier-group-robberPieces"'),
      html.indexOf('data-testid="modifier-group-cards"'),
    );
    expect(robberGroup).toContain('Friendly Robber');
    expect(robberGroup).toContain('Multi-piece hex framework');

    const cardsGroup = html.slice(
      html.indexOf('data-testid="modifier-group-cards"'),
      html.indexOf('data-testid="modifier-group-houseRules"'),
    );
    expect(cardsGroup).toContain('Card Mods');
    expect(cardsGroup).toContain('Event Cards');
    expect(cardsGroup).toContain('The Helpers of Hexhaven');

    const houseRulesGroup = html.slice(
      html.indexOf('data-testid="modifier-group-houseRules"'),
      html.indexOf('data-testid="modifier-group-board"'),
    );
    expect(houseRulesGroup).toContain('Custom target VP');
    expect(houseRulesGroup).toContain('Combine 2s &amp; 12s');
    expect(houseRulesGroup).toContain('Play dev card same turn');
    expect(houseRulesGroup).toContain('Harbormaster');
    expect(houseRulesGroup).toContain('Custom game');

    const boardGroup = html.slice(html.indexOf('data-testid="modifier-group-board"'));
    expect(boardGroup).toContain('Shuffle numbers');
    expect(boardGroup).toContain('Blind placement');
  });

  it('renders the wave A-1 + cardMods/helpers modifiers all enabled (no conflicting selection)', () => {
    const html = render(true);
    expect(html).not.toMatch(/aria-label="Friendly Robber" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Play dev card same turn" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Harbormaster" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Card Mods" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="The Helpers of Hexhaven" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Multi-piece hex framework" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Event Cards" aria-disabled="true"/);
  });

  it('renders the hexPieces per-kind picker block with all 5 kind names', () => {
    const html = render(true);
    const block = html.slice(html.indexOf('data-testid="hexpieces-options"'));
    expect(block).toContain('Wizard');
    expect(block).toContain('Trader');
    expect(block).toContain('Robin Hood');
    expect(block).toContain('Banker');
    expect(block).toContain('Poaching');
  });

  it('explains the robber is always in play WITHOUT a togglable robber row (B-44 → B-47)', () => {
    const html = render(true);
    const block = html.slice(html.indexOf('data-testid="hexpieces-options"'));
    // A plain note, not a locked toggle — the robber is the base piece, not a hexPieces kind, and
    // picking none of the kinds is a valid "no extra hex piece" game.
    expect(block).toContain('The robber is always in play');
    expect(block).not.toContain('aria-label="Robber"');
  });

  it('a modifier toggle flips aria-checked once its config value is on (Friendly Robber)', () => {
    // The SegmentedControl's group div carries `aria-label`; its FIRST child radio button is the
    // "on" option (`onOffOptions`'s order), so that button's `aria-checked` reflects whether the
    // modifier is currently enabled.
    function firstRadioTag(html: string, ariaLabel: string): string {
      const group = html.slice(html.indexOf(`aria-label="${ariaLabel}"`));
      const radio = group.slice(group.indexOf('role="radio"'));
      return radio.slice(0, radio.indexOf('>'));
    }

    const off = render(true, DEFAULT_ROOM_CONFIG);
    expect(firstRadioTag(off, 'Friendly Robber')).toContain('aria-checked="false"');

    const on = render(true, withModifierToggled(DEFAULT_ROOM_CONFIG, 'friendlyRobber', true));
    expect(firstRadioTag(on, 'Friendly Robber')).toContain('aria-checked="true"');
  });

  it('an incompatible modifier (eventCards vs citiesKnights) is disabled with the matrix reason', () => {
    const html = render(true, CK_ON);
    // The control is disabled; the matrix REASON text now lives in a hover-only portal tooltip
    // (Tooltip.tsx), so it isn't in static markup — the disabled state is what we assert here.
    expect(html).toMatch(/aria-label="Event Cards" aria-disabled="true"/);
  });

  it('unrelated modifiers stay enabled even when citiesKnights conflicts with eventCards', () => {
    const html = render(true, CK_ON);
    expect(html).not.toMatch(/aria-label="Custom target VP" aria-disabled="true"/);
    expect(html).not.toMatch(/aria-label="Combine 2s &amp; 12s" aria-disabled="true"/);
  });

  it('shows the custom-target-VP number input only once that modifier is enabled', () => {
    expect(render(true, DEFAULT_ROOM_CONFIG)).not.toContain('data-testid="custom-target-vp-options"');
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customTargetVp', true);
    const html = render(true, on);
    expect(html).toContain('data-testid="custom-target-vp-options"');
    expect(html).toContain('Target VP');
  });

  it('Custom Target VP has an Unlimited toggle merged in (B-44), storing the finite LIMITLESS sentinel', () => {
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customTargetVp', true);
    const html = render(true, on);
    const block = html.slice(html.indexOf('data-testid="custom-target-vp-options"'));
    expect(block).toContain('Limitless'); // the Unlimited option label
    // Turning it on flips the stored value to the limitless sentinel (endless game); off returns finite.
    const limitless = withCustomTargetVpLimitless(on, true);
    expect(isCustomTargetVpLimitless(limitless)).toBe(true);
    expect(isCustomTargetVpLimitless(withCustomTargetVpLimitless(limitless, false))).toBe(false);
  });

  it('shows the custom-game (customConstants) params panel only once that modifier is enabled', () => {
    expect(render(true, DEFAULT_ROOM_CONFIG)).not.toContain('data-testid="custom-constants-options"');
    const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
    const html = render(true, on);
    expect(html).toContain('data-testid="custom-constants-options"');
    expect(html).toContain('Production multiplier');
    expect(html).toContain('Road Building count');
  });

  describe('limits + Limitless toggles (docs/07 D-034 "limits + winnability")', () => {
    it('base game: only the 3 non-expansion caps show (target VP merged out; C&K caps gated)', () => {
      const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
      const html = render(true, on);
      // Target VP merged into the single "Custom Target VP" control; C&K-only caps are hidden with
      // C&K off (B-45 expansion-gating). Only the 3 base piece caps remain.
      expect(html).not.toContain('Target VP (or endless)');
      expect(html).toContain('Max settlements');
      expect(html).toContain('Max cities');
      expect(html).toContain('Max roads');
      expect(html).not.toContain('Max city walls');
      expect(html).not.toContain('Max knights per level');
      expect(html).not.toContain('Max progress cards in hand');
      expect(html.match(/Limitless/g)?.length).toBe(3);
    });

    it('Cities & Knights game: the 3 C&K-only caps appear too (6 total)', () => {
      const on = withModifierToggled(CK_ON, 'customConstants', true);
      const html = render(true, on);
      expect(html).toContain('Max city walls');
      expect(html).toContain('Max knights per level');
      expect(html).toContain('Max progress cards in hand');
      expect(html.match(/Limitless/g)?.length).toBe(6);
    });

    it('the number input is disabled once that field is toggled Limitless', () => {
      const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
      const limitless = withCustomConstants(on, { maxSettlements: null });
      const html = render(true, limitless);
      const label = html.indexOf('Max settlements');
      const inputTag = html.slice(label, html.indexOf('/>', label));
      expect(inputTag).toContain('disabled=""');
    });
  });

  // Bug fix regression (docs/11 §6 "no layout thrash"): the dialog previously overflowed on BOTH
  // axes — the customConstants cost grid (4 items x 5 resources) forced a fixed 5-column grid
  // wider than the modal, growing a horizontal scrollbar alongside Modal's own vertical one.
  describe('bounded single-axis scroll (Bug 2: no horizontal + vertical double scrollbar)', () => {
    it("Modal's dialog container disables horizontal overflow and bounds vertical overflow to one scroll region", () => {
      const html = render(true);
      const dialog = html.slice(html.indexOf('role="dialog"'));
      const openTag = dialog.slice(0, dialog.indexOf('>'));
      expect(openTag).toContain('overflow-x-hidden');
      expect(openTag).toContain('overflow-y-auto');
      expect(openTag).toContain('max-h-[85vh]');
    });

    it('the starting-resources and cost-item grids wrap instead of forcing a fixed 5-column row', () => {
      const on = withModifierToggled(DEFAULT_ROOM_CONFIG, 'customConstants', true);
      const html = render(true, on);
      expect(html).not.toContain('grid-cols-5');
      expect(html).toContain('grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))]');
    });
  });
});
