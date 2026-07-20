// The Seafarers expansion as a RuleModule (docs/10 §5, docs/rules/seafarers-rules.md).
//
// T-701 laid the FOUNDATION (scenario schema/data + this shell). T-702 adds the core ship gameplay:
//   • the scenario board is stood up at createGame (board.ts) and its geometry resolved everywhere
//     via `scenarioGeometryFor` (modules/index.ts);
//   • ships are a new public piece on sea edges, held under `state.ext.seafarers` (state.ts);
//   • `buildShip`/`moveShip` (ships.ts) are dispatched through `interceptAction` below, so the base
//     reducer never names a ship inline (docs/10 §3);
//   • Longest Road generalizes to the Longest Trade Route over roads ∪ ships (rules/longestRoad.ts).
//
// T-703 completes the Seafarers engine on top of T-702's ships: the pirate (pirate.ts), gold-field
// production choice (gold.ts), small-island VP chits (chits.ts), the 14-VP scenario win (createGame
// resolves the target), and Road-Building-may-place-ships (roadBuilding.ts). All plug in via this
// module's hooks — the base engine never names the pirate/gold/chits inline.
// Base + fiveSix stay bit-identical: with seafarers off this module is never in `activeModules`, so
// no hook runs (RK-13 + the 5–6 sim).

