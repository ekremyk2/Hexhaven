// Traders & Barbarians — the MAIN scenario (T-1006, docs/rules/traders-barbarians-rules.md §TB6).
// LAST of the five T&B scenarios: three trade hexes (quarry/glassworks/castle) transform
// commodities (marble/glass/sand/tools, §TB6.1); building a city places a wagon on that city's
// vertex (§TB6.2); on your turn the wagon spends movement points (MP) along paths — a road-less
// edge costs 2 MP, your own road 1 MP, another seat's road 1 MP + 1 gold paid to them, +2 MP extra
// if a barbarian occupies the edge (§TB6.2/§TB6.3); delivering a trade hex's needed commodity there
// scores +1 VP + gold and grants the hex's output commodities (§TB6.3); barbarians also block road
// building on the paths they occupy (§TB6.3).
//
// Mirrors caravans.ts/barbarianAttack.ts's shape: a scenario init for `createGame`, a
// `phaseHooks.afterAction` production hook on `rollDice` + a wagon-placement hook on `buildCity`,
// and a dedicated `moveWagon` handler the module's `interceptAction` routes to (mirroring
// `buildBridgeHandler`/`recruitKnightHandler`) — plus a `buildRoad` REJECTION when the named edge
// carries a barbarian, exactly like Rivers' river-edge exclusion.
//
// ⚠ VERIFY (v1 model, every number a named constant so a rulebook correction is a one-line change):
//  - `TB_TRADE_HEXES`/`TB_PATH_BARBARIAN_EDGES` positions are approximate-but-fixed module-load
//    constants (mirrors fishermen's fishing-grounds / caravans' route-edge precedent) — independent
//    of board terrain (unlike the Lake/Oasis, there are THREE trade hexes and only one desert), so a
//    trade hex may rarely coincide with wherever a given board's desert landed (permanently dormant
//    there — no number token to roll). A documented v1 edge case, not a bug.
//  - `WAGON_MP_PER_TURN` (provisional 4, per the task's decided data model).
//  - Commodity production: "each adjacent settlement/city gains 1 of that hex's OUTPUT commodities"
//    is genuinely ambiguous with two outputs — v1 gives a producing SETTLEMENT one unit of the
//    recipe's FIRST-listed output, a producing CITY one unit of EACH output (mirrors the base
//    "city produces double" multiplier without inventing a third quantity).
//  - Delivery against a 2-commodity recipe (castle: glass + marble) with a single-slot wagon cargo:
//    the wagon's cargo (if it matches one of the hex's needs) covers ONE leg; any remaining needed
//    commodity is drawn straight from the seat's own warehouse STOCK. An empty-cargo wagon may still
//    complete a delivery purely off stock — the wagon's ARRIVAL is what triggers a delivery attempt,
//    cargo merely offsets one leg. A documented v1 simplification of the two-commodity recipe.
//  - `DELIVERY_GOLD` (provisional 2) / `WAGON_TOLL_GOLD` (1 gold per foreign-road edge, per §TB6.2's
//    literal text) / the `gold` field is the SAME shared `ext.gold` track Barbarian Attack uses —
//    safe because T&B scenarios are standalone (TB8.1), never combined.
//  - Path barbarians are STATIC in v1 (no advance/clearing) — §TB6.3 leaves this an open question.
//  - Win target: base 10 (TB1.3 — no override clause for this scenario, unlike Caravans' 12).
//
// T-1054 (5–6, Phase 10B, the LAST T&B scenario to gain 5–6 support): `computeTradeHexes`/
// `computePathBarbarianEdges` are now parameterized on the RESOLVED `BoardGeometry` (base 19-hex, or
// the 30-hex `GEOMETRY_EXT56` for a fiveSix game) instead of always the module-load base `GEOMETRY`
// — mirrors T-1050/T-1051/T-1052/T-1053's fishing-grounds/river-edge/barbarian-ring/caravan-route
// rework. `tradersBarbariansMainGeometryFor(geometry, pathBarbarianCount)` reference-equality
// short-circuits to the base module constants for a 3–4p game (byte-identical, RK-13); any other
// geometry (or a scaled-up `pathBarbarianCount`) recomputes fresh. `initialTradersBarbariansMainExt`
// takes `geometry` as a new parameter (threaded from `createGame` via `geometryForConfig(config)`).
// `applyTradersBarbariansMainProduction`/`legalWagonDestinations`/`moveWagonHandler` below — which
// walk the board's own vertex/edge/hex graph at READ time rather than off a precomputed set — now
// call `geometryForState(state)` instead of always the base `GEOMETRY` (mirrors barbarianAttack.ts's
// knight recruit-edge/move-range lookups and caravans.ts's `caravansVpFor`). The BARBARIAN SUB-
// MECHANIC referenced by this scenario's name is NOT barbarianAttack.ts's mobile-wave/knight system
// (that module stays untouched here, already 5–6-ready per T-1052) — this scenario's own "path
// barbarians" are a wholly separate, STATIC v1 model (§TB6.3, this file's header above), so the only
// geometry this file owns is its own trade-hex placement + path-barbarian-edge set.

