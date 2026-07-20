// Explorers & Pirates as a RuleModule (docs/rules/explorers-pirates-rules.md, Phase 11).
//
// T-1101 lays the FOUNDATION: the scenario registry + config gating + a hook-less module skeleton.
// E&P ships FIVE scenarios that layer the mechanics (EP1.1); each is selected via
// `config.expansions.explorersPirates = { scenario }` and self-gated. No scenario is PLAYABLE yet —
// `SHIPPED_EP_SCENARIOS` is empty until T-1102…T-1107 land the ship-movement/exploration/founding
// engine and the "Land Ho!" intro — so `resolveModules` rejects any E&P selection with
// EXPANSION_NOT_AVAILABLE ("coming soon"), exactly how Seafarers/T&B scenarios were gated before they
// were encoded. Per-scenario tasks flip their id into the shipped set and add the board/state/actions.
//
// T-1102 lands the FIRST real engine subsystem — ship movement + crew/cargo (§EP3): `buildEPShip`/
// `moveEPShip`/`loadCargo`/`unloadCargo`, routed via `interceptAction` below, gated on
// `isExplorersPiratesState` (ext PRESENCE, not the config toggle — see state.ts's header comment for
// why: no scenario ships yet, so a config-toggle gate would make this whole subsystem untestable
// before T-1107). A `phaseHooks.afterAction` hook clears the per-turn ship-build/move bookkeeping on
// every `endTurn`, mirroring T&B's own per-turn resets (`applyBarbarianAttackTurnReset`).
//
// T-1105 adds the FIRST mission (§EP7, Pirate Lairs): `buildEPCrew`/`placeCrewOnLair`, routed via
// `interceptAction` below, same ext-presence gate. `revealOnArrival` (exploration.ts) now creates a
// pirate lair whenever a `'pirate'` tile is revealed; `ships.ts`'s `loadCargo`/`unloadCargo` mirror
// T-1104's settler-reserve extension for `'crew'` cargo.
//
// T-1106 adds the LAST two missions + the gold economy (§EP6/§EP8/§EP9, `goldFishSpice.ts`):
// `shipGold`/`tradeSpice`/`deliverFish`/`deliverSpice`, routed via `interceptAction` below, same
// ext-presence gate; a `phaseHooks.afterAction` hook on `rollDice` awards no-resource-roll gold
// compensation (EP6.1) — strictly E&P-gated (`applyGoldCompensation` checks `epExt` itself before
// touching anything), so a base game's `rollDice` stays byte-identical (RK-13). With all three
// missions + gold now built, T-1107 assembles the actual scenarios.
//
// With `explorersPirates` absent (every non-E&P game), this module is never in `activeModules`, so no
// hook runs and no `state.ext.explorersPirates` exists — base/other-expansion play stays byte-
// identical (RK-13).

