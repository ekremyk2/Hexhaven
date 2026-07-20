// Legal-move summaries (docs/02 §4). Pure functions over GameState that enumerate the currently
// legal targets for a phase — used by tests and, later, by the client to highlight moves.
// Grows one section per engine task (T-103 setup; T-104+ add their own).

import { hasAtLeast } from '@hexhaven/shared';
import type {
  GameState,
  HexPieceKindId,
  ResourceBundle,
  ResourceType,
  Seat,
  VertexId,
  EdgeId,
  HexId,
} from '@hexhaven/shared';
import { costsForState, geometryForState } from './modules/index.js';
import { hexPiecesExt } from './modules/modifiers/hexPieces/index.js';
import { citiesKnightsExt } from './modules/citiesKnights/state.js';
import {
  canPlayRoadBuildingSeafarers,
  edgeBordersLand,
  hexTerrainOf,
  isSeafarersState,
  pirateOf,
  pirateStealCandidates,
  vertexTouchesLand,
} from './modules/seafarers/index.js';
// Explorers & Pirates (T-1107, §EP4.3): setup + normal main-phase building are kept to discovered
// land here (setup below, `legalRoadEdges`/`legalSettlementVertices` further down) — critical for
// setup specifically (a starting settlement stranded on the still-fogged ring never produces, since
// fog hexes stay the sea proxy/`token: null` until a ship reveals them, dooming that seat's economy
// for the whole game). Deliberately NOT applied to `canPlaceRoadHere` (shared with
// `legalFreeRoadEdges`, the Road Building card's sub-phase): `playRoadBuilding`'s own entry check
// (phases/devCards.ts) uses raw, unrestricted `canPlaceRoad` to decide whether the card can be
// played at all, so restricting ONLY the enumerator there could open the `roadBuilding` sub-phase
// (committed, no way back except placing) while leaving the sim bot with zero legal candidates to
// satisfy it — caught by the sim itself. Base `buildRoad`/`buildSettlement`/`playRoadBuilding`
// (phases/main.ts, phases/devCards.ts) never gained an E&P-aware gate either (only `foundSettlement`,
// settling.ts's own action, checks `vertexTouchesDiscoveredLand`) — exactly mirroring how Seafarers'
// "no road on a pure sea route" (S3.2) is ALSO only an advisory, enumerator-only restriction, not
// handler-enforced. ⚠ VERIFY against the physical rulebook later.
import {
  edgeTouchesDiscoveredLand,
  isExplorersPiratesState,
  vertexTouchesDiscoveredLand,
} from './modules/explorersPirates/index.js';
import { isVertexOccupied, satisfiesDistanceRule, isEdgeOccupied } from './rules/placement.js';
import { canPlaceRoad, ownRoadOrShipAt } from './rules/connectivity.js';
import { canAfford } from './rules/afford.js';
import { tradeRate } from './rules/harbors.js';
import { stealCandidatesForHex } from './phases/robber.js';
import { commonPlayBlockReason } from './phases/devCards.js';
import { computeVp } from './vp.js';

/** Setup: every vertex satisfying the distance rule (no road requirement — R3.2). In a seafarers
 *  game a starting settlement must touch land (S4.3 — no open-ocean placement). */
export function legalSetupSettlements(state: GameState): VertexId[] {
  if (state.phase.kind !== 'setup' || state.phase.expect !== 'settlement') return [];
  const geometry = geometryForState(state);
  const seafarers = isSeafarersState(state);
  // T-1107 (§EP2.3): starting settlements go on the home island only — see this file's E&P import
  // comment for why this is enforced here (unlike the main-phase road/settlement gates below, this
  // one is safe: `beginPlay`-style entry checks aren't involved, so there's no "phase already
  // committed with zero candidates" risk). `false` outside a live E&P game (RK-13-safe).
  const explorersPirates = isExplorersPiratesState(state);
  return geometry.vertices
    .filter(
      (v) =>
        satisfiesDistanceRule(state, v.id) &&
        (!seafarers || vertexTouchesLand(state, geometry, v.id)) &&
        (!explorersPirates || vertexTouchesDiscoveredLand(state, v.id))
    )
    .map((v) => v.id);
}

/** Setup: empty edges incident to the settlement just placed (R3.3). In a seafarers game a setup
 *  road may only go on a land-bordering edge (a pure sea route would need a ship, S3.2 — setup ships
 *  are out of scope for T-702). Same discovered-land gate in an E&P game (T-1107, mirrors
 *  `legalSetupSettlements` above — safe for the same "no phase-commit risk" reason). */