import { GEOMETRY } from '@hexhaven/shared';
import type {
  Action,
  BoardGeometry,
  EdgeId,
  EngineErrorCode,
  GameEvent,
  GameState,
  HexId,
  Seat,
  TBCommodity,
  VertexId,
} from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { tbCommodityProduced, tbDeliveryCompleted, tbWagonMoved, tbWagonPlaced } from '../../events.js';
import { geometryForState } from '../index.js';
import {
  isTradersBarbariansMainState,
  pathBarbariansOf,
  tbExt,
  wagonsOf,
  withTbExt,
} from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

// ---- Fixed data (§TB6.1/§TB6.2/§TB6.3, ⚠ VERIFY against the physical rulebook) --------------------

type TradeHexKind = 'quarry' | 'glassworks' | 'castle';

/** §TB6.1: the fixed transform recipes — `needs` (1 or 2 commodities, ALL required) -> `produces`
 *  (always 2, one of each). Named so a correction touches one line. */
export const TB_TRADE_RECIPES: Readonly<
  Record<TradeHexKind, { needs: readonly TBCommodity[]; produces: readonly TBCommodity[] }>
> = {
  quarry: { needs: ['tools'], produces: ['sand', 'marble'] },
  glassworks: { needs: ['sand'], produces: ['tools', 'glass'] },
  castle: { needs: ['glass', 'marble'], produces: ['tools', 'sand'] },
};

/** Every `TBCommodity` value (bot/UI iteration convenience). */
export const TB_COMMODITIES: readonly TBCommodity[] = ['marble', 'glass', 'sand', 'tools'];

/** §TB6.2 ⚠ VERIFY: the wagon movement-point budget per turn owner's turn. */
export const WAGON_MP_PER_TURN = 4;

/** §TB6.2: an edge with no road costs this many MP to cross. */
export const WAGON_MP_NO_ROAD = 2;

/** §TB6.2: an edge with ANY road (own or another seat's) costs this many MP to cross — a foreign
 *  road additionally costs `WAGON_TOLL_GOLD` (paid to that road's owner, not the bank). */
export const WAGON_MP_ROAD = 1;

/** §TB6.2: a barbarian-occupied path costs this many EXTRA MP, on top of the road/no-road base. */
export const WAGON_MP_BARBARIAN_EXTRA = 2;

/** §TB6.2: gold paid to a foreign road's owner (not the bank) per such edge crossed. */
export const WAGON_TOLL_GOLD = 1;

/** §TB6.3 ⚠ VERIFY: flat gold reward for completing a delivery. */
export const DELIVERY_GOLD = 2;

