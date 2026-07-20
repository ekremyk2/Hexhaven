// The Rivers of Hexhaven (T-1003, docs/rules/traders-barbarians-rules.md §TB3). Two rivers run across
// the board along fixed hex edges (§TB3.1); building a settlement on a river-shore vertex or a
// road on an edge touching one earns 1 gold coin, a NEW tradeable (not a resource). Bridges
// (§TB3.2) cross a river edge — a normal road may never be built there — cost 2 brick + 1 lumber,
// join the road network (Longest Road), and earn their own coin reward. Coins trade with the bank
// at 2:1 for the first two trades each turn-owner rotation, then 4:1 (§TB3.3). The Wealthiest
// (+1 VP, sole leader only) and Poorest (-2 VP, every tied-lowest seat) settlers are scored purely
// from `ext.coins` each time (§TB3.4 — no held/hysteresis state, unlike Longest Road/Harbormaster:
// the rule text has NO "ties keep the current holder" carve-out, so `vp.ts` recomputes fresh every
// call — see `riversVpFor` below).
//
// Mirrors fishermen.ts's shape (T-1002's precedent): a scenario init for `createGame`, handler
// functions the module's `interceptAction` routes new actions to (`buildBridge`/`tradeCoins`), and
// a `phaseHooks.afterAction` hook that observes existing base actions (`buildSettlement`/
// `buildRoad`/`buildBridge`/`endTurn`) to award coins / reset the per-turn trade counter — the
// river-edge EXCLUSION on plain `buildRoad` is the one new wrinkle, handled by `interceptAction`
// returning a coded rejection BEFORE the base `mainHandler` ever sees the action (docs/10 §3).
//
// No board mutation (§TB1.2/T-1003's decided data model): river edges are a geometry-derived
// CONSTANT (T-1051, 5–6: parameterized on the RESOLVED `BoardGeometry`, not always the base 3-4p
// board's frozen `GEOMETRY` — `initialRiversExt` below takes `geometry` as a parameter and threads
// it into `state.ts`'s `riverGeometryFor`, mirroring `initialFishermenExt`'s `geometry` parameter;
// still never `geometryForState` — see state.ts's header comment on why that import would cycle).

import type { Action, EdgeId, EngineErrorCode, GameEvent, GameState, ResourceType, Seat } from '@hexhaven/shared';
import type { BoardGeometry } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { bridgeBuilt, coinsAwarded, coinsTraded } from '../../events.js';
import { canAfford, payToBank } from '../../rules/afford.js';
import { updateAwards } from '../../rules/awards.js';
import { isRoadConnected } from '../../rules/connectivity.js';
import { isEdgeOccupied } from '../../rules/placement.js';
import {
  RIVERS_RIVER_EDGES,
  RIVERS_SHORE_VERTICES,
  coinsOf,
  isBridgeOccupied,
  isRiverEdge,
  isRiverShoreEdge,
  isRiverShoreVertex,
  isRiversState,
  riverEdgesOf,
  riverGeometryFor,
  tbExt,
  withTbExt,
} from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// Re-export the river geometry constants/helpers imported above — they actually LIVE in state.ts
// (see that file's header comment for why: `rules/connectivity.ts`'s `canPlaceRoad` needs
// river-edge awareness too, and state.ts is the one leaf file every rule module can import without
// a cycle), but every OTHER caller (bot.ts, tests, index.ts's re-export block) imports rivers-scoped
// names from here, mirroring `initialFishermenExt`/`FISH_EXCHANGE_COST` living in fishermen.ts.
export { RIVERS_RIVER_EDGES, RIVERS_SHORE_VERTICES, isRiverEdge, isRiverShoreEdge, isRiverShoreVertex };

// ---- Fixed data (§TB3.1/§TB3.2, ⚠ VERIFY against the physical rulebook) --------------------------

/** §TB3.2, ⚠ VERIFY exact bridge cost against the rulebook (sources agree on this one). Paid to
 *  the bank, like a road (`rules/afford.ts`'s `canAfford`/`payToBank`). */
export const RIVERS_BRIDGE_COST: Readonly<Partial<Record<ResourceType, number>>> = { brick: 2, lumber: 1 };

