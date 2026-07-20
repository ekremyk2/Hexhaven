// Mechanical accessibility checks (T-307 requirement 6 / docs/11 §6: "Text contrast >= 4.5:1 on
// parchment", "visible focus rings"). Reads the ACTUAL tokens.css off disk (like
// i18n/parity.test.ts reads the real JSON) rather than hand-copied hex constants, so a token edit
// that regresses contrast fails this test instead of silently drifting.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  MIN_CONTRAST_TEXT,
  MIN_CONTRAST_UI,
  parseCssCustomProperties,
} from './a11y';

const THEME_DIR = dirname(fileURLToPath(import.meta.url));
const tokensCss = readFileSync(join(THEME_DIR, 'tokens.css'), 'utf8');
const tokens = parseCssCustomProperties(tokensCss);

function token(name: string): string {
  const value = tokens.get(name);
  if (!value) throw new Error(`BUG: token --${name} not found in tokens.css`);
  return value;
}

describe('design token contrast (docs/11 §6, WCAG 2.1)', () => {
  // Pairs actually used as text-on-surface by src/ui/** primitives.
  const textPairs: Array<[string, string, string]> = [
    ['ink', 'panel', 'primary body text on parchment panels'],
    ['ink-soft', 'panel', 'secondary/help text on parchment panels'],
    ['on-accent', 'accent', 'Button primary label on terracotta fill'],
    ['on-accent', 'danger', 'Button danger label on danger fill'],
    ['ink', 'accent-gold', 'Badge "gold" label on the award/victory fill'],
    ['ink', 'panel-edge', 'ink text on the panel border tone (worst-case placeholder/disabled)'],
    ['panel', 'table-b', 'light text on the deep-ocean table backdrop'],
  ];

  for (const [fg, bg, description] of textPairs) {
    it(`${description}: --${fg} on --${bg} >= ${MIN_CONTRAST_TEXT}:1`, () => {
      const ratio = contrastRatio(token(fg), token(bg));
      expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST_TEXT);
    });
  }

  // Non-text UI components (focus rings, borders) — WCAG 1.4.11 uses a lower 3:1 bar. The focus
  // ring reuses --accent directly (docs/11 §6: "visible focus rings (--accent 2px)"); every
  // src/ui/** primitive that gets a focus ring lives on a parchment panel surface.
  const uiPairs: Array<[string, string, string]> = [
    ['accent', 'panel', 'focus ring (--accent) visible against parchment panels'],
  ];

  for (const [fg, bg, description] of uiPairs) {
    it(`${description}: --${fg} on --${bg} >= ${MIN_CONTRAST_UI}:1`, () => {
      const ratio = contrastRatio(token(fg), token(bg));
      expect(ratio).toBeGreaterThanOrEqual(MIN_CONTRAST_UI);
    });
  }

  // KNOWN EXCEPTION (flagged for PM review — see T-307 Implementation notes): docs/11 §1 pins
  // seat3 at #e07b28 (terracotta-orange), which measures ~2.65:1 against the light badge ink —
  // below even the 3:1 non-text bar. The token value is docs/11-owned (§7: deviations require
  // editing the doc first), so this task flags rather than silently repaints the seat palette.
  const KNOWN_SEAT_CONTRAST_EXCEPTIONS = new Set(['seat-3']);

  it('every other seat color pairs with a badge ink (docs/11 §4) that clears the UI-component bar', () => {
    const seatKeys = ['seat-0', 'seat-1', 'seat-2', 'seat-3', 'seat-4', 'seat-5'];
    for (const seatKey of seatKeys) {
      if (KNOWN_SEAT_CONTRAST_EXCEPTIONS.has(seatKey)) continue;
      const seatColor = token(seatKey);
      // Mirrors board/palette.ts's contrastInk(): seat2 (near-white) gets dark ink, everyone else
      // gets the light panel/cream ink.
      const badgeInk = seatKey === 'seat-2' ? token('ink') : token('panel');
      const ratio = contrastRatio(seatColor, badgeInk);
      expect(ratio, `--${seatKey} vs its badge ink`).toBeGreaterThanOrEqual(MIN_CONTRAST_UI);
    }
  });

  it('documents the seat3 exception without letting it silently improve or regress further', () => {
    const ratio = contrastRatio(token('seat-3'), token('panel'));
    expect(ratio).toBeGreaterThan(2);
    expect(ratio).toBeLessThan(MIN_CONTRAST_UI);
  });
});