/** How many barbarian pieces occupy fixed paths at game start (§TB6.3, ⚠ VERIFY) at 3–4p — a
 *  module-load constant, unchanged since T-1006 (RK-13). `pathBarbarianCountFor` below scales it up
 *  for 5–6p. */
const TB_PATH_BARBARIAN_COUNT = 3;

/**
 * T-1054 (5–6) ⚠ VERIFY (no rulebook scaling guidance either way — the sim is the arbiter, see
 * sim/tradersBarbariansMain56.test.ts): 3–4p keeps the original `TB_PATH_BARBARIAN_COUNT`
 * (byte-identical, RK-13). A fiveSix game has more seats each building roads across a bigger board,
 * so a still-3-edge blocker set would barely register — scaling +1 per seat beyond 4 (5p -> 4, 6p ->
 * 5) mirrors `barbarianAttack.ts`'s own `barbarianWaveSizeFor` heuristic.
 */
export function pathBarbarianCountFor(playerCount: number): number {
  return playerCount <= 4 ? TB_PATH_BARBARIAN_COUNT : TB_PATH_BARBARIAN_COUNT + (playerCount - 4);
}

/** Axial ring-distance from the board center (mirrors barbarianAttack.ts's own `hexDistance`; kept
 *  as an independent copy rather than a cross-scenario import — every scenario file in this module
 *  is self-contained, per the established fishermen/rivers/caravans/barbarianAttack precedent). */
function hexDistance(hex: { q: number; r: number }): number {
  return Math.max(Math.abs(hex.q), Math.abs(hex.r), Math.abs(hex.q + hex.r));
}

/**
 * ⚠ VERIFY exact positions against the diagram — an approximate-but-fixed v1 simplification
 * (mirrors fishermen/caravans/barbarianAttack's own placement precedents). Three ring-distance-2
 * hexes, evenly spaced by ascending hex id, assigned quarry/glassworks/castle in that order. Takes
 * `geometry` as a parameter (T-1054, 5–6) rather than always reading the base `GEOMETRY` — a fiveSix
 * game passes `GEOMETRY_EXT56` instead. Ring-distance 2 is deliberately NOT "the outermost ring"
 * (unlike barbarianAttack.ts's start hexes): `GEOMETRY_EXT56`'s dist<=2 core is the exact same
 * 12-hex ring as the base board (T-1052's verified subgraph fact), so this stays well-defined and
 * roomy for 3 trade hexes on EITHER board without any board-size-specific branching. Computed once
 * at module load / `createGame` time (never random — pure function of `geometry`), independent of
 * any particular board's terrain/desert placement.
 */
function computeTradeHexes(geometry: BoardGeometry): { hex: HexId; kind: TradeHexKind }[] {
  const kinds: readonly TradeHexKind[] = ['quarry', 'glassworks', 'castle'];
  const outerRing = geometry.hexes
    .filter((h) => hexDistance(h) === 2)
    .map((h) => h.id)
    .sort((a, b) => a - b);
  if (outerRing.length === 0) return [];
  const step = Math.max(1, Math.floor(outerRing.length / kinds.length));
  const out: { hex: HexId; kind: TradeHexKind }[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const hex = outerRing[i * step];
    if (hex === undefined) continue;
    out.push({ hex, kind: kinds[i]! });
  }
  return out;
}

export const TB_TRADE_HEXES: readonly { hex: HexId; kind: TradeHexKind }[] = computeTradeHexes(GEOMETRY);

/**
 * ⚠ VERIFY exact positions — an evenly-spread, fixed module-load constant (mirrors
 * `TB_TRADE_HEXES` above): every `total / count`-th edge by ascending edge id. Takes `geometry` +
 * `count` as parameters (T-1054, 5–6) rather than always reading the base `GEOMETRY`/
 * `TB_PATH_BARBARIAN_COUNT` — a fiveSix game passes `GEOMETRY_EXT56` + `pathBarbarianCountFor`'s
 * scaled-up count instead.
 */