/** §TB3.1: the flat coin reward for a settlement/road built on/incident-to a river-shore vertex. */
export const RIVERS_SHORE_COIN_REWARD = 1;

/** §TB3.2, ⚠ VERIFY exact reward — sources disagree ("3 coins" is the most commonly cited figure);
 *  named so a correction is a one-line change. Awarded INSTEAD OF (not in addition to)
 *  `RIVERS_SHORE_COIN_REWARD` for a bridge build — a bridge's own edge always incidentally
 *  qualifies as "shore" too, so stacking both would double-count the same build. */
export const RIVERS_BRIDGE_COIN_REWARD = 3;

/** §TB3.3: the coin-per-resource rate for the first 2 trades each turn-owner rotation. */
export const RIVERS_COIN_TRADE_RATE_EARLY = 2;
/** §TB3.3: the coin-per-resource rate from the 3rd trade onward, same rotation. */
export const RIVERS_COIN_TRADE_RATE_LATE = 4;
/** §TB3.3: how many early-rate trades a turn owner gets before the rate climbs. */
const RIVERS_EARLY_TRADE_LIMIT = 2;

// ---- Init (createGame) -----------------------------------------------------------------------

/**
 * Seed `ext.tradersBarbarians` for a rivers game (createGame, gated on `isRiversConfig(config)`).
 * No `rng` draw needed — river edges are a deterministic function of `geometry`, not randomized
 * per game. `geometry` is the config's RESOLVED geometry (`geometryForConfig(config)` at the call
 * site, T-1051) — the base 19-hex board for a 3–4p game, or `GEOMETRY_EXT56` for a fiveSix one — so
 * a 5–6 rivers game gets its own river layout computed against the board actually in play
 * (`state.ts`'s `riverGeometryFor` short-circuits to the base module constants by reference
 * equality when `geometry === GEOMETRY`, keeping a 3–4p game byte-identical, RK-13).
 */
export function initialRiversExt(
  playerCount: number,
  geometry: BoardGeometry
): NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']> {
  const { riverEdges, riverShoreVertices, riverShoreEdges } = riverGeometryFor(geometry);
  return {
    scenario: 'rivers',
    coins: Array.from({ length: playerCount }, () => 0),
    bridges: Array.from({ length: playerCount }, () => []),
    coinTradesThisTurn: 0,
    riverEdges,
    riverShoreVertices,
    riverShoreEdges,
  };
}

// ---- Coin trade rate (§TB3.3) ------------------------------------------------------------------

/** The CURRENT coin->resource rate for `state`'s turn-owner rotation: 2:1 for the first 2 trades,
 *  4:1 thereafter. 2 outside a rivers game (never read there in practice). */
export function riversCoinTradeRate(state: GameState): 2 | 4 {
  const ext = tbExt(state);
  const made = ext?.coinTradesThisTurn ?? 0;
  return made < RIVERS_EARLY_TRADE_LIMIT ? RIVERS_COIN_TRADE_RATE_EARLY : RIVERS_COIN_TRADE_RATE_LATE;
}

// ---- buildBridge (§TB3.2) --------------------------------------------------------------------

/**
 * `buildBridge` (§TB3.2): legal only on a `RIVERS_RIVER_EDGES` edge, unoccupied by any road/bridge,
 * connected to the seat's own road/bridge network (R7.2, via `isRoadConnected` — bridge-aware,
 * `rules/connectivity.ts`). Bridges draw from their OWN supply, NOT the seat's 15-road piece pool
 * (⚠ VERIFY — physical Traders & Barbarians sets ship bridges as separate wooden pieces, not drawn
 * from the road stock; this also keeps the base I2 piece-supply invariant, which sums
 * `roads.length + piecesLeft.roads`, meaningful for every game including a rivers one): the fixed,
 * tiny `RIVERS_RIVER_EDGES` set (never more than a handful of edges) is itself the natural cap on
 * how many bridges can ever exist, so no separate `bridgesLeft` counter is needed (the decided data
 * model carries none). Coin awarding happens uniformly via `applyRiversCoinAward` (the module's
 * `phaseHooks.afterAction`) rather than here, so every river coin source shares one code path.
 */
