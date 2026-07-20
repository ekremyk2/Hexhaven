// T-304: the single mechanism every Phase-4 flow (build, robber, free roads, …) reuses to figure
// out (a) which board-target category is currently highlightable, (b) which ids in it are legal
// right now, and (c) what `Action` a confirmed pick turns into. Pure functions only — no React, no
// store access — so they're directly testable against the engine's own `legal.ts` enumerators
// (docs/02 §8). `useUiInteraction` at the bottom is the thin store-connected wrapper components use.
//
// WIRE: T-204 — `PlayerView` (store/types.ts) is still the `unknown` wire placeholder; the real
// redacted view schema hasn't landed. Legal-move enumeration is inherently about the ACTING seat's
// own choices, which redaction is not expected to hide from that seat, so this module treats the
// view as a full engine `GameState` (exactly what every engine test and `BoardPreview`'s fixture
// already do) rather than block on T-204. Once T-204 lands a real `PlayerView` type, the cast in
// `useUiInteraction` below is the one line that should change.
import { useCallback, useEffect } from 'react';
import {
  chaseRobberHexTargets,
  chaseRobberKnights,
  diplomatOpenRoads,
  displaceableKnights,
  epShipMoveTargets,
  intrigueTargets,
  knightDisplaceTargets,
  knightMoveTargets,
  knightPlacementVertices,
  legalBridgeEdges,
  legalCamelEdges,
  legalCityVertices,
  legalFreeRoadEdges,
  legalFreeShipEdges,
  legalHexPieceHexes,
  legalKnightMoveTargets,
  legalKnightRecruitEdges,
  legalKnightVertices,
  legalPirateHexes,
  legalRoadEdges,
  legalRobberHexes,
  legalSettlementVertices,
  legalSetupRoads,
  legalSetupSettlements,
  legalShipEdges,
  merchantHexes,
  movableEPShips,
  movableKnights,
  movableShips,
  shipMoveTargets,
  stealCandidates,
  wallEligibleCities,
} from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { Action, EdgeId, GameState, HexId, HexPieceKindId, Seat, VertexId } from '@hexhaven/shared';
import {
  activatableKnightVertices,
  bishopHexes,
  flattenKnights,
  inventorHexes,
  medicineVertices,
  promotableKnightVertices,
} from '../citiesKnights/ckHelpers';
import { hexChoicesExceptRobber, legalRoadEdgesAnyPhase, unoccupiedEdges } from '../cardMods/cardModLogic';
import { explorerFromChoices, priestCityVertices, priestSettlementVertices, roadTargetChoices } from '../helpers/helpersLogic';
import {
  legalBuildEPShipEdges,
  legalFoundSettlementVertices,
  legalUpgradeToHarborVertices,
} from '../explorersPirates/epActionLogic';
import { useStore } from './index';
import type { UiMode } from './types';

/** Which hit-test category the interaction layer is currently listening on (task requirement 1). */
export type TargetMode = 'vertex' | 'edge' | 'hex';

export interface UiTargets {
  mode: TargetMode | null;
  targets: Set<number>;
}

const IDLE_TARGETS: UiTargets = { mode: null, targets: new Set() };

/**
 * T-903: which hex-piece kind `movingHexPiece` mode should target. `hexPieceTarget` is the kind the
 * `RobberOverlay` chooser armed (`game.hexPieceTarget`) — honored only while it's actually still
 * active this game (defensive against a stale value surviving a piece's own kind falling out of
 * `state.ext.hexPieces.pieces`, which can't happen mid-game today but costs nothing to guard).
 * Falls back to the sole active kind when there's exactly one (no chooser needed, mirrors T-902's
 * original single-kind behavior); `null` when there's none active, or several active but none
 * chosen yet (the chooser must be used first).
 */
function activeHexPieceKind(view: GameState, hexPieceTarget: HexPieceKindId | null): HexPieceKindId | null {
  const active = view.ext?.hexPieces?.pieces.map((p) => p.kind) ?? [];
  if (hexPieceTarget != null && active.includes(hexPieceTarget)) return hexPieceTarget;
  return active.length === 1 ? active[0]! : null;
}

/**
 * Guard rail (requirement 3): is it `seat`'s decision to make at all right now? The interaction
 * layer renders nothing interactive when this is false, regardless of `uiMode` — covers both "not
 * your turn" and "your turn, but this sub-decision belongs to someone else" (e.g. another seat's
 * pending discard).
 */
