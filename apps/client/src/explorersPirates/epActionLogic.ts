// Explorers & Pirates — Land Ho! action-control logic (T-1108): pure enablement/reason helpers +
// legal-target composers for the scenario's actions, mirroring `tradersBarbarians/tbActionLogic.ts`'s
// split exactly — a presentational component only ever calls into this module, never re-derives
// legality itself. Every helper treats `view` as a full `GameState` for legal-target enumeration (the
// same documented WIRE workaround `tbActionLogic.ts`/`ckActionLogic.ts` use: legal-move enumeration is
// about the ACTING seat's own choices, which redaction never hides from that seat) — safe here too,
// since every `ext.explorersPirates` field is fully public (redact.ts) except the exploration supply,
// which none of these helpers ever touch.
//
// `legalBuildEPShipEdges`/`legalFoundSettlementVertices` compose EXISTING exported engine predicates
// (`epShipPlacementError`, `satisfiesDistanceRule`, `vertexTouchesDiscoveredLand`) rather than
// re-deriving the rule client-side — exactly the same "legal-target enumerator built from the
// handler's own checks" discipline `legal.ts`'s enumerators use internally, just composed here
// because T-1108 is client-only (no engine changes) and no such combined enumerator existed yet.
//
// T-1160 (FOLLOWUP from T-1150): both composers used to iterate the base 19-hex `GEOMETRY` directly,
// so a 5-6 Land Ho! game (37-hex `LAND_HO_56_GEOMETRY`) computed move/found candidates against the
// wrong board. Fixed to resolve `boardGeometryFor(view.config)` — the same client-side resolver
// `board/geometry.ts`'s renderer and `routes/Game.tsx` already use, which T-1150 gave an E&P branch.
import {
  EP_CREW_COST,
  EP_HARBOR_COST,
  EP_MAX_SHIPS_PER_SEAT,
  EP_SETTLER_COST,
  EP_SHIP_COST,
  GOLD_PER_VP,
  SPICE_TRADE_COST_GOLD,
  epShipPlacementError,
  movableEPShips,
  satisfiesDistanceRule,
  vertexTouchesDiscoveredLand,
} from '@hexhaven/engine';
import type { GameState, PlayerView } from '@hexhaven/engine';
import type { EdgeId, HexId, ResourceBundle, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { boardGeometryFor } from '../board/geometry';
import {
  epOf,
  ownCrewSupplyOf,
  ownEpShipsOf,
  ownGoldOf,
  ownHarborSettlementsOf,
  ownSettlerSupplyOf,
  shipTouchesOwnBuilding,
} from './epHelpers';

export type EpControlReason =
  | 'notYourTurn'
  | 'notMainPhase'
  | 'cantAfford'
  | 'noLegalTargets'
  | 'maxShips'
  | 'noOwnSettlements'
  | 'noReserve'
  | 'noShipHere'
  // T-1154 (§EP7.1): `buildEPCrew` needs one of the seat's own harbor settlements as its build anchor
  // (mirrors `buildEPCrewHandler`'s own `NOT_CONNECTED` check, pirateLairs.ts) — distinct from
  // `noOwnSettlements` above (that one is about the harbor-settlement UPGRADE having no settlement to
  // upgrade at all; this one is about crews needing an ALREADY-upgraded harbor settlement).
  | 'noHarborSettlement';

export interface EpControlState {
  enabled: boolean;
  reason?: EpControlReason;
  /** Only set alongside `reason: 'cantAfford'` — mirrors `TbControlState`'s own field exactly. */
  missing?: { unit: string; need: number; have: number };
}

const ENABLED: EpControlState = { enabled: true };

function turnGate(state: GameState, seat: Seat): EpControlState | null {
  if (state.turn.player !== seat) return { enabled: false, reason: 'notYourTurn' };
  if (state.phase.kind !== 'main') return { enabled: false, reason: 'notMainPhase' };
  return null;
}

function affordGate(state: GameState, seat: Seat, cost: ResourceBundle): EpControlState | null {
  const player = state.players[seat];
  for (const [res, need] of Object.entries(cost) as [ResourceType, number][]) {
    const have = player?.resources[res] ?? 0;
    if (have < need) return { enabled: false, reason: 'cantAfford', missing: { unit: res, need, have } };
  }
  return null;
}

// ---- Ships (§EP3) --------------------------------------------------------------------------------

/** Every sea edge `seat` may legally build a NEW ship on right now (EP3.1) — every candidate edge is
 *  checked with `epShipPlacementError`, the exact predicate `buildEPShipHandler` itself uses, plus the
 *  per-seat ship cap the handler also enforces. */
export function legalBuildEPShipEdges(view: PlayerView, seat: Seat): EdgeId[] {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main') return [];
  if (ownEpShipsOf(view, seat).length >= EP_MAX_SHIPS_PER_SEAT) return [];
  const geometry = boardGeometryFor(view.config);
  return geometry.edges.filter((e) => epShipPlacementError(state, seat, e.id) === null).map((e) => e.id);
}

export function computeBuildEPShipState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (ownEpShipsOf(view, seat).length >= EP_MAX_SHIPS_PER_SEAT) {
    return { enabled: false, reason: 'maxShips' };
  }
  // Legal-target gate BEFORE affordability (mirrors `computeBuildBridgeState`'s own ordering,
  // tbActionLogic.ts): a fresh game has neither a coastal ship anchor nor any resources, and
  // "nowhere to put it" is the more informative reason than "can't afford it" in that case.
  if (legalBuildEPShipEdges(view, seat).length === 0) return { enabled: false, reason: 'noLegalTargets' };
  return affordGate(state, seat, EP_SHIP_COST) ?? ENABLED;
}