export function legalSetupRoads(state: GameState): EdgeId[] {
  if (state.phase.kind !== 'setup' || state.phase.expect !== 'road') return [];
  const last = state.phase.lastSettlement;
  if (last == null) return [];
  const geometry = geometryForState(state);
  const vert = geometry.vertices[last];
  if (!vert) return [];
  const seafarers = isSeafarersState(state);
  const explorersPirates = isExplorersPiratesState(state);
  return vert.edges.filter(
    (e) =>
      !isEdgeOccupied(state, e) &&
      (!seafarers || edgeBordersLand(state, geometry, e)) &&
      (!explorersPirates || edgeTouchesDiscoveredLand(state, e))
  );
}

/** preRoll: the mandatory roll is legal for the turn owner until it has happened (R4/ER-7). */
export function canRollDice(state: GameState): boolean {
  return state.phase.kind === 'preRoll' && !state.turn.rolled;
}

/** True iff a road may legally sit on `edge` for `seat` — `canPlaceRoad` (rivers-aware: a river
 *  edge is already excluded there, §TB3.2, T-1003) plus, in a seafarers game, the requirement that
 *  the edge borders land (a pure sea route is ship-only, S3.2). */
function canPlaceRoadHere(state: GameState, seat: Seat, edge: EdgeId): boolean {
  if (!canPlaceRoad(state, seat, edge)) return false;
  if (!isSeafarersState(state)) return true;
  return edgeBordersLand(state, geometryForState(state), edge);
}

/** Main phase: empty edges connected to the seat's network (R7.2); land-bordering in seafarers.
 *  Empty when the seat has no road pieces left — the UI highlights these, so an unguarded list would
 *  offer a road the engine rejects `NO_PIECES_LEFT` (common in seafarers, where roads+ships drain the
 *  15-road supply — playtest bug). Mirrors `buildAffordability`. */
export function legalRoadEdges(state: GameState, seat: Seat): EdgeId[] {
  if (state.phase.kind !== 'main') return [];
  if ((state.players[seat]?.piecesLeft.roads ?? 0) <= 0) return [];
  const explorersPirates = isExplorersPiratesState(state);
  return geometryForState(state)
    .edges.filter(
      (e) =>
        canPlaceRoadHere(state, seat, e.id) &&
        // T-1107 (§EP4.3): a NORMAL road build (not the Road Building card's committed sub-phase,
        // see this file's E&P import comment) is safe to gate on discovered land — the bot/client
        // simply won't propose one, no phase is ever left stranded.
        (!explorersPirates || edgeTouchesDiscoveredLand(state, e.id))
    )
    .map((e) => e.id);
}

/** Road Building sub-phase (R9.6/ER-5): the free-road placements. Same occupancy + connectivity
 * gate as a normal road (`canPlaceRoad`), but valid while the `roadBuilding` sub-phase is active —
 * `legalRoadEdges` above is `main`-only, so the UI's free-road highlighting needs this. */
export function legalFreeRoadEdges(state: GameState, seat: Seat): EdgeId[] {
  if (state.phase.kind !== 'roadBuilding') return [];
  // A free road consumes a road piece — in seafarers the sub-phase can outlast the road supply (its
  // `remaining` counts roads+ships, S11.1), so gate on roads-left so a road is never offered at 0
  // roads. A no-op in a base game (base `remaining` is capped by the road supply — RK-13 unchanged).
  if ((state.players[seat]?.piecesLeft.roads ?? 0) <= 0) return [];
  return geometryForState(state)
    .edges.filter((e) => canPlaceRoadHere(state, seat, e.id))
    .map((e) => e.id);
}

/** Main phase: empty, distance-legal vertices touching one of the seat's roads/ships (R7.3/S4.3);
 *  land-touching in a seafarers game. */