import type { Action, EdgeId, GameState, ScenarioId, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { geometryForState } from '../index.js';
import type { RuleModule } from '../types.js';
import { grantIslandChit } from './chits.js';
import { applyClothGains, computeClothGains } from './cloth.js';
import { revealFogAt } from './fog.js';
import { chooseGoldResourceHandler, computeGoldOwed } from './gold.js';
import { grantLairCapture } from './lairs.js';
import { movePirate } from './pirate.js';
import { advancePirateTrack } from './pirateTrack.js';
import {
  placeFreeRoadSeafarers,
  placeFreeShipSeafarers,
  playRoadBuildingSeafarers,
} from './roadBuilding.js';
import { buildShip, edgeBordersLand, moveShip, vertexTouchesLand } from './ships.js';
import { isSeafarersState } from './state.js';
import { advanceWonderProgress } from './wonder.js';

/** Reject a road on a pure aquatic edge (S3.2 — ships only there); `null` if it's a legal road edge. */
function roadLandCheck(state: GameState, edge: EdgeId): EngineResult | null {
  const geometry = geometryForState(state);
  if (geometry.edges[edge] && !edgeBordersLand(state, geometry, edge)) {
    return {
      ok: false,
      error: { code: 'BAD_LOCATION', message: `edge ${edge} is a sea route; build a ship there (S3.2)` },
    };
  }
  return null;
}

/**
 * Pre-routing interception (docs/10 §3). Fully handles the ship actions (S4/S7), the pirate move
 * (S8), the gold choice (S9), and Road-Building free pieces incl. ships (S11.1); and — because ships
 * add sea edges / open-ocean vertices the base placement handlers don't know about — REJECTS the two
 * seafarers-illegal base placements (a road on a pure aquatic edge, S3.2; a settlement in open ocean,
 * S4.3) before they reach the base handler. Everything else falls through (`null`) to normal routing;
 * the base build/afford/award plumbing is reused unchanged (T-105).
 */
function seafarersIntercept(state: GameState, seat: Seat, action: Action): EngineResult | null {
  const seafarers = isSeafarersState(state);
  switch (action.type) {
    case 'buildShip':
      return buildShip(state, seat, action.edge);
    case 'moveShip':
      return moveShip(state, seat, action.from, action.to);
    // S8: relocate the pirate instead of the robber (during the moveRobber sub-phase).
    case 'movePirate':
      return movePirate(state, seat, action.hex);
    // S11.1: in a seafarers game Road Building may place ships too — own the play + free placements
    // so a free piece can be a road OR a ship. Only where a dev card is playable (R4.1).
    case 'playRoadBuilding':
      return seafarers && (state.phase.kind === 'preRoll' || state.phase.kind === 'main')
        ? playRoadBuildingSeafarers(state, seat)
        : null;
    case 'placeFreeShip':
      return placeFreeShipSeafarers(state, seat, action.edge);
    case 'placeFreeRoad':
      return seafarers && state.phase.kind === 'roadBuilding'
        ? placeFreeRoadSeafarers(state, seat, action.edge)
        : roadLandCheck(state, action.edge);
    case 'buildRoad':
    case 'placeSetupRoad':
      return roadLandCheck(state, action.edge);
    case 'buildSettlement':
    case 'placeSetupSettlement': {
      const geometry = geometryForState(state);
      if (geometry.vertices[action.vertex] && !vertexTouchesLand(state, geometry, action.vertex)) {
        return {
          ok: false,
          error: { code: 'BAD_LOCATION', message: `vertex ${action.vertex} is open ocean (S4.3)` },
        };
      }
      return null;
    }
    default:
      return null;
  }
}

/** The `chooseGoldResource` sub-phase handler (S9/ER-S7): only the gold action is legal here. */
function goldPhaseHandler(state: GameState, seat: Seat, action: Action): EngineResult {
  if (action.type !== 'chooseGoldResource') {
    return { ok: false, error: { code: 'WRONG_PHASE', message: `action ${action.type} is not legal while choosing gold` } };
  }
  return chooseGoldResourceHandler(state, seat, action.picks);
}

/** The Seafarers module. Board layout/geometry are player-count-dependent (3p vs 4p scenario frames),
 *  so they are resolved dynamically in modules/index.ts rather than pinned as static fields here. */
export const seafarersModule: RuleModule = {
  id: 'seafarers',
  interceptAction: seafarersIntercept,
  phaseHandlers: { chooseGoldResource: goldPhaseHandler },
  // S9/ER-S7: any seat still owing a gold choice may act during the gold sub-phase, though they may
  // not be the turn owner (parallels the base `discard` exemption in reduce.ts).
  isActorAllowed(state, seat, action) {
    return (
      state.phase.kind === 'chooseGoldResource' &&
      action.type === 'chooseGoldResource' &&
      state.phase.pending.includes(seat)
    );
  },
  phaseHooks: {
    // S9 gold + S10.6 island chits: post-process a producing roll / a settlement placement.
    afterAction(_prev, next, action, events, actingSeat) {
      if (!isSeafarersState(next)) return null;

      // S9/ER-S7 (+ T-757 Cloth for Hexhaven, + T-758 Pirate Islands, all folded into the SAME dice-roll
      // hook): a roll that produced (phase is now `main`) may grant cloth (deterministic, no player
      // choice — applied FIRST so it rides even when the same roll also owes a gold choice below),
      // advance the Pirate Islands auto-moving pirate one track step, and/or owe gold choices.
      if (action.type === 'rollDice' && next.phase.kind === 'main' && next.turn.roll) {
        const total = next.turn.roll[0] + next.turn.roll[1];
        const clothGains = computeClothGains(next, total);
        const withCloth = clothGains ? applyClothGains(next, clothGains) : next;
        // T-758: a no-op `advancePirateTrack` returns `withCloth` unchanged (reference-equal) for
        // every OTHER scenario — this only actually moves anything in a Pirate Islands game.
        const withPirateTrack = advancePirateTrack(withCloth);

        const { pending, owed } = computeGoldOwed(withPirateTrack, total);
        if (pending.length > 0) {
          return {
            state: { ...withPirateTrack, phase: { kind: 'chooseGoldResource', pending, owed } },
            events: [...events],
          };
        }
        if (withPirateTrack !== next) {
          return { state: withPirateTrack, events: [...events] };
        }
      }

      // S10.6: a main-phase settlement on a new small island earns the +2 VP chit (setup settlements
      // are main-island only, S10.5 — not granted here). T-758 (Pirate Islands): the SAME settlement
      // may also capture a lair its vertex touches — chained on top so both can fire from one action
      // (no early return before the lair check, unlike before this task). T-759 (Wonders of Hexhaven):
      // the SAME settlement may also advance the seat's wonder-stage progress — chained on top again
      // (a no-op `advanceWonderProgress` for every other scenario).
      if (action.type === 'buildSettlement') {
        const granted = grantIslandChit(next, actingSeat, action.vertex);
        const afterChit = granted ? granted.state : next;
        const chitEvents = granted ? granted.events : [];

        const vertex = geometryForState(afterChit).vertices[action.vertex];
        const lairCapture = vertex ? grantLairCapture(afterChit, actingSeat, vertex.hexes) : null;
        const afterLair = lairCapture ? lairCapture.state : afterChit;

        const wonderProgress = advanceWonderProgress(afterLair, actingSeat);
        const finalState = wonderProgress ? wonderProgress.state : afterLair;

        if (finalState !== next) return { state: finalState, events: [...events, ...chitEvents] };
      }

      // T-759 (Wonders of Hexhaven): a city build has no OTHER existing afterAction hook to piggyback
      // on (island chits/lair capture are settlement/ship-only, S10.6), so it gets its own small
      // branch — same no-op-elsewhere discipline as the settlement branch above.
      if (action.type === 'buildCity') {
        const wonderProgress = advanceWonderProgress(next, actingSeat);
        if (wonderProgress) return { state: wonderProgress.state, events: [...events] };
      }

      // Fog Islands (T-756): a ship build/move may reach a still-fogged hex's edge — reveal it. NO
      // new event (the task's hard constraint): a no-op `revealFogAt` returns `next` unchanged
      // (reference-equal), so this only replaces the transition when a reveal actually happened.
      // T-758 (Pirate Islands): the SAME ship build/move may also capture a lair its edge touches —
      // chained on top of the fog reveal (both are no-ops outside their own scenario).
      if (action.type === 'buildShip' || action.type === 'moveShip') {
        const edge = action.type === 'buildShip' ? action.edge : action.to;
        const revealed = revealFogAt(next, edge);

        const geomEdge = geometryForState(revealed).edges[edge];
        const lairCapture = geomEdge ? grantLairCapture(revealed, actingSeat, geomEdge.hexes) : null;
        const finalState = lairCapture ? lairCapture.state : revealed;

        if (finalState !== next) return { state: finalState, events: [...events] };
      }
      return null;
    },
  },
};

export type { ScenarioId };

// Re-exports consumed across the engine (board wiring, legal moves, redaction, invariants).
export {
  generateScenarioBoard,
  islandOfHex,
  scenarioBoardFor,
  scenarioFor,
  scenarioGeometryFor,
  scenarioLairHexesFor,
  scenarioPirateTrackFor,
  scenarioTokensFor,
  scenarioVillageHexesFor,
  seedScenarioFog,
} from './board.js';
export type { ResolvedPirateTrackEntry, ScenarioFogSeed } from './board.js';
export { revealFogAt } from './fog.js';
export { clothVp, computeClothGains, isClothForHexhavenState } from './cloth.js';
export { LAIR_VP, grantLairCapture, isPirateIslandsState, lairVp } from './lairs.js';
export { advancePirateTrack } from './pirateTrack.js';
export {
  WONDER_STAGES,
  WONDER_STAGE_COSTS,
  WONDER_THRESHOLDS,
  advanceWonderProgress,
  isWondersOfHexhavenState,
  wonderComplete,
  wonderVp,
} from './wonder.js';
export {
  SHIPS_PER_PLAYER,
  clothOf,
  hexTerrainOf,
  initialSeafarersExt,
  islandChitsOf,
  isSeafarersConfig,
  isSeafarersState,
  lairsOf,
  pirateOf,
  seafarersExt,
  shipsLeftOf,
  shipsOf,
  wonderStagesOf,
} from './state.js';
export {
  buildShip,
  canPlaceShip,
  edgeBordersLand,
  legalShipEdges,
  movableShips,
  moveShip,
  shipMoveTargets,
  vertexTouchesLand,
} from './ships.js';
export { edgeBordersPirate, pirateStealCandidates } from './pirate.js';
export { computeGoldOwed, goldPickCount } from './gold.js';
export { islandChitVp, islandOfVertex } from './chits.js';
export { canPlayRoadBuildingSeafarers, legalFreeShipEdges } from './roadBuilding.js';