function computePathBarbarianEdges(geometry: BoardGeometry, count: number): EdgeId[] {
  const total = geometry.edges.length;
  const stride = Math.max(1, Math.floor(total / count));
  const out: EdgeId[] = [];
  for (let i = 0; i < count; i++) {
    const edge = geometry.edges[i * stride];
    if (edge) out.push(edge.id);
  }
  return out;
}

export const TB_PATH_BARBARIAN_EDGES: readonly EdgeId[] = computePathBarbarianEdges(
  GEOMETRY,
  TB_PATH_BARBARIAN_COUNT
);

/**
 * Seed THIS game's trade-hex placement / path-barbarian-edge set for `initialTradersBarbariansMainExt`.
 * `geometry === GEOMETRY` (a 3–4p game, reference equality) AND `pathBarbarianCount ===
 * TB_PATH_BARBARIAN_COUNT` short-circuits to the base module constants above — byte-identical result,
 * no recomputation (RK-13; a 3–4p game's `pathBarbarianCount` is always `TB_PATH_BARBARIAN_COUNT` by
 * construction, so this branch is exactly "is this a 3–4p game", mirrors `barbarianGeometryFor`).
 * Any other geometry/count (a fiveSix game's `GEOMETRY_EXT56` + scaled-up count, T-1054) recomputes
 * fresh against it.
 */
export function tradersBarbariansMainGeometryFor(
  geometry: BoardGeometry,
  pathBarbarianCount: number
): { tradeHexes: { hex: HexId; kind: TradeHexKind }[]; pathBarbarians: EdgeId[] } {
  if (geometry === GEOMETRY && pathBarbarianCount === TB_PATH_BARBARIAN_COUNT) {
    return {
      tradeHexes: TB_TRADE_HEXES.map((t) => ({ ...t })),
      pathBarbarians: [...TB_PATH_BARBARIAN_EDGES],
    };
  }
  return {
    tradeHexes: computeTradeHexes(geometry),
    pathBarbarians: computePathBarbarianEdges(geometry, pathBarbarianCount),
  };
}

// ---- Init (createGame) -----------------------------------------------------------------------

/** Seed `ext.tradersBarbarians` for the main-scenario game (createGame, gated on
 *  `isTradersBarbariansMainConfig(config)`). No `rng` draw needed — every fixed constant/derived set
 *  is a pure function of `geometry` (the config's RESOLVED geometry — the base 19-hex board, or
 *  `GEOMETRY_EXT56` for a fiveSix game, T-1054), not randomized per game. No board mutation either
 *  (the trade hexes keep their normal terrain/number token — see this file's header comment). */
export function initialTradersBarbariansMainExt(
  playerCount: number,
  geometry: BoardGeometry
): NonNullable<NonNullable<GameState['ext']>['tradersBarbarians']> {
  const { tradeHexes, pathBarbarians } = tradersBarbariansMainGeometryFor(
    geometry,
    pathBarbarianCountFor(playerCount)
  );
  return {
    scenario: 'tradersBarbarians',
    commodities: Array.from({ length: playerCount }, () => ({ marble: 0, glass: 0, sand: 0, tools: 0 })),
    wagons: [],
    tradeHexes,
    pathBarbarians,
    deliveries: Array.from({ length: playerCount }, () => 0),
    gold: Array.from({ length: playerCount }, () => 0),
  };
}

// ---- Wagon placement (§TB6.2, module `phaseHooks.afterAction` on `buildCity`) -----------------

/** §TB6.2: after a `buildCity` lands, place a new wagon at that city's vertex (`cargo: null`). Never
 *  removed/reordered afterward — later lookups address a wagon by its ARRAY POSITION. `null` outside
 *  the main scenario / for any other action (the module's `afterAction` hook forwards `null` to fall
 *  through to its other checks, docs/10 §3).
 *
 *  T-1054 (5–6) bug fix: accepts `next.phase.kind === 'specialBuild'` too, not just `'main'` — the
 *  fiveSix 2015 SBP turn rule (`modules/fiveSix/specialBuild.ts`) reuses `buildCity` VERBATIM during
 *  its own `{ kind: 'specialBuild' }` phase (never touching `phase` itself), so a city built there
 *  must still get its wagon (TBM1: wagon count == city count, EVERY city, regardless of which
 *  fiveSix turn-rule phase built it). Unreachable at 3–4p (`specialBuild` only exists once the
 *  fiveSix module is active, which itself requires 5–6) — RK-13-safe, purely additive. */