export function legalSettlementVertices(state: GameState, seat: Seat): VertexId[] {
  if (state.phase.kind !== 'main') return [];
  if ((state.players[seat]?.piecesLeft.settlements ?? 0) <= 0) return [];
  const geometry = geometryForState(state);
  const seafarers = isSeafarersState(state);
  // C7.1 (B-31): in a C&K game a knight occupies its intersection like a building — a settlement can
  // never be built where any player's knight sits (the `buildSettlement` intercept rejects it, so the
  // enumerator must match, else the sim bot / client would offer an OCCUPIED-bound spot, cf. B-23/B-28).
  // `ck` is undefined outside a C&K game -> no-op filter -> base/other modes bit-identical (RK-13).
  const ck = citiesKnightsExt(state);
  // T-1107 (§EP4.3): a NORMAL settlement build (not `foundSettlement`, which already checks this
  // itself, settling.ts) stays on discovered land too — same "bot-only, no phase-commit risk" gate
  // as `legalRoadEdges` above.
  const explorersPirates = isExplorersPiratesState(state);
  return geometry.vertices
    .filter(
      (v) =>
        satisfiesDistanceRule(state, v.id) &&
        !isVertexOccupied(state, v.id) &&
        ownRoadOrShipAt(state, seat, v.id) &&
        (!seafarers || vertexTouchesLand(state, geometry, v.id)) &&
        (!explorersPirates || vertexTouchesDiscoveredLand(state, v.id)) &&
        !(ck?.knights.some((list) => list.some((k) => k.vertex === v.id)) ?? false)
    )
    .map((v) => v.id);
}

/** Main phase: the seat's own settlements, each upgradeable to a city (R7.4). Empty with no city
 *  pieces left (else the UI offers a city the engine rejects `NO_PIECES_LEFT`). */
export function legalCityVertices(state: GameState, seat: Seat): VertexId[] {
  if (state.phase.kind !== 'main') return [];
  if ((state.players[seat]?.piecesLeft.cities ?? 0) <= 0) return [];
  return [...(state.players[seat]?.settlements ?? [])];
}

/** Affordability + stock for each build type (drives the action-bar enablement, T-403). */
export function buildAffordability(state: GameState, seat: Seat): {
  road: boolean;
  settlement: boolean;
  city: boolean;
} {
  const p = state.players[seat];
  if (!p) return { road: false, settlement: false, city: false };
  const costs = costsForState(state);
  return {
    road: p.piecesLeft.roads > 0 && canAfford(p, costs.road),
    settlement: p.piecesLeft.settlements > 0 && canAfford(p, costs.settlement),
    city: p.piecesLeft.cities > 0 && canAfford(p, costs.city),
  };
}

/** Seafarers (S4/S7): the seat's legal ship builds/moves right now, and whether a ship is affordable
 *  (1 lumber + 1 wool) with supply left. All empty/false in a base game. Re-exported enumerators come
 *  from the seafarers module so callers (client highlighting, bots) import them from one place. */
export { legalShipEdges, movableShips, shipMoveTargets } from './modules/seafarers/index.js';
// Seafarers Road-Building free ships (S11.1) + the gold pick-count (S9) — used by bots/candidates.
export { legalFreeShipEdges, goldPickCount } from './modules/seafarers/index.js';

// Rivers (T-1003, §TB3.2): legal bridge targets — `[]` outside a rivers game. Re-exported here so
// bots/UI import every legal-move enumerator from one place, mirroring the seafarers pattern above.
export { legalBridgeEdges } from './modules/tradersBarbarians/index.js';

// Caravans (T-1004, §TB4.1): legal camel-placement targets (empty route edges) — `[]` outside a
// caravans game / once every route edge already carries a camel.
export { legalCamelEdges } from './modules/tradersBarbarians/index.js';

// Barbarian Attack (T-1005, §TB5.2): legal knight recruit/move targets — `[]` outside a
// barbarianAttack game.
export { legalKnightMoveTargets, legalKnightRecruitEdges } from './modules/tradersBarbarians/index.js';

export function canBuildShip(state: GameState, seat: Seat): boolean {
  if (!isSeafarersState(state)) return false;
  const p = state.players[seat];
  const ext = state.ext?.seafarers;
  if (!p || !ext) return false;
  return (
    (ext.shipsLeft[seat] ?? 0) > 0 && (p.resources.lumber ?? 0) >= 1 && (p.resources.wool ?? 0) >= 1
  );
}

/**
 * Per-resource maritime trade rate (R8.2) and whether the seat currently holds enough to trade
 * it away — drives the trade dialog's rate badges/enablement (T-404). The bank's stock of the
 * `receive` side isn't checked here (picked after `give` in the UI); the `bankTrade` action
 * itself remains authoritative and returns `BANK_EMPTY` when the bank can't supply it.
 */
export function bankTradeOptions(
  state: GameState,
  seat: Seat
): Record<ResourceType, { rate: 2 | 3 | 4; affordable: boolean }> {
  const player = state.players[seat];
  const out = {} as Record<ResourceType, { rate: 2 | 3 | 4; affordable: boolean }>;
  for (const res of Object.keys(state.bank) as ResourceType[]) {
    const rate = tradeRate(state, seat, res);
    out[res] = { rate, affordable: !!player && player.resources[res] >= rate };
  }
  return out;
}

