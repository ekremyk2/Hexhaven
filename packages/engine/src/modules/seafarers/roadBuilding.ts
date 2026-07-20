// Seafarers Road Building → ships (T-703, docs/rules/seafarers-rules.md §S11.1). In a seafarers game
// the Road Building card places 2 roads, OR 2 ships, OR 1 road + 1 ship — each following its normal
// placement rules (ER-5 "place what you can" extends to the ship option). Base Road Building
// (phases/devCards.ts) stays bit-identical; the seafarers module intercepts `playRoadBuilding` and the
// two free-piece placements (`placeFreeRoad` / `placeFreeShip`) for a seafarers game only, so all the
// ship-aware logic lives here rather than special-cased into the base handler.

import type { EdgeId, EngineErrorCode, GameEvent, GameState, Phase, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { built, devPlayed, shipBuilt } from '../../events.js';
import { beginPlay, resolvedRoadBuildingCount } from '../../phases/devCards.js';
import { updateAwards } from '../../rules/awards.js';
import { canPlaceRoad } from '../../rules/connectivity.js';
import { geometryForState } from '../index.js';
import { canPlaceShip, edgeBordersLand } from './ships.js';
import { seafarersExt, shipsLeftOf, withSeafarersExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** A free road spot: connected + occupancy-legal (R7.2) AND land-bordering (S3.2 — a pure sea route
 *  is ship-only). */
function canPlaceFreeRoad(state: GameState, seat: Seat, edge: EdgeId): boolean {
  return canPlaceRoad(state, seat, edge) && edgeBordersLand(state, geometryForState(state), edge);
}

/** Is any free road placement legal for `seat` right now? (roads left + a legal land edge). */
function anyFreeRoad(state: GameState, seat: Seat): boolean {
  const roadsLeft = state.players[seat]?.piecesLeft.roads ?? 0;
  if (roadsLeft <= 0) return false;
  return geometryForState(state).edges.some((e) => canPlaceFreeRoad(state, seat, e.id));
}

/** Is any free ship placement legal for `seat` right now? (ships left + a legal sea edge). */
function anyFreeShip(state: GameState, seat: Seat): boolean {
  if (shipsLeftOf(state, seat) <= 0) return false;
  return geometryForState(state).edges.some((e) => canPlaceShip(state, seat, e.id));
}

/**
 * Can `seat` play Road Building in this seafarers game right now (S11.1)? True iff at least a road OR
 * a ship free placement is legal — the exact CANNOT_PLAY gate `playRoadBuildingSeafarers` enforces.
 * Exported so legal.ts's `playableDevCards` shares this single source of truth (a road-only check
 * there would wrongly count a pure-sea edge as legal, S3.2, or ignore the ship option, S11.1 — a
 * mismatch the sim caught as an illegal `playRoadBuilding` the bot proposed but the handler rejected).
 */
export function canPlayRoadBuildingSeafarers(state: GameState, seat: Seat): boolean {
  return anyFreeRoad(state, seat) || anyFreeShip(state, seat);
}

/** Every edge `seat` could place a FREE ship on during the `roadBuilding` sub-phase (S11.1) — drives
 *  legal.ts / the bots. Empty unless it's a seafarers game in that sub-phase with ship supply left. */
export function legalFreeShipEdges(state: GameState, seat: Seat): EdgeId[] {
  if (state.phase.kind !== 'roadBuilding' || shipsLeftOf(state, seat) <= 0) return [];
  return geometryForState(state)
    .edges.filter((e) => canPlaceShip(state, seat, e.id))
    .map((e) => e.id);
}

/**
 * S11.1 play: open Road Building in a seafarers game. Unplayable (`CANNOT_PLAY`, card retained, no
 * dev-play spent — ER-5) only when NEITHER a road NOR a ship can be placed. `remaining` counts the
 * free pieces available: up to `resolvedRoadBuildingCount` (base 2, T-906 `customConstants.
 * roadBuildingCount`), bounded by the seat's combined road+ship supply.
 */
export function playRoadBuildingSeafarers(state: GameState, seat: Seat): EngineResult {
  const guard = beginPlay(state, seat, 'roadBuilding');
  if (!guard.ok) return guard;

  const canRoad = anyFreeRoad(guard.state, seat);
  const canShip = anyFreeShip(guard.state, seat);
  if (!canRoad && !canShip) {
    return fail('CANNOT_PLAY', 'no road/ship piece or legal edge for Road Building (ER-5/S11.1)');
  }
  const player = guard.state.players[seat]!;
  const supply = player.piecesLeft.roads + shipsLeftOf(guard.state, seat);
  const remaining = Math.min(resolvedRoadBuildingCount(guard.state), supply);
  const next: GameState = { ...guard.state, phase: { kind: 'roadBuilding', remaining } };
  return { ok: true, state: next, events: [devPlayed(seat, 'roadBuilding')] };
}

/** Where the sub-phase returns after the last free piece — mirrors base devCards.ts: derived from
 *  `turn.rolled` (rolled ⇔ played in the main phase, !rolled ⇔ played in preRoll). */
function returnPhase(state: GameState): Phase {
  return state.turn.rolled ? { kind: 'main' } : { kind: 'preRoll' };
}

/** After placing one free piece, advance the sub-phase: end when none remain or nothing is placeable
 *  (S11.1/ER-5), else stay in `roadBuilding` with one fewer. */
function advance(state: GameState, remaining: number, seat: Seat, events: GameEvent[]): EngineResult {
  const stillLegal = anyFreeRoad(state, seat) || anyFreeShip(state, seat);
  if (remaining <= 0 || !stillLegal) {
    return { ok: true, state: { ...state, phase: returnPhase(state) }, events };
  }
  return {
    ok: true,
    state: { ...state, phase: { kind: 'roadBuilding', remaining } },
    events,
  };
}

/**
 * A free ROAD placement during Road Building in a seafarers game (S11.1). Same occupancy+connectivity
 * gate as a normal road, plus the land-edge requirement (S3.2). Free (bank untouched).
 */
export function placeFreeRoadSeafarers(state: GameState, seat: Seat, edge: EdgeId): EngineResult {
  if (state.phase.kind !== 'roadBuilding') return fail('WRONG_PHASE', 'not in the roadBuilding phase');
  // A free road still spends a road piece. This sub-phase's `remaining` counts roads+ships (S11.1),
  // so it can outlast the ROAD supply (ships still placeable) — guard here or piecesLeft.roads goes
  // negative (I4). The base handler needs no such guard: base `remaining` is capped by roads alone.
  if ((state.players[seat]?.piecesLeft.roads ?? 0) <= 0) {
    return fail('NO_PIECES_LEFT', 'no roads left in supply (R7.1/S11.1)');
  }
  if (!canPlaceFreeRoad(state, seat, edge)) {
    return fail('BAD_LOCATION', `edge ${edge} is not a legal free-road spot (R7.2/S3.2)`);
  }
  const players = state.players.map((p) =>
    p.seat === seat
      ? { ...p, roads: [...p.roads, edge], piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 } }
      : p
  );
  const awarded = updateAwards({ ...state, players });
  const events: GameEvent[] = [built(seat, 'road', edge), ...awarded.events];
  return advance(awarded.state, state.phase.remaining - 1, seat, events);
}

/**
 * A free SHIP placement during Road Building in a seafarers game (S11.1). Normal ship placement rules
 * (S3/S4/S5/S8.5) but free. Recorded in `builtShips` so it can't be moved this turn (S7.1b).
 */
export function placeFreeShipSeafarers(state: GameState, seat: Seat, edge: EdgeId): EngineResult {
  if (state.phase.kind !== 'roadBuilding') return fail('WRONG_PHASE', 'not in the roadBuilding phase');
  const ext = seafarersExt(state);
  if (!ext) return fail('EXPANSION_NOT_AVAILABLE', 'ships require a seafarers game (S11.1)');
  if (shipsLeftOf(state, seat) <= 0) return fail('NO_PIECES_LEFT', 'no ships left in supply (S1.1)');
  if (!canPlaceShip(state, seat, edge)) {
    return fail('BAD_LOCATION', `edge ${edge} is not a legal free-ship spot (S3/S4/S5/S8.5)`);
  }

  const ships = ext.ships.map((list, s) => (s === seat ? [...list, edge] : list));
  const shipsLeft = ext.shipsLeft.map((n, s) => (s === seat ? n - 1 : n));
  const builtShips =
    ext.builtShips.turn === state.turn.number
      ? { turn: state.turn.number, edges: [...ext.builtShips.edges, edge] }
      : { turn: state.turn.number, edges: [edge] };
  const withShip = withSeafarersExt(state, { ...ext, ships, shipsLeft, builtShips });
  const awarded = updateAwards(withShip);
  const events: GameEvent[] = [shipBuilt(seat, edge), ...awarded.events];
  return advance(awarded.state, state.phase.remaining - 1, seat, events);
}