export function applyWagonPlacement(
  next: GameState,
  action: Action,
  events: readonly GameEvent[],
  actingSeat: Seat
): { state: GameState; events: GameEvent[] } | null {
  if (action.type !== 'buildCity') return null;
  if (!isTradersBarbariansMainState(next)) return null;
  if (next.phase.kind !== 'main' && next.phase.kind !== 'specialBuild') return null;
  const ext = tbExt(next);
  if (!ext) return null;

  const wagons = [...(ext.wagons ?? []), { seat: actingSeat, at: action.vertex, cargo: null }];
  const withExt = withTbExt(next, { ...ext, wagons });
  return { state: withExt, events: [...events, tbWagonPlaced(actingSeat, action.vertex)] };
}

// ---- Commodity production (§TB6.1, module `phaseHooks.afterAction` on `rollDice`) --------------

/**
 * §TB6.1: on a trade hex's own number roll (robber-blocked exactly like a normal resource hex,
 * R6.2), each adjacent builder gains commodities — a settlement 1 of the recipe's FIRST output, a
 * city 1 of EACH output (⚠ VERIFY the exact split, see this file's header comment). This is ON TOP
 * of the hex's normal terrain resource production (untouched, §TB6's trade hexes double as ordinary
 * resource hexes). `null` when nothing produced (outside the scenario, or no trade hex matches this
 * roll) — the module's `afterAction` hook forwards `null` to fall through to its other checks.
 */
export function applyTradersBarbariansMainProduction(
  next: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const ext = tbExt(next);
  if (!ext || ext.scenario !== 'tradersBarbarians' || !next.turn.roll) return null;
  const total = next.turn.roll[0] + next.turn.roll[1];

  const tradeHexes = ext.tradeHexes ?? [];
  const commodities = (ext.commodities ?? []).map((c) => ({ ...c }));
  const outEvents: GameEvent[] = [...events];
  let produced = false;
  const geometry = geometryForState(next);

  for (const th of tradeHexes) {
    const hexTile = next.board.hexes[th.hex];
    if (!hexTile || hexTile.token !== total) continue;
    if (next.board.robber === th.hex) continue; // R6.2: the robber blocks this hex's production too.
    const hexGeo = geometry.hexes[th.hex];
    if (!hexGeo) continue;
    const recipe = TB_TRADE_RECIPES[th.kind];
    const settlementGain = recipe.produces[0]!;

    const gains: { seat: Seat; commodities: Partial<Record<TBCommodity, number>> }[] = [];
    for (const vertex of hexGeo.vertices) {
      for (const p of next.players) {
        const isCity = p.cities.includes(vertex);
        const isSettlement = !isCity && p.settlements.includes(vertex);
        if (!isCity && !isSettlement) continue;
        const stock = { ...(commodities[p.seat] ?? { marble: 0, glass: 0, sand: 0, tools: 0 }) };
        const gained: Partial<Record<TBCommodity, number>> = {};
        if (isCity) {
          for (const out of recipe.produces) {
            stock[out] += 1;
            gained[out] = (gained[out] ?? 0) + 1;
          }
        } else {
          stock[settlementGain] += 1;
          gained[settlementGain] = (gained[settlementGain] ?? 0) + 1;
        }
        commodities[p.seat] = stock;
        gains.push({ seat: p.seat, commodities: gained });
      }
    }
    if (gains.length > 0) {
      produced = true;
      outEvents.push(tbCommodityProduced(th.hex, gains));
    }
  }

  if (!produced) return null;
  return { state: withTbExt(next, { ...ext, commodities }), events: outEvents };
}

