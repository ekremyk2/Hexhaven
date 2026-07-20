// Explorers & Pirates — ship movement + crew/cargo (T-1102, docs/rules/explorers-pirates-rules.md
// §EP3/§EP7/§EP12). The FIRST E&P engine subsystem — every later E&P task (exploration T-1103,
// founding T-1104, missions T-1105/6, scenarios T-1107) builds on this. Four actions, routed through
// the module's `interceptAction` (index.ts), gated on `isExplorersPiratesState` (ext presence, not
// the config toggle — see state.ts's header comment for why): `buildEPShip` (EP3.1), `moveEPShip`
// (EP3.2, a movement-budget reachability search over sea-edge adjacency — mirrors T&B's
// `moveWagon`/`moveBarbarianKnight` pattern, `modules/tradersBarbarians/{main,barbarianAttack}.ts`),
// `loadCargo`/`unloadCargo` (EP3.3).
//
// T-1106 (§EP8/§EP9) extends `moveEPShipHandler`'s arrival step twice: a fish-shoal haul
// (`haulFishOnArrival`, goldFishSpice.ts) right after the exploration reveal, and `spiceBenefit`
// (raised by `deliverSpice`) widening the movement-budget search past the fixed `SHIP_MOVE_RANGE`
// (`spiceShipRangeBonus`, same file) — see that module's own header for the v1 model.
//
// v1 model (provisional — every constant below is a ⚠ VERIFY placeholder, named so a rulebook-
// accurate correction later is a one-line change, same discipline as the T&B scenario files):
//  - `EP_SHIP_COST` (1 wool + 1 lumber, EP3.1) and `SHIP_MOVE_RANGE` (4 sea routes, EP3.2) are the
//    task's own decided-v1 numbers.
//  - `EP_MAX_SHIPS_PER_SEAT` (3, EP3.2 "up to 3 ships" cited in the rules doc) caps ship count; there
//    is no separate ship-piece SUPPLY field in the data model (unlike base roads/settlements or
//    Seafarers' `shipsLeft`) — v1 just checks the seat's current `ships` count against this constant
//    directly (reuses `NO_PIECES_LEFT`, same meaning: no more of this piece available).
//  - **Coastal-building substitute for a harbor settlement** (EP3.1 build-anchor / EP3.3 load-unload
//    location): harbor settlements are T-1104's own scope (they don't exist yet), so v1 anchors ship
//    building/cargo load/unload to any of the seat's own settlements/cities — exactly the junction
//    rule Seafarers' ships already use (`modules/seafarers/ships.ts`'s `shipPlacementError`), minus
//    the "or an opponent's building blocks this end" wrinkle (E&P has no such clause on record).
//  - **Ship movement is edge-adjacency BFS restricted to SEA edges** (two sea edges are "adjacent"
//    iff they share a vertex, mirrors `barbarianAttack.ts`'s `edgesWithinRange`over land edges): a
//    ship glides up to `SHIP_MOVE_RANGE` hops through connected sea routes. Not blocked by another
//    seat's ship along the WAY (only the destination edge must be unoccupied, EP3.1's "one ship per
//    edge") — E&P's EP10 pirate-ship blocking is out of this task's scope (later, ⚠ VERIFY).
//  - **A ship's edge IS its identity** (EP3.1: one ship per edge) — `shipsBuiltThisTurn`/
//    `movedShipsThisTurn` track CURRENT edges, so a ship that moved this turn is looked up by its
//    NEW position, not where it started.
//  - **Cargo pieces are not separately inventoried at T-1102** — `loadCargo`'s `piece` names an
//    abstract `EPCargo` tag with no accompanying resource cost or supply check (building a real
//    settler/crew piece at cost is T-1104's `buildSettler` / T-1105's `buildCrew`, not this task).
//    `loadCargo`/`unloadCargo` here own only the cargo BAY bookkeeping: the 2-piece cap and the
//    coastal-building location rule.