/** `moveEPShip` button: turn/phase gate, then the seat must own at least one ship that can still move
 *  somewhere this turn (mirrors `movableEPShips`, the exact enumerator the sim bot also uses). */
export function computeMoveEPShipState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return movableEPShips(state, seat).length === 0 ? { enabled: false, reason: 'noLegalTargets' } : ENABLED;
}

// `store/uiMode.ts`'s board-pick modes call the engine's own `epShipMoveTargets`/`movableEPShips`
// directly (both already GameState-based, like `shipMoveTargets`/`movableShips` for Seafarers) — no
// wrapper needed here, unlike the vertex/edge composers above (which have no engine-side equivalent
// yet, T-1108 being client-only).

// ---- Settlers & founding (§EP4) -------------------------------------------------------------------

export function computeBuildEPSettlerState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return affordGate(state, seat, EP_SETTLER_COST) ?? ENABLED;
}

/** Every coast vertex `seat` may found a settlement on right now (EP4.1): empty + distance-legal +
 *  touching discovered land + adjacent to one of the seat's own ships currently carrying a `'settler'`
 *  cargo unit — mirrors `foundSettlementHandler`'s own checks (settling.ts) exactly. */
export function legalFoundSettlementVertices(view: PlayerView, seat: Seat): VertexId[] {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main') return [];
  const settlerShipEdges = new Set(
    ownEpShipsOf(view, seat)
      .filter((s) => s.cargo.includes('settler'))
      .map((s) => s.edge),
  );
  if (settlerShipEdges.size === 0) return [];
  const geometry = boardGeometryFor(view.config);
  return geometry.vertices
    .filter(
      (v) =>
        satisfiesDistanceRule(state, v.id) &&
        vertexTouchesDiscoveredLand(state, v.id) &&
        v.edges.some((e) => settlerShipEdges.has(e)),
    )
    .map((v) => v.id);
}

export function computeFoundSettlementState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return legalFoundSettlementVertices(view, seat).length === 0
    ? { enabled: false, reason: 'noLegalTargets' }
    : ENABLED;
}

/** Own settlements eligible for the harbor-settlement upgrade (EP4.2) — every one of the seat's own
 *  settlements, no further legality beyond affordability (mirrors `legalCityVertices`'s own "just the
 *  seat's own settlements" shape for the base city upgrade). */
export function legalUpgradeToHarborVertices(view: PlayerView, seat: Seat): VertexId[] {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main') return [];
  const player = view.players.find((p) => p.seat === seat);
  return player ? [...player.settlements] : [];
}

export function computeUpgradeToHarborState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (legalUpgradeToHarborVertices(view, seat).length === 0) {
    return { enabled: false, reason: 'noOwnSettlements' };
  }
  return affordGate(state, seat, EP_HARBOR_COST) ?? ENABLED;
}

// ---- Cargo (§EP3.3, Land Ho! only ever moves the 'settler' piece) --------------------------------