export function buildBridgeHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'buildBridge' }>
): EngineResult {
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'bridges may only be built in the main phase (§TB3.2)');
  }
  const edge = action.edge;
  if (!isRiverEdge(state, edge)) {
    return fail('NOT_A_RIVER_EDGE', `edge ${edge} is not a river edge — bridges only cross rivers (§TB3.2)`);
  }
  if (isEdgeOccupied(state, edge) || isBridgeOccupied(state, edge)) {
    return fail('OCCUPIED', `edge ${edge} already carries a road or bridge`);
  }
  const player = state.players[seat];
  if (!player) throw new Error(`BUG: buildBridge for unknown seat ${seat}`);
  if (!isRoadConnected(state, seat, edge)) {
    return fail('NOT_CONNECTED', `edge ${edge} does not connect to your network (R7.2/§TB3.2)`);
  }
  if (!canAfford(player, RIVERS_BRIDGE_COST)) return fail('CANT_AFFORD', 'cannot afford a bridge (§TB3.2)');

  const { players, bank } = payToBank(state, seat, RIVERS_BRIDGE_COST);
  const ext = tbExt(state);
  if (!ext) throw new Error('BUG: rivers ext missing in buildBridgeHandler');
  const bridges = (ext.bridges ?? []).map((list, i) => (i === seat ? [...list, edge] : list));
  const withBridge = withTbExt({ ...state, players, bank }, { ...ext, bridges });

  const awarded = updateAwards(withBridge); // Longest Road recompute — bridges join the network (§TB3.2).
  return { ok: true, state: awarded.state, events: [bridgeBuilt(seat, edge), ...awarded.events] };
}

/** Every legal `buildBridge` target for `seat` right now (client highlighting / the sim bot,
 *  mirrors `legal.ts`'s enumerator shape). `[]` outside a rivers game / the main phase. */
export function legalBridgeEdges(state: GameState, seat: Seat): EdgeId[] {
  if (state.phase.kind !== 'main' || !isRiversState(state)) return [];
  return riverEdgesOf(state).filter(
    (edge) =>
      !isEdgeOccupied(state, edge) && !isBridgeOccupied(state, edge) && isRoadConnected(state, seat, edge)
  );
}

// ---- tradeCoins (§TB3.3) ---------------------------------------------------------------------

/**
 * `tradeCoins` (§TB3.3): spend coins for 1 bank resource at the CURRENT rate (2:1 for the first 2
 * trades this turn-owner rotation, 4:1 thereafter — `riversCoinTradeRate`). `give` must equal that
 * resolved rate exactly (the caller states its intent; the engine is authoritative on the rate, so
 * a stale/guessed `give` is rejected rather than silently reinterpreted).
 */
export function tradeCoinsHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'tradeCoins' }>
): EngineResult {
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'coins may only be traded in the main phase (§TB3.3)');
  }
  const rate = riversCoinTradeRate(state);
  if (action.give !== rate) {
    return fail(
      'BAD_TRADE',
      `tradeCoins must give exactly ${rate} coins at the current rate (§TB3.3), got ${action.give}`
    );
  }
  const held = coinsOf(state, seat);
  if (held < rate) {
    return fail('NOT_ENOUGH_COINS', `seat ${seat} holds ${held} coins, needs ${rate} (§TB3.3)`);
  }
  if (state.bank[action.receive] < 1) return fail('BANK_EMPTY', `the bank has no ${action.receive} left`);

  const ext = tbExt(state);
  if (!ext) throw new Error('BUG: rivers ext missing in tradeCoinsHandler');
  const coins = [...(ext.coins ?? [])];
  coins[seat] = (coins[seat] ?? 0) - rate;
  const coinTradesThisTurn = (ext.coinTradesThisTurn ?? 0) + 1;

  const bank = { ...state.bank, [action.receive]: state.bank[action.receive] - 1 };
  const players = state.players.map((p) =>
    p.seat === seat
      ? { ...p, resources: { ...p.resources, [action.receive]: p.resources[action.receive] + 1 } }
      : p
  );

  const nextState = withTbExt({ ...state, players, bank }, { ...ext, coins, coinTradesThisTurn });
  return { ok: true, state: nextState, events: [coinsTraded(seat, rate, action.receive, rate)] };
}