import type {
  Action,
  EdgeId,
  EngineErrorCode,
  EPCargo,
  GameState,
  ResourceBundle,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { epCargoLoaded, epCargoUnloaded, epShipBuilt, epShipMoved } from '../../events.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { geometryForState } from '../index.js';
import { revealOnArrival } from './exploration.js';
import { haulFishOnArrival, spiceShipRangeBonus } from './goldFishSpice.js';
import {
  crewSupplyOf,
  epExt,
  epTerrainOf,
  harborSettlementsOf,
  isExplorersPiratesState,
  isShipOnEdge,
  settlerSupplyOf,
  shipsOfSeat,
  withEpExt,
} from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed constants (EP3, ⚠ VERIFY every number against the physical rulebook) ------------------

/** EP3.1 ⚠ VERIFY: a ship costs 1 wool + 1 lumber (paid to the bank). */
export const EP_SHIP_COST: ResourceBundle = { wool: 1, lumber: 1 };

/** EP3.2 ⚠ VERIFY: a ship may move up to this many sea-route hops per turn. */
export const SHIP_MOVE_RANGE = 4;

/** EP3.2 ⚠ VERIFY ("up to 3 ships" cited): the per-seat ship count cap — see this file's header. */
export const EP_MAX_SHIPS_PER_SEAT = 3;

/** EP3.3: a ship's cargo bay holds at most this many pieces, any mix. */
export const SHIP_CARGO_CAP = 2;

// ---- Board predicates (EP3.1/EP3.2) --------------------------------------------------------------

/** EP3.1: an edge borders at least one hex that is still open water — fog (`'sea'`) OR a revealed
 *  `'gold'` field (T-1107 fix, ⚠ VERIFY: a gold field is a water tile a ship sails ON, not solid
 *  land — EP6.1/EP7.2 both require a ship to REACH a gold-field hex, which is impossible if
 *  revealing one turned every edge touching it into a dead end). A hex revealed as real `terrain`
 *  is the only outcome that stops an edge from being sailable here. */
export function isSeaEdge(state: GameState, edge: EdgeId): boolean {
  const e = geometryForState(state).edges[edge];
  if (!e) return false;
  return e.hexes.some((h) => {
    const t = epTerrainOf(state, h);
    return t === 'sea' || t === 'gold';
  });
}

/** T-1104 (§EP4.2): also true for one of the seat's own HARBOR settlements — E&P's own coastal-
 *  building anchor, once one exists (`ext.explorersPirates.harborSettlements`, an ext presence that
 *  is `[]` before any upgrade, so this is unchanged behavior until T-1104's `upgradeToHarbor` ever
 *  runs). */
function ownBuildingOn(state: GameState, seat: Seat, v: VertexId): boolean {
  const p = state.players[seat];
  return !!p && (p.settlements.includes(v) || p.cities.includes(v) || harborSettlementsOf(state, seat).includes(v));
}

/** Does the seat have a ship incident to vertex `v` (ignoring `exclude`, a ship being relocated)? */
function ownShipAt(state: GameState, seat: Seat, v: VertexId, exclude?: EdgeId): boolean {
  const vert = geometryForState(state).vertices[v];
  if (!vert) return false;
  const ships = shipsOfSeat(state, seat);
  return vert.edges.some((e) => e !== exclude && ships.some((s) => s.edge === e));
}

/**
 * Why `seat` may NOT place/relocate a ship onto `edge` (EP3.1), or `null` if it is a legal spot.
 * `exclude` is a ship being relocated (`moveEPShip`): treated as already picked up, so it neither
 * occupies the edge nor anchors connectivity. Does NOT check cost or the ship-count cap (callers do).
 */
export function epShipPlacementError(
  state: GameState,
  seat: Seat,
  edge: EdgeId,
  exclude?: EdgeId
): { code: EngineErrorCode; message: string } | null {
  const e = geometryForState(state).edges[edge];
  if (!e) return { code: 'BAD_LOCATION', message: `edge ${edge} is off the board` };
  if (!isSeaEdge(state, edge)) {
    return { code: 'NOT_A_SEA_EDGE', message: `edge ${edge} is not a sea edge; E&P ships need a sea route (EP3.1)` };
  }
  if (edge !== exclude && isShipOnEdge(state, edge)) {
    return { code: 'OCCUPIED', message: `edge ${edge} already carries a ship (EP3.1)` };
  }
  for (const v of [e.a, e.b]) {
    if (ownBuildingOn(state, seat, v)) return null; // adjacent to your coastal building (EP3.1)
    if (ownShipAt(state, seat, v, exclude)) return null; // adjacent to your own ship (chained route)
  }
  return {
    code: 'NOT_CONNECTED',
    message: `edge ${edge} is not adjacent to your coastal settlement/city or ship (EP3.1, v1 harbor substitute — ⚠ VERIFY)`,
  };
}

/** Every sea edge reachable from `from` within `range` hops, restricted to SEA edges throughout (two
 *  sea edges are "adjacent" iff they share a vertex) — the EP3.2 movement-budget search. Maps each
 *  reachable edge to its hop distance (0 for `from` itself, which need not itself be a sea edge so a
 *  caller can validate that separately). */
function seaEdgesWithinRange(state: GameState, from: EdgeId, range: number): Map<EdgeId, number> {
  const geometry = geometryForState(state);
  const dist = new Map<EdgeId, number>([[from, 0]]);
  let frontier: EdgeId[] = [from];
  for (let d = 1; d <= range && frontier.length > 0; d++) {
    const nextFrontier: EdgeId[] = [];
    for (const edgeId of frontier) {
      const edge = geometry.edges[edgeId];
      if (!edge) continue;
      for (const v of [edge.a, edge.b]) {
        const vert = geometry.vertices[v];
        if (!vert) continue;
        for (const adjEdge of vert.edges) {
          if (dist.has(adjEdge)) continue;
          if (!isSeaEdge(state, adjEdge)) continue; // ships travel sea routes only (EP3.2)
          dist.set(adjEdge, d);
          nextFrontier.push(adjEdge);
        }
      }
    }
    frontier = nextFrontier;
  }
  return dist;
}

/**
 * T-1107 (sim bot / future UI use, mirrors seafarers' own `movableShips`/`shipMoveTargets` pair,
 * modules/seafarers/ships.ts): every legal destination edge for relocating `seat`'s ship currently
 * on `from` — the same reachability search `moveEPShipHandler` itself uses, minus the actual
 * mutation. `[]` outside a live E&P game, outside the main phase, if `seat` has no ship on `from`,
 * or if that ship already built/moved this turn (EP3.2).
 */
export function epShipMoveTargets(state: GameState, seat: Seat, from: EdgeId): EdgeId[] {
  if (!isExplorersPiratesState(state) || state.phase.kind !== 'main') return [];
  const ext = epExt(state);
  if (!ext) return [];
  if (!shipsOfSeat(state, seat).some((s) => s.edge === from)) return [];
  if ((ext.shipsBuiltThisTurn ?? []).includes(from)) return [];
  if ((ext.movedShipsThisTurn ?? []).includes(from)) return [];
  const range = SHIP_MOVE_RANGE + spiceShipRangeBonus(state, seat);
  const reachable = seaEdgesWithinRange(state, from, range);
  const out: EdgeId[] = [];
  for (const [edge, dist] of reachable) {
    if (dist === 0) continue; // `from` itself
    if (isShipOnEdge(state, edge)) continue;
    out.push(edge);
  }
  return out;
}

/** T-1107: every one of `seat`'s ships that could legally move somewhere THIS turn (mirrors
 *  `epShipMoveTargets`'s own gating) — a thin convenience for the sim bot so it doesn't have to
 *  probe every ship with `epShipMoveTargets` just to find out which ones are movable at all. */
export function movableEPShips(state: GameState, seat: Seat): EdgeId[] {
  return shipsOfSeat(state, seat)
    .map((s) => s.edge)
    .filter((edge) => epShipMoveTargets(state, seat, edge).length > 0);
}

/** A ship's edge doubles as an adjacent-vertex anchor for cargo (EP3.3): true iff `edge` touches one
 *  of `seat`'s own settlements/cities (v1 harbor substitute — see this file's header). */
function shipTouchesOwnBuilding(state: GameState, seat: Seat, edge: EdgeId): boolean {
  const e = geometryForState(state).edges[edge];
  if (!e) return false;
  return [e.a, e.b].some((v) => ownBuildingOn(state, seat, v));
}

// ---- buildEPShip (EP3.1) --------------------------------------------------------------------------

export function buildEPShipHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'buildEPShip' }>
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'ships require a live Explorers & Pirates game (EP3.1)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'ships are built in the main phase (EP3.1)');

  const placement = epShipPlacementError(state, seat, action.edge);
  if (placement) return fail(placement.code, placement.message);

  if (shipsOfSeat(state, seat).length >= EP_MAX_SHIPS_PER_SEAT) {
    return fail('NO_PIECES_LEFT', `no more than ${EP_MAX_SHIPS_PER_SEAT} ships per seat (EP3.2, ⚠ VERIFY)`);
  }

  const player = state.players[seat];
  if (!player) throw new Error(`BUG: buildEPShip for unknown seat ${seat}`);
  if (!canAfford(player, EP_SHIP_COST)) {
    return fail('CANT_AFFORD', 'an E&P ship costs 1 wool + 1 lumber (EP3.1, ⚠ VERIFY)');
  }

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in buildEPShipHandler');
  const { players, bank } = payToBank(state, seat, EP_SHIP_COST);
  const ships = [...(ext.ships ?? []), { seat, edge: action.edge, cargo: [] as EPCargo[] }];
  const shipsBuiltThisTurn = [...(ext.shipsBuiltThisTurn ?? []), action.edge];
  const next = withEpExt({ ...state, players, bank }, { ...ext, ships, shipsBuiltThisTurn });
  return { ok: true, state: next, events: [epShipBuilt(seat, action.edge)] };
}