import type { Action, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import {
  SHIP_CARGO_CAP,
  applyExplorersPiratesTurnReset,
  buildEPShipHandler,
  loadCargoHandler,
  moveEPShipHandler,
  unloadCargoHandler,
} from './ships.js';
import { buildEPCrewHandler, placeCrewOnLairHandler } from './pirateLairs.js';
import {
  applyGoldCompensation,
  deliverFishHandler,
  deliverSpiceHandler,
  shipGoldHandler,
  tradeSpiceHandler,
} from './goldFishSpice.js';
import { buildEPSettlerHandler, foundSettlementHandler, upgradeToHarborHandler } from './settling.js';
import { EP_SCENARIO_CONFIG, isExplorersPiratesState } from './state.js';
import type { RuleModule } from '../types.js';

/** EP1.3 ⚠ VERIFY: Land Ho!'s win target — 8 VP (settlement 1 / harbor settlement 2; the three
 *  mission point tracks are always 0 in Land Ho!, which uses none of them). Kept as a named export
 *  for API stability (createGame.ts now reads `EP_SCENARIO_CONFIG` generically instead). */
export const EP_LANDHO_TARGET_VP = EP_SCENARIO_CONFIG.landHo.winTarget;

/**
 * Ship/cargo action routing (T-1102, §EP3): only ever intercepted in a live E&P game
 * (`isExplorersPiratesState`, ext presence). Every other action falls through (`null`) to normal
 * routing, exactly like `tradersBarbariansIntercept`'s per-scenario switches.
 */
function explorersPiratesIntercept(state: GameState, seat: Seat, action: Action): EngineResult | null {
  if (!isExplorersPiratesState(state)) return null;
  switch (action.type) {
    case 'buildEPShip':
      return buildEPShipHandler(state, seat, action);
    case 'moveEPShip':
      return moveEPShipHandler(state, seat, action);
    case 'loadCargo':
      return loadCargoHandler(state, seat, action);
    case 'unloadCargo':
      return unloadCargoHandler(state, seat, action);
    case 'buildEPSettler':
      return buildEPSettlerHandler(state, seat);
    case 'foundSettlement':
      return foundSettlementHandler(state, seat, action);
    case 'upgradeToHarbor':
      return upgradeToHarborHandler(state, seat, action);
    case 'buildEPCrew':
      return buildEPCrewHandler(state, seat);
    case 'placeCrewOnLair':
      return placeCrewOnLairHandler(state, seat, action);
    case 'shipGold':
      return shipGoldHandler(state, seat);
    case 'tradeSpice':
      return tradeSpiceHandler(state, seat, action, SHIP_CARGO_CAP);
    case 'deliverFish':
      return deliverFishHandler(state, seat);
    case 'deliverSpice':
      return deliverSpiceHandler(state, seat);
    default:
      return null;
  }
}

/**
 * The Explorers & Pirates module. T-1102 adds the first real hooks: `interceptAction` routes the
 * four ship/cargo actions above; `phaseHooks.afterAction` clears `shipsBuiltThisTurn`/
 * `movedShipsThisTurn` after every `endTurn` in a live E&P game. Per-scenario tasks (T-1103…T-1107)
 * add `boardLayout`/further hooks the same way T&B's scenarios layered onto its own module file. A
 * no-op (never in `activeModules`) for a non-E&P game — base/other-expansion play stays byte-
 * identical (RK-13).
 */
export const explorersPiratesModule: RuleModule = {
  id: 'explorersPirates',
  interceptAction: explorersPiratesIntercept,
  phaseHooks: {
    afterAction(_prev, next, action, events) {
      if (action.type === 'rollDice') {
        // T-1106 (§EP6.1): a seat that produced no resources on a producing roll gets compensation
        // gold — strictly E&P-gated (`applyGoldCompensation` itself checks `epExt`), so a base-game
        // `rollDice` never runs this and stays byte-identical (RK-13).
        return applyGoldCompensation(next, events);
      }
      if (action.type !== 'endTurn') return null;
      const reset = applyExplorersPiratesTurnReset(next);
      if (!reset) return null;
      return { state: reset.state, events: [...events] };
    },
  },
};

export {
  EP_MAX_SHIPS_PER_SEAT,
  EP_SHIP_COST,
  SHIP_CARGO_CAP,
  SHIP_MOVE_RANGE,
  applyExplorersPiratesTurnReset,
  buildEPShipHandler,
  epShipMoveTargets,
  epShipPlacementError,
  isSeaEdge,
  loadCargoHandler,
  movableEPShips,
  moveEPShipHandler,
  unloadCargoHandler,
} from './ships.js';
export {
  EP_SCENARIO_CONFIG,
  EP_SCENARIO_IDS,
  EP_SCENARIO_SUPPORTS_56,
  SHIPPED_EP_SCENARIOS,
  councilVertexOf,
  crewSupplyOf,
  epExt,
  epFishMissionActive,
  epGoldOf,
  epSpiceMissionActive,
  epTerrainOf,
  explorersPiratesScenario,
  fishPointsOf,
  fishShoalsOf,
  goldPointsOf,
  harborSettlementsOf,
  isEPScenarioId,
  isExplorersPiratesState,
  isHarborSettlementAt,
  isShipOnEdge,
  lairPointsOf,
  movedShipsThisTurnOf,
  pirateLairsOf,
  seaMapOf,
  settlerSupplyOf,
  shipsBuiltThisTurnOf,
  shipsOf,
  shipsOfSeat,
  spiceBenefitOf,
  spicePointsOf,
  unexploredOf,
  villagesOf,
  withEpExt,
} from './state.js';
export type { EPScenarioId } from './state.js';
export {
  LAND_HO_56_GEOMETRY,
  LAND_HO_56_TERRAINS,
  LAND_HO_56_TOKENS,
  LAND_HO_V0_TERRAINS,
  LAND_HO_V0_TOKENS,
  buildLandHoBoard56,
  buildLandHoBoardV0,
} from './board.js';
export {
  EP_EXPLORATION_TILES,
  EP_EXPLORATION_TILES_56,
  revealOnArrival,
  seedExplorationV0,
} from './exploration.js';
export {
  EP_HARBOR_COST,
  EP_HARBOR_SETTLEMENT_VP,
  EP_SETTLER_COST,
  buildEPSettlerHandler,
  edgeTouchesDiscoveredLand,
  foundSettlementHandler,
  harborSettlementVpFor,
  upgradeToHarborHandler,
  vertexTouchesDiscoveredLand,
} from './settling.js';
export {
  EP_CREW_COST,
  LAIR_CAPTURE_CREWS,
  LAIR_CREW_VP,
  buildEPCrewHandler,
  lairPointsVpFor,
  placeCrewOnLairHandler,
} from './pirateLairs.js';
export {
  FISH_SHOAL_COUNT,
  FISH_SHOAL_COUNT_56,
  FISH_VP_PER_DELIVERY,
  GOLD_COMPENSATION,
  GOLD_PER_VP,
  SPICE_BENEFIT_MAX_BONUS,
  SPICE_TRADE_COST_GOLD,
  SPICE_VP_PER_DELIVERY,
  VILLAGE_COUNT,
  VILLAGE_COUNT_56,
  applyGoldCompensation,
  deliverFishHandler,
  deliverSpiceHandler,
  fishPointsVpFor,
  goldPointsVpFor,
  haulFishOnArrival,
  seedFishSpiceV0,
  shipGoldHandler,
  spicePointsVpFor,
  spiceShipRangeBonus,
  tradeSpiceHandler,
} from './goldFishSpice.js';