/** Discard sub-phase: seats still owing a discard (R6.1/ER-2), in `phase.pending` order. */
export function pendingDiscards(state: GameState): Seat[] {
  return state.phase.kind === 'discard' ? [...state.phase.pending] : [];
}

/** moveRobber: every hex except the one the robber currently occupies (R6.2; desert allowed).
 *  In a seafarers game the robber only moves to LAND hexes — sea hexes are the pirate's domain (S8.2),
 *  and moving the robber onto a sea hex would pointlessly block a non-producing tile. */
export function legalRobberHexes(state: GameState): HexId[] {
  if (state.phase.kind !== 'moveRobber') return [];
  const seafarers = isSeafarersState(state);
  return geometryForState(state)
    .hexes.map((h) => h.id)
    .filter((id) => id !== state.board.robber)
    .filter((id) => !seafarers || hexTerrainOf(state, id) !== 'sea');
}

/** moveRobber (Seafarers S8.2): every SEA hex except the pirate's current one — the pirate move
 *  alternative to the robber. Empty outside the moveRobber sub-phase / in a base game. */
export function legalPirateHexes(state: GameState): HexId[] {
  if (state.phase.kind !== 'moveRobber' || !isSeafarersState(state)) return [];
  const pirate = pirateOf(state);
  return geometryForState(state)
    .hexes.map((h) => h.id)
    .filter((id) => id !== pirate && hexTerrainOf(state, id) === 'sea');
}

/**
 * moveRobber (T-902, multi-piece hex framework, docs/07 D-034): every hex except `piece`'s own
 * current hex — the `moveHexPiece` alternative to `moveRobber`/`movePirate` for a NAMED enabled hex
 * piece. Empty outside the `moveRobber` sub-phase, when the `hexPieces` modifier is off, or when
 * `piece` isn't currently active. Mirrors `legalRobberHexes`/`legalPirateHexes`'s shape one level
 * up the framework.
 */
export function legalHexPieceHexes(state: GameState, piece: HexPieceKindId): HexId[] {
  if (state.phase.kind !== 'moveRobber') return [];
  const instance = hexPiecesExt(state)?.pieces.find((p) => p.kind === piece);
  if (!instance) return [];
  return geometryForState(state)
    .hexes.map((h) => h.id)
    .filter((id) => id !== instance.hex);
}

/** Pirate steal candidates (S8.4/ER-S5) for `hex` (default: the pirate's current hex): seats other
 *  than the active player who own a ship adjacent to `hex` and hold ≥1 card. Empty in a base game. */
export function pirateSteals(state: GameState, hex?: HexId): Seat[] {
  if (!isSeafarersState(state)) return [];
  const target = hex ?? pirateOf(state);
  return target === undefined ? [] : pirateStealCandidates(state, target);
}

/** chooseGoldResource sub-phase (S9/ER-S7): seats still owing a gold choice, in `phase.pending`
 *  order. Empty outside that sub-phase. */
export function pendingGoldChoices(state: GameState): Seat[] {
  return state.phase.kind === 'chooseGoldResource' ? [...state.phase.pending] : [];
}

/**
 * Steal candidates for `hex` (R6.3/ER-3): seats other than the active player with a
 * settlement/city on one of the hex's vertices and ≥1 resource card. Defaults to the robber's
 * CURRENT hex when `hex` is omitted. Deliberately phase-agnostic (unlike the `legal*` functions
 * above, which only answer for the phase where that action is directly submittable): the `hex`
 * parameter exists so the client can preview candidates for any hex — e.g. while the moveRobber
 * choice is still being made — where the robber hasn't actually moved there yet.
 */
export function stealCandidates(state: GameState, hex?: HexId): Seat[] {
  return stealCandidatesForHex(state, hex ?? state.board.robber);
}

/** R8.1 open-offer summary — drives the trade UI (T-404); `null` when no offer is open. */
export interface TradeOfferSummary {
  from: Seat;
  give: ResourceBundle;
  receive: ResourceBundle;
  responses: Partial<Record<Seat, 'accepted' | 'declined'>>;
  /** Every seat other than the owner — responses are idempotent (R8.1), so a seat may (re)respond
   *  at any time while the offer stays open, regardless of any earlier response. */
  canRespond: Seat[];
  /** Seats the owner could legally `confirmTrade` with RIGHT NOW: they've accepted AND both sides
   *  still hold their side of the trade — mirrors the re-verification `confirmTrade` performs
   *  (phases/main.ts) so the UI never offers a confirm that would come back `CANT_AFFORD`. */
  confirmable: Seat[];
}