// ---- moveEPShip (EP3.2) ----------------------------------------------------------------------------

export function moveEPShipHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'moveEPShip' }>
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'ships require a live Explorers & Pirates game (EP3.2)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'ships move in the main phase (EP3.2)');

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in moveEPShipHandler');
  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex((s) => s.seat === seat && s.edge === action.from);
  if (shipIdx < 0) return fail('SHIP_NOT_FOUND', `seat ${seat} has no ship on edge ${action.from} (EP3.1/EP3.2)`);

  if ((ext.shipsBuiltThisTurn ?? []).includes(action.from)) {
    return fail(
      'SHIP_BUILT_THIS_TURN',
      `the ship on edge ${action.from} was built this turn and may not also move (EP3.2, ⚠ VERIFY)`
    );
  }
  if ((ext.movedShipsThisTurn ?? []).includes(action.from)) {
    return fail('SHIP_ALREADY_MOVED', `the ship on edge ${action.from} has already moved this turn (EP3.2)`);
  }
  if (action.to === action.from) return fail('BAD_LOCATION', 'moveEPShip must name a different edge (EP3.2)');

  // T-1106 (§EP9, ⚠ VERIFY the ladder): `spiceBenefit` extends the movement budget on top of the
  // fixed `SHIP_MOVE_RANGE` — see goldFishSpice.ts's header for the v1 model.
  const range = SHIP_MOVE_RANGE + spiceShipRangeBonus(state, seat);
  const reachable = seaEdgesWithinRange(state, action.from, range);
  const dist = reachable.get(action.to);
  if (dist === undefined) {
    return fail(
      'SHIP_MOVE_TOO_FAR',
      `edge ${action.to} is more than ${range} sea route(s) from ${action.from} (EP3.2)`
    );
  }
  if (isShipOnEdge(state, action.to)) {
    return fail('OCCUPIED', `edge ${action.to} already carries a ship (EP3.1)`);
  }

  const nextShips = ships.map((s, i) => (i === shipIdx ? { ...s, edge: action.to } : s));
  const movedShipsThisTurn = [...(ext.movedShipsThisTurn ?? []), action.to];
  const next = withEpExt(state, { ...ext, ships: nextShips, movedShipsThisTurn });

  // T-1103 (§EP5.1): arrival is the reveal trigger — fold it in here per the task's own preference
  // over a dedicated `explore` action (exploration.ts's own header explains the v1 adjacency model).
  const reveal = revealOnArrival(next, seat, action.to);
  // T-1106 (§EP8, ⚠ VERIFY): arrival at a fish shoal auto-hauls a cargo unit — same "side effect of a
  // legal move" fold-in as the reveal above (goldFishSpice.ts's header).
  const haul = haulFishOnArrival(reveal.state, seat, action.to, SHIP_CARGO_CAP);
  return {
    ok: true,
    state: haul.state,
    events: [epShipMoved(seat, action.from, action.to), ...reveal.events, ...haul.events],
  };
}

