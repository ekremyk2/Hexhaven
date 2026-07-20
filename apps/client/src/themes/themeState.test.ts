// Cosmetic-theme persistence tests (T-907 PM wiring). Same localStorage-double convention as
// `theme/theme.test.ts` (this workspace runs vitest under `environment: "node"` — no real
// localStorage, so a plain Map-backed stub stands in for it).
import { afterEach, describe, expect, it } from 'vitest';
import { COSMETIC_THEME_STORAGE_KEY, persistThemeId, readStoredThemeId } from './themeState';

type Globals = { localStorage?: unknown };

function stubLocalStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  (globalThis as Globals).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

describe('readStoredThemeId / persistThemeId (T-907 persistence)', () => {
  afterEach(() => {
    delete (globalThis as Globals).localStorage;
  });

  it('defaults to "classic" when nothing is stored (first load — identity theme)', () => {
    stubLocalStorage();
    expect(readStoredThemeId()).toBe('classic');
  });

  it('returns a valid stored theme id', () => {
    stubLocalStorage({ [COSMETIC_THEME_STORAGE_KEY]: 'pirates' });
    expect(readStoredThemeId()).toBe('pirates');
  });

  it('ignores a garbage stored value and falls back to "classic"', () => {
    stubLocalStorage({ [COSMETIC_THEME_STORAGE_KEY]: 'neon' });
    expect(readStoredThemeId()).toBe('classic');
  });

  it('round-trips through persistThemeId, under its OWN key (never collides with hexhaven.theme)', () => {
    const store = stubLocalStorage();
    persistThemeId('harvest');
    expect(store.get(COSMETIC_THEME_STORAGE_KEY)).toBe('harvest');
    expect(readStoredThemeId()).toBe('harvest');
    expect(COSMETIC_THEME_STORAGE_KEY).not.toBe('hexhaven.theme');
    expect(COSMETIC_THEME_STORAGE_KEY).not.toBe('hexhaven.lang');
  });

  it('falls back gracefully when localStorage is unavailable (private mode)', () => {
    delete (globalThis as Globals).localStorage;
    expect(readStoredThemeId()).toBe('classic');
    expect(() => persistThemeId('pirates')).not.toThrow();
  });
});