export function isMyDecision(view: GameState, seat: Seat): boolean {
  switch (view.phase.kind) {
    case 'discard':
      return view.phase.pending.includes(seat);
    // Seafarers gold fields (S9/ER-S7): any pending seat picks its free resource(s) independently,
    // exactly like an owed discard (T-705). Blocks the turn until every pending seat resolves.
    case 'chooseGoldResource':
      return view.phase.pending.includes(seat);
    // 5–6 SBP (X12): the current builder acts although `turn.player` is the seat whose turn just
    // ended (redact.ts passes the `specialBuild` phase through, so `builder` is visible).
    case 'specialBuild':
      return view.phase.builder === seat;
    // Caravans camel-placement vote (T-1008, §TB4.2): any still-pending seat owes a `caravanVote`
    // bid; once every seat has bid, only the resolved `winner` may act (the follow-up `placeCamel`) —
    // who may NOT be `turn.player` (mirrors the engine module's own `isActorAllowed`).
    case 'caravanVote':
      return view.phase.pending.includes(seat) || (view.phase.pending.length === 0 && view.phase.winner === seat);
    case 'ended':
      return false;
    // setup/preRoll/main/roadBuilding/moveRobber/steal: the phase's actor is always turn.player
    // (setup's snake draft reorders turn.player itself — docs/03 createGame comment). The 2022
    // Paired-Players partial turn is a `main` turn owned by the paired builder, so it's covered here.
    default:
      return view.turn.player === seat;
  }
}

/**
 * uiMode -> current target mode + legal id set (requirement 2), sourced from `legal.ts`. Returns
 * the idle/empty shape whenever it isn't `seat`'s decision, when `uiMode` is `idle`, or when the
 * mode has no board-target of its own (`discarding` is a card-count picker, not a board pick).
 */
