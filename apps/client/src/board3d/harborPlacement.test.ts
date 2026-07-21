// Tests for T-1505's (reworked) harbor-tile placement math — pure, no react/three/DOM.
import { describe, expect, it } from 'vitest';
import { GEOMETRY, type EdgeId, type HexTile } from '@hexhaven/shared';
import { computeSeaHexRing } from './seaHexRing';
import { computeHarborTiles, nearestRotationStep } from './harborPlacement';
import { HARBOR_VARIANT_YAW_OFFSET, hexYaw, type HarborModelVariant } from './terrainStlModels';

const BASE_YAW = Math.PI / 6;
const STEP = Math.PI / 3;

/** The per-variant yaw offset baked into a harbor tile's `yaw` — looked up by the picked variant's
 *  stable `id` (PART A: per-ship-variant yaw, not a single shared ship/lighthouse pair). */
const offsetFor = (variant: HarborModelVariant) => HARBOR_VARIANT_YAW_OFFSET[variant.id];

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
    expect(nearestRotationStep(BASE_YAW + STEP * 1.4)).toBe(1);
    expect(nearestRotationStep(BASE_YAW + STEP * 1.6)).toBe(2);
  });

  it('wraps correctly across the 0/2pi boundary', () => {
    expect(nearestRotationStep(BASE_YAW - STEP * 0.1)).toBe(0);
    expect(nearestRotationStep(BASE_YAW + STEP * 5.6)).toBe(0); // rounds up to step 6 mod 6 = 0
  });
});

describe('computeHarborTiles — base board (no real sea hex, harbors land on the synthetic ring)', () => {
  const hex = (terrain: HexTile['terrain']): HexTile => ({ terrain, token: null });
  const board = {
    hexes: GEOMETRY.hexes.map(() => hex('forest')),
    harbors: { [GEOMETRY.harborSpots[0]!]: 'generic' } as Record<EdgeId, 'generic'>,
  };
  const seaRing = computeSeaHexRing(GEOMETRY);

  it('emits exactly one tile per board.harbors entry', () => {
    const tiles = computeHarborTiles(board, GEOMETRY, undefined, seaRing);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.edgeId).toBe(GEOMETRY.harborSpots[0]);
    expect(tiles[0]!.type).toBe('generic');
  });

  it('targets a RING hex (base board has no real sea hex in geometry)', () => {
    const [tile] = computeHarborTiles(board, GEOMETRY, undefined, seaRing);
    expect(tile!.target.kind).toBe('ring');
    if (tile!.target.kind === 'ring') {
      const key = `${tile!.target.q},${tile!.target.r}`;
      expect(new Set(seaRing.map((r) => `${r.q},${r.r}`)).has(key)).toBe(true);
    }
  });

  it('every harbor spot resolves to a ring hex that is actually adjacent to its land hex', () => {
    const multi = {
      hexes: board.hexes,
      harbors: Object.fromEntries(GEOMETRY.harborSpots.map((e) => [e, 'generic'])) as Record<EdgeId, 'generic'>,
    };
    const tiles = computeHarborTiles(multi, GEOMETRY, undefined, seaRing);
    expect(tiles).toHaveLength(GEOMETRY.harborSpots.length);
    for (const tile of tiles) {
      const edge = GEOMETRY.edges[tile.edgeId]!;
      const landHexId = edge.hexes[0]!;
      const landHex = GEOMETRY.hexes[landHexId]!;
      expect(tile.target.kind).toBe('ring');
      if (tile.target.kind === 'ring') {
        const dq = tile.target.q - landHex.q;
        const dr = tile.target.r - landHex.r;
        // One of the 6 axial neighbor deltas (E, W, NE, NW, SE, SW).
        const isNeighbor = [
          [1, 0], [-1, 0], [1, -1], [0, -1], [0, 1], [-1, 1],
        ].some(([q, r]) => q === dq && r === dr);
        expect(isNeighbor).toBe(true);
      }
    }
  });

  it('picks a yaw that is one of the 6 hex-flush steps plus the calibration offset', () => {
    const [tile] = computeHarborTiles(board, GEOMETRY, undefined, seaRing);
    const stripped = tile!.yaw - offsetFor(tile!.variant);
    const matchesSomeStep = [0, 1, 2, 3, 4, 5].some((k) => Math.abs(stripped - hexYaw(k)) < 1e-9);
    expect(matchesSomeStep).toBe(true);
  });

  it('faces INWARD (toward the land hex), not outward toward open sea', () => {
    const [tile] = computeHarborTiles(board, GEOMETRY, undefined, seaRing);
    const edge = GEOMETRY.edges[tile!.edgeId]!;
    const landHexId = edge.hexes[0]!;
    const landHex = GEOMETRY.hexes[landHexId]!;
    if (tile!.target.kind !== 'ring') throw new Error('expected a ring target');
    // Direction from the ring hex to the land hex, in the same (dx, dz)-style axial space this
    // module works in (x = sqrt3*(q+r/2), y = 1.5*r) — should point the same way as the yaw's
    // implied facing (sin, cos) up to the fixed BASE/step quantization, i.e. a positive dot product.
    const ringX = Math.sqrt(3) * (tile!.target.q + tile!.target.r / 2);
    const ringY = 1.5 * tile!.target.r;
    const landX = Math.sqrt(3) * (landHex.q + landHex.r / 2);
    const landY = 1.5 * landHex.r;
    const toLandX = landX - ringX;
    const toLandZ = landY - ringY; // board y -> world z, same convention as coords.ts
    const stripped = tile!.yaw - offsetFor(tile!.variant);
    const facingX = Math.sin(stripped);
    const facingZ = Math.cos(stripped);
    expect(facingX * toLandX + facingZ * toLandZ).toBeGreaterThan(0);
  });

  it('skips a harbors entry whose edge id has no matching geometry edge (defensive)', () => {
    const badBoard = { hexes: board.hexes, harbors: { 99999: 'generic' } as Record<EdgeId, 'generic'> };
    expect(computeHarborTiles(badBoard, GEOMETRY, undefined, seaRing)).toHaveLength(0);
  });

  it('emits nothing for a harbor edge when no ring was computed at all (defensive — should not happen on a real board)', () => {
    expect(computeHarborTiles(board, GEOMETRY, undefined, [])).toHaveLength(0);
  });
});