export function tradeOfferSummary(state: GameState): TradeOfferSummary | null {
  const trade = state.trade;
  if (trade == null) return null;
  const from = state.turn.player;
  const owner = state.players[from];
  const ownerCanAfford = !!owner && hasAtLeast(owner.resources, trade.give);

  const canRespond = state.players.map((p) => p.seat).filter((s) => s !== from);
  const confirmable = canRespond.filter((s) => {
    if (trade.responses[s] !== 'accepted') return false;
    const partner = state.players.find((p) => p.seat === s);
    return ownerCanAfford && !!partner && hasAtLeast(partner.resources, trade.receive);
  });

  return {
    from,
    give: trade.give,
    receive: trade.receive,
    responses: trade.responses,
    canRespond,
    confirmable,
  };
}

/** Why a "play" dev card currently can't be played (R9.3/R9.4/ER-5/ER-6) — see `playableDevCards`. */
export type DevCardBlockedReason =
  | 'CARD_NOT_HELD'
  | 'DEV_ALREADY_PLAYED'
  | 'DEV_BOUGHT_THIS_TURN'
  | 'CANNOT_PLAY'
  | 'BANK_EMPTY';

export interface DevCardPlayability {
  playable: boolean;
  reason?: DevCardBlockedReason;
}

/**
 * Playability of each of the four "play" dev cards for `seat` right now (R9.3/R9.4; Road
 * Building's ER-5 CANNOT_PLAY; Year of Plenty's ER-6 BANK_EMPTY) — drives the dev-card UI's
 * enablement (T-406). Deliberately phase-agnostic: preRoll and main allow the exact same four
 * plays (R4.1), so this never gates on `state.phase.kind`. Victory Point cards have no play
 * action at all (R9.8) and are intentionally not part of this shape.
 */
export function playableDevCards(
  state: GameState,
  seat: Seat
): Record<'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly', DevCardPlayability> {
  const of = (reason: DevCardBlockedReason | null): DevCardPlayability =>
    reason === null ? { playable: true } : { playable: false, reason };

  const player = state.players[seat];

  let roadReason: DevCardBlockedReason | null = commonPlayBlockReason(state, seat, 'roadBuilding');
  if (roadReason === null) {
    // Base: playable iff a road piece and a legal road edge exist (matches phases/devCards.ts's
    // CANNOT_PLAY gate — keeps RK-13 bit-identical). Seafarers (S11.1): Road Building may place a
    // road OR a ship, and a road may not sit on a pure sea edge (S3.2) — so defer to the handler's
    // own predicate rather than a road-only check (the sim caught this mismatch, T-706).
    const canPlay = isSeafarersState(state)
      ? canPlayRoadBuildingSeafarers(state, seat)
      : (player?.piecesLeft.roads ?? 0) > 0 &&
        geometryForState(state).edges.some((e) => canPlaceRoad(state, seat, e.id));
    if (!canPlay) roadReason = 'CANNOT_PLAY';
  }

  let yopReason: DevCardBlockedReason | null = commonPlayBlockReason(state, seat, 'yearOfPlenty');
  if (yopReason === null) {
    const bankHasAny = (Object.keys(state.bank) as ResourceType[]).some((r) => state.bank[r] > 0);
    if (!bankHasAny) yopReason = 'BANK_EMPTY';
  }

  return {
    knight: of(commonPlayBlockReason(state, seat, 'knight')),
    roadBuilding: of(roadReason),
    yearOfPlenty: of(yopReason),
    monopoly: of(commonPlayBlockReason(state, seat, 'monopoly')),
  };
}

/**
 * R13.1 VP for the HUD as seen by every OTHER seat (T-111): settlements/cities/awards only —
 * hidden VP-card counts (R9.8) are deliberately excluded so this is always safe to show for any
 * seat, including opponents. Server-side redaction (T-204) should use this for every seat except
 * the connection's own.
 */
export function publicVp(state: GameState, seat: Seat): number {
  const b = computeVp(state, seat);
  return b.total - b.vpCards;
}

/**
 * The viewer's own full R13.1 VP total, including their own hidden VP cards. Only ever safe to
 * compute/show for the connection's OWN seat — never call this for another seat's client-facing
 * total (that would leak hidden information ahead of `gameWon`'s reveal, R13.2).
 */
export function ownVp(state: GameState, seat: Seat): number {
  return computeVp(state, seat).total;
}