export function computeUiTargets(
  view: GameState,
  seat: Seat,
  uiMode: UiMode,
  // T-705: the move-ship source edge picked in step 1 (`game.shipMoveFrom`). Only consulted for the
  // `movingShip` mode; `null` selects the step-1 source targets, a set edge selects the destinations.
  shipMoveFrom: EdgeId | null = null,
  // T-806: the own-knight source vertex picked in step 1 of `movingKnight`/`displacingKnight`/
  // `chasingRobber` (`game.knightPickFrom`). `null` selects the step-1 source targets (the seat's own
  // eligible knights); a set vertex selects the step-2 destination/target set.
  knightPickFrom: VertexId | null = null,
  // T-903: the hex-piece kind armed via the `RobberOverlay` chooser (`game.hexPieceTarget`). Only
  // consulted for `movingHexPiece`; see `activeHexPieceKind`'s doc comment for the fallback rule.
  hexPieceTarget: HexPieceKindId | null = null,
  // Board-click targeting follow-up: the first pick of a two-step progress-card flow
  // (`game.progressCardStep1`). Only consulted for `ckPlayInventor`/`ckPlayDeserter`; `null`
  // selects the step-1 target set, a set id selects the step-2 set (mirrors `knightPickFrom`).
  progressCardStep1: number | null = null,
): UiTargets {
  if (!isMyDecision(view, seat)) return IDLE_TARGETS;

  switch (uiMode) {
    case 'placingRoad': {
      const ids = view.phase.kind === 'setup' ? legalSetupRoads(view) : legalRoadEdges(view, seat);
      return { mode: 'edge', targets: new Set(ids) };
    }
    case 'placingSettlement': {
      const ids =
        view.phase.kind === 'setup' ? legalSetupSettlements(view) : legalSettlementVertices(view, seat);
      return { mode: 'vertex', targets: new Set(ids) };
    }
    case 'placingCity':
      return { mode: 'vertex', targets: new Set(legalCityVertices(view, seat)) };
    case 'placingFreeRoad':
      return { mode: 'edge', targets: new Set(legalFreeRoadEdges(view, seat)) };
    case 'movingRobber':
      return { mode: 'hex', targets: new Set(legalRobberHexes(view)) };
    // Seafarers (T-705). Build a ship on a legal sea edge (S4).
    case 'placingShip':
      return { mode: 'edge', targets: new Set(legalShipEdges(view, seat)) };
    // Move a ship (S7), two-step: step 1 highlights the mover's open ships; once one is picked
    // (`shipMoveFrom`), step 2 highlights that ship's legal destinations.
    case 'movingShip':
      return shipMoveFrom == null
        ? { mode: 'edge', targets: new Set(movableShips(view, seat)) }
        : { mode: 'edge', targets: new Set(shipMoveTargets(view, seat, shipMoveFrom)) };
    // Relocate the pirate to a legal sea hex on a 7 / Knight (S8), instead of the robber.
    case 'movingPirate':
      return { mode: 'hex', targets: new Set(legalPirateHexes(view)) };
    // T-902/T-903 (multi-piece hex framework): relocate the ARMED active hex piece on a 7 / Knight,
    // instead of the robber. `null` (several kinds active, none chosen yet) shows nothing until the
    // `RobberOverlay` chooser sets `hexPieceTarget`.
    case 'movingHexPiece': {
      const kind = activeHexPieceKind(view, hexPieceTarget);
      return kind == null ? IDLE_TARGETS : { mode: 'hex', targets: new Set(legalHexPieceHexes(view, kind)) };
    }
    // A Road-Building free piece placed as a ship (S11.1).
    case 'placingFreeShip':
      return { mode: 'edge', targets: new Set(legalFreeShipEdges(view, seat)) };
    // Cities & Knights (T-806, C7.1): build a new basic knight on a legal vertex.
    case 'buildingKnight':
      return { mode: 'vertex', targets: new Set(legalKnightVertices(view, seat)) };
    // C7.2: pick one of the seat's own INACTIVE knights to activate. Empty outside a C&K game.
    case 'activatingKnight': {
      const ck = view.ext?.citiesKnights;
      return { mode: 'vertex', targets: new Set(ck ? activatableKnightVertices(ck, seat) : []) };
    }
    // C7.2/C7.3: pick one of the seat's own knights (below max level, Fortress-gated) to promote.
    case 'promotingKnight': {
      const ck = view.ext?.citiesKnights;
      return { mode: 'vertex', targets: new Set(ck ? promotableKnightVertices(ck, seat) : []) };
    }
    // C7.4: move an active knight, two-step like `movingShip` — step 1 highlights movable knights,
    // step 2 (once `knightPickFrom` is set) highlights that knight's legal destinations.
    case 'movingKnight':
      return knightPickFrom == null
        ? { mode: 'vertex', targets: new Set(movableKnights(view, seat)) }
        : { mode: 'vertex', targets: new Set(knightMoveTargets(view, seat, knightPickFrom)) };
    // C7.4: displace a weaker opponent knight, two-step exactly like `movingKnight`.
    case 'displacingKnight':
      return knightPickFrom == null
        ? { mode: 'vertex', targets: new Set(displaceableKnights(view, seat)) }
        : { mode: 'vertex', targets: new Set(knightDisplaceTargets(view, seat, knightPickFrom)) };
    // C7.4/C10.2: chase the robber off a hex adjacent to an active knight — step 1 (vertex) picks
    // the knight, step 2 (hex, once `knightPickFrom` is set) picks the robber's destination.
    case 'chasingRobber':
      return knightPickFrom == null
        ? { mode: 'vertex', targets: new Set(chaseRobberKnights(view, seat)) }
        : { mode: 'hex', targets: new Set(chaseRobberHexTargets(view)) };
    // C9.1: build a city wall on one of the seat's own unwalled cities.
    case 'buildingCityWall':
      return { mode: 'vertex', targets: new Set(wallEligibleCities(view, seat)) };
    // Board-click targeting follow-up (C6.5): the single-step progress-card board targets — each
    // reuses the exact enumerator `ProgressHandPanel.tsx` used to build its old list dialog.
    case 'ckPlayEngineer':
      return { mode: 'vertex', targets: new Set(wallEligibleCities(view, seat)) };
    case 'ckPlayMedicine':
      return { mode: 'vertex', targets: new Set(medicineVertices(view as unknown as PlayerView, seat)) };
    case 'ckPlayMerchant':
      return { mode: 'hex', targets: new Set(merchantHexes(view, seat)) };
    case 'ckPlayBishop':
      return { mode: 'hex', targets: new Set(bishopHexes(view as unknown as PlayerView)) };
    case 'ckPlayDiplomat':
      return { mode: 'edge', targets: new Set(diplomatOpenRoads(view)) };
    case 'ckPlayIntrigue':
      return { mode: 'vertex', targets: new Set(intrigueTargets(view, seat)) };
    // Inventor (two DISTINCT hexes): step 1 offers every eligible hex; step 2 excludes whichever
    // was picked first (mirrors the old `InventorDialog`'s "disable the other row's pick").
    case 'ckPlayInventor': {
      const eligible = inventorHexes(view as unknown as PlayerView);
      return progressCardStep1 == null
        ? { mode: 'hex', targets: new Set(eligible) }
        : { mode: 'hex', targets: new Set(eligible.filter((h) => h !== progressCardStep1)) };
    }
    // Deserter: step 1 picks an OPPONENT's knight vertex; step 2 picks the seat's own legal
    // replacement-placement vertex (same shape `knightPlacementVertices` already offers Deserter's
    // list dialog).
    case 'ckPlayDeserter': {
      if (progressCardStep1 == null) {
        const opponentKnights = flattenKnights(view as unknown as PlayerView)
          .filter((k) => k.seat !== seat)
          .map((k) => k.vertex);
        return { mode: 'vertex', targets: new Set(opponentKnights) };
      }
      return { mode: 'vertex', targets: new Set(knightPlacementVertices(view, seat)) };
    }
    // cardMods (Priority 2 of the board-click targeting follow-up): Trailblazer/Highwayman are
    // single-step; Super-Settle reads the seat's own settlements straight off `view.players` (the
    // full engine truth here, not a redacted `OwnPlayerView` — no cast/import of `superSettleVertices`
    // needed). Ride By Night is two-step (hex, then edge), reusing `progressCardStep1`.
    case 'cardModTrailblazer':
      return { mode: 'edge', targets: new Set(unoccupiedEdges(view as unknown as PlayerView)) };
    case 'cardModHighwayman':
      return { mode: 'hex', targets: new Set(hexChoicesExceptRobber(view as unknown as PlayerView)) };
    case 'cardModSuperSettle': {
      const player = view.players[seat];
      const vertices = player && player.piecesLeft.cities > 0 ? player.settlements : [];
      return { mode: 'vertex', targets: new Set(vertices) };
    }
    case 'cardModRideByNight':
      return progressCardStep1 == null
        ? { mode: 'hex', targets: new Set(hexChoicesExceptRobber(view as unknown as PlayerView)) }
        : { mode: 'edge', targets: new Set(legalRoadEdgesAnyPhase(view as unknown as PlayerView, seat)) };
    // Helpers of Hexhaven (Priority 3): Explorer is two-step edge->edge (own road, then its new spot,
    // excluding the source itself); Priest's two build kinds are single-step vertex picks.
    case 'helperExplorer': {
      const pv = view as unknown as PlayerView;
      return progressCardStep1 == null
        ? { mode: 'edge', targets: new Set(explorerFromChoices(pv, seat)) }
        : { mode: 'edge', targets: new Set(roadTargetChoices(pv, seat).filter((e) => e !== progressCardStep1)) };
    }
    case 'helperPriestSettlement':
      return { mode: 'vertex', targets: new Set(priestSettlementVertices(view as unknown as PlayerView, seat)) };
    case 'helperPriestCity':
      return { mode: 'vertex', targets: new Set(priestCityVertices(view as unknown as PlayerView, seat)) };
    // Traders & Barbarians (T-1008). Rivers (§TB3.2): build a bridge on a legal river edge.
    case 'tbBuildingBridge':
      return { mode: 'edge', targets: new Set(legalBridgeEdges(view, seat)) };
    // Fishermen (§TB2.4): the 5-fish "free road" benefit's edge pick. `legalFreeRoadEdges` is the
    // WRONG enumerator here — it's gated to the `roadBuilding` sub-phase (the dev card's own free
    // placements), whereas the fish benefit places its road during the normal `main` phase, exactly
    // like a paid road build (R7.2, `canPlaceRoad`) MINUS the cost — so `legalRoadEdges` (which
    // already gates on `main` + the seat's own road-piece supply, matching `exchangeFishHandler`'s
    // own `piecesLeft.roads`/`canPlaceRoad` checks exactly) is the correct match.
    case 'tbExchangeFishRoad':
      return { mode: 'edge', targets: new Set(legalRoadEdges(view, seat)) };
    // Barbarian Attack (§TB5.2): recruit a new knight on a legal own-network edge.
    case 'tbRecruitingKnight':
      return { mode: 'edge', targets: new Set(legalKnightRecruitEdges(view, seat)) };
    // Barbarian Attack (§TB5.2): move an active knight, two-step like `movingKnight` — step 1
    // highlights the seat's own active knight edges, step 2 (once `shipMoveFrom` is set) highlights
    // that knight's legal destinations (both normal- and extended-range, tagged by `pickAction`).
    case 'tbMovingKnight': {
      if (shipMoveFrom == null) {
        const knights = (view.ext?.tradersBarbarians?.knights ?? [])
          .filter((k) => k.seat === seat && k.active)
          .map((k) => k.edge);
        return { mode: 'edge', targets: new Set(knights) };
      }
      return { mode: 'edge', targets: new Set(legalKnightMoveTargets(view, seat, shipMoveFrom).map((t) => t.to)) };
    }
    // Caravans (§TB4.2): the vote's resolved winner places one camel on an empty route edge.
    case 'tbPlacingCamel':
      return { mode: 'edge', targets: new Set(legalCamelEdges(view)) };
    // Explorers & Pirates — Land Ho! (T-1108, §EP3.1): build a new ship on a legal sea edge.
    case 'epBuildingShip':
      return { mode: 'edge', targets: new Set(legalBuildEPShipEdges(view as unknown as PlayerView, seat)) };
    // Move a ship (§EP3.2), two-step exactly like `movingShip`/`tbMovingKnight`: step 1 highlights the
    // seat's own movable ships, step 2 (once `shipMoveFrom` is set) highlights that ship's legal
    // destinations (the engine's own reachability search, `epShipMoveTargets`).
    case 'epMovingShip':
      return shipMoveFrom == null
        ? { mode: 'edge', targets: new Set(movableEPShips(view, seat)) }
        : { mode: 'edge', targets: new Set(epShipMoveTargets(view, seat, shipMoveFrom)) };
    // Found a settlement (§EP4.1): a coastal vertex touching discovered land, adjacent to one of the
    // seat's own ships currently carrying a settler.
    case 'epFoundingSettlement':
      return { mode: 'vertex', targets: new Set(legalFoundSettlementVertices(view as unknown as PlayerView, seat)) };
    // Upgrade a settlement to a harbor settlement (§EP4.2): one of the seat's own settlements.
    case 'epUpgradingHarbor':
      return { mode: 'vertex', targets: new Set(legalUpgradeToHarborVertices(view as unknown as PlayerView, seat)) };
    case 'idle':
    case 'discarding':
      return IDLE_TARGETS;
    default: {
      const exhaustiveCheck: never = uiMode;
      return exhaustiveCheck;
    }
  }
}

