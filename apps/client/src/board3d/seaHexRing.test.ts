// Tests for T-1505's sea-hex ring computation — pure axial-grid math, no react/three/DOM needed.
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type HexId } from '@hexhaven/shared';
import { computeSeaHexRing } from './seaHexRing';

const SQRT3 = Math.sqrt(3);
const hid = (n: number) => n as HexId;

describe('computeSeaHexRing — single hex', () => {
  const ring = computeSeaHexRing({ hexes: [{ id: hid(0), q: 0, r: 0, x: 0, y: 0, vertices: [], edges: [] }] });

  it('returns exactly the 6 axial neighbors of the lone hex', () => {
    expect(ring).toHaveLength(6);
    const keys = new Set(ring.map((h) => `${h.q},${h.r}`));
    expect(keys).toEqual(
      new Set(['1,0', '-1,0', '1,-1', '0,-1', '0,1', '-1,1']),
    );
  });

  it('every ring hex\'s (x, y) matches the same unit-space formula geometry.ts uses (x = sqrt3*(q+r/2), y = 1.5*r)', () => {
    for (const h of ring) {
      expect(h.x).toBeCloseTo(SQRT3 * (h.q + h.r / 2), 10);
      expect(h.y).toBeCloseTo(1.5 * h.r, 10);
    }
  });

  it('every ring hex carries a distinct seed (used as a deterministic-pick hash input)', () => {
    const seeds = new Set(ring.map((h) => h.seed));
    expect(seeds.size).toBe(ring.length);
  });
});

describe('computeSeaHexRing — two adjacent hexes', () => {
  it('never includes a hex that is itself part of the input geometry', () => {
    const hexes = [
      { id: hid(0), q: 0, r: 0, x: 0, y: 0, vertices: [], edges: [] },
      { id: hid(1), q: 1, r: 0, x: SQRT3, y: 0, vertices: [], edges: [] },
    ];
    const ring = computeSeaHexRing({ hexes });
    const occupied = new Set(hexes.map((h) => `${h.q},${h.r}`));
    for (const h of ring) expect(occupied.has(`${h.q},${h.r}`)).toBe(false);
  });

  it('dedupes a shared neighbor (e.g. (1,-1) touches both (0,0) and (1,0)) — appears exactly once', () => {
    const hexes = [
      { id: hid(0), q: 0, r: 0, x: 0, y: 0, vertices: [], edges: [] },
      { id: hid(1), q: 1, r: 0, x: SQRT3, y: 0, vertices: [], edges: [] },
    ];
    const ring = computeSeaHexRing({ hexes });
    const keys = ring.map((h) => `${h.q},${h.r}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('computeSeaHexRing — the real base board', () => {
  const ring = computeSeaHexRing(GEOMETRY);

  it('produces a non-empty ring fully outside the 19-hex island', () => {
    expect(ring.length).toBeGreaterThan(0);
    const occupied = new Set(GEOMETRY.hexes.map((h) => `${h.q},${h.r}`));
    for (const h of ring) expect(occupied.has(`${h.q},${h.r}`)).toBe(false);
  });

  it('every ring hex is axially adjacent to at least one real board hex', () => {
    const occupied = new Set(GEOMETRY.hexes.map((h) => `${h.q},${h.r}`));
    const deltas = [
      { q: 1, r: 0 },
      { q: -1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: 0, r: 1 },
      { q: -1, r: 1 },
    ];
    for (const h of ring) {
      const touchesBoard = deltas.some((d) => occupied.has(`${h.q + d.q},${h.r + d.r}`));
      expect(touchesBoard).toBe(true);
    }
  });
});