// ---- loadCargo / unloadCargo (EP3.3) ---------------------------------------------------------------

export function loadCargoHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'loadCargo' }>
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'cargo requires a live Explorers & Pirates game (EP3.3)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'cargo is loaded in the main phase (EP3.3)');

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in loadCargoHandler');
  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex((s) => s.seat === seat && s.edge === action.ship);
  if (shipIdx < 0) return fail('SHIP_NOT_FOUND', `seat ${seat} has no ship on edge ${action.ship} (EP3.1/EP3.3)`);

  if (!shipTouchesOwnBuilding(state, seat, action.ship)) {
    return fail(
      'NOT_CONNECTED',
      `the ship on edge ${action.ship} must be at your own coastal settlement/city to load (EP3.3, v1 harbor substitute — ⚠ VERIFY)`
    );
  }

  const ship = ships[shipIdx]!;
  if (ship.cargo.length >= SHIP_CARGO_CAP) {
    return fail('CARGO_FULL', `the ship on edge ${action.ship} already carries ${SHIP_CARGO_CAP} cargo piece(s) (EP3.3)`);
  }

  // T-1104 (§EP4.1, ⚠ VERIFY the reserve-pool model — settling.ts's header): loading a `'settler'`
  // draws one unit from the seat's un-loaded reserve (`buildEPSettler`'s own supply).
  let settlerSupply = ext.settlerSupply;
  if (action.piece === 'settler') {
    const reserve = settlerSupplyOf(state, seat);
    if (reserve <= 0) {
      return fail('NO_PIECES_LEFT', 'no settler in reserve to load — buildEPSettler first (EP4.1)');
    }
    settlerSupply = (ext.settlerSupply ?? state.players.map(() => 0)).map((n, i) => (i === seat ? n - 1 : n));
  }

  // T-1105 (§EP7.1, mirrors the settler reserve above): loading a `'crew'` draws one unit from the
  // seat's un-loaded reserve (`buildEPCrew`'s own supply, `modules/explorersPirates/pirateLairs.ts`).
  // Every other cargo kind (`'fish'`/`'spice'`) is untouched (T-1102's original, no-supply-check
  // bookkeeping — those missions are T-1106's scope).
  let crewSupply = ext.crewSupply;
  if (action.piece === 'crew') {
    const reserve = crewSupplyOf(state, seat);
    if (reserve <= 0) {
      return fail('NO_PIECES_LEFT', 'no crew in reserve to load — buildEPCrew first (EP7.1)');
    }
    crewSupply = (ext.crewSupply ?? state.players.map(() => 0)).map((n, i) => (i === seat ? n - 1 : n));
  }

  const nextShips = ships.map((s, i) => (i === shipIdx ? { ...s, cargo: [...s.cargo, action.piece] } : s));
  const next = withEpExt(state, {
    ...ext,
    ships: nextShips,
    ...(settlerSupply ? { settlerSupply } : {}),
    ...(crewSupply ? { crewSupply } : {}),
  });
  return { ok: true, state: next, events: [epCargoLoaded(seat, action.ship, action.piece)] };
}

