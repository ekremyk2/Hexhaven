// Traders & Barbarians as a RuleModule (docs/rules/traders-barbarians-rules.md, Phase 10).
//
// T-1001 laid the FOUNDATION: the scenario registry + config gating + a hook-less module skeleton.
// T&B is a COMPILATION of five separable scenarios (TB2…TB6); each is selected via
// `config.expansions.tradersBarbarians = { scenario }` and self-gated. T-1002 lands the FIRST
// playable scenario — Fishermen (§TB2): fish production off the Lake + fishing grounds (a
// `phaseHooks.afterAction` hook on `rollDice`, mirroring seafarers' gold sub-phase hook), the five
// `exchangeFish` benefits and `passOldBoot` (routed via `interceptAction`, mirroring seafarers'
// ship actions). Every other scenario id stays rejected with EXPANSION_NOT_AVAILABLE ("coming soon")
// until its own task lands, exactly how Seafarers scenarios were gated before T-705.
//
// With `tradersBarbarians` absent (every non-T&B game), this module is never in `activeModules`, so no
// hook runs and no `state.ext.tradersBarbarians` exists — base/other-expansion play stays byte-
// identical (RK-13).
//
// T-1006 lands the LAST scenario — the main scenario (scenario id `'tradersBarbarians'`, §TB6): trade
// hexes' commodity production (a `phaseHooks.afterAction` hook on `rollDice`, mirroring fishermen's),
// wagon placement on `buildCity` (another `afterAction` hook), `moveWagon` (routed via
// `interceptAction`, mirroring `buildBridge`/`recruitKnight`), and a `buildRoad` rejection when the
// target edge carries a barbarian (mirroring Rivers' river-edge exclusion). With all five scenarios
// now shipped, every declared `TBScenarioId` in `SHIPPED_TB_SCENARIOS` is playable.

