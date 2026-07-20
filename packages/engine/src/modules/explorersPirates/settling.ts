// Explorers & Pirates — settlers, founding & harbor settlements (T-1104, docs/rules/
// explorers-pirates-rules.md §EP4/§EP12). Builds on T-1102's ship/cargo engine (ships.ts) and
// T-1103's exploration/fog reveal (exploration.ts): a seat builds a settler (a reserve piece, not
// yet on the board), loads it onto a ship (ships.ts's `loadCargoHandler`, extended by this task to
// draw from `settlerSupply`), sails to a discovered coast and FOUNDS a settlement there
// (`foundSettlementHandler` below — the settler unloads itself in the same action; it does NOT go
// through `unloadCargoHandler`). A settlement may later be upgraded to a HARBOR SETTLEMENT — E&P's
// city-analogue (EP4.2): 2 VP, and the anchor ships/crews build at (`ships.ts`'s `ownBuildingOn`
// already checks `ext.explorersPirates.harborSettlements` — see that file's own T-1104 update).
//
// v1 model (provisional — every constant a ⚠ VERIFY placeholder, same discipline as ships.ts/
// exploration.ts's own headers):
//  - `EP_SETTLER_COST` (1 grain + 1 wool) / `EP_HARBOR_COST` (2 ore + 1 grain, the base-city-cost
//    analogue) are this task's own decided-v1 numbers (docs' "named constants + ⚠ VERIFY").
//  - **Settler supply model** (⚠ VERIFY, the task's own open question): `buildEPSettler` only pays
//    the cost and increments `settlerSupply[seat]` — a settler sits in reserve, off the board, until
//    `loadCargo{piece:'settler'}` (ships.ts) draws one unit from that reserve onto a ship's cargo
//    bay (reusing `NO_PIECES_LEFT` when the reserve is empty — same meaning as everywhere else in
//    this codebase: no more of this piece available). `unloadCargo{piece:'settler'}` (a change of
//    mind, NOT founding) returns the unit to the reserve. `foundSettlement` consumes the ship's
//    cargo unit directly (it is its own "unload") — it never returns a unit to `settlerSupply` (the
//    settler piece has become a real settlement instead). The alternative reading — folding
//    build+load into a single action so `settlerSupply` never actually holds anything mid-turn — was
//    rejected here only because the data model (docs/tasks' own decided v1) asks for a persisted
//    per-seat reserve count, which only means something under the "build now, load later" model.
//  - **Founding needs no road/land connection** (⚠ VERIFY, no explicit rulebook citation found): only
//    a ship carrying a `'settler'` cargo unit incident to the target vertex is required — mirrors
//    ships.ts's own "reached by ship" v1 substitute for a harbor-settlement anchor. If more than one
//    of the seat's ships qualifies, the first one found (array order) is used — deterministic, never
//    ambiguous to the caller since which settler is "spent" has no further game consequence.
//  - **"Discovered land"** (EP4.1): a vertex counts if it touches at least one hex whose
//    `epTerrainOf` is a REAL terrain — i.e. not `'sea'` (fog OR open water) and not `'gold'`. Unlike
//    Seafarers' `vertexTouchesLand` (which treats a gold hex as land, since Seafarers renders a real
//    hex there), this task's v1 `'gold'` reveal (exploration.ts) never writes a real `board.hexes`
//    entry — it stays the sea PROXY — so there is nothing to found a settlement ON there; ⚠ VERIFY
//    against the physical Land Ho! rules once T-1107 authors the real scenario frame.
//  - **The normal distance rule + occupancy check apply** (`rules/placement.ts`'s
//    `isVertexOccupied`/`satisfiesDistanceRule`, unchanged, reused directly — the same predicates
//    normal `buildSettlement` uses) — a founded settlement is a REAL settlement in every other
//    respect (counts toward `piecesLeft.settlements`, VP, `updateAwards`'s longest-road recompute in
//    case it breaks someone's route, R7.3).
//  - **Harbor-settlement upgrade mirrors `buildCity`** (EP4.2): the seat's own settlement at
//    `vertex` (checked the same way `buildCity` checks `player.settlements.includes(vertex)`) is
//    removed from `settlements` (its piece RETURNS to `piecesLeft.settlements`, R7.5's own rule,
//    unchanged) and the vertex is recorded in `ext.explorersPirates.harborSettlements[seat]` — there
//    is no separate harbor-settlement piece SUPPLY cap in this v1 model (⚠ VERIFY), mirroring
//    ships.ts's own "no separate supply field, just track placed pieces" choice for ships.

