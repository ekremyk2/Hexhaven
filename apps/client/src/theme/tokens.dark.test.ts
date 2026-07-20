// Dark-theme contrast guard (T-505 dark mode), mirroring a11y.test.ts for the LIGHT palette. Reads
// the REAL tokens.css (base) and tokens.dark.css (overrides) off disk and merges them into the
// effective dark palette, so a dark token edit that regresses contrast fails here instead of
// silently shipping an unreadable surface (docs/11 §6, WCAG 2.1).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio, MIN_CONTRAST_TEXT, parseCssCustomProperties } from './a11y';

const THEME_DIR = dirname(fileURLToPath(import.meta.url));
const lightTokens = parseCssCustomProperties(readFileSync(join(THEME_DIR, 'tokens.css'), 'utf8'));
const darkOverrides = parseCssCustomProperties(readFileSync(join(THEME_DIR, 'tokens.dark.css'), 'utf8'));

// Effective dark palette = light base with the dark block layered on top (exactly how the cascade
// resolves `:root[data-theme='dark']` over `:root`).
const darkTokens = new Map(lightTokens);
for (const [name, value] of darkOverrides) darkTokens.set(name, value);

function token(name: string): string {
  const value = darkTokens.get(name);
  if (!value) throw new Error(`BUG: token --${name} not resolvable in the dark palette`);
  return value;
}

describe('dark palette contrast (docs/11 §6, WCAG 2.1)', () => {
  // Sanity: the dark block must actually flip the surfaces (guards against the file being emptied /
  // the import being dropped from index.css).
  it('darkens the panel surface and lightens body ink versus the light theme', () => {
    expect(token('panel')).not.toBe(lightTokens.get('panel'));
    expect(token('ink')).not.toBe(lightTokens.get('ink'));
  });

  const textPairs: Array<[string, string, string]> = [
    ['ink', 'panel', 'primary body text on dark parchment panels'],
    ['ink-soft', 'panel', 'secondary/help text on dark parchment panels'],
    ['ink', 'field', 'text-input text on the dark field surface'],
    ['on-accent', 'accent', 'button primary label on terracotta fill'],
    ['on-accent', 'danger-solid', 'button/badge danger label on the danger fill'],
    ['ink-onlight', 'accent-gold', 'gold badge / award label on the gold fill'],
    ['ink-ondark', 'table-b', 'header + on-ocean text on the dark table backdrop'],
    // The dark-specific one: --danger is used as *text* (errors, warnings, low-bank) and MUST read
    // on the dark panel — this is why it brightens in dark rather than staying the fill red.
    ['danger', 'panel', 'danger/error TEXT on dark parchment panels'],
  ];

  for (const [fg, bg, description] of textPairs) {
    it(`${description}: --${fg} on --${bg} >= ${MIN_CONTRAST_TEXT}:1`, () => {
      expect(contrastRatio(token(fg), token(bg))).toBeGreaterThanOrEqual(MIN_CONTRAST_TEXT);
    });
  }
});