/** Confirming a pick in `uiMode` -> the `Action` it dispatches (requirement 2). `null` for modes
 * with no board pick (`idle`, `discarding`). */
export function pickAction(
  view: GameState,
  uiMode: UiMode,
  id: number,
  shipMoveFrom: EdgeId | null = null,
  knightPickFrom: VertexId | null = null,
  hexPieceTarget: HexPieceKindId | null = null,
  progressCardStep1: number | null = null,
  // Traders & Barbarians (T-1008): only `tbMovingKnight`'s step 2 needs the acting seat directly (to
  // look up whether the picked destination requires the once-per-turn paid range extension via
  // `legalKnightMoveTargets`, which is keyed by seat). Every other mode/case above never needed the
  // acting seat here (`computeUiTargets` already took it two params earlier for its own target
  // enumeration) — appended last, optional, so no existing call site needs updating.
  mySeat: Seat | null = null,
): Action | null {
  switch (uiMode) {
    case 'placingRoad':
      return view.phase.kind === 'setup'
        ? { type: 'placeSetupRoad', edge: id as EdgeId }
        : { type: 'buildRoad', edge: id as EdgeId };
    case 'placingSettlement':
      return view.phase.kind === 'setup'
        ? { type: 'placeSetupSettlement', vertex: id as VertexId }
        : { type: 'buildSettlement', vertex: id as VertexId };
    case 'placingCity':
      return { type: 'buildCity', vertex: id as VertexId };
    case 'placingFreeRoad':
      return { type: 'placeFreeRoad', edge: id as EdgeId };
    case 'movingRobber':
      return { type: 'moveRobber', hex: id as HexId };
    case 'placingShip':
      return { type: 'buildShip', edge: id as EdgeId };
    // Step 1 of move-ship (source pick) produces no engine action — it only records the source edge
    // (`useUiInteraction` handles that transition). Step 2 (destination known) dispatches `moveShip`.
    case 'movingShip':
      return shipMoveFrom == null
        ? null
        : { type: 'moveShip', from: shipMoveFrom, to: id as EdgeId };
    case 'movingPirate':
      return { type: 'movePirate', hex: id as HexId };
    case 'movingHexPiece': {
      const kind = activeHexPieceKind(view, hexPieceTarget);
      return kind == null ? null : { type: 'moveHexPiece', piece: kind, hex: id as HexId };
    }
    case 'placingFreeShip':
      return { type: 'placeFreeShip', edge: id as EdgeId };
    // Cities & Knights (T-806, C7.1): a legal-vertex pick builds a basic knight directly.
    case 'buildingKnight':
      return { type: 'buildKnight', vertex: id as VertexId };
    case 'activatingKnight':
      return { type: 'activateKnight', vertex: id as VertexId };
    case 'promotingKnight':
      return { type: 'promoteKnight', vertex: id as VertexId };
    // Step 1 (source pick) produces no engine action — `useUiInteraction` records `knightPickFrom`
    // instead. Step 2 (destination known) dispatches the real action.
    case 'movingKnight':
      return knightPickFrom == null ? null : { type: 'moveKnight', from: knightPickFrom, to: id as VertexId };
    case 'displacingKnight':
      return knightPickFrom == null
        ? null
        : { type: 'knightDisplace', from: knightPickFrom, to: id as VertexId };
    // C7.4/C10.2: step 2 is the destination HEX; `stealFrom` is resolved from the (public) steal
    // candidates for that hex. >=2 candidates auto-picks the lowest seat number — a documented v1
    // simplification consistent with `knightDisplace`'s auto-picked landing vertex elsewhere in this
    // codebase (the real rule leaves an ambiguous "your choice" to the acting player; a confirm
    // dialog for this rare case is deferred, see this task's Implementation notes).
    case 'chasingRobber': {
      if (knightPickFrom == null) return null;
      const hex = id as HexId;
      const candidates = stealCandidates(view, hex);
      return {
        type: 'chaseRobber',
        knightVertex: knightPickFrom,
        toHex: hex,
        ...(candidates.length > 0 ? { stealFrom: candidates[0] } : {}),
      };
    }
    case 'buildingCityWall':
      return { type: 'buildCityWall', vertex: id as VertexId };
    // Board-click targeting follow-up (C6.5): single-step progress-card plays dispatch straight
    // from the board pick — none of these 6 need any OTHER parameter.
    case 'ckPlayEngineer':
      return { type: 'playProgressCard', card: 'engineer', vertex: id as VertexId };
    case 'ckPlayMedicine':
      return { type: 'playProgressCard', card: 'medicine', vertex: id as VertexId };
    case 'ckPlayMerchant':
      return { type: 'playProgressCard', card: 'merchant', hex: id as HexId };
    case 'ckPlayBishop':
      return { type: 'playProgressCard', card: 'bishop', hex: id as HexId };
    case 'ckPlayDiplomat':
      return { type: 'playProgressCard', card: 'diplomat', edge: id as EdgeId };
    case 'ckPlayIntrigue':
      return { type: 'playProgressCard', card: 'intrigue', targetVertex: id as VertexId };
    // Step 1 (first hex) produces no engine action — `useUiInteraction` records `progressCardStep1`
    // instead. Step 2 (second hex known) dispatches the real action.
    case 'ckPlayInventor':
      return progressCardStep1 == null
        ? null
        : { type: 'playProgressCard', card: 'inventor', hexA: progressCardStep1 as HexId, hexB: id as HexId };
    // Step 1 (opponent knight vertex) produces no engine action either — its SEAT is resolved here
    // from the (public) knight list rather than needing a separate param, so step 2 (the seat's own
    // placement vertex) is enough to build the full `deserter` action.
    case 'ckPlayDeserter': {
      if (progressCardStep1 == null) return null;
      const knight = flattenKnights(view as unknown as PlayerView).find((k) => k.vertex === progressCardStep1);
      if (!knight) return null;
      return {
        type: 'playProgressCard',
        card: 'deserter',
        targetSeat: knight.seat,
        targetVertex: progressCardStep1 as VertexId,
        vertex: id as VertexId,
      };
    }
    // cardMods (Priority 2): single-step plays dispatch straight from the board pick.
    case 'cardModTrailblazer':
      return { type: 'playCardModCard', card: 'trailblazer', edge: id as EdgeId };
    case 'cardModHighwayman':
      return { type: 'playCardModCard', card: 'highwayman', hex: id as HexId };
    case 'cardModSuperSettle':
      return { type: 'playCardModCombo', combo: 'superSettle', vertex: id as VertexId };
    // Step 1 (hex) produces no engine action — `useUiInteraction` records `progressCardStep1`
    // instead. Step 2 (edge known) dispatches the combo.
    case 'cardModRideByNight':
      return progressCardStep1 == null
        ? null
        : { type: 'playCardModCombo', combo: 'rideByNight', hex: progressCardStep1 as HexId, edge: id as EdgeId };
    // Step 1 (source road) produces no engine action — `useUiInteraction` records
    // `progressCardStep1` instead. Step 2 (destination known) dispatches `useHelper`.
    case 'helperExplorer':
      return progressCardStep1 == null
        ? null
        : { type: 'useHelper', helper: 'explorer', from: progressCardStep1 as EdgeId, to: id as EdgeId };
    case 'helperPriestSettlement':
      return { type: 'useHelper', helper: 'priest', build: 'settlement', vertex: id as VertexId };
    case 'helperPriestCity':
      return { type: 'useHelper', helper: 'priest', build: 'city', vertex: id as VertexId };
    // Traders & Barbarians (T-1008): single-step edge picks dispatch straight from the board pick.
    case 'tbBuildingBridge':
      return { type: 'buildBridge', edge: id as EdgeId };
    case 'tbExchangeFishRoad':
      return { type: 'exchangeFish', benefit: 'freeRoad', edge: id as EdgeId };
    case 'tbRecruitingKnight':
      return { type: 'recruitKnight', edge: id as EdgeId };
    // Step 1 (source knight edge) produces no engine action — `useUiInteraction` records
    // `shipMoveFrom` instead (this mode reuses that field, see store/types.ts's doc comment). Step 2
    // (destination known) looks up whether IT specifically needs the paid range extension.
    case 'tbMovingKnight': {
      if (shipMoveFrom == null) return null;
      const targets = mySeat != null ? legalKnightMoveTargets(view, mySeat, shipMoveFrom) : [];
      const match = targets.find((t) => t.to === id);
      return {
        type: 'moveBarbarianKnight',
        from: shipMoveFrom,
        to: id as EdgeId,
        ...(match?.extended ? { extended: true } : {}),
      };
    }
    case 'tbPlacingCamel':
      return { type: 'placeCamel', edge: id as EdgeId };
    // Explorers & Pirates — Land Ho! (T-1108): a legal-edge pick builds a ship directly.
    case 'epBuildingShip':
      return { type: 'buildEPShip', edge: id as EdgeId };
    // Step 1 (source pick) produces no engine action — `useUiInteraction` records `shipMoveFrom`
    // instead (this mode reuses that field, see store/types.ts's doc comment). Step 2 (destination
    // known) dispatches `moveEPShip`.
    case 'epMovingShip':
      return shipMoveFrom == null ? null : { type: 'moveEPShip', from: shipMoveFrom, to: id as EdgeId };
    case 'epFoundingSettlement':
      return { type: 'foundSettlement', vertex: id as VertexId };
    case 'epUpgradingHarbor':
      return { type: 'upgradeToHarbor', vertex: id as VertexId };
    case 'idle':
    case 'discarding':
      return null;
    default: {
      const exhaustiveCheck: never = uiMode;
      return exhaustiveCheck;
    }
  }
}

