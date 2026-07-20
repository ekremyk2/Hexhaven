// Seafarers ship gameplay (T-702, docs/rules/seafarers-rules.md §S3–§S7). The two ship ACTIONS —
// `buildShip` (S4) and `moveShip` (S7) — plus the pure placement/legality predicates they and the
// legal-move enumerators (legal.ts) / bots (ai, sim) share. Wired into the engine through the
// seafarers module's `interceptAction` (index.ts), so the base reducer never names a ship inline.
//
// Junction rule (S5): road and ship networks are separate and join ONLY at that player's
// settlement/city. So ship connectivity looks at the player's SHIPS and BUILDINGS — never their roads.

import type {
  BoardGeometry,
  EdgeId,
  EngineErrorCode,
  GameEvent,
  GameState,
  ResourceBundle,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { shipBuilt, shipMoved, tradeCancelled } from '../../events.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { updateAwards } from '../../rules/awards.js';
import { isRoadOnEdge } from '../../rules/placement.js';
import { geometryForState } from '../index.js';
import { edgeBordersPirate } from './pirate.js';
import { hexTerrainOf, isShipOnEdge, seafarersExt, shipsLeftOf, shipsOf, withSeafarersExt } from './state.js';

/** S4.1: a ship costs 1 lumber + 1 wool (paid to the bank). */
export const SHIP_COST: ResourceBundle = { lumber: 1, wool: 1 };

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Board predicates -------------------------------------------------------------------------

/** S3.2: an edge borders at least one sea hex (aquatic or coastal) — i.e. a legal ship edge shape. */
export function isSeaEdge(state: GameState, geometry: BoardGeometry, edge: EdgeId): boolean {
  const e = geometry.edges[edge];
  if (!e) return false;
  return e.hexes.some((h) => hexTerrainOf(state, h) === 'sea');
}

/** True iff the edge borders at least one land hex (resource/desert/gold) — where roads may go. A
 *  pure aquatic (sea↔sea) edge is ship-only (S3.2); an edge with no on-board sea hex is road-only. */
export function edgeBordersLand(state: GameState, geometry: BoardGeometry, edge: EdgeId): boolean {
  const e = geometry.edges[edge];
  if (!e) return false;
  return e.hexes.some((h) => {
    const t = hexTerrainOf(state, h);
    return t !== undefined && t !== 'sea';
  });
}

/** True iff vertex `v` touches at least one land hex — where a settlement may be built (S4.3). Open
 *  ocean (a vertex bordered only by sea) is never buildable. */
export function vertexTouchesLand(state: GameState, geometry: BoardGeometry, v: VertexId): boolean {
  const vert = geometry.vertices[v];
  if (!vert) return false;
  return vert.hexes.some((h) => {
    const t = hexTerrainOf(state, h);
    return t !== undefined && t !== 'sea';
  });
}

function ownBuildingOn(state: GameState, seat: Seat, v: VertexId): boolean {
  const p = state.players[seat];
  return !!p && (p.settlements.includes(v) || p.cities.includes(v));
}

function opponentBuildingOn(state: GameState, seat: Seat, v: VertexId): boolean {
  return state.players.some(
    (p) => p.seat !== seat && (p.settlements.includes(v) || p.cities.includes(v))
  );
}

/** Does the seat have a ship incident to vertex `v` (ignoring `exclude`, a ship being relocated)? */
export function ownShipAt(
  state: GameState,
  geometry: BoardGeometry,
  seat: Seat,
  v: VertexId,
  exclude?: EdgeId
): boolean {
  const vert = geometry.vertices[v];
  if (!vert) return false;
  const ships = shipsOf(state, seat);
  return vert.edges.some((e) => e !== exclude && ships.includes(e));
}

// ---- Ship placement (S4.2 / S5) ---------------------------------------------------------------

/**
 * Why `seat` may NOT place a ship on `edge` (S3/S4/S5), or `null` if it is a legal ship spot.
 * `exclude` is a ship being relocated (moveShip, S7.1c): it is treated as already picked up, so it
 * neither occupies the edge nor anchors connectivity. Does NOT check cost or supply (callers do).
 */
export function shipPlacementError(
  state: GameState,
  seat: Seat,
  edge: EdgeId,
  exclude?: EdgeId
): { code: EngineErrorCode; message: string } | null {
  const geometry = geometryForState(state);
  if (!geometry.edges[edge]) return { code: 'BAD_LOCATION', message: `edge ${edge} is off the board` };
  if (!isSeaEdge(state, geometry, edge)) {
    return { code: 'BAD_LOCATION', message: `edge ${edge} is not a sea edge; ships need a sea hex (S3.2)` };
  }
  if (isRoadOnEdge(state, edge)) {
    return { code: 'OCCUPIED', message: `edge ${edge} already has a road (one piece per edge, S3.3)` };
  }
  if (edge !== exclude && isShipOnEdge(state, edge)) {
    return { code: 'OCCUPIED', message: `edge ${edge} already has a ship (S3.3)` };
  }
  if (edgeBordersPirate(state, geometry, edge)) {
    return { code: 'BAD_LOCATION', message: `edge ${edge} borders the pirate; no ship may be placed there (S8.5)` };
  }
  const e = geometry.edges[edge]!;
  for (const v of [e.a, e.b]) {
    if (opponentBuildingOn(state, seat, v)) continue; // blocked at this vertex (ER-S2, cf. R7.2)
    if (ownBuildingOn(state, seat, v)) return null; // adjacent to your coastal building (S4.2)
    if (ownShipAt(state, geometry, seat, v, exclude)) return null; // adjacent to your own ship (S4.2)
  }
  return {
    code: 'NOT_CONNECTED',
    message: `edge ${edge} is not adjacent to your coastal building or ship (junction rule, S4.2/S5)`,
  };
}

/** Fully legal ship spot for `seat` right now (shape + connectivity; NOT cost/supply). */
export function canPlaceShip(state: GameState, seat: Seat, edge: EdgeId, exclude?: EdgeId): boolean {
  return shipPlacementError(state, seat, edge, exclude) === null;
}

/** Every sea edge `seat` could legally build a ship on right now (drives legal.ts / bots). */
export function legalShipEdges(state: GameState, seat: Seat): EdgeId[] {
  if (state.phase.kind !== 'main' || !seafarersExt(state)) return [];
  if (shipsLeftOf(state, seat) <= 0) return []; // no ship pieces left → don't highlight (S1.1)
  return geometryForState(state)
    .edges.filter((e) => canPlaceShip(state, seat, e.id))
    .map((e) => e.id);
}

// ---- Ship movement (S7) -----------------------------------------------------------------------

/**
 * S7.1d/S7.2: a ship is relocatable only if it has an OPEN end — one of its two endpoints is not
 * adjacent to any of the seat's OTHER pieces. "Pieces" here means the seat's buildings and other
 * ships; roads never attach to ships (junction rule S5), so a nearby unconnected road does not close
 * an end. A ship inside a route or spanning two of the seat's own settlements/cities (a CLOSED route,
 * S7.2) has both ends built up and so is never movable.
 */
export function shipHasOpenEnd(state: GameState, geometry: BoardGeometry, seat: Seat, edge: EdgeId): boolean {
  const e = geometry.edges[edge];
  if (!e) return false;
  for (const v of [e.a, e.b]) {
    if (ownBuildingOn(state, seat, v)) continue; // built-up end
    if (ownShipAt(state, geometry, seat, v, edge)) continue; // another of your ships continues here
    return true; // nothing of yours anchors this end → it is open
  }
  return false;
}

/** Raw legal destination edges for relocating the ship on `from` (S7.1c re-placement rules): every
 * sea edge that would be a legal NEW-ship placement with `from` picked up (`canPlaceShip` excluding
 * `from`). Does NOT re-check `from`'s own mover eligibility (built-this-turn / open-end / pirate) —
 * callers gate that. Split out so `movableShips` can filter out a ship that has an open end but
 * nowhere legal to go. */
function moveTargetsOf(state: GameState, seat: Seat, from: EdgeId, geometry: BoardGeometry): EdgeId[] {
  return geometry.edges
    .filter((e) => e.id !== from && canPlaceShip(state, seat, e.id, from))
    .map((e) => e.id) as EdgeId[];
}

/** The seat's ships that could be picked up this turn (open-ended, not built this turn, ≤1/turn) AND
 * that actually have somewhere legal to go. */
export function movableShips(state: GameState, seat: Seat): EdgeId[] {
  const ext = seafarersExt(state);
  if (state.phase.kind !== 'main' || !ext) return [];
  if (ext.movedShipOnTurn === state.turn.number) return []; // S7.1a: already moved one this turn
  const geometry = geometryForState(state);
  const builtThisTurn = ext.builtShips.turn === state.turn.number ? ext.builtShips.edges : [];
  return shipsOf(state, seat).filter(
    (edge) =>
      !builtThisTurn.includes(edge) &&
      !edgeBordersPirate(state, geometry, edge) && // S7.3/S8.5: can't move a ship away from the pirate
      shipHasOpenEnd(state, geometry, seat, edge) &&
      // B-28: a ship with an open end but NO legal destination (classic case: a lone ship on a
      // coastal settlement with only one sea edge) must not be offered as movable — the UI's step-1
      // pick would select it and then show zero destinations ("select ship, can't select where to").
      moveTargetsOf(state, seat, edge, geometry).length > 0
  ) as EdgeId[];
}

/** Every legal destination edge for relocating the open ship `from` (S7.1c re-placement rules). */
export function shipMoveTargets(state: GameState, seat: Seat, from: EdgeId): EdgeId[] {
  if (!movableShips(state, seat).includes(from)) return [];
  return moveTargetsOf(state, seat, from, geometryForState(state));
}

// ---- Action handlers --------------------------------------------------------------------------

/** Common build/move tail: recompute the Longest Trade Route award and clear any open trade (ER-11). */
function finishShipAction(next: GameState, primary: GameEvent[]): EngineResult {
  const awarded = updateAwards(next);
  let state = awarded.state;
  const events: GameEvent[] = [...primary, ...awarded.events];
  if (state.trade != null) {
    state = { ...state, trade: null };
    events.push(tradeCancelled());
  }
  return { ok: true, state, events };
}

/** S4: build a ship. Turn owner only (dispatcher-guaranteed) in the main phase after the roll. */
export function buildShip(state: GameState, seat: Seat, edge: EdgeId): EngineResult {
  const ext = seafarersExt(state);
  if (!ext) return fail('EXPANSION_NOT_AVAILABLE', 'ships require a seafarers game (S3)');
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'ships are built in the main phase (S4)');

  const placement = shipPlacementError(state, seat, edge);
  if (placement) return fail(placement.code, placement.message);
  if (shipsLeftOf(state, seat) <= 0) return fail('NO_PIECES_LEFT', 'no ships left in supply (S1.1)');

  const player = state.players[seat];
  if (!player) throw new Error(`BUG: buildShip for unknown seat ${seat}`);
  if (!canAfford(player, SHIP_COST)) {
    return fail('CANT_AFFORD', 'a ship costs 1 lumber + 1 wool (S4.1)');
  }

  const { players, bank } = payToBank(state, seat, SHIP_COST);
  const ships = ext.ships.map((list, s) => (s === seat ? [...list, edge] : list));
  const shipsLeft = ext.shipsLeft.map((n, s) => (s === seat ? n - 1 : n));
  const builtShips =
    ext.builtShips.turn === state.turn.number
      ? { turn: state.turn.number, edges: [...ext.builtShips.edges, edge] }
      : { turn: state.turn.number, edges: [edge] };

  const next = withSeafarersExt({ ...state, players, bank }, { ...ext, ships, shipsLeft, builtShips });
  return finishShipAction(next, [shipBuilt(seat, edge)]);
}

