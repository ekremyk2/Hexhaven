// Placement rules shared by setup (T-103) and normal building (T-105): occupancy + the
// settlement distance rule (R7.3). Pure reads over GameState + GEOMETRY.

import type { GameState, VertexId, EdgeId } from '@hexhaven/shared';
import { geometryForState } from '../modules/index.js';
import { isHarborSettlementAt } from '../modules/explorersPirates/state.js';
import { isShipOnEdge } from '../modules/seafarers/state.js';

/** Is any player's settlement or city on this vertex? T-1107 (§EP4.2): also true for an E&P harbor
 *  settlement — `upgradeToHarbor` (settling.ts) removes the vertex from `player.settlements` (the
 *  piece returns to supply, like a base city upgrade) but the harbor settlement is still a real
 *  building sitting there, so it must keep blocking the distance rule / re-placement exactly like a
 *  settlement or city does. `isHarborSettlementAt` is `false` outside a live E&P game (ext absence),
 *  so base/other-expansion occupancy is unchanged (RK-13) — mirrors `isEdgeOccupied`'s own
 *  cross-module `isShipOnEdge` read below. */
export function isVertexOccupied(state: GameState, v: VertexId): boolean {
  return (
    state.players.some((p) => p.settlements.includes(v) || p.cities.includes(v)) ||
    isHarborSettlementAt(state, v)
  );
}

/** Is any player's road on this edge? (Roads only — used where a ship's own placement wants a
 *  road-specific message; general occupancy should use `isEdgeOccupied`.) */
export function isRoadOnEdge(state: GameState, e: EdgeId): boolean {
  return state.players.some((p) => p.roads.includes(e));
}

/** Is this edge occupied by ANY piece? A road always; in a seafarers game a ship too — S3.3's one
 *  piece per edge (roads and ships may not share a coastline). `isShipOnEdge` is false in a base
 *  game, so base occupancy is unchanged (RK-13). */
export function isEdgeOccupied(state: GameState, e: EdgeId): boolean {
  return isRoadOnEdge(state, e) || isShipOnEdge(state, e);
}

/**
 * R7.3 distance rule: the target vertex is empty AND none of its (up to three) neighbouring
 * intersections carry a building — anyone's. Used for both setup and normal settlement placement.
 */
export function satisfiesDistanceRule(state: GameState, v: VertexId): boolean {
  if (isVertexOccupied(state, v)) return false;
  const vert = geometryForState(state).vertices[v];
  if (!vert) throw new Error(`BUG: unknown vertex ${v}`);
  return vert.neighbors.every((n) => !isVertexOccupied(state, n));
}
