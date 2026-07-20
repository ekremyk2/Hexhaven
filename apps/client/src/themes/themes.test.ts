// Theme registry tests (T-907). Pure data-shape checks — no rendering, no engine involvement.
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_ID, THEME_IDS, THEMES, themeDefinition, themedPieceLabelKey, type ThemedPieceKind } from './themes';

const KINDS: ThemedPieceKind[] = ['robber', 'settlement', 'city', 'road'];

describe('THEMES registry (T-907)', () => {
  it('declares exactly the ids in THEME_IDS, no more, no less', () => {
    expect(new Set(Object.keys(THEMES))).toEqual(new Set(THEME_IDS));
  });

  it('DEFAULT_THEME_ID is one of the declared themes', () => {
    expect(THEME_IDS).toContain(DEFAULT_THEME_ID);
  });

  it.each(THEME_IDS)('theme "%s" declares every piece-kind label key + matching i18n identity keys', (id) => {
    const def = themeDefinition(id);
    expect(def.id).toBe(id);
    expect(def.nameKey).toBe(`theme.${id}.name`);
    expect(def.descriptionKey).toBe(`theme.${id}.description`);
    for (const kind of KINDS) {
      expect(def.labelKeys[kind]).toBe(`piece.${id}.${kind}`);
      expect(themedPieceLabelKey(id, kind)).toBe(def.labelKeys[kind]);
    }
  });

  it.each(THEME_IDS)('theme "%s" uses a docs/11 §1 accent token, not an ad-hoc hex', (id) => {
    // docs/11 §1: --accent (#b3541e terracotta), --accent-gold (#c9a227).
    expect(['#b3541e', '#c9a227']).toContain(themeDefinition(id).accent);
  });

  it('classic reuses the base game\'s robber silhouette (no reskin)', () => {
    expect(THEMES.classic.robberArt).toBe('classicPawn');
  });

  it('pirates and harvest each draw a distinct, non-classic robber silhouette', () => {
    expect(THEMES.pirates.robberArt).not.toBe('classicPawn');
    expect(THEMES.harvest.robberArt).not.toBe('classicPawn');
    expect(THEMES.pirates.robberArt).not.toBe(THEMES.harvest.robberArt);
  });

  it('classic\'s piece labels are the vanilla base-game terms (identity reskin)', () => {
    const def = THEMES.classic;
    expect(def.labelKeys).toEqual({
      robber: 'piece.classic.robber',
      settlement: 'piece.classic.settlement',
      city: 'piece.classic.city',
      road: 'piece.classic.road',
    });
  });
});
