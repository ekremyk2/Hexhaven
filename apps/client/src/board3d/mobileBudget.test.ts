// Tests for the mobile perf-budget gate (T-1404). Same `environment: "node"` convention as
// `webgl.test.ts` — `window` is genuinely undefined here, exercising the real SSR/test-safe path.
import { afterEach, describe, expect, it } from 'vitest';
import { detectMobileBudget } from './mobileBudget';

describe('detectMobileBudget', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('is the (cheaper-is-safer) mobile budget when there is no window (SSR/test-safe, never throws)', () => {
    expect(typeof window).toBe('undefined');
    const budget = detectMobileBudget();
    expect(budget.dpr).toEqual([1, 1]);
    expect(budget.shadowMapSize).toBe(512);
    expect(budget.envResolution).toBe(64);
    expect(budget.contactShadowResolution).toBe(384);
    expect(budget.contactShadowSmooth).toBe(false);
  });

  it('picks the desktop budget when neither coarse-pointer nor narrow-viewport matches', () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => ({ matches: false }),
    };
    const budget = detectMobileBudget();
    expect(budget.dpr).toEqual([1, 2]);
    expect(budget.shadowMapSize).toBe(1536);
    expect(budget.envResolution).toBe(256);
    expect(budget.contactShadowResolution).toBe(1024);
    expect(budget.contactShadowSmooth).toBe(true);
  });

  it('picks the mobile budget on a coarse pointer even at desktop width', () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: (query: string) => ({ matches: query.includes('pointer') }),
    };
    const budget = detectMobileBudget();
    expect(budget.dpr).toEqual([1, 1]);
  });

  it('picks the mobile budget on a narrow viewport even with a fine pointer', () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: (query: string) => ({ matches: query.includes('max-width') }),
    };
    const budget = detectMobileBudget();
    expect(budget.dpr).toEqual([1, 1]);
  });

  it('never throws even if matchMedia itself throws', () => {
    (globalThis as { window?: unknown }).window = {
      matchMedia: () => {
        throw new Error('boom');
      },
    };
    expect(() => detectMobileBudget()).not.toThrow();
    expect(detectMobileBudget().shadowMapSize).toBe(512);
  });
});