/** Own ships that can accept a settler right now (cargo bay has room AND the ship sits at the seat's
 *  own coastal building — the v1 harbor-substitute anchor `loadCargoHandler` itself checks). */
export function loadSettlerShipTargets(view: PlayerView, seat: Seat): EdgeId[] {
  return ownEpShipsOf(view, seat)
    .filter((s) => s.cargo.length < 2 && shipTouchesOwnBuilding(view, seat, s.edge))
    .map((s) => s.edge);
}

/** Own ships currently carrying a settler that can be unloaded back to reserve right now (same
 *  coastal-building anchor as loading). */
export function unloadSettlerShipTargets(view: PlayerView, seat: Seat): EdgeId[] {
  return ownEpShipsOf(view, seat)
    .filter((s) => s.cargo.includes('settler') && shipTouchesOwnBuilding(view, seat, s.edge))
    .map((s) => s.edge);
}

export function computeLoadSettlerState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (ownSettlerSupplyOf(view, seat) <= 0) return { enabled: false, reason: 'noReserve' };
  return loadSettlerShipTargets(view, seat).length === 0 ? { enabled: false, reason: 'noShipHere' } : ENABLED;
}

export function computeUnloadSettlerState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return unloadSettlerShipTargets(view, seat).length === 0 ? { enabled: false, reason: 'noShipHere' } : ENABLED;
}

// ---- Crews & Pirate Lairs (§EP7, T-1154) ------------------------------------------------------------

/** `buildEPCrew` (EP7.1): turn/phase gate, then the seat needs at least one of its own harbor
 *  settlements as a build anchor (mirrors `buildEPCrewHandler`'s own `NOT_CONNECTED` check exactly),
 *  then affordability. */
export function computeBuildEPCrewState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (ownHarborSettlementsOf(view, seat).length === 0) {
    return { enabled: false, reason: 'noHarborSettlement' };
  }
  return affordGate(state, seat, EP_CREW_COST) ?? ENABLED;
}

/** Own ships that can accept a crew right now (mirrors `loadSettlerShipTargets` exactly — cargo bay
 *  has room AND the ship sits at the seat's own coastal building, the same v1 harbor-substitute anchor
 *  `loadCargoHandler` itself checks for every cargo kind). */
export function loadCrewShipTargets(view: PlayerView, seat: Seat): EdgeId[] {
  return ownEpShipsOf(view, seat)
    .filter((s) => s.cargo.length < 2 && shipTouchesOwnBuilding(view, seat, s.edge))
    .map((s) => s.edge);
}

/** `loadCargo{piece:'crew'}`: turn/phase gate, then a built-but-unloaded crew in reserve (mirrors
 *  `computeLoadSettlerState`'s own reserve gate exactly), then a ship to load it onto. */
export function computeLoadCrewState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  if (ownCrewSupplyOf(view, seat) <= 0) return { enabled: false, reason: 'noReserve' };
  return loadCrewShipTargets(view, seat).length === 0 ? { enabled: false, reason: 'noShipHere' } : ENABLED;
}

/** Every active (uncaptured) pirate lair `seat` may legally land a crew on right now (EP7.2): one of
 *  the seat's own ships must be carrying a `'crew'` cargo unit AND adjacent (its edge borders the
 *  lair's hex) — mirrors `placeCrewOnLairHandler`'s own `CREW_NOT_FOUND` check (pirateLairs.ts)
 *  exactly. Returns each candidate lair's current crew count too (for the picker label — how close it
 *  is to `LAIR_CAPTURE_CREWS`). */
export function legalPlaceCrewOnLairTargets(
  view: PlayerView,
  seat: Seat
): { hex: HexId; crews: number }[] {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main') return [];
  const lairs = epOf(view)?.pirateLairs ?? [];
  if (lairs.length === 0) return [];
  const crewShipEdges = ownEpShipsOf(view, seat)
    .filter((s) => s.cargo.includes('crew'))
    .map((s) => s.edge);
  if (crewShipEdges.length === 0) return [];
  const geometry = boardGeometryFor(view.config);
  return lairs
    .filter((l) => crewShipEdges.some((e) => geometry.edges[e]?.hexes.includes(l.hex)))
    .map((l) => ({ hex: l.hex, crews: l.crews.length }));
}