// ---- moveWagon (§TB6.2/§TB6.3) -----------------------------------------------------------------

/** The MP cost + gold-toll owner (if any) for crossing `edgeId` — shared by the handler's
 *  validation and `legalWagonDestinations`'s search below, so both use the exact same cost model. */
function wagonEdgeCost(
  state: GameState,
  seat: Seat,
  edgeId: EdgeId,
  barbarianEdges: ReadonlySet<EdgeId>
): { mp: number; tollOwner: Seat | null } {
  const ownerSeat = state.players.find((p) => p.roads.includes(edgeId))?.seat;
  let mp = ownerSeat === undefined ? WAGON_MP_NO_ROAD : WAGON_MP_ROAD;
  if (barbarianEdges.has(edgeId)) mp += WAGON_MP_BARBARIAN_EXTRA;
  const tollOwner = ownerSeat !== undefined && ownerSeat !== seat ? ownerSeat : null;
  return { mp, tollOwner };
}

export interface WagonDestination {
  to: VertexId;
  path: EdgeId[];
  mpCost: number;
  goldCost: number;
}

/**
 * Every vertex `seat`'s wagon #`wagonIndex` can reach THIS turn (§TB6.2), with the cheapest-MP path
 * found (ties broken by exploration order) and its total gold toll, filtered to paths the mover can
 * actually afford. Includes the wagon's own current vertex (`path: []` — a "stay" option, useful to
 * load/deliver without moving, a v1 addition the rules don't forbid). Relaxation search (correct for
 * non-negative edge weights even over a plain FIFO frontier — this graph is small enough either way)
 * over `geometryForState(state)`'s vertex graph (T-1054, 5–6, rather than always the base `GEOMETRY`
 * — works the same whether `state` is the engine's own full `GameState` or a client's redacted
 * `PlayerView` cast to one), weighted by `wagonEdgeCost` above. `[]` outside the scenario / main
 * phase / an unknown-to-`seat` wagon.
 */
export function legalWagonDestinations(state: GameState, seat: Seat, wagonIndex: number): WagonDestination[] {
  if (!isTradersBarbariansMainState(state) || state.phase.kind !== 'main') return [];
  const wagon = wagonsOf(state)[wagonIndex];
  if (!wagon || wagon.seat !== seat) return [];
  const gold = tbExt(state)?.gold?.[seat] ?? 0;
  const barbarianEdges = new Set(pathBarbariansOf(state));
  const geometry = geometryForState(state);

  const best = new Map<VertexId, { mp: number; goldCost: number; path: EdgeId[] }>();
  best.set(wagon.at, { mp: 0, goldCost: 0, path: [] });
  const frontier: VertexId[] = [wagon.at];
  while (frontier.length > 0) {
    const current = frontier.shift()!;
    const cur = best.get(current)!;
    const vert = geometry.vertices[current];
    if (!vert) continue;
    for (let i = 0; i < vert.edges.length; i++) {
      const edgeId = vert.edges[i]!;
      const to = vert.neighbors[i]!;
      const { mp, tollOwner } = wagonEdgeCost(state, seat, edgeId, barbarianEdges);
      const toll = tollOwner !== null ? WAGON_TOLL_GOLD : 0;
      const nextMp = cur.mp + mp;
      const nextGold = cur.goldCost + toll;
      if (nextMp > WAGON_MP_PER_TURN || nextGold > gold) continue;
      const existing = best.get(to);
      if (existing && existing.mp <= nextMp) continue;
      best.set(to, { mp: nextMp, goldCost: nextGold, path: [...cur.path, edgeId] });
      frontier.push(to);
    }
  }

  return [...best.entries()].map(([to, info]) => ({
    to,
    path: info.path,
    mpCost: info.mp,
    goldCost: info.goldCost,
  }));
}