// ---- Coin awarding + per-turn reset (module `phaseHooks.afterAction`) -------------------------

/**
 * §TB3.1/§TB3.2: award coins after a successful `buildSettlement`/`buildRoad`/`buildBridge` in a
 * rivers game — a settlement on a river-shore vertex or a road on a river-shore edge earns
 * `RIVERS_SHORE_COIN_REWARD`; a bridge build earns `RIVERS_BRIDGE_COIN_REWARD` INSTEAD (not in
 * addition — see that constant's header comment). `null` when nothing qualifies (including outside
 * a rivers game, or an action this scenario doesn't score) — the module's `afterAction` hook
 * forwards `null` to fall through to its other checks (docs/10 §3).
 *
 * Deliberately does NOT observe `placeSetupSettlement`/`placeSetupRoad` (setup-phase placements) —
 * the task's decided data model names only `buildSettlement`/`buildRoad`/`buildBridge` as the
 * observed actions (a documented v1 scope choice, not an oversight).
 */
export function applyRiversCoinAward(
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  actingSeat: Seat
): { state: GameState; events: GameEvent[] } | null {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'rivers') return null;

  let amount = 0;
  let source: 'shore' | 'bridge' | null = null;
  if (action.type === 'buildSettlement' && isRiverShoreVertex(next, action.vertex)) {
    amount = RIVERS_SHORE_COIN_REWARD;
    source = 'shore';
  } else if (action.type === 'buildRoad' && isRiverShoreEdge(next, action.edge)) {
    amount = RIVERS_SHORE_COIN_REWARD;
    source = 'shore';
  } else if (action.type === 'buildBridge') {
    amount = RIVERS_BRIDGE_COIN_REWARD;
    source = 'bridge';
  }
  if (amount === 0 || source === null) return null;

  const coins = [...(ext.coins ?? [])];
  coins[actingSeat] = (coins[actingSeat] ?? 0) + amount;
  const withCoins = withTbExt(next, { ...ext, coins });
  return { state: withCoins, events: [...events, coinsAwarded(actingSeat, amount, source)] };
}

/** §TB3.3: reset the per-turn coin-trade counter on every `endTurn` in a rivers game. `null` when
 *  there's nothing to reset (outside a rivers game, or the counter is already 0). */
export function applyRiversTurnReset(
  next: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'rivers') return null;
  if ((ext.coinTradesThisTurn ?? 0) === 0) return null;
  return { state: withTbExt(next, { ...ext, coinTradesThisTurn: 0 }), events: [...events] };
}

// ---- VP (§TB3.4) -----------------------------------------------------------------------------

/**
 * Wealthiest/Poorest Settler (§TB3.4), recomputed FRESH from `ext.coins` every call — no held
 * state, unlike Longest Road/Harbormaster, because the rule text has no "ties keep the current
 * holder" carve-out (a tie simply means nobody/everybody, every time). Both are 0 while nobody has
 * earned a coin yet (`maxCoins === 0`) — a v1 gate so a fresh rivers game doesn't hand out a -2 VP
 * penalty to every seat simultaneously before the river economy has even started (⚠ VERIFY against
 * the physical rulebook — not explicit in the sourced clause text). `wealthiest` is 1 only for the
 * SOLE seat at the max (ties -> nobody, §TB3.4); `poorest` is 1 for EVERY seat tied at the min (no
 * sole-leader requirement — plural "player(s)" in the rule text).
 */
export function riversVpFor(state: GameState, seat: Seat): { wealthiest: number; poorest: number } {
  const ext = tbExt(state);
  if (!ext || ext.scenario !== 'rivers') return { wealthiest: 0, poorest: 0 };
  const coins = ext.coins ?? [];
  if (coins.length === 0) return { wealthiest: 0, poorest: 0 };
  const maxCoins = Math.max(...coins);
  if (maxCoins === 0) return { wealthiest: 0, poorest: 0 };
  const minCoins = Math.min(...coins);
  const mine = coins[seat] ?? 0;
  const leaders = coins.filter((c) => c === maxCoins).length;
  const wealthiest = leaders === 1 && mine === maxCoins ? 1 : 0;
  const poorest = mine === minCoins ? 1 : 0;
  return { wealthiest, poorest };
}
