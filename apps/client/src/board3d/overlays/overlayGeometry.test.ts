import { describe, expect, it } from 'vitest';
import { averageXZ, ringFanOffset } from './overlayGeometry';

describe('ringFanOffset', () => {
  it('places a lone marker dead-center (no fan)', () => {
    expect(ringFanOffset(0, 1, 10)).toEqual({ dx: 0, dz: 0 });
    expect(ringFanOffset(0, 0, 10)).toEqual({ dx: 0, dz: 0 });
  });

  it('places index 0 of a multi-marker fan straight up (-Z)', () => {
    const p = ringFanOffset(0, 4, 2);
    expect(p.dx).toBeCloseTo(0, 10);
    expect(p.dz).toBeCloseTo(-2, 10);
  });

  it('every marker sits exactly `radius` away from the anchor', () => {
    const radius = 3;
    for (const count of [2, 3, 4, 5, 6]) {
      for (let i = 0; i < count; i++) {
        const { dx, dz } = ringFanOffset(i, count, radius);
        expect(Math.hypot(dx, dz)).toBeCloseTo(radius, 10);
      }
    }
  });

  it('a full ring of evenly-spaced markers sums to (0, 0) — no directional bias', () => {
    const count = 5;
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < count; i++) {
      const { dx, dz } = ringFanOffset(i, count, 7);
      sx += dx;
      sz += dz;
    }
    expect(sx).toBeCloseTo(0, 9);
    expect(sz).toBeCloseTo(0, 9);
  });

  it('two markers land on opposite sides of the anchor', () => {
    const a = ringFanOffset(0, 2, 5);
    const b = ringFanOffset(1, 2, 5);
    expect(a.dx).toBeCloseTo(-b.dx, 10);
    expect(a.dz).toBeCloseTo(-b.dz, 10);
  });
});

describe('averageXZ', () => {
  it('returns the origin for an empty list', () => {
    expect(averageXZ([])).toEqual({ x: 0, z: 0 });
  });

  it('averages a single point to itself', () => {
    expect(averageXZ([{ x: 4, z: -2 }])).toEqual({ x: 4, z: -2 });
  });

  it('averages several points component-wise', () => {
    const out = averageXZ([
      { x: 0, z: 0 },
      { x: 2, z: 4 },
      { x: 4, z: 8 },
    ]);
    expect(out.x).toBeCloseTo(2, 10);
    expect(out.z).toBeCloseTo(4, 10);
  });
});