/**
 * One-shot click resolution: legal id -> its `Action`; anything else (illegal id, wrong category,
 * not-your-decision) -> `null` and the click is ignored (requirement 5). This is what both
 * `useUiInteraction` and the fixture page call — the authoritative "did this click count" answer.
 */
export function resolvePick(
  view: GameState,
  seat: Seat,
  uiMode: UiMode,
  id: number,
  shipMoveFrom: EdgeId | null = null,
  knightPickFrom: VertexId | null = null,
  hexPieceTarget: HexPieceKindId | null = null,
  progressCardStep1: number | null = null,
): Action | null {
  const { targets } = computeUiTargets(
    view,
    seat,
    uiMode,
    shipMoveFrom,
    knightPickFrom,
    hexPieceTarget,
    progressCardStep1,
  );
  if (!targets.has(id)) return null;
  return pickAction(view, uiMode, id, shipMoveFrom, knightPickFrom, hexPieceTarget, progressCardStep1, seat);
}

/** T-705 move-ship step 1: is `id` a legal open ship to pick up right now? Distinguishes a valid
 * source pick (which only transitions the UI, no engine action) from an illegal click, so callers
 * (`useUiInteraction`, the hot-seat page) can record the source edge instead of dispatching. */
export function isShipMoveSourcePick(
  view: GameState,
  seat: Seat,
  uiMode: UiMode,
  shipMoveFrom: EdgeId | null,
  id: number,
): boolean {
  if (uiMode !== 'movingShip' || shipMoveFrom != null) return false;
  return computeUiTargets(view, seat, uiMode, null).targets.has(id);
}