export function unloadCargoHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'unloadCargo' }>
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'cargo requires a live Explorers & Pirates game (EP3.3)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'cargo is unloaded in the main phase (EP3.3)');

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in unloadCargoHandler');
  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex((s) => s.seat === seat && s.edge === action.ship);
  if (shipIdx < 0) return fail('SHIP_NOT_FOUND', `seat ${seat} has no ship on edge ${action.ship} (EP3.1/EP3.3)`);

  if (!shipTouchesOwnBuilding(state, seat, action.ship)) {
    return fail(
      'NOT_CONNECTED',
      `the ship on edge ${action.ship} must be at your own coastal settlement/city to unload (EP3.3, v1 harbor substitute — ⚠ VERIFY)`
    );
  }

  const ship = ships[shipIdx]!;
  const pieceIdx = ship.cargo.indexOf(action.piece);
  if (pieceIdx < 0) {
    return fail('CARGO_NOT_FOUND', `the ship on edge ${action.ship} does not carry ${action.piece} (EP3.3)`);
  }

  const nextCargo = [...ship.cargo];
  nextCargo.splice(pieceIdx, 1);
  const nextShips = ships.map((s, i) => (i === shipIdx ? { ...s, cargo: nextCargo } : s));
  // T-1104 (§EP4.1): unloading a `'settler'` is a change of mind, not founding — the unit returns to
  // the seat's reserve (`foundSettlement`, settling.ts, consumes cargo directly and does NOT go
  // through this handler, so it never double-returns a unit here).
  const settlerSupply =
    action.piece === 'settler'
      ? (ext.settlerSupply ?? state.players.map(() => 0)).map((n, i) => (i === seat ? n + 1 : n))
      : ext.settlerSupply;
  // T-1105 (§EP7.1, mirrors the settler return above): unloading a `'crew'` is a change of mind, not
  // landing on a lair — the unit returns to `crewSupply` (`placeCrewOnLairHandler`,
  // `modules/explorersPirates/pirateLairs.ts`, consumes cargo directly and does NOT go through this
  // handler, so it never double-returns a unit here).
  const crewSupply =
    action.piece === 'crew'
      ? (ext.crewSupply ?? state.players.map(() => 0)).map((n, i) => (i === seat ? n + 1 : n))
      : ext.crewSupply;
  const next = withEpExt(state, {
    ...ext,
    ships: nextShips,
    ...(settlerSupply ? { settlerSupply } : {}),
    ...(crewSupply ? { crewSupply } : {}),
  });
  return { ok: true, state: next, events: [epCargoUnloaded(seat, action.ship, action.piece)] };
}

// ---- Per-turn reset (EP3.2, module `phaseHooks.afterAction` on `endTurn`) --------------------------

/** Clears `shipsBuiltThisTurn`/`movedShipsThisTurn` on every `endTurn` in a live E&P game (mirrors
 *  T&B's own per-turn resets, e.g. `applyBarbarianAttackTurnReset`). `null` when there's nothing to
 *  reset (outside a live E&P game, or both lists are already empty). */
export function applyExplorersPiratesTurnReset(
  next: GameState
): { state: GameState } | null {
  const ext = epExt(next);
  if (!ext) return null;
  if ((ext.shipsBuiltThisTurn ?? []).length === 0 && (ext.movedShipsThisTurn ?? []).length === 0) return null;
  return { state: withEpExt(next, { ...ext, shipsBuiltThisTurn: [], movedShipsThisTurn: [] }) };
}
