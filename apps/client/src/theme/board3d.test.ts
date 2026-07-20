// Tests for the "3D board" setting persistence (T-1210). Like theme.test.ts, this workspace runs
// vitest under `environment: "node"` (no jsdom), so `localStorage` is stubbed as a plain object.
import { afterEach, describe, expect, it } from 'vitest';
import {
  BOARD_3D_DEFAULT,
  BOARD_3D_STORAGE_KEY,
  persistBoard3d,
  readStoredBoard3d,
} from './board3d';

type Globals = { localStorage?: unknown };

/** Minimal Map-backed localStorage double (mirrors theme.test.ts's). */
function stubLocalStorage(initial?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(initial ?? {}));
  (globalThis as Globals).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  return store;
}

describe('board3d default', () => {
  it('defaults ON (the shipped look)', () => {
    expect(BOARD_3D_DEFAULT).toBe(true);
  });
});

describe('readStoredBoard3d (persistence)', () => {
  afterEach(() => {
    delete (globalThis as Globals).localStorage;
  });

  it('defaults to ON when nothing is stored (first load)', () => {
    stubLocalStorage();
    expect(readStoredBoard3d()).toBe(true);
  });

  it('returns a stored "off" choice', () => {
    stubLocalStorage({ [BOARD_3D_STORAGE_KEY]: 'off' });
    expect(readStoredBoard3d()).toBe(false);
  });

  it('returns a stored "on" choice', () => {
    stubLocalStorage({ [BOARD_3D_STORAGE_KEY]: 'on' });
    expect(readStoredBoard3d()).toBe(true);
  });

  it('ignores a garbage stored value and falls back to the default (ON)', () => {
    stubLocalStorage({ [BOARD_3D_STORAGE_KEY]: 'bogus' });
    expect(readStoredBoard3d()).toBe(true);
  });

  it('round-trips through persistBoard3d', () => {
    const store = stubLocalStorage();
    persistBoard3d(false);
    expect(store.get(BOARD_3D_STORAGE_KEY)).toBe('off');
    expect(readStoredBoard3d()).toBe(false);

    persistBoard3d(true);
    expect(store.get(BOARD_3D_STORAGE_KEY)).toBe('on');
    expect(readStoredBoard3d()).toBe(true);
  });

  it('is ON when there is no localStorage (SSR/test-safe)', () => {
    delete (globalThis as Globals).localStorage;
    expect(readStoredBoard3d()).toBe(true);
  });
});