/** T-806 knight-pick step 1 (`movingKnight`/`displacingKnight`/`chasingRobber`): is `id` a legal own
 * knight to pick up right now? Mirrors `isShipMoveSourcePick` exactly — a valid source pick only
 * transitions the UI (`useUiInteraction`/the hot-seat page record `knightPickFrom`), never dispatches. */
export function isKnightPickSourcePick(
  view: GameState,
  seat: Seat,
  uiMode: UiMode,
  knightPickFrom: VertexId | null,
  id: number,
): boolean {
  if (
    (uiMode !== 'movingKnight' && uiMode !== 'displacingKnight' && uiMode !== 'chasingRobber') ||
    knightPickFrom != null
  ) {
    return false;
  }
  return computeUiTargets(view, seat, uiMode, null, null).targets.has(id);
}

/** Traders & Barbarians (T-1008) knight-move step 1: is `id` a legal own active-knight edge to pick
 *  up right now? Mirrors `isShipMoveSourcePick`/`isKnightPickSourcePick` exactly — a valid source
 *  pick only transitions the UI (`useUiInteraction` records `shipMoveFrom`, reused per that field's
 *  doc comment), never dispatches. */
export function isTbKnightMoveSourcePick(
  view: GameState,
  seat: Seat,
  uiMode: UiMode,
  shipMoveFrom: EdgeId | null,
  id: number,
): boolean {
  if (uiMode !== 'tbMovingKnight' || shipMoveFrom != null) return false;
  return computeUiTargets(view, seat, uiMode, null).targets.has(id);
}