export function computePlaceCrewOnLairState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return legalPlaceCrewOnLairTargets(view, seat).length === 0
    ? { enabled: false, reason: 'noLegalTargets' }
    : ENABLED;
}

// ---- Fish for Hexhaven / Spices for Hexhaven (§EP8/§EP9, T-1154) -------------------------------------------

/** Is one of `seat`'s own ships carrying `cargo` adjacent to the home-island council vertex (the fixed
 *  `deliverFish`/`deliverSpice` delivery point)? Mirrors `deliverFishHandler`/`deliverSpiceHandler`'s
 *  own adjacency check (goldFishSpice.ts) exactly. `false` before `councilVertex` is seeded (Land Ho!
 *  and any pre-mission-seed state) or off-board. */
function hasDeliverableCargoAtCouncil(view: PlayerView, seat: Seat, cargo: 'fish' | 'spice'): boolean {
  const council = epOf(view)?.councilVertex;
  if (council === undefined) return false;
  const geometry = boardGeometryFor(view.config);
  const vert = geometry.vertices[council];
  if (!vert) return false;
  return ownEpShipsOf(view, seat).some((s) => s.cargo.includes(cargo) && vert.edges.includes(s.edge));
}

/** `deliverFish` (EP8): turn/phase gate, then a ship carrying fish adjacent to the council. No target
 *  parameter — the delivery point is fixed board state (mirrors `deliverFishHandler`'s "no payload"
 *  shape). */
export function computeDeliverFishState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return hasDeliverableCargoAtCouncil(view, seat, 'fish') ? ENABLED : { enabled: false, reason: 'noLegalTargets' };
}

/** `deliverSpice` (EP9): mirrors `computeDeliverFishState` exactly, for the spice cargo/mission. */
export function computeDeliverSpiceState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  return hasDeliverableCargoAtCouncil(view, seat, 'spice') ? ENABLED : { enabled: false, reason: 'noLegalTargets' };
}

/** Every active village hex `seat` may legally `tradeSpice` at right now (EP9): the village must still
 *  be active, `seat` must have enough gold for the trade, and one of the seat's own ships (with cargo
 *  bay room) must be adjacent — mirrors `tradeSpiceHandler`'s own checks (goldFishSpice.ts) exactly. */
export function legalTradeSpiceHexes(view: PlayerView, seat: Seat): HexId[] {
  const state = view as unknown as GameState;
  if (state.phase.kind !== 'main') return [];
  const villages = epOf(view)?.villages ?? [];
  if (villages.length === 0) return [];
  if (ownGoldOf(view, seat) < SPICE_TRADE_COST_GOLD) return [];
  const geometry = boardGeometryFor(view.config);
  const ownShips = ownEpShipsOf(view, seat).filter((s) => s.cargo.length < 2);
  if (ownShips.length === 0) return [];
  return villages.filter((hex) => ownShips.some((s) => geometry.edges[s.edge]?.hexes.includes(hex)));
}

export function computeTradeSpiceState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  const gold = ownGoldOf(view, seat);
  if (gold < SPICE_TRADE_COST_GOLD) {
    return { enabled: false, reason: 'cantAfford', missing: { unit: 'gold', need: SPICE_TRADE_COST_GOLD, have: gold } };
  }
  return legalTradeSpiceHexes(view, seat).length === 0 ? { enabled: false, reason: 'noLegalTargets' } : ENABLED;
}

// ---- Gold (§EP6.2, T-1154) --------------------------------------------------------------------------

/** `shipGold` (EP6.2): turn/phase gate, then `GOLD_PER_VP` gold on hand — mirrors `shipGoldHandler`'s
 *  own `NOT_ENOUGH_GOLD` check (goldFishSpice.ts) exactly. No target parameter (a flat fee-for-effect
 *  action, no ship/board anchor — that file's own header explains why). */
export function computeShipGoldState(view: PlayerView, seat: Seat): EpControlState {
  const state = view as unknown as GameState;
  const gate = turnGate(state, seat);
  if (gate) return gate;
  const gold = ownGoldOf(view, seat);
  if (gold < GOLD_PER_VP) {
    return { enabled: false, reason: 'cantAfford', missing: { unit: 'gold', need: GOLD_PER_VP, have: gold } };
  }
  return ENABLED;
}
