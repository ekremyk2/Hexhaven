// Tests for the geometry → world-space mapping (T-1400). Pure math — no react/three/DOM needed, so
// this runs fine under the workspace's `environment: "node"` vitest config.
import { describe, expect, it } from 'vitest';
import { GEOMETRY, GEOMETRY_EXT56 } from '@hexhaven/shared';
import { HEX_SIZE } from '../board/palette';
import {
  boardToWorld,
  boardWorldExtents,
  edgeWorldPosition,
  hexWorldCenter,
  toWorldUnits,
  vertexWorldPosition,
} from './coords';

describe('toWorldUnits', () => {
  it('scales by HEX_SIZE — the same px-per-unit factor the flat SVG board uses', () => {
    expect(toWorldUnits(1)).toBe(HEX_SIZE);
    expect(toWorldUnits(2.5)).toBe(2.5 * HEX_SIZE);
    expect(toWorldUnits(0)).toBe(0);
  });
});

describe('boardToWorld', () => {
  it('maps board x -> world X and board y -> world Z, unchanged (no axis flip)', () => {
    const p = boardToWorld(3, 4);
    expect(p.x).toBe(toWorldUnits(3));
    expect(p.z).toBe(toWorldUnits(4));
  });

  it('elevation goes to world Y (up), defaulting to 0', () => {
    expect(boardToWorld(0, 0).y).toBe(0);
    expect(boardToWorld(0, 0, 12.5).y).toBe(12.5);
  });
});

describe('hexWorldCenter / vertexWorldPosition', () => {
  it('reads a GEOMETRY hex/vertex\'s own x/y, scaled — matches BoardView\'s `px(h.x), px(h.y)`', () => {
    const hex = GEOMETRY.hexes[0]!;
    const w = hexWorldCenter(hex);
    expect(w.x).toBe(toWorldUnits(hex.x));
    expect(w.z).toBe(toWorldUnits(hex.y));
    expect(w.y).toBe(0);

    const vertex = GEOMETRY.vertices[0]!;
    const wv = vertexWorldPosition(vertex, 5);
    expect(wv.x).toBe(toWorldUnits(vertex.x));
    expect(wv.z).toBe(toWorldUnits(vertex.y));
    expect(wv.y).toBe(5);
  });

  it('every hex center is a distinct world point (no accidental collapse of the mapping)', () => {
    const seen = new Set<string>();
    for (const hex of GEOMETRY.hexes) {
      const w = hexWorldCenter(hex);
      seen.add(`${w.x},${w.z}`);
    }
    expect(seen.size).toBe(GEOMETRY.hexes.length);
  });
});

describe('edgeWorldPosition', () => {
  it('places the edge at its midpoint, scaled, at the given elevation', () => {
    const edge = GEOMETRY.edges[0]!;
    const w = edgeWorldPosition(edge, 3);
    expect(w.x).toBe(toWorldUnits(edge.x));
    expect(w.z).toBe(toWorldUnits(edge.y));
    expect(w.y).toBe(3);
  });

  it('derives rotationY = -angleDeg (radians) from the edge angle', () => {
    for (const angleDeg of [30, 90, 150]) {
      const w = edgeWorldPosition({ x: 0, y: 0, angleDeg });
      expect(w.rotationY).toBeCloseTo(-(angleDeg * Math.PI) / 180, 10);
    }
  });

  it('a rotationY=0 mesh axis and a 90deg edge are perpendicular (sanity check on the sign convention)', () => {
    const flat = edgeWorldPosition({ x: 0, y: 0, angleDeg: 0 });
    const perpendicular = edgeWorldPosition({ x: 0, y: 0, angleDeg: 90 });
    expect(Math.abs(flat.rotationY - perpendicular.rotationY)).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('boardWorldExtents', () => {
  it('bounds every hex center within [minX,maxX] x [minZ,maxZ] on the base 19-hex board', () => {
    const extents = boardWorldExtents(GEOMETRY);
    for (const hex of GEOMETRY.hexes) {
      const w = hexWorldCenter(hex);
      expect(w.x).toBeGreaterThanOrEqual(extents.minX - 1e-9);
      expect(w.x).toBeLessThanOrEqual(extents.maxX + 1e-9);
      expect(w.z).toBeGreaterThanOrEqual(extents.minZ - 1e-9);
      expect(w.z).toBeLessThanOrEqual(extents.maxZ + 1e-9);
    }
  });

  it('center is the midpoint of the bounding box, radius covers every hex center', () => {
    const extents = boardWorldExtents(GEOMETRY);
    expect(extents.center.x).toBeCloseTo((extents.minX + extents.maxX) / 2, 9);
    expect(extents.center.z).toBeCloseTo((extents.minZ + extents.maxZ) / 2, 9);
    for (const hex of GEOMETRY.hexes) {
      const w = hexWorldCenter(hex);
      const dist = Math.hypot(w.x - extents.center.x, w.z - extents.center.z);
      expect(dist).toBeLessThanOrEqual(extents.radius + 1e-6);
    }
  });

  it('a bigger board (30-hex EXT56) frames with a bigger radius than the base 19-hex board', () => {
    const base = boardWorldExtents(GEOMETRY);
    const ext56 = boardWorldExtents(GEOMETRY_EXT56);
    expect(ext56.radius).toBeGreaterThan(base.radius);
  });

  it('degenerate (empty) geometry still returns a sane, finite extent instead of Infinity/NaN', () => {
    const extents = boardWorldExtents({ hexes: [] });
    expect(Number.isFinite(extents.radius)).toBe(true);
    expect(extents.radius).toBeGreaterThan(0);
    expect(extents.center).toEqual({ x: 0, y: 0, z: 0 });
  });
});
