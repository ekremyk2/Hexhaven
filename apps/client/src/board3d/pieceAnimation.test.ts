// Tests for the 3D pieces' animation math (T-1401). Pure math — no react/three/DOM needed, runs
// under the workspace's `environment: "node"` vitest config (same rationale as `coords.test.ts`).
import { describe, expect, it } from 'vitest';
import {
  HOP_DURATION_MS,
  PLACEMENT_DURATION_MS,
  PLACEMENT_MIN_SCALE,
  clampProgress,
  easeInOutCubic,
  easeOutCubic,
  hopOffset,
  placementDropOffset,
  placementScale,
} from './pieceAnimation';

describe('clampProgress', () => {
  it('clamps to [0, 1]', () => {
    expect(clampProgress(-1)).toBe(0);
    expect(clampProgress(0.4)).toBe(0.4);
    expect(clampProgress(2)).toBe(1);
  });

  it('treats NaN as 0 rather than propagating it', () => {
    expect(clampProgress(NaN)).toBe(0);
  });
});

describe('easeOutCubic', () => {
  it('starts at 0 and ends at 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('is monotonically non-decreasing', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('front-loads progress (ease-OUT: past the midpoint before t=0.5)', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});

describe('easeInOutCubic', () => {
  it('starts at 0 and ends at 1, midpoint exactly 0.5 (symmetric)', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });

  it('is monotonically non-decreasing', () => {
    let prev = -Infinity;
    for (let t = 0; t <= 1; t += 0.1) {
      const v = easeInOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('placementScale', () => {
  it('starts at the min scale (never literal 0 — a singular transform) and ends at 1', () => {
    expect(placementScale(0)).toBeCloseTo(PLACEMENT_MIN_SCALE, 10);
    expect(placementScale(1)).toBeCloseTo(1, 10);
  });

  it('grows monotonically over the animation', () => {
    expect(placementScale(0.8)).toBeGreaterThan(placementScale(0.2));
  });
});

describe('placementDropOffset', () => {
  it('starts at the full drop height and eases to 0', () => {
    expect(placementDropOffset(0, 40)).toBeCloseTo(40, 10);
    expect(placementDropOffset(1, 40)).toBeCloseTo(0, 10);
  });

  it('scales linearly with dropHeight for a fixed progress', () => {
    expect(placementDropOffset(0.3, 100)).toBeCloseTo(placementDropOffset(0.3, 50) * 2, 10);
  });
});

describe('hopOffset', () => {
  it('at progress 0: full horizontal offset, zero arc height', () => {
    const o = hopOffset(0, 30, -20, 15);
    expect(o.x).toBeCloseTo(30, 10);
    expect(o.z).toBeCloseTo(-20, 10);
    expect(o.y).toBeCloseTo(0, 10);
  });

  it('at progress 1: zero horizontal offset (arrived), zero arc height (landed)', () => {
    const o = hopOffset(1, 30, -20, 15);
    expect(o.x).toBeCloseTo(0, 10);
    expect(o.z).toBeCloseTo(0, 10);
    expect(o.y).toBeCloseTo(0, 10);
  });

  it('at progress 0.5: peak arc height, horizontal offset roughly halved', () => {
    const o = hopOffset(0.5, 30, -20, 15);
    expect(o.y).toBeCloseTo(15, 10);
    expect(o.x).toBeCloseTo(15, 10);
    expect(o.z).toBeCloseTo(-10, 10);
  });

  it('clamps out-of-range progress instead of overshooting', () => {
    const under = hopOffset(-0.5, 30, -20, 15);
    const over = hopOffset(1.5, 30, -20, 15);
    expect(under).toEqual(hopOffset(0, 30, -20, 15));
    expect(over).toEqual(hopOffset(1, 30, -20, 15));
  });
});

describe('durations', () => {
  it('robber hop matches docs/11 §5\'s spec (400ms) and the flat board\'s CSS animation', () => {
    expect(HOP_DURATION_MS).toBe(400);
  });

  it('placement pop is a short, snappy duration', () => {
    expect(PLACEMENT_DURATION_MS).toBeGreaterThan(0);
    expect(PLACEMENT_DURATION_MS).toBeLessThan(1000);
  });
});
