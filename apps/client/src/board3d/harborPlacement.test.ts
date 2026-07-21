// Tests for T-1505's harbor placement math — pure, no react/three/DOM.
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type EdgeId, type HexTile } from '@hexhaven/shared';
import { edgeWorldPosition, hexWorldCenter } from './coords';
import { computeHarborPlacements, nearestRotationStep } from './harborPlacement';

const BASE_YAW = Math.PI / 6;
const STEP = Math.PI / 3;

describe('nearestRotationStep', () => {
  it('snaps the base yaw itself to step 0', () => {
    expect(nearestRotationStep(BASE_YAW)).toBe(0);
  });

  it('snaps each exact step angle to its own k', () => {
    for (let k = 0; k < 6; k++) {
      expect(nearestRotationStep(BASE_YAW + k * STEP)).toBe(k);
    }
  });

  it('snaps a slightly-off angle to the NEAREST step, not just floor', () => {
    // Just under halfway to step 2 from step 1 should still round down to 1; just over rounds to 2.
    expect(nearestRotationStep(BASE_YAW + STEP * 1.4)).toBe(1);
    expect(nearestRotationStep(BASE_YAW + STEP * 1.6)).toBe(2);
  });

  it('wraps correctly across the 0/2pi boundary', () => {
    expect(nearestRotationStep(BASE_YAW - STEP * 0.1)).toBe(0);
    expect(nearestRotationStep(BASE_YAW + STEP * 5.6)).toBe(0); // rounds up to step 6 mod 6 = 0
  });
});

describe('computeHarborPlacements', () => {
  const hex = (terrain: HexTile['terrain']): HexTile => ({ terrain, token: null });
  // Real base-board geometry + a plausible all-forest board so every harbor's land hex resolves.
  const board = {
    hexes: GEOMETRY.hexes.map(() => hex('forest')),
    harbors: { [GEOMETRY.harborSpots[0]!]: 'generic' } as Record<EdgeId, 'generic'>,
  };

  it('emits exactly one placement per board.harbors entry', () => {
    const placements = computeHarborPlacements(board, GEOMETRY, undefined);
    expect(placements).toHaveLength(1);
    expect(placements[0]!.edgeId).toBe(GEOMETRY.harborSpots[0]);
    expect(placements[0]!.type).toBe('generic');
  });

  it('places the harbor along the line from the land hex center through the edge midpoint, beyond the edge', () => {
    const [placement] = computeHarborPlacements(board, GEOMETRY, undefined);
    const edge = GEOMETRY.edges[placement!.edgeId]!;
    const landHexId = edge.hexes[0]!; // base board coastal edge: exactly one bordering hex
    const landCenter = hexWorldCenter(GEOMETRY.hexes[landHexId]!);
    const edgeMid = edgeWorldPosition(edge);

    // The placement should be strictly further from the land center than the edge midpoint is
    // (floats "just off the coast", not on the coastline itself or back over the land).
    const distToEdge = Math.hypot(edgeMid.x - landCenter.x, edgeMid.z - landCenter.z);
    const distToPlacement = Math.hypot(placement!.position.x - landCenter.x, placement!.position.z - landCenter.z);
    expect(distToPlacement).toBeGreaterThan(distToEdge);

    // And it should lie exactly on the ray from landCenter through edgeMid (same direction, just
    // scaled) — cross product of the two offset vectors is ~0 for collinear points.
    const dx1 = edgeMid.x - landCenter.x;
    const dz1 = edgeMid.z - landCenter.z;
    const dx2 = placement!.position.x - landCenter.x;
    const dz2 = placement!.position.z - landCenter.z;
    expect(dx1 * dz2 - dz1 * dx2).toBeCloseTo(0, 6);
  });

  it('picks a rotation step in [0, 6)', () => {
    const [placement] = computeHarborPlacements(board, GEOMETRY, undefined);
    expect(placement!.rotationStep).toBeGreaterThanOrEqual(0);
    expect(placement!.rotationStep).toBeLessThan(6);
  });

  it('skips a harbors entry whose edge id has no matching geometry edge (defensive)', () => {
    const badBoard = { hexes: board.hexes, harbors: { 99999: 'generic' } as Record<EdgeId, 'generic'> };
    expect(computeHarborPlacements(badBoard, GEOMETRY, undefined)).toHaveLength(0);
  });

  it('emits one placement per harbor for a multi-harbor board', () => {
    const multi = {
      hexes: board.hexes,
      harbors: Object.fromEntries(GEOMETRY.harborSpots.map((e) => [e, 'generic'])) as Record<EdgeId, 'generic'>,
    };
    expect(computeHarborPlacements(multi, GEOMETRY, undefined)).toHaveLength(GEOMETRY.harborSpots.length);
  });
});