import type { Action, EdgeId, EngineErrorCode, GameState, ResourceBundle, Seat, VertexId } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { epHarborSettlementBuilt, epSettlementFounded, epSettlerBuilt } from '../../events.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { updateAwards } from '../../rules/awards.js';
import { isVertexOccupied, satisfiesDistanceRule } from '../../rules/placement.js';
import { geometryForState } from '../index.js';
import { epExt, epTerrainOf, isExplorersPiratesState, withEpExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed constants (EP4, ⚠ VERIFY every number against the physical rulebook) ------------------

/** EP4.1 ⚠ VERIFY: a settler costs 1 grain + 1 wool (paid to the bank). */
export const EP_SETTLER_COST: ResourceBundle = { grain: 1, wool: 1 };

/** EP4.2 ⚠ VERIFY (the base city-cost analogue): a harbor settlement upgrade costs 2 ore + 1 grain. */
export const EP_HARBOR_COST: ResourceBundle = { ore: 2, grain: 1 };

/** EP4.2: a harbor settlement is worth this many VP (`vp.ts`'s `computeVp`, E&P-gated). */
export const EP_HARBOR_SETTLEMENT_VP = 2;

// ---- Board predicate (EP4.1) ----------------------------------------------------------------------

/** True iff vertex `v` touches at least one hex whose authoritative E&P terrain is discovered, real
 *  land — see this file's header for why `'gold'` does NOT count here (unlike Seafarers' own
 *  `vertexTouchesLand`). False for an off-board vertex or outside a live E&P game. */
export function vertexTouchesDiscoveredLand(state: GameState, v: VertexId): boolean {
  const vert = geometryForState(state).vertices[v];
  if (!vert) return false;
  return vert.hexes.some((h) => {
    const t = epTerrainOf(state, h);
    return t !== undefined && t !== 'sea' && t !== 'gold';
  });
}

/** T-1107 (§EP4.3 "settlement/road building otherwise follows base rules on discovered land"): the
 *  edge-based analogue of `vertexTouchesDiscoveredLand` — true iff either endpoint touches
 *  discovered land. Consumed by `legal.ts`'s setup/main-phase road enumerators (mirrors the
 *  seafarers `edgeBordersLand` gate already there) so the sim bot/client never offer a road on the
 *  still-fogged ring before it's explored. False for an off-board edge or outside a live E&P game. */
export function edgeTouchesDiscoveredLand(state: GameState, edge: EdgeId): boolean {
  const e = geometryForState(state).edges[edge];
  if (!e) return false;
  return vertexTouchesDiscoveredLand(state, e.a) || vertexTouchesDiscoveredLand(state, e.b);
}

// ---- buildEPSettler (EP4.1) -------------------------------------------------------------------------

// No `action` parameter: `buildEPSettler`'s only field is its discriminant `type`, nothing to read
// (same "no payload, no third param" precedent as the base game's `buyDevCard`, phases/devCards.ts).
export function buildEPSettlerHandler(state: GameState, seat: Seat): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'settlers require a live Explorers & Pirates game (EP4.1)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'settlers are built in the main phase (EP4.1)');

  const player = state.players[seat];
  if (!player) throw new Error(`BUG: buildEPSettler for unknown seat ${seat}`);
  if (!canAfford(player, EP_SETTLER_COST)) {
    return fail('CANT_AFFORD', 'an E&P settler costs 1 grain + 1 wool (EP4.1, ⚠ VERIFY)');
  }

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in buildEPSettlerHandler');
  const { players, bank } = payToBank(state, seat, EP_SETTLER_COST);
  const settlerSupply = (ext.settlerSupply ?? state.players.map(() => 0)).map((n, i) =>
    i === seat ? n + 1 : n
  );
  const next = withEpExt({ ...state, players, bank }, { ...ext, settlerSupply });
  return { ok: true, state: next, events: [epSettlerBuilt(seat)] };
}

// ---- foundSettlement (EP4.1) ------------------------------------------------------------------------

