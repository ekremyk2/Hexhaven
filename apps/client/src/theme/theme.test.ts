// Tests for the theme logic (T-505 dark mode): persistence + the prefers-color-scheme default.
// Like motion.test.ts, this workspace runs vitest under `environment: "node"` (no jsdom), so
// `window.matchMedia`, `localStorage`, and `document` are stubbed as plain objects — the module
// only reads/writes simple values on them, no real DOM is involved.
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyResolvedTheme,
  initTheme,
  isThemeChoice,
  persistChoice,
  readStoredChoice,
  resolveTheme,
  systemPrefersDark,
  THEME_STORAGE_KEY,
} from './theme';

type Globals = {
  window?: unknown;
  localStorage?: unknown;
  document?: unknown;
};

function stubMatchMedia(prefersDark: boolean) {
  (globalThis as Globals).window = {
    matchMedia: (query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  };
}

/** Minimal Map-backed localStorage double. */
function stubLocalStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  (globalThis as Globals).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

/** Minimal document double exposing just documentElement.dataset for applyResolvedTheme. */
function stubDocument() {
  const dataset: Record<string, string> = {};
  (globalThis as Globals).document = { documentElement: { dataset } };
  return dataset;
}

describe('isThemeChoice', () => {
  it('accepts the three valid choices and rejects anything else', () => {
    expect(isThemeChoice('light')).toBe(true);
    expect(isThemeChoice('dark')).toBe(true);
    expect(isThemeChoice('system')).toBe(true);
    expect(isThemeChoice('bogus')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });
});

describe('systemPrefersDark', () => {
  afterEach(() => {
    delete (globalThis as Globals).window;
  });

  it('is false when there is no window (SSR/test-safe)', () => {
    delete (globalThis as Globals).window;
    expect(systemPrefersDark()).toBe(false);
  });

  it('reflects the matchMedia result', () => {
    stubMatchMedia(true);
    expect(systemPrefersDark()).toBe(true);
    stubMatchMedia(false);
    expect(systemPrefersDark()).toBe(false);
  });
});

describe('readStoredChoice (persistence)', () => {
  afterEach(() => {
    delete (globalThis as Globals).localStorage;
  });

  it('defaults to "system" when nothing is stored (first load)', () => {
    stubLocalStorage();
    expect(readStoredChoice()).toBe('system');
  });

  it('returns a valid stored choice', () => {
    stubLocalStorage({ [THEME_STORAGE_KEY]: 'dark' });
    expect(readStoredChoice()).toBe('dark');
  });

  it('ignores a garbage stored value and falls back to "system"', () => {
    stubLocalStorage({ [THEME_STORAGE_KEY]: 'neon' });
    expect(readStoredChoice()).toBe('system');
  });

  it('round-trips through persistChoice', () => {
    const store = stubLocalStorage();
    persistChoice('light');
    expect(store.get(THEME_STORAGE_KEY)).toBe('light');
    expect(readStoredChoice()).toBe('light');
  });
});

describe('resolveTheme', () => {
  afterEach(() => {
    delete (globalThis as Globals).window;
  });

  it('passes explicit light/dark straight through (ignores the OS)', () => {
    stubMatchMedia(true);
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('resolves "system" off prefers-color-scheme', () => {
    stubMatchMedia(true);
    expect(resolveTheme('system')).toBe('dark');
    stubMatchMedia(false);
    expect(resolveTheme('system')).toBe('light');
  });
});

describe('applyResolvedTheme + initTheme', () => {
  afterEach(() => {
    delete (globalThis as Globals).window;
    delete (globalThis as Globals).localStorage;
    delete (globalThis as Globals).document;
  });

  it('stamps data-theme on the document root', () => {
    const dataset = stubDocument();
    applyResolvedTheme('dark');
    expect(dataset.theme).toBe('dark');
    applyResolvedTheme('light');
    expect(dataset.theme).toBe('light');
  });

  it('initTheme applies an explicit stored choice regardless of OS', () => {
    const dataset = stubDocument();
    stubLocalStorage({ [THEME_STORAGE_KEY]: 'dark' });
    stubMatchMedia(false); // OS says light, stored choice says dark → dark wins
    initTheme();
    expect(dataset.theme).toBe('dark');
  });

  it('initTheme honors prefers-color-scheme when no choice is stored (first load)', () => {
    const dataset = stubDocument();
    stubLocalStorage(); // nothing stored → "system"
    stubMatchMedia(true);
    initTheme();
    expect(dataset.theme).toBe('dark');
  });
});