import type { Action, EngineErrorCode, GameConfig, GameState, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import {
  applyBarbarianAdvance,
  applyBarbarianAttackTurnReset,
  moveBarbarianKnightHandler,
  recruitKnightHandler,
} from './barbarianAttack.js';
import { caravanVoteHandler, maybeOpenCaravanVote } from './caravans.js';
import { applyFishermenProduction, exchangeFishHandler, passOldBootHandler } from './fishermen.js';
import {
  applyTradersBarbariansMainProduction,
  applyWagonPlacement,
  moveWagonHandler,
} from './main.js';
import {
  applyRiversCoinAward,
  applyRiversTurnReset,
  buildBridgeHandler,
  isRiverEdge,
  tradeCoinsHandler,
} from './rivers.js';
import {
  isBarbarianAttackState,
  isFishermenState,
  isRiversState,
  isTradersBarbariansMainState,
  isPathBarbarianEdge,
} from './state.js';
import type { RuleModule } from '../types.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** Every declared T&B scenario id (TB1.1). A new scenario adds its id here + a `TradersBarbariansExt`
 *  field (packages/shared) + its engine task. Order is the rulebook order. */
export const TB_SCENARIO_IDS = [
  'fishermen',
  'rivers',
  'caravans',
  'barbarianAttack',
  'tradersBarbarians',
] as const;

export type TBScenarioId = (typeof TB_SCENARIO_IDS)[number];

/** Which T&B scenarios are actually BUILT + playable today. `fishermen` ships with T-1002; the rest
 *  join as their own per-scenario task (T-1003…T-1006) lands its board + rules + sim gate. Mirrors the
 *  Seafarers `SHIPPED_EXPANSIONS`/scenario gating discipline (D-026). */
export const SHIPPED_TB_SCENARIOS: ReadonlySet<TBScenarioId> = new Set<TBScenarioId>([
  'fishermen',
  'rivers',
  'caravans',
  'barbarianAttack',
  'tradersBarbarians',
]);

/**
 * Which shipped T&B scenarios support the 5–6 player extension (Phase 10B, T-1050). T&B has no
 * per-scenario BOARD frame (TB1.2 — every scenario plays the base board), so unlike Seafarers'
 * per-scenario `boards[playerCount]` presence gate (T-750), 5–6 support here is a per-scenario
 * CAPABILITY flag: does this scenario's geometry-derived setup (fishing grounds/barbarian
 * ring/caravan routes/river edges/trade hexes/…) actually resolve correctly against the 30-hex
 * `GEOMETRY_EXT56` board? `fishermen` is the first proven (T-1050 seeds its fishing grounds from the
 * RESOLVED config geometry rather than a hardcoded base-board constant, and its lake/production
 * logic was already geometry-driven). The rest stay `false` until their own task (T-1051…T-1055)
 * reworks whatever of their setup is still hardcoded to the 19-hex board and sim-proves it at 5–6.
 * `resolveModules`/the server's `expansionUnavailable` both gate `fiveSix` + T&B on this flag.
 */
export const TB_SCENARIO_SUPPORTS_56: Readonly<Record<TBScenarioId, boolean>> = {
  fishermen: true,
  // T-1051: rivers' river-edge/shore-vertex/shore-edge geometry is now parameterized on the
  // resolved `BoardGeometry` (state.ts's `riverGeometryFor`, threaded through `createGame` via
  // `initialRiversExt`'s new `geometry` parameter) instead of always the base 19-hex `GEOMETRY` —
  // sim-proven at 5–6 (sim/tradersBarbariansRivers56.test.ts).
  rivers: true,
  // T-1053: caravans' Oasis/camel-route-edge geometry (module `caravans.ts`) is now parameterized on
  // the resolved `BoardGeometry` (`computeCaravanRouteEdges`, threaded through `createGame` via
  // `initialCaravansExt`'s new `geometry` parameter) instead of always the base 19-hex `GEOMETRY` —
  // sim-proven at 5–6 (sim/tradersBarbariansCaravans56.test.ts).
  caravans: true,
  // T-1052: barbarianAttack's ring/center/march-path geometry (module `barbarianAttack.ts`) is now
  // parameterized on the resolved `BoardGeometry` (`barbarianGeometryFor`, threaded through
  // `createGame` via `initialBarbarianAttackExt`'s new `geometry` parameter) instead of always the
  // base 19-hex `GEOMETRY` — sim-proven at 5–6 (sim/tradersBarbariansBarbarianAttack56.test.ts).
  barbarianAttack: true,
  // T-1054 (the LAST of the five): the main scenario's own trade-hex placement/path-barbarian-edge
  // geometry (module `main.ts`) is now parameterized on the resolved `BoardGeometry`
  // (`tradersBarbariansMainGeometryFor`, threaded through `createGame` via
  // `initialTradersBarbariansMainExt`'s new `geometry` parameter) instead of always the base 19-hex
  // `GEOMETRY` — sim-proven at 5–6 (sim/tradersBarbariansMain56.test.ts). The main scenario's own
  // "path barbarians" are a separate STATIC v1 model from barbarianAttack.ts's mobile-wave/knight
  // system (that module is untouched here, unaffected either way). Every declared `TBScenarioId` now
  // supports 5–6.
  tradersBarbarians: true,
};

/** Type guard: is `id` a declared T&B scenario? */
export function isTBScenarioId(id: string): id is TBScenarioId {
  return (TB_SCENARIO_IDS as readonly string[]).includes(id);
}

/** The selected T&B scenario id for a config, or `null` when T&B is off. */
export function tradersBarbariansScenario(config: Pick<GameConfig, 'expansions'>): TBScenarioId | null {
  const tb = config.expansions.tradersBarbarians;
  if (!tb) return null;
  return isTBScenarioId(tb.scenario) ? tb.scenario : null;
}

/**
 * Fishermen action routing (§TB2.4/§TB2.5): only ever intercepted in a fishermen game.
 * Rivers action routing (§TB3.2/§TB3.3, T-1003): only ever intercepted in a rivers game —
 * `buildRoad` is rejected outright when it names a river edge (a bridge is required there
 * instead, BEFORE the base `mainHandler` ever sees it); `buildBridge`/`tradeCoins` are fully
 * handled here. Other T&B scenarios (once shipped) add their own gated branches the same way,
 * mirroring how seafarers' `interceptAction` covers every ship/pirate/gold action in one switch.
 */
function tradersBarbariansIntercept(state: GameState, seat: Seat, action: Action): EngineResult | null {
  if (isFishermenState(state)) {
    switch (action.type) {
      case 'exchangeFish':
        return exchangeFishHandler(state, seat, action);
      case 'passOldBoot':
        return passOldBootHandler(state, seat, action);
      default:
        return null;
    }
  }
  if (isRiversState(state)) {
    switch (action.type) {
      case 'buildRoad':
        return isRiverEdge(state, action.edge)
          ? fail('NOT_A_RIVER_EDGE', `edge ${action.edge} is a river edge — build a bridge instead (§TB3.2)`)
          : null;
      case 'buildBridge':
        return buildBridgeHandler(state, seat, action);
      case 'tradeCoins':
        return tradeCoinsHandler(state, seat, action);
      default:
        return null;
    }
  }
  if (isBarbarianAttackState(state)) {
    switch (action.type) {
      case 'recruitKnight':
        return recruitKnightHandler(state, seat, action);
      case 'moveBarbarianKnight':
        return moveBarbarianKnightHandler(state, seat, action);
      default:
        return null;
    }
  }
  // The main scenario (T-1006, §TB6.2/§TB6.3): `buildRoad` is rejected outright when it names a
  // barbarian-occupied path (clear it first — no such action exists in v1, barbarians are static);
  // `moveWagon` is fully handled here, mirroring `buildBridgeHandler`/`recruitKnightHandler` above.
  if (isTradersBarbariansMainState(state)) {
    switch (action.type) {
      case 'buildRoad':
        return isPathBarbarianEdge(state, action.edge)
          ? fail(
              'PATH_BARBARIAN_BLOCKED',
              `edge ${action.edge} is occupied by barbarians — no road may be built there (§TB6.3)`
            )
          : null;
      case 'moveWagon':
        return moveWagonHandler(state, seat, action);
      default:
        return null;
    }
  }
  return null;
}

/**
 * The Traders & Barbarians module. Fishermen (T-1002), Rivers (T-1003), and Caravans (T-1004) are
 * the scenarios with real hooks today: `phaseHooks.afterAction` resolves fish production after a
 * producing `rollDice` (mirroring seafarers' gold sub-phase hook), rivers coin awards after a
 * qualifying `buildSettlement`/`buildRoad`/`buildBridge`, the rivers per-turn coin-trade counter
 * reset after `endTurn`, and the caravans camel-placement vote after a qualifying
 * `buildSettlement`/`buildCity`; `interceptAction` routes `exchangeFish`/`passOldBoot`/
 * `buildBridge`/`tradeCoins` and rejects a river-edge `buildRoad`; `phaseHandlers` owns the new
 * `caravanVote` phase itself (mirroring the fiveSix module's `specialBuild` / seafarers'
 * `chooseGoldResource`); `isActorAllowed` lets a non-turn-owner seat submit `caravanVote`/
 * `placeCamel` while that sub-phase is open (mirroring the base `discard` exemption); `winCheckSeat`
 * re-checks the actual turn owner the instant a camel placement (submitted by the vote's winner, who
 * may not be the turn owner) resolves the sub-phase back to `main` (docs/03 §7 R13.2 discipline).
 * Everything is internally gated on `isFishermenState`/`isRiversState`/`isCaravansState`, so a future
 * scenario sharing this module file adds its own branches without touching these. No-op (never in
 * `activeModules`) for a non-T&B game — base/other-expansion play stays byte-identical (RK-13).
 */
export const tradersBarbariansModule: RuleModule = {
  id: 'tradersBarbarians',
  interceptAction: tradersBarbariansIntercept,
  phaseHandlers: { caravanVote: caravanVoteHandler },
  isActorAllowed(state, seat, action) {
    if (state.phase.kind !== 'caravanVote') return false;
    if (action.type === 'caravanVote') return state.phase.pending.includes(seat);
    if (action.type === 'placeCamel') return state.phase.pending.length === 0 && state.phase.winner === seat;
    return false;
  },
  winCheckSeat(prev, next, _actingSeat, baseWinSeat) {
    if (prev.phase.kind === 'caravanVote' && next.phase.kind === 'main') {
      return next.turn.player;
    }
    return baseWinSeat;
  },
  phaseHooks: {
    afterAction(_prev, next, action, events, actingSeat) {
      if (action.type === 'rollDice') {
        const fishermenResult = applyFishermenProduction(next, events);
        if (fishermenResult) return fishermenResult;
        // The main scenario (T-1006, §TB6.1): trade-hex commodity production — mutually exclusive
        // with fishermen/barbarianAttack (TB8.1 standalone-only), so a safe no-op (`null`) elsewhere.
        const mainProduction = applyTradersBarbariansMainProduction(next, events);
        if (mainProduction) return mainProduction;
        // Barbarian Attack (T-1005, §TB5.2): advance/resolve on every roll — mutually exclusive
        // with fishermen (TB8.1 standalone-only), so this is a safe no-op (`null`) elsewhere.
        return applyBarbarianAdvance(next, events, actingSeat);
      }
      const riversAward = applyRiversCoinAward(next, action, events, actingSeat);
      if (riversAward) return riversAward;
      if (action.type === 'endTurn') {
        const riversReset = applyRiversTurnReset(next, events);
        if (riversReset) return riversReset;
        // Barbarian Attack (§TB5.2): reset the once-per-turn extended-move flag.
        return applyBarbarianAttackTurnReset(next, events);
      }
      // The main scenario (T-1006, §TB6.2): a wagon is placed the moment a `buildCity` lands.
      const wagonPlacement = applyWagonPlacement(next, action, events, actingSeat);
      if (wagonPlacement) return wagonPlacement;
      return maybeOpenCaravanVote(next, action, events, actingSeat);
    },
  },
};

export {
  FISHERMEN_FISHING_GROUNDS,
  FISHERMEN_FISH_STACK,
  FISH_EXCHANGE_COST,
  applyFishermenProduction,
  exchangeFishHandler,
  initialFishermenExt,
  passOldBootHandler,
} from './fishermen.js';
export {
  RIVERS_BRIDGE_COIN_REWARD,
  RIVERS_BRIDGE_COST,
  RIVERS_COIN_TRADE_RATE_EARLY,
  RIVERS_COIN_TRADE_RATE_LATE,
  RIVERS_RIVER_EDGES,
  RIVERS_SHORE_COIN_REWARD,
  RIVERS_SHORE_VERTICES,
  applyRiversCoinAward,
  applyRiversTurnReset,
  buildBridgeHandler,
  initialRiversExt,
  isRiverEdge,
  isRiverShoreEdge,
  isRiverShoreVertex,
  legalBridgeEdges,
  riversCoinTradeRate,
  riversVpFor,
  tradeCoinsHandler,
} from './rivers.js';
export {
  CARAVANS_CAMEL_SUPPLY,
  CARAVANS_TARGET_VP,
  caravansVpFor,
  caravanVoteHandler,
  initialCaravansExt,
  legalCamelEdges,
  maybeOpenCaravanVote,
} from './caravans.js';
export {
  BARBARIAN_CENTER_HEX,
  BARBARIAN_GOLD,
  BARBARIAN_NEXT_HEX,
  BARBARIAN_START_HEXES,
  CAPTURED_VP_DIVISOR,
  KNIGHT_COST,
  KNIGHT_LOSS_GOLD,
  KNIGHT_MOVE_EXTEND_COST_GRAIN,
  KNIGHT_MOVE_EXTENDED_RANGE,
  KNIGHT_MOVE_RANGE,
  applyBarbarianAdvance,
  applyBarbarianAttackTurnReset,
  barbarianAttackVpFor,
  initialBarbarianAttackExt,
  legalKnightMoveTargets,
  legalKnightRecruitEdges,
  moveBarbarianKnightHandler,
  recruitKnightHandler,
} from './barbarianAttack.js';
export {
  DELIVERY_GOLD,
  TB_COMMODITIES,
  TB_PATH_BARBARIAN_EDGES,
  TB_TRADE_HEXES,
  TB_TRADE_RECIPES,
  WAGON_MP_BARBARIAN_EXTRA,
  WAGON_MP_NO_ROAD,
  WAGON_MP_PER_TURN,
  WAGON_MP_ROAD,
  WAGON_TOLL_GOLD,
  applyTradersBarbariansMainProduction,
  applyWagonPlacement,
  initialTradersBarbariansMainExt,
  legalWagonDestinations,
  moveWagonHandler,
  tradersBarbariansMainVpFor,
} from './main.js';
export type { WagonDestination } from './main.js';
export {
  barbarianAttackGoldOf,
  barbariansOf,
  bridgesOf,
  camelsOf,
  capturedBarbariansOf,
  coinsOf,
  coinTradesThisTurnOf,
  deliveriesOf,
  fishOf,
  fishStackOf,
  fishingGroundsOf,
  isBarbarianAttackConfig,
  isBarbarianAttackState,
  isBridgeOccupied,
  isCamelEdge,
  isCaravanRouteEdge,
  isCaravansConfig,
  isCaravansState,
  isFishermenConfig,
  isFishermenState,
  isPathBarbarianEdge,
  isRiversConfig,
  isRiversState,
  isTradersBarbariansMainConfig,
  isTradersBarbariansMainState,
  knightsOf,
  lakeHexOf,
  oasisHexOf,
  oldBootHolder,
  pathBarbariansOf,
  routeEdgesOf,
  tbCommoditiesOf,
  tbExt,
  tbGoldOf,
  tradeHexesOf,
  wagonsOf,
  withTbExt,
} from './state.js';