export function foundSettlementHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'foundSettlement' }>
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'founding requires a live Explorers & Pirates game (EP4.1)');
  }
  if (state.phase.kind !== 'main') return fail('WRONG_PHASE', 'settlements are founded in the main phase (EP4.1)');

  const { vertex } = action;
  const vert = geometryForState(state).vertices[vertex];
  if (!vert) return fail('BAD_LOCATION', `vertex ${vertex} is off the board`);
  if (isVertexOccupied(state, vertex)) return fail('OCCUPIED', `vertex ${vertex} already has a building`);
  if (!satisfiesDistanceRule(state, vertex)) {
    return fail('DISTANCE_RULE', `vertex ${vertex} is adjacent to a building (R7.3)`);
  }
  if (!vertexTouchesDiscoveredLand(state, vertex)) {
    return fail('NOT_DISCOVERED_LAND', `vertex ${vertex} does not touch discovered land (EP4.1)`);
  }

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in foundSettlementHandler');
  const ships = ext.ships ?? [];
  const shipIdx = ships.findIndex(
    (s) => s.seat === seat && s.cargo.includes('settler') && vert.edges.includes(s.edge)
  );
  if (shipIdx < 0) {
    return fail('SETTLER_NOT_FOUND', `no ship carrying a settler is adjacent to vertex ${vertex} (EP4.1)`);
  }

  const player = state.players[seat];
  if (!player) throw new Error(`BUG: foundSettlement for unknown seat ${seat}`);
  if (player.piecesLeft.settlements <= 0) return fail('NO_PIECES_LEFT', 'no settlement pieces left');

  const ship = ships[shipIdx]!;
  const cargoIdx = ship.cargo.indexOf('settler');
  const nextCargo = [...ship.cargo];
  nextCargo.splice(cargoIdx, 1);
  const nextShips = ships.map((s, i) => (i === shipIdx ? { ...s, cargo: nextCargo } : s));

  const players = state.players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          settlements: [...p.settlements, vertex],
          piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements - 1 },
        }
      : p
  );

  const placed = withEpExt({ ...state, players }, { ...ext, ships: nextShips });
  const awarded = updateAwards(placed);
  return {
    ok: true,
    state: awarded.state,
    events: [epSettlementFounded(seat, vertex), ...awarded.events],
  };
}

// ---- upgradeToHarbor (EP4.2) -------------------------------------------------------------------------

export function upgradeToHarborHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'upgradeToHarbor' }>
): EngineResult {
  if (!isExplorersPiratesState(state)) {
    return fail('EXPANSION_NOT_AVAILABLE', 'harbor settlements require a live Explorers & Pirates game (EP4.2)');
  }
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'harbor settlements are built in the main phase (EP4.2)');
  }

  const { vertex } = action;
  const player = state.players[seat];
  if (!player) throw new Error(`BUG: upgradeToHarbor for unknown seat ${seat}`);
  if (!player.settlements.includes(vertex)) {
    return fail('BAD_LOCATION', 'a harbor settlement must replace one of your own settlements (EP4.2)');
  }
  if (!canAfford(player, EP_HARBOR_COST)) {
    return fail('CANT_AFFORD', 'a harbor settlement costs 2 ore + 1 grain (EP4.2, ⚠ VERIFY)');
  }

  const ext = epExt(state);
  if (!ext) throw new Error('BUG: explorersPirates ext missing in upgradeToHarborHandler');
  const { players, bank } = payToBank(state, seat, EP_HARBOR_COST);
  const upgraded = players.map((p) =>
    p.seat === seat
      ? {
          ...p,
          // R7.5-style: the replaced settlement's piece returns to supply.
          settlements: p.settlements.filter((s) => s !== vertex),
          piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements + 1 },
        }
      : p
  );
  const harborSettlements = (ext.harborSettlements ?? state.players.map(() => [] as VertexId[])).map(
    (list, i) => (i === seat ? [...list, vertex] : list)
  );
  const next = withEpExt({ ...state, players: upgraded, bank }, { ...ext, harborSettlements });
  return { ok: true, state: next, events: [epHarborSettlementBuilt(seat, vertex)] };
}

// ---- VP (EP4.2, consumed by vp.ts's computeVp) -----------------------------------------------------

/** `seat`'s harbor-settlement VP (2 each) — 0 outside a live E&P game. */
export function harborSettlementVpFor(state: GameState, seat: Seat): number {
  return (epExt(state)?.harborSettlements?.[seat]?.length ?? 0) * EP_HARBOR_SETTLEMENT_VP;
}
