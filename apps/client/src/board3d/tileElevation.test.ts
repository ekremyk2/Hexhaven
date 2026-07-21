// Tests for T-1505's per-hex/vertex/edge tile-top elevation lookups — pure, no react/three/DOM.
import { describe, expect, it } from 'vitest';
import type { EdgeId, HexId, HexTile, ScenarioTerrain, VertexId } from '@hexhaven/shared';
import { TILE_HEIGHT } from './constants';
import { hexModelHeight } from './terrainStlModels';
import { edgeTopY, hexTopY, resolvedHexTerrain, vertexTopY } from './tileElevation';

const hid = (n: number) => n as HexId;
const vid = (n: number) => n as VertexId;
const eid = (n: number) => n as EdgeId;

const hex = (terrain: ScenarioTerrain, token: number | null = null): HexTile => ({
  // `HexTile.terrain` is `TerrainType` (no sea/gold) — real boards proxy those through `hexTerrain`
  // instead (see `board/BoardView.tsx`'s own comment on this); tests that need sea/gold pass an
  // override via the `hexTerrain` array argument, same as production callers.
  terrain: terrain as HexTile['terrain'],
  token,
});

describe('resolvedHexTerrain', () => {
  const board = { hexes: [hex('forest'), hex('desert')] };

  it('uses the base tile terrain when no override is given', () => {
    expect(resolvedHexTerrain(board, undefined, hid(0))).toBe('forest');
  });

  it('prefers the hexTerrain override when present (Seafarers sea/gold proxy through desert)', () => {
    expect(resolvedHexTerrain(board, ['forest', 'sea'], hid(1))).toBe('sea');
  });

  it('returns undefined for a hex id with no tile at all', () => {
    expect(resolvedHexTerrain(board, undefined, hid(5))).toBeUndefined();
  });
});

describe('hexTopY', () => {
  it('returns the STL model height for a terrain with coverage', () => {
    const board = { hexes: [hex('forest')] };
    expect(hexTopY(board, undefined, hid(0))).toBeCloseTo(hexModelHeight('forest', 0), 10);
  });

  it('falls back to TILE_HEIGHT for gold (no supplied model)', () => {
    const board = { hexes: [hex('desert')] };
    expect(hexTopY(board, ['gold'], hid(0))).toBe(TILE_HEIGHT);
  });

  it('falls back to TILE_HEIGHT for a missing tile', () => {
    const board = { hexes: [] as HexTile[] };
    expect(hexTopY(board, undefined, hid(0))).toBe(TILE_HEIGHT);
  });

  it('sea (proxied through desert) gets the water model\'s height, not TILE_HEIGHT', () => {
    const board = { hexes: [hex('desert')] };
    expect(hexTopY(board, ['sea'], hid(0))).toBeCloseTo(hexModelHeight('sea', 0), 10);
    expect(hexTopY(board, ['sea'], hid(0))).not.toBe(TILE_HEIGHT);
  });
});

describe('vertexTopY', () => {
  const board = { hexes: [hex('mountains'), hex('forest'), hex('desert')] };
  // hex 0 (mountains) is measured the tallest terrain model (see terrainStlModels.ts's ratios).
  const geometry = { vertices: [{ id: vid(0), x: 0, y: 0, hexes: [hid(0), hid(1), hid(2)], edges: [], neighbors: [] }] };

  it('rests on the TALLEST of its touching hexes, not the first/last', () => {
    const expected = Math.max(
      hexTopY(board, undefined, hid(0)),
      hexTopY(board, undefined, hid(1)),
      hexTopY(board, undefined, hid(2)),
    );
    expect(vertexTopY(board, geometry, undefined, vid(0))).toBeCloseTo(expected, 10);
    // Sanity: mountains really is the tallest of the three in this fixture, so the max is non-trivial.
    expect(expected).toBeCloseTo(hexTopY(board, undefined, hid(0)), 10);
  });

  it('falls back to TILE_HEIGHT for an unknown vertex', () => {
    expect(vertexTopY(board, geometry, undefined, vid(99))).toBe(TILE_HEIGHT);
  });
});

describe('edgeTopY', () => {
  const board = { hexes: [hex('hills'), hex('mountains')] };
  const geometry = { edges: [{ id: eid(0), a: vid(0), b: vid(1), hexes: [hid(0), hid(1)], x: 0, y: 0, angleDeg: 30 }] };

  it('rests on the taller of its (up to 2) bordering hexes', () => {
    const expected = Math.max(hexTopY(board, undefined, hid(0)), hexTopY(board, undefined, hid(1)));
    expect(edgeTopY(board, geometry, undefined, eid(0))).toBeCloseTo(expected, 10);
  });

  it('a single-hex (coastal) edge just uses that one hex\'s height', () => {
    // Array INDEX must match the id being queried (`edgeTopY` looks up `geometry.edges[edgeId]`
    // positionally, exactly like every real `BoardGeometry`) — this fixture's only edge sits at
    // index 0, so it's queried as `eid(0)`, distinct from the `geometry` fixture above (whose edge
    // also happens to be at index 0, id 0) only in its `hexes` list (a single hex, not two).
    const coastalGeometry = { edges: [{ id: eid(0), a: vid(0), b: vid(1), hexes: [hid(1)], x: 0, y: 0, angleDeg: 30 }] };
    expect(edgeTopY(board, coastalGeometry, undefined, eid(0))).toBeCloseTo(hexTopY(board, undefined, hid(1)), 10);
  });

  it('falls back to TILE_HEIGHT for an unknown edge', () => {
    expect(edgeTopY(board, geometry, undefined, eid(99))).toBe(TILE_HEIGHT);
  });
});