/** Explorers & Pirates (T-1108) move-ship step 1: is `id` a legal own ship to pick up right now?
 *  Mirrors `isShipMoveSourcePick`/`isTbKnightMoveSourcePick` exactly — a valid source pick only
 *  transitions the UI (`useUiInteraction` records `shipMoveFrom`, reused per that field's doc
 *  comment), never dispatches. */
export function isEpShipMoveSourcePick(
  view: GameState,
  seat: Seat,
  uiMode: UiMode,
  shipMoveFrom: EdgeId | null,
  id: number,
): boolean {
  if (uiMode !== 'epMovingShip' || shipMoveFrom != null) return false;
  return computeUiTargets(view, seat, uiMode, null).targets.has(id);
}

/** Two-step modifier modes recognized by `isProgressCardStep1Pick` below — every mode whose FIRST
 *  board pick only records `progressCardStep1` rather than dispatching. */
const TWO_STEP_MODIFIER_MODES: ReadonlySet<UiMode> = new Set([
  'ckPlayInventor',
  'ckPlayDeserter',
  'cardModRideByNight',
  'helperExplorer',
]);

/** Board-click targeting follow-up: is `id` a legal step-1 pick right now for a two-step modifier
 *  mode (`ckPlayInventor`'s first hex, `ckPlayDeserter`'s opponent-knight vertex, `cardModRideByNight`'s
 *  hex)? Mirrors `isShipMoveSourcePick`/`isKnightPickSourcePick` exactly — a valid step-1 pick only
 *  transitions the UI (records `progressCardStep1`), never dispatches. */
export function isProgressCardStep1Pick(
  view: GameState,
  seat: Seat,
  uiMode: UiMode,
  progressCardStep1: number | null,
  id: number,
): boolean {
  if (!TWO_STEP_MODIFIER_MODES.has(uiMode) || progressCardStep1 != null) {
    return false;
  }
  return computeUiTargets(view, seat, uiMode, null, null, null, null).targets.has(id);
}

