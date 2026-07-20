// Road connectivity (R7.2). A road connects if it touches one of your roads/settlements/cities at
// an endpoint — but connection THROUGH a vertex carrying an opponent's building is blocked.
// `canPlaceRoad` is reused by T-109's Road Building card.

import type { EdgeId, GameState, Seat, VertexId } from '@hexhaven/shared';
import { geometryForState } from '../modules/index.js';
import { harborSettlementsOf } from '../modules/explorersPirates/state.js';
import { shipsOf } from '../modules/seafarers/state.js';
import {
  bridgesOf,
  isPathBarbarianEdge,
  isRiverEdge,
  isRiversState,
  isTradersBarbariansMainState,
} from '../modules/tradersBarbarians/state.js';
import { isEdgeOccupied } from './placement.js';

/** T-1107 (§EP4.2): a harbor settlement counts as `seat`'s own building for road connectivity too —
 *  `upgradeToHarbor` removes the vertex from `player.settlements` (the piece returns to supply, like
 *  a base city upgrade) but it's still a real building the seat's road network may extend through/
 *  from. `harborSettlementsOf` is `[]` outside a live E&P game, so base/other-expansion connectivity
 *  is unchanged (RK-13) — mirrors `rules/placement.ts`'s own `isVertexOccupied` fix. */
function ownBuildingOn(state: GameState, seat: Seat, v: VertexId): boolean {
  const p = state.players[seat];
  return (
    (!!p && (p.settlements.includes(v) || p.cities.includes(v))) ||
    harborSettlementsOf(state, seat).includes(v)
  );
}

/** T-1107 (§EP4.2, mirrors `ownBuildingOn`'s own harbor-settlement fix above): an OPPONENT's harbor
 *  settlement blocks road connectivity through its vertex exactly like their settlement/city would. */
function opponentBuildingOn(state: GameState, seat: Seat, v: VertexId): boolean {
  return state.players.some(
    (p) =>
      p.seat !== seat &&
      (p.settlements.includes(v) || p.cities.includes(v) || harborSettlementsOf(state, p.seat).includes(v))
  );
}

/** Does the seat have a road on any edge incident to vertex `v`? Rivers (T-1003, §TB3.2): a
 *  bridge counts as part of the road network too — `bridgesOf` is `[]` outside a rivers game, so
 *  base occupancy is unchanged there (RK-13). */
export function ownRoadAt(state: GameState, seat: Seat, v: VertexId): boolean {
  const p = state.players[seat];
  const vert = geometryForState(state).vertices[v];
  if (!p || !vert) return false;
  const bridges = bridgesOf(state, seat);
  return vert.edges.some((e) => p.roads.includes(e) || bridges.includes(e));
}

/** Does the seat have a ship on any edge incident to vertex `v`? Always false in a base game
 *  (`shipsOf` is []). Used for S4.3: a settlement may be built where a shipping route reaches land. */
export function ownShipAt(state: GameState, seat: Seat, v: VertexId): boolean {
  const vert = geometryForState(state).vertices[v];
  if (!vert) return false;
  const ships = shipsOf(state, seat);
  return ships.length > 0 && vert.edges.some((e) => ships.includes(e));
}

/** Settlement connectivity (R7.3, extended by S4.3): the vertex touches one of the seat's roads OR,
 *  in a seafarers game, one of their ships. Identical to `ownRoadAt` in a base game. */
export function ownRoadOrShipAt(state: GameState, seat: Seat, v: VertexId): boolean {
  return ownRoadAt(state, seat, v) || ownShipAt(state, seat, v);
}

/** Can the seat's road network legally extend through vertex `v` (R7.2)? */
function connectsAt(state: GameState, seat: Seat, v: VertexId): boolean {
  if (opponentBuildingOn(state, seat, v)) return false; // blocked by an enemy building
  if (ownBuildingOn(state, seat, v)) return true;
  return ownRoadAt(state, seat, v);
}

/** R7.2 connectivity (ignoring occupancy/cost): does the edge touch the seat's network? */
export function isRoadConnected(state: GameState, seat: Seat, edge: EdgeId): boolean {
  const e = geometryForState(state).edges[edge];
  if (!e) return false;
  return connectsAt(state, seat, e.a) || connectsAt(state, seat, e.b);
}

/**
 * Fully legal road spot: empty AND connected (R7.2). Used by legal.ts and every "free road"
 * mechanism (Road Building, the Explorer helper move, cardMods' Trailblazer/Ride-by-Night combos,
 * …) — this is the ONE gate all of them share, so it must also carry the rivers exclusion (T-1003,
 * §TB3.2): a river edge may never take a normal road, only a bridge (`buildBridge`). `isRiversState`
 * is false outside a rivers game, so base behavior is unchanged there (RK-13). Same discipline for
 * the main scenario's path barbarians (T-1006, §TB6.3): a barbarian-occupied edge blocks EVERY road
 * mechanism here too, not just a direct `buildRoad` (the module's `interceptAction` rejection is a
 * defense-in-depth backstop for that one action, mirroring rivers' own belt-and-suspenders setup).
 */
export function canPlaceRoad(state: GameState, seat: Seat, edge: EdgeId): boolean {
  if (isRiversState(state) && isRiverEdge(state, edge)) return false;
  if (isTradersBarbariansMainState(state) && isPathBarbarianEdge(state, edge)) return false;
  return !isEdgeOccupied(state, edge) && isRoadConnected(state, seat, edge);
}