/**
 * §TB6.1-§TB6.3: checks whether `kind`'s trade hex will accept a delivery right now given a wagon's
 * `cargo` (may be `null`) and the owner's warehouse `stock` — cargo (if it matches one of the
 * recipe's needs) covers ONE leg, any remaining needed commodity must be present in `stock` (⚠
 * VERIFY / documented v1 simplification of a 2-commodity recipe against a single-slot wagon, see
 * this file's header comment). Returns which commodities must be debited from `stock` on success
 * (cargo's own unit is handled by the caller, not listed here).
 */
function deliveryCheck(
  kind: TradeHexKind,
  cargo: TBCommodity | null,
  stock: Readonly<Record<TBCommodity, number>>
): { ok: true; consumedFromStock: TBCommodity[] } | { ok: false } {
  const needs = [...TB_TRADE_RECIPES[kind].needs];
  if (cargo !== null) {
    const idx = needs.indexOf(cargo);
    if (idx === -1) return { ok: false };
    needs.splice(idx, 1);
  }
  for (const need of needs) {
    if ((stock[need] ?? 0) < 1) return { ok: false };
  }
  return { ok: true, consumedFromStock: needs };
}

/**
 * `moveWagon` (§TB6.2/§TB6.3): validates `action.path` is a connected walk from the wagon's current
 * vertex, computes its total MP cost + foreign-road gold tolls, and rejects if either the MP budget
 * or the mover's gold is exceeded. `action.load` (optional) auto-loads a commodity from the seat's
 * stock at DEPARTURE (only when the wagon starts on the seat's own settlement/city and its cargo
 * slot is empty); arrival at a vertex touching a served trade hex auto-attempts a delivery
 * (`deliveryCheck` above) — the first trade hex found to accept it (ascending `tradeHexes` order)
 * delivers, consuming cargo/stock and crediting output commodities + `DELIVERY_GOLD` + `deliveries`.
 */