describe('computeHarborTiles — Seafarers/E&P-style board (a REAL sea hex already borders the edge)', () => {
  const SQRT3 = Math.sqrt(3);
  // Minimal synthetic 2-hex geometry: hex 0 (land) at axial (0,0), hex 1 (sea) at its east neighbor
  // (1,0) — the exact same axial-neighbor relationship `seaHexRing.ts`'s `NEIGHBOR_DELTAS` E entry
  // describes. The edge between them sits at the true midpoint of the two hex centers (unit-space
  // formula `x = sqrt3*(q+r/2), y = 1.5*r`, same as every other real edge in this codebase).
  const geometry = {
    hexes: [
      { id: 0, q: 0, r: 0, x: 0, y: 0, vertices: [], edges: [] },
      { id: 1, q: 1, r: 0, x: SQRT3, y: 0, vertices: [], edges: [] },
    ],
    edges: [{ id: 0, a: 0, b: 1, hexes: [0, 1], x: SQRT3 / 2, y: 0, angleDeg: 90 }],
  } as unknown as Parameters<typeof computeHarborTiles>[1];

  const board = {
    hexes: [{ terrain: 'forest', token: null }, { terrain: 'desert', token: null }] as HexTile[],
    harbors: { 0: 'generic' } as Record<EdgeId, 'generic'>,
  };
  const hexTerrain = ['forest', 'sea'] as const;

  it('targets the REAL sea hex the edge already borders, not a ring hex', () => {
    const tiles = computeHarborTiles(board, geometry, hexTerrain, []);
    expect(tiles).toHaveLength(1);
    expect(tiles[0]!.target).toEqual({ kind: 'hex', hexId: 1 });
  });

  it('still faces inward (toward the land hex) even for a real-hex target', () => {
    const [tile] = computeHarborTiles(board, geometry, hexTerrain, []);
    const stripped = tile!.yaw - offsetFor(tile!.variant);
    // Land hex is due WEST of the sea hex here, so "facing the island" should point in -X.
    const facingX = Math.sin(stripped);
    expect(facingX).toBeLessThan(0);
  });
});
