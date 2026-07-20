// CosmeticThemeSwitcher render tests (T-907 PM wiring). Same renderToStaticMarkup + per-feature
// testI18n + localStorage-double conventions as ThemedPieces.test.ts / theme/theme.test.ts.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CosmeticThemeSwitcher } from './CosmeticThemeSwitcher';
import { COSMETIC_THEME_STORAGE_KEY } from './themeState';
import { initTestI18n } from './testI18n';

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

/** The opening `<button>` tag's attribute string for a given `data-testid` — attribute-order
 *  independent (mirrors `controls/ActionBar.test.ts`'s `attrsFor`). */
function buttonAttrs(html: string, testid: string): string {
  const start = html.indexOf(`data-testid="${testid}"`);
  if (start === -1) throw new Error(`BUG: no element with data-testid="${testid}" in:\n${html}`);
  const tagStart = html.lastIndexOf('<button', start);
  const tagEnd = html.indexOf('>', start);
  return html.slice(tagStart, tagEnd);
}

describe('CosmeticThemeSwitcher (T-907)', () => {
  beforeAll(async () => {
    await initTestI18n();
  });

  afterEach(() => {
    delete (globalThis as Globals).localStorage;
  });

  it('renders one button per shipped theme, tagged by id', () => {
    stubLocalStorage();
    const html = renderToStaticMarkup(createElement(CosmeticThemeSwitcher));
    expect(html).toContain('data-testid="cosmetic-theme-classic"');
    expect(html).toContain('data-testid="cosmetic-theme-pirates"');
    expect(html).toContain('data-testid="cosmetic-theme-harvest"');
  });

  it('marks "classic" pressed by default (nothing stored — identity theme)', () => {
    stubLocalStorage();
    const html = renderToStaticMarkup(createElement(CosmeticThemeSwitcher));
    expect(buttonAttrs(html, 'cosmetic-theme-classic')).toContain('aria-pressed="true"');
    expect(buttonAttrs(html, 'cosmetic-theme-pirates')).toContain('aria-pressed="false"');
  });

  it('reflects a previously-persisted choice on (re)mount', () => {
    stubLocalStorage({ [COSMETIC_THEME_STORAGE_KEY]: 'harvest' });
    const html = renderToStaticMarkup(createElement(CosmeticThemeSwitcher));
    expect(buttonAttrs(html, 'cosmetic-theme-harvest')).toContain('aria-pressed="true"');
    expect(buttonAttrs(html, 'cosmetic-theme-classic')).toContain('aria-pressed="false"');
  });

  it("shows each theme's real translated name as its aria-label (not a raw key)", () => {
    stubLocalStorage();
    const html = renderToStaticMarkup(createElement(CosmeticThemeSwitcher));
    expect(buttonAttrs(html, 'cosmetic-theme-classic')).toContain('aria-label="Classic"');
    // React escapes the apostrophe as an HTML entity in the static-markup output.
    expect(buttonAttrs(html, 'cosmetic-theme-pirates')).toContain('aria-label="Pirate&#x27;s Cove"');
    expect(buttonAttrs(html, 'cosmetic-theme-harvest')).toContain('aria-label="Harvest Festival"');
  });
});
