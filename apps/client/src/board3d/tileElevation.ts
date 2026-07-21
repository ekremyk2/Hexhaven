// T-1505 requirement 4 — "sculpted tiles have height, lift number tokens/fog/pieces to sit on the
// tile TOP surface (derive top-Y from the normalized model bounds, not the old flat TILE_HEIGHT)".
// Pure lookups, no react/three imports (`coords.ts`/`pieceAnimation.ts` convention) — the single place
// every board3d component asks "how tall is the ground here" so `Board3D.tsx` (tokens/fog, per hex)
// and `Pieces3D.tsx` (settlements/cities/roads/ships, per vertex/edge) can never disagree.
//
// A vertex/edge touches 1-3 hexes that can each show a DIFFERENT terrain (and, for terrains with STL
// coverage, a different deterministically-picked variant height) — a piece standing there rests on
// the TALLEST of them, so it never clips into a taller neighbouring sculpted tile.
import type { BoardGeometry, EdgeId, GameState, HexId, ScenarioTerrain, VertexId } from '@hexhaven/shared';
import { TILE_HEIGHT } from './constants';
import { hasStlCoverage, hexModelHeight } from './terrainStlModels';

type BoardState = GameState['board'];

/** The terrain a hex actually shows — the same `hexTerrain?.[id] ?? board.hexes[id].terrain`
 *  resolution every board3d component already applies (`HexTiles.tsx`, `Board3D.tsx`), centralized
 *  here so this module's elevation answers can never disagree with what's actually rendered there. */
export function resolvedHexTerrain(
  board: Pick<BoardState, 'hexes'>,
  hexTerrain: readonly ScenarioTerrain[] | undefined,
  hexId: HexId,
): ScenarioTerrain | undefined {
  const tile = board.hexes[hexId];
  if (!tile) return undefined;
  return hexTerrain?.[hexId] ?? tile.terrain;
}

/** The Y a token/fog-cover/piece resting ON hex `hexId` sits at: the sculpted model's own measured
 *  height (deterministic per-hex variant, `terrainStlModels.ts`) for terrains with STL coverage, or
 *  the flat procedural prism's `TILE_HEIGHT` for anything without (Seafarers `gold`, or a missing
 *  tile — defensive). */
export function hexTopY(
  board: Pick<BoardState, 'hexes'>,
  hexTerrain: readonly ScenarioTerrain[] | undefined,
  hexId: HexId,
): number {
  const terrain = resolvedHexTerrain(board, hexTerrain, hexId);
  if (terrain && hasStlCoverage(terrain)) return hexModelHeight(terrain, hexId);
  return TILE_HEIGHT;
}

/** A vertex's resting Y — the max `hexTopY` over its 1-3 touching hexes (`vertex.hexes`, ascending
 *  per `GeometryVertex`'s own doc). Falls back to `TILE_HEIGHT` for a (never-real) vertex with no
 *  touching hexes at all. */
export function vertexTopY(
  board: Pick<BoardState, 'hexes'>,
  geometry: Pick<BoardGeometry, 'vertices'>,
  hexTerrain: readonly ScenarioTerrain[] | undefined,
  vertexId: VertexId,
): number {
  const vertex = geometry.vertices[vertexId];
  if (!vertex || vertex.hexes.length === 0) return TILE_HEIGHT;
  return Math.max(...vertex.hexes.map((h) => hexTopY(board, hexTerrain, h)));
}

/** An edge's (road/ship) resting Y — the max `hexTopY` over its 1-2 bordering hexes, same "rest on
 *  the taller side" rule as `vertexTopY`. */
export function edgeTopY(
  board: Pick<BoardState, 'hexes'>,
  geometry: Pick<BoardGeometry, 'edges'>,
  hexTerrain: readonly ScenarioTerrain[] | undefined,
  edgeId: EdgeId,
): number {
  const edge = geometry.edges[edgeId];
  if (!edge || edge.hexes.length === 0) return TILE_HEIGHT;
  return Math.max(...edge.hexes.map((h) => hexTopY(board, hexTerrain, h)));
}