// ---- Store-connected hook ----------------------------------------------------------------------
// The React glue: reads `game.view`/`game.uiMode`/`lobby.mySeat`, recomputes targets on every
// render, dispatches a confirmed pick through the store's `sendAction` (-> GameTransport, T-301
// §3) and returns `uiMode` to `idle` (requirement 2), and cancels on Escape without sending
// (requirement 3). `InteractionLayer` itself stays presentational — it only takes the returned
// `{ mode, targets, onPick }` as props.
export function useUiInteraction(): UiTargets & { onPick: (id: number) => void } {
  const view = useStore((s) => s.game.view) as GameState | null;
  const uiMode = useStore((s) => s.game.uiMode);
  const shipMoveFrom = useStore((s) => s.game.shipMoveFrom);
  const knightPickFrom = useStore((s) => s.game.knightPickFrom);
  const hexPieceTarget = useStore((s) => s.game.hexPieceTarget);
  const progressCardStep1 = useStore((s) => s.game.progressCardStep1);
  const mySeat = useStore((s) => s.lobby.mySeat);
  const sendAction = useStore((s) => s.sendAction);
  const setUiMode = useStore((s) => s.setUiMode);
  const setShipMoveFrom = useStore((s) => s.setShipMoveFrom);
  const setKnightPickFrom = useStore((s) => s.setKnightPickFrom);
  const setProgressCardStep1 = useStore((s) => s.setProgressCardStep1);

  const { mode, targets } =
    view != null && mySeat != null
      ? computeUiTargets(view, mySeat, uiMode, shipMoveFrom, knightPickFrom, hexPieceTarget, progressCardStep1)
      : IDLE_TARGETS;

  // Road Building (R9.6): the `roadBuilding` sub-phase is a mandatory 1-2 free-piece placement, so
  // auto-enter `placingFreeRoad` for the acting seat (like setup auto-enters its placement mode) and
  // auto-exit when the engine returns to main/preRoll after the placements. There's no "cancel" —
  // the card is already spent — so this intentionally overrides an Escape-to-idle while it lasts. In a
  // Seafarers game the player may toggle a given free piece to `placingFreeShip` (S11.1); both count
  // as "in the free-placement flow", so neither auto-resets to the other.
  useEffect(() => {
    if (view == null || mySeat == null) return;
    const inFreeRoad = view.phase.kind === 'roadBuilding' && isMyDecision(view, mySeat);
    const inFreeMode = uiMode === 'placingFreeRoad' || uiMode === 'placingFreeShip';
    if (inFreeRoad && !inFreeMode) setUiMode('placingFreeRoad');
    else if (!inFreeRoad && inFreeMode) setUiMode('idle');
  }, [view, mySeat, uiMode, setUiMode]);

  useEffect(() => {
    if (mode == null) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUiMode('idle');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mode, setUiMode]);

  const onPick = useCallback(
    (id: number) => {
      if (view == null || mySeat == null) return;
      // Move-ship step 1: a valid open-ship pick only records the source edge and stays in
      // `movingShip` so the destination targets light up — it dispatches nothing yet (T-705).
      if (isShipMoveSourcePick(view, mySeat, uiMode, shipMoveFrom, id)) {
        setShipMoveFrom(id as EdgeId);
        return;
      }
      // Knight-pick step 1 (T-806): same deal for `movingKnight`/`displacingKnight`/`chasingRobber`.
      if (isKnightPickSourcePick(view, mySeat, uiMode, knightPickFrom, id)) {
        setKnightPickFrom(id as VertexId);
        return;
      }
      // Traders & Barbarians (T-1008) knight-move step 1: same deal, reusing `shipMoveFrom`.
      if (isTbKnightMoveSourcePick(view, mySeat, uiMode, shipMoveFrom, id)) {
        setShipMoveFrom(id as EdgeId);
        return;
      }
      // Explorers & Pirates (T-1108) move-ship step 1: same deal, reusing `shipMoveFrom`.
      if (isEpShipMoveSourcePick(view, mySeat, uiMode, shipMoveFrom, id)) {
        setShipMoveFrom(id as EdgeId);
        return;
      }
      // Progress-card step 1 (board-click targeting follow-up): same deal for `ckPlayInventor`'s
      // first hex / `ckPlayDeserter`'s opponent-knight vertex.
      if (isProgressCardStep1Pick(view, mySeat, uiMode, progressCardStep1, id)) {
        setProgressCardStep1(id);
        return;
      }
      const action = resolvePick(
        view,
        mySeat,
        uiMode,
        id,
        shipMoveFrom,
        knightPickFrom,
        hexPieceTarget,
        progressCardStep1,
      );
      if (action == null) return;
      sendAction(action);
      setUiMode('idle');
    },
    [
      view,
      mySeat,
      uiMode,
      shipMoveFrom,
      knightPickFrom,
      hexPieceTarget,
      progressCardStep1,
      sendAction,
      setUiMode,
      setShipMoveFrom,
      setKnightPickFrom,
      setProgressCardStep1,
    ],
  );

  return { mode, targets, onPick };
}