/** S7: relocate one open-ended ship (once per turn, not one built this turn, ends legally placed). */
export function moveShip(state: GameState, seat: Seat, from: EdgeId, to: EdgeId): EngineResult {
  const ext = seafarersExt(state);
  if (!ext) return fail('EXPANSION_NOT_AVAILABLE', 'ships require a seafarers game (S7)');
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'ships move in the main phase (S7.1a)');

  if (!shipsOf(state, seat).includes(from)) {
    return fail('BAD_LOCATION', `edge ${from} does not carry one of your ships (S7)`);
  }
  if (ext.movedShipOnTurn === state.turn.number) {
    return fail('CANNOT_PLAY', 'you may move only one ship per turn (S7.1a)');
  }
  if (ext.builtShips.turn === state.turn.number && ext.builtShips.edges.includes(from)) {
    return fail('CANNOT_PLAY', 'you may not move a ship built this turn (S7.1b)');
  }
  const geometry = geometryForState(state);
  if (edgeBordersPirate(state, geometry, from)) {
    return fail('CANNOT_PLAY', 'a ship bordering the pirate may not be moved away (S7.3/S8.5)');
  }
  if (!shipHasOpenEnd(state, geometry, seat, from)) {
    return fail('CANNOT_PLAY', 'only an open-ended ship may be moved (S7.1d/S7.2)');
  }
  if (to === from) return fail('BAD_LOCATION', 'a ship must move to a different edge (S7)');

  // S7.1c: the destination must satisfy all normal new-ship placement rules with `from` picked up.
  const placement = shipPlacementError(state, seat, to, from);
  if (placement) return fail(placement.code, placement.message);

  const ships = ext.ships.map((list, s) =>
    s === seat ? [...list.filter((e) => e !== from), to] : list
  );
  const next = withSeafarersExt(
    { ...state },
    { ...ext, ships, movedShipOnTurn: state.turn.number }
  );
  return finishShipAction(next, [shipMoved(seat, from, to)]);
}
