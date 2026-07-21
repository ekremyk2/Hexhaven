// Tests for the pure logic backing `Interaction3D.tsx` (T-1402). No react-three-fiber/three/DOM —
// runs fine under the workspace's `environment: "node"` vitest config, exactly like `coords.test.ts`
// (T-1400). See `interactionTargets.ts`'s header comment for why the r3f component itself has no
// direct test file (mounting r3f/drei needs a `window`/WebGL this environment doesn't provide).
import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import {
  activeTargetIds,
  EDGE_GHOST_RADIUS,
  EDGE_HIT_RADIUS,
  exceedsDragThreshold,
  HEX_MARKER_LIFT,
  nextHoverAfterTargetsChange,
  pulseOpacity,
  VERTEX_EDGE_MARKER_LIFT,
  VERTEX_GHOST_RADIUS,
  VERTEX_HIT_RADIUS,
} from './interactionTargets';

describe('activeTargetIds', () => {
  it('mode === null always yields no ids, regardless of targets', () => {
    expect(activeTargetIds(GEOMETRY, null, new Set([0, 1, 2]))).toEqual([]);
  });

  it("mode 'vertex' returns only the geometry vertex ids present in targets", () => {
    const targets = new Set([GEOMETRY.vertices[0]!.id, GEOMETRY.vertices[3]!.id]);
    const ids = activeTargetIds(GEOMETRY, 'vertex', targets);
    expect(ids.sort((a, b) => a - b)).toEqual([GEOMETRY.vertices[0]!.id, GEOMETRY.vertices[3]!.id].sort((a, b) => a - b));
  });

  it("mode 'edge' returns only the geometry edge ids present in targets", () => {
    const targets = new Set([GEOMETRY.edges[1]!.id]);
    expect(activeTargetIds(GEOMETRY, 'edge', targets)).toEqual([GEOMETRY.edges[1]!.id]);
  });

  it("mode 'hex' returns only the geometry hex ids present in targets", () => {
    const targets = new Set([GEOMETRY.hexes[2]!.id]);
    expect(activeTargetIds(GEOMETRY, 'hex', targets)).toEqual([GEOMETRY.hexes[2]!.id]);
  });

  it('an empty targets set yields no ids for any mode', () => {
    expect(activeTargetIds(GEOMETRY, 'vertex', new Set())).toEqual([]);
    expect(activeTargetIds(GEOMETRY, 'edge', new Set())).toEqual([]);
    expect(activeTargetIds(GEOMETRY, 'hex', new Set())).toEqual([]);
  });

  it('never returns an id NOT in targets (only legal targets are ever interactive)', () => {
    const targets = new Set([GEOMETRY.vertices[5]!.id]);
    const ids = activeTargetIds(GEOMETRY, 'vertex', targets);
    expect(ids).toEqual([GEOMETRY.vertices[5]!.id]);
    expect(ids.length).toBe(1);
  });
});

describe('nextHoverAfterTargetsChange', () => {
  it('keeps the hovered id when it is still a legal target', () => {
    expect(nextHoverAfterTargetsChange(7, new Set([3, 7, 9]))).toBe(7);
  });

  it('clears a stale hover once its id drops out of targets', () => {
    expect(nextHoverAfterTargetsChange(7, new Set([3, 9]))).toBeNull();
  });

  it('stays null when nothing was hovered', () => {
    expect(nextHoverAfterTargetsChange(null, new Set([1, 2]))).toBeNull();
  });

  it('clears when targets is empty even if something was hovered', () => {
    expect(nextHoverAfterTargetsChange(1, new Set())).toBeNull();
  });
});

describe('exceedsDragThreshold', () => {
  it('a stationary pointer never exceeds the threshold', () => {
    expect(exceedsDragThreshold(0, 0, 6)).toBe(false);
  });

  it('movement past the threshold reads as a drag', () => {
    expect(exceedsDragThreshold(10, 0, 6)).toBe(true);
    expect(exceedsDragThreshold(0, 10, 6)).toBe(true);
    expect(exceedsDragThreshold(4, 4, 5)).toBe(true); // hypot ≈ 5.66 > 5
  });

  it('exactly at the threshold does not (yet) count as a drag', () => {
    expect(exceedsDragThreshold(6, 0, 6)).toBe(false);
  });

  it('diagonal movement is measured by straight-line distance, not axis sum', () => {
    // 3-4-5 triangle: dx=3, dy=4 -> distance 5, under a threshold of 6 despite dx+dy=7.
    expect(exceedsDragThreshold(3, 4, 6)).toBe(false);
  });
});

describe('pulseOpacity', () => {
  const MIN = 0.35;
  const MAX = 0.6;
  const PERIOD = 1.2;

  it('starts at min (t=0), matching the CSS keyframe\'s 0% frame', () => {
    expect(pulseOpacity(0, MIN, MAX, PERIOD)).toBeCloseTo(MIN, 9);
  });

  it('peaks at max at the half-period mark, matching the CSS keyframe\'s 50% frame', () => {
    expect(pulseOpacity(PERIOD / 2, MIN, MAX, PERIOD)).toBeCloseTo(MAX, 9);
  });

  it('returns to min after a full period, matching the CSS keyframe\'s 100% frame', () => {
    expect(pulseOpacity(PERIOD, MIN, MAX, PERIOD)).toBeCloseTo(MIN, 9);
  });

  it('stays within [min, max] at arbitrary points in the cycle', () => {
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 2.5]) {
      const v = pulseOpacity(t, MIN, MAX, PERIOD);
      expect(v).toBeGreaterThanOrEqual(MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(MAX + 1e-9);
    }
  });
});

describe('marker sizing constants', () => {
  it('the raycast hit area is always more generous than the drawn ghost (click tolerance)', () => {
    expect(VERTEX_HIT_RADIUS).toBeGreaterThan(VERTEX_GHOST_RADIUS);
    expect(EDGE_HIT_RADIUS).toBeGreaterThan(EDGE_GHOST_RADIUS);
  });

  it('markers sit at a positive lift above their target surface (not buried in the board)', () => {
    expect(VERTEX_EDGE_MARKER_LIFT).toBeGreaterThan(0);
    expect(HEX_MARKER_LIFT).toBeGreaterThan(0);
  });
});
