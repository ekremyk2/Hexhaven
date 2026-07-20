import { describe, expect, it } from 'vitest';
import { boardProjection, TILT_SCALE_Y } from './projection';

describe('boardProjection(false) — identity (flat board, RK-13-style byte-identical guarantee)', () => {
  const p = boardProjection(false);

  it('reports disabled', () => {
    expect(p.enabled).toBe(false);
  });

  it('passes x/y through unchanged', () => {
    expect(p.project(0, 0)).toEqual({ sx: 0, sy: 0 });
    expect(p.project(123.5, -47.25)).toEqual({ sx: 123.5, sy: -47.25 });
    expect(p.project(-10, 999)).toEqual({ sx: -10, sy: 999 });
  });

  it('ignores height entirely', () => {
    expect(p.project(10, 20, 50)).toEqual({ sx: 10, sy: 20 });
    expect(p.project(10, 20, -50)).toEqual({ sx: 10, sy: 20 });
  });
});

describe('boardProjection(true) — the oblique tabletop tilt', () => {
  const p = boardProjection(true);

  it('reports enabled', () => {
    expect(p.enabled).toBe(true);
  });

  it('passes x through unchanged (no horizontal foreshortening — stays affine)', () => {
    expect(p.project(37, 0).sx).toBe(37);
    expect(p.project(-14, 200).sx).toBe(-14);
  });

  it('scales y by TILT_SCALE_Y when height is omitted', () => {
    const { sy } = p.project(0, 100);
    expect(sy).toBeCloseTo(100 * TILT_SCALE_Y, 10);
  });

  it('subtracts height from the scaled y — positive height raises the point up-screen', () => {
    const base = p.project(0, 100).sy;
    const raised = p.project(0, 100, 20).sy;
    expect(raised).toBeCloseTo(base - 20, 10);
    expect(raised).toBeLessThan(base);
  });

  it('negative height (below the plane, e.g. a skirt bottom) lowers the point down-screen', () => {
    const base = p.project(0, 100).sy;
    const lowered = p.project(0, 100, -20).sy;
    expect(lowered).toBeCloseTo(base + 20, 10);
    expect(lowered).toBeGreaterThan(base);
  });

  it('defaults height to 0 when omitted', () => {
    expect(p.project(5, 5)).toEqual(p.project(5, 5, 0));
  });
});