export function moveWagonHandler(
  state: GameState,
  seat: Seat,
  action: Extract<Action, { type: 'moveWagon' }>
): EngineResult {
  if (state.phase.kind !== 'main') {
    return fail('WRONG_PHASE', 'wagons may only move in the main phase (§TB6.2)');
  }
  const ext = tbExt(state);
  if (!ext) throw new Error('BUG: tradersBarbariansMain ext missing in moveWagonHandler');
  const wagons = ext.wagons ?? [];
  const wagon = wagons[action.wagon];
  if (!wagon || wagon.seat !== seat) {
    return fail('WAGON_NOT_FOUND', `seat ${seat} has no wagon at index ${action.wagon} (§TB6.2)`);
  }

  const barbarianEdges = new Set(ext.pathBarbarians ?? []);
  const geometry = geometryForState(state);
  let position = wagon.at;
  let mpCost = 0;
  const goldOwed = new Map<Seat, number>();
  for (const edgeId of action.path) {
    const edge = geometry.edges[edgeId];
    if (!edge) return fail('WAGON_MOVE_INVALID', `unknown edge ${edgeId} (§TB6.2)`);
    if (edge.a !== position && edge.b !== position) {
      return fail('WAGON_MOVE_INVALID', `edge ${edgeId} does not connect from vertex ${position} (§TB6.2)`);
    }
    const { mp, tollOwner } = wagonEdgeCost(state, seat, edgeId, barbarianEdges);
    mpCost += mp;
    if (tollOwner !== null) goldOwed.set(tollOwner, (goldOwed.get(tollOwner) ?? 0) + WAGON_TOLL_GOLD);
    position = edge.a === position ? edge.b : edge.a;
  }
  if (mpCost > WAGON_MP_PER_TURN) {
    return fail('WAGON_MP_EXCEEDED', `path costs ${mpCost} MP, budget is ${WAGON_MP_PER_TURN} (§TB6.2)`);
  }
  const totalToll = [...goldOwed.values()].reduce((a, b) => a + b, 0);
  const myGold = ext.gold?.[seat] ?? 0;
  if (totalToll > myGold) {
    return fail('CANT_AFFORD', `cannot afford ${totalToll} gold in road tolls (§TB6.2), holds ${myGold}`);
  }

  const gold = [...(ext.gold ?? [])];
  gold[seat] = (gold[seat] ?? 0) - totalToll;
  for (const [ownerSeat, amount] of goldOwed) gold[ownerSeat] = (gold[ownerSeat] ?? 0) + amount;

  // Auto-load (§TB6.2 "keep it simple" fold-in): at DEPARTURE, before the path is walked, only when
  // the wagon starts on the seat's own settlement/city with an empty cargo slot.
  let cargo = wagon.cargo;
  const commodities = (ext.commodities ?? []).map((c) => ({ ...c }));
  if (action.load !== undefined) {
    if (cargo !== null) return fail('BAD_TRADE', 'the wagon already carries cargo (§TB6.2)');
    const player = state.players[seat];
    const ownsHere = !!player && (player.settlements.includes(wagon.at) || player.cities.includes(wagon.at));
    if (!ownsHere) {
      return fail('BAD_LOCATION', 'the wagon must be at your own settlement/city to load (§TB6.2)');
    }
    const stock = { ...(commodities[seat] ?? { marble: 0, glass: 0, sand: 0, tools: 0 }) };
    if ((stock[action.load] ?? 0) < 1) {
      return fail('CANT_AFFORD', `no ${action.load} in stock to load (§TB6.2)`);
    }
    stock[action.load] -= 1;
    commodities[seat] = stock;
    cargo = action.load;
  }

  let wagonsNext = wagons.map((w, i) => (i === action.wagon ? { ...w, at: position, cargo } : w));
  const events: GameEvent[] = [tbWagonMoved(seat, action.wagon, action.path, mpCost, action.load)];

  // Auto-deliver (§TB6.3): the first served trade hex touching `position` that accepts a delivery
  // right now, ascending `tradeHexes` order (deterministic — mirrors barbarianAttack.ts's own
  // ascending-order combat resolution).
  const deliveries = [...(ext.deliveries ?? [])];
  for (const th of ext.tradeHexes ?? []) {
    const hexGeo = geometry.hexes[th.hex];
    if (!hexGeo || !hexGeo.vertices.includes(position)) continue;
    const stock = commodities[seat] ?? { marble: 0, glass: 0, sand: 0, tools: 0 };
    const check = deliveryCheck(th.kind, wagonsNext[action.wagon]!.cargo, stock);
    if (!check.ok) continue;

    const newStock = { ...stock };
    for (const need of check.consumedFromStock) newStock[need] -= 1;
    const recipe = TB_TRADE_RECIPES[th.kind];
    for (const out of recipe.produces) newStock[out] = (newStock[out] ?? 0) + 1;
    commodities[seat] = newStock;
    wagonsNext = wagonsNext.map((w, i) => (i === action.wagon ? { ...w, cargo: null } : w));
    deliveries[seat] = (deliveries[seat] ?? 0) + 1;
    gold[seat] = (gold[seat] ?? 0) + DELIVERY_GOLD;
    events.push(tbDeliveryCompleted(seat, th.hex, th.kind, [...recipe.produces], DELIVERY_GOLD));
    break;
  }

  const withExt = withTbExt(state, {
    ...ext,
    wagons: wagonsNext,
    commodities,
    gold,
    deliveries,
  });
  return { ok: true, state: withExt, events };
}

// ---- VP (§TB6.3) --------------------------------------------------------------------------------

/** +1 VP per completed delivery (§TB6.3). 0 outside the main scenario. */
export function tradersBarbariansMainVpFor(state: GameState, seat: Seat): number {
  if (!isTradersBarbariansMainState(state)) return 0;
  return tbExt(state)?.deliveries?.[seat] ?? 0;
}
